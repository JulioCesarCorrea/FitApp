using System.Security.Cryptography;
using System.Text;
using FitnessApp.Api.Domain.Auth;
using FitnessApp.Api.Infrastructure;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FitnessApp.Api.Features.Auth;

public sealed record RegisterRequest(string Username, string Password, string InviteCode);

public sealed record LoginRequest(string Username, string Password);

public sealed record RefreshRequest(string RefreshToken);

public sealed record LogoutRequest(string RefreshToken);

public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public sealed record UserDto(Guid Id, string Username, bool MustChangePassword);

public sealed record AuthResponse(string AccessToken, string RefreshToken, int ExpiresIn, UserDto User);

public sealed class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RuleFor(x => x.Username).Must(u => AuthRules.IsValidUsername(AuthRules.NormalizeUsername(u)))
            .WithMessage("El nombre de usuario debe tener de 3 a 30 caracteres: letras sin acentos, números, punto, guion o guion bajo.");
        RuleFor(x => x).Custom((request, context) =>
        {
            var problem = AuthRules.PasswordProblem(request.Password, AuthRules.NormalizeUsername(request.Username));
            if (problem is not null) context.AddFailure(nameof(RegisterRequest.Password), problem);
        });
    }
}

// El usuario y la contraseña de entrada no se validan por formato: no se da pistas de qué cuentas existen.
public sealed class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(x => x.Username).NotEmpty().WithMessage("Falta el nombre de usuario.");
        RuleFor(x => x.Password).NotEmpty().WithMessage("Falta la contraseña.");
    }
}

public sealed class RefreshRequestValidator : AbstractValidator<RefreshRequest>
{
    public RefreshRequestValidator() => RuleFor(x => x.RefreshToken).NotEmpty().WithMessage("Falta el token de renovación.");
}

public sealed class LogoutRequestValidator : AbstractValidator<LogoutRequest>
{
    public LogoutRequestValidator() => RuleFor(x => x.RefreshToken).NotEmpty().WithMessage("Falta el token de renovación.");
}

public sealed class ChangePasswordRequestValidator : AbstractValidator<ChangePasswordRequest>
{
    public ChangePasswordRequestValidator()
    {
        RuleFor(x => x.CurrentPassword).NotEmpty().WithMessage("Falta la contraseña actual.");
        RuleFor(x => x.NewPassword).NotEmpty().WithMessage("Falta la contraseña nueva.");
    }
}

public abstract record RegisterResult
{
    public sealed record Created(AuthResponse Response) : RegisterResult;
    public sealed record InvalidInvite : RegisterResult;
    public sealed record UsernameTaken : RegisterResult;
}

public abstract record LoginResult
{
    public sealed record Ok(AuthResponse Response) : LoginResult;
    public sealed record InvalidCredentials : LoginResult;
    public sealed record Locked(int RetryAfterSeconds) : LoginResult;
}

public abstract record ChangePasswordResult
{
    public sealed record Ok(AuthResponse Response) : ChangePasswordResult;
    public sealed record WrongCurrent : ChangePasswordResult;
    public sealed record InvalidNew(string Message) : ChangePasswordResult;
    public sealed record UnknownUser : ChangePasswordResult;
}

/// <summary>Casos de uso de SPEC-auth-001: registro, entrada, renovación, cierre de sesión y cambio de contraseña.</summary>
public sealed class AuthHandler(
    AppDbContext db, PasswordService passwords, TokenService tokens, IOptions<AuthOptions> options, TimeProvider clock)
{
    public async Task<RegisterResult> RegisterAsync(RegisterRequest request, CancellationToken ct)
    {
        if (!InviteCodeMatches(request.InviteCode)) return new RegisterResult.InvalidInvite();

        var username = AuthRules.NormalizeUsername(request.Username);
        if (await db.Users.AnyAsync(u => u.Username == username, ct)) return new RegisterResult.UsernameTaken();

        var user = new AppUser
        {
            Id = Guid.NewGuid(),
            Username = username,
            PasswordHash = passwords.Hash(request.Password),
            CreatedAt = clock.GetUtcNow(),
        };
        db.Users.Add(user);
        var response = Issue(user, Guid.NewGuid());

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Carrera: otra petición registró el mismo usuario entre la comprobación y la escritura.
            db.ChangeTracker.Clear();
            return new RegisterResult.UsernameTaken();
        }

        return new RegisterResult.Created(response);
    }

    public async Task<LoginResult> LoginAsync(LoginRequest request, CancellationToken ct)
    {
        var username = AuthRules.NormalizeUsername(request.Username);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == username, ct);
        if (user is null)
        {
            passwords.SpendTime(request.Password);
            return new LoginResult.InvalidCredentials();
        }

        var now = clock.GetUtcNow();
        if (user.LockedUntil is { } until && until > now)
            return new LoginResult.Locked((int)Math.Ceiling((until - now).TotalSeconds));

        if (!passwords.Verify(user.PasswordHash, request.Password))
        {
            user.FailedLogins++;
            if (user.FailedLogins >= AuthOptions.LockoutThreshold)
            {
                user.LockedUntil = now + AuthOptions.LockoutDuration;
                user.FailedLogins = 0; // tras el plazo hacen falta otros cinco fallos para volver a bloquear
            }

            await db.SaveChangesAsync(ct);
            return new LoginResult.InvalidCredentials();
        }

        user.FailedLogins = 0;
        user.LockedUntil = null;
        var response = Issue(user, Guid.NewGuid());
        await db.SaveChangesAsync(ct);
        return new LoginResult.Ok(response);
    }

    /// <summary>Rota el token de renovación. Null si no sirve; reutilizar uno ya usado revoca todas las sesiones (AC-11).</summary>
    public async Task<AuthResponse?> RefreshAsync(string rawToken, CancellationToken ct)
    {
        var hash = TokenService.Hash(rawToken);
        var token = await db.RefreshTokens.Include(t => t.User).FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        var now = clock.GetUtcNow();
        if (token?.User is null || token.RevokedAt is not null || token.ExpiresAt <= now) return null;

        // Se «reclama» el token con una actualización condicional: si dos peticiones lo usan a la vez, solo una gana.
        var claimed = await db.RefreshTokens
            .Where(t => t.Id == token.Id && t.UsedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.UsedAt, now), ct);
        if (claimed == 0)
        {
            await RevokeAllAsync(token.UserId, ct);
            return null;
        }

        var response = Issue(token.User, token.FamilyId);
        await db.SaveChangesAsync(ct);
        return response;
    }

    public async Task LogoutAsync(string rawToken, CancellationToken ct)
    {
        var hash = TokenService.Hash(rawToken);
        var now = clock.GetUtcNow();
        await db.RefreshTokens
            .Where(t => t.TokenHash == hash && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
    }

    public async Task<ChangePasswordResult> ChangePasswordAsync(Guid userId, ChangePasswordRequest request, CancellationToken ct)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null) return new ChangePasswordResult.UnknownUser();

        if (!passwords.Verify(user.PasswordHash, request.CurrentPassword)) return new ChangePasswordResult.WrongCurrent();
        if (AuthRules.PasswordProblem(request.NewPassword, user.Username) is { } problem)
            return new ChangePasswordResult.InvalidNew(problem);

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        user.PasswordHash = passwords.Hash(request.NewPassword);
        user.MustChangePassword = false;
        user.FailedLogins = 0;
        user.LockedUntil = null;
        await db.SaveChangesAsync(ct);
        await RevokeAllAsync(user.Id, ct);

        var response = Issue(user, Guid.NewGuid());
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return new ChangePasswordResult.Ok(response);
    }

    public async Task<UserDto?> MeAsync(Guid userId, CancellationToken ct) =>
        await db.Users.AsNoTracking().Where(u => u.Id == userId)
            .Select(u => new UserDto(u.Id, u.Username, u.MustChangePassword)).FirstOrDefaultAsync(ct);

    private Task<int> RevokeAllAsync(Guid userId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        return db.RefreshTokens.Where(t => t.UserId == userId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
    }

    /// <summary>Crea el par de tokens y deja la fila de renovación pendiente de guardar.</summary>
    private AuthResponse Issue(AppUser user, Guid familyId)
    {
        var (access, expiresIn) = tokens.CreateAccessToken(user);
        var (raw, hash) = tokens.NewRefreshToken();
        db.RefreshTokens.Add(new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            FamilyId = familyId,
            TokenHash = hash,
            ExpiresAt = tokens.RefreshExpiry(),
            CreatedAt = clock.GetUtcNow(),
        });
        return new AuthResponse(access, raw, expiresIn, new UserDto(user.Id, user.Username, user.MustChangePassword));
    }

    // Comparación en tiempo constante (sobre los hashes, para que no dependa de la longitud).
    private bool InviteCodeMatches(string? candidate)
    {
        var expected = options.Value.InviteCode;
        if (string.IsNullOrEmpty(expected) || string.IsNullOrEmpty(candidate)) return false;
        return CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(candidate)), SHA256.HashData(Encoding.UTF8.GetBytes(expected)));
    }
}
