using System.Security.Cryptography;
using FitnessApp.Api.Domain.Auth;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Auth;

public abstract record CreateUserResult
{
    public sealed record Created(string TemporaryPassword, Guid UserId) : CreateUserResult;
    public sealed record UsernameTaken : CreateUserResult;
    public sealed record IdTaken : CreateUserResult;
    public sealed record InvalidUsername : CreateUserResult;
}

public abstract record ResetPasswordResult
{
    public sealed record Reset(string TemporaryPassword) : ResetPasswordResult;
    public sealed record NotFound : ResetPasswordResult;
}

/// <summary>Operaciones del administrador (SPEC-auth-001, AC-18 y AC-19). No son endpoints: las ejecuta <see cref="AdminCli"/>.</summary>
public sealed class AdminCommands(AppDbContext db, PasswordService passwords, TimeProvider clock)
{
    // Sin caracteres que se confunden al leerlos (0/O, 1/l/I).
    private const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

    /// <summary>Crea la cuenta con contraseña temporal. Con <paramref name="id"/> la cuenta hereda los datos guardados con ese id.</summary>
    public async Task<CreateUserResult> CreateUserAsync(string username, Guid? id, CancellationToken ct)
    {
        var normalized = AuthRules.NormalizeUsername(username);
        if (!AuthRules.IsValidUsername(normalized)) return new CreateUserResult.InvalidUsername();
        if (await db.Users.AnyAsync(u => u.Username == normalized, ct)) return new CreateUserResult.UsernameTaken();
        if (id is { } wanted && await db.Users.AnyAsync(u => u.Id == wanted, ct)) return new CreateUserResult.IdTaken();

        var temporary = TemporaryPassword();
        var user = new AppUser
        {
            Id = id ?? Guid.NewGuid(),
            Username = normalized,
            PasswordHash = passwords.Hash(temporary),
            MustChangePassword = true,
            CreatedAt = clock.GetUtcNow(),
        };
        db.Users.Add(user);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            return new CreateUserResult.UsernameTaken();
        }

        return new CreateUserResult.Created(temporary, user.Id);
    }

    public async Task<ResetPasswordResult> ResetPasswordAsync(string username, CancellationToken ct)
    {
        var normalized = AuthRules.NormalizeUsername(username);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == normalized, ct);
        if (user is null) return new ResetPasswordResult.NotFound();

        var temporary = TemporaryPassword();
        var now = clock.GetUtcNow();
        user.PasswordHash = passwords.Hash(temporary);
        user.MustChangePassword = true;
        user.FailedLogins = 0;
        user.LockedUntil = null;
        await db.SaveChangesAsync(ct);
        await db.RefreshTokens.Where(t => t.UserId == user.Id && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
        return new ResetPasswordResult.Reset(temporary);
    }

    private static string TemporaryPassword() => RandomNumberGenerator.GetString(Alphabet, 16);
}

/// <summary>
/// Interfaz de línea de comandos del administrador:
/// <c>dotnet run --project src/Api -- admin create-user &lt;usuario&gt; [--id &lt;guid&gt;]</c> y
/// <c>dotnet run --project src/Api -- admin reset-password &lt;usuario&gt;</c>.
/// </summary>
public static class AdminCli
{
    public static async Task<int> RunAsync(IServiceProvider services, string[] args)
    {
        var commands = services.GetRequiredService<AdminCommands>();

        switch (args)
        {
            case ["create-user", var username, ..]:
                Guid? id = null;
                if (args.Length >= 4 && args[2] == "--id")
                {
                    if (!Guid.TryParse(args[3], out var parsed))
                    {
                        Console.Error.WriteLine("El valor de --id no es un GUID válido.");
                        return 2;
                    }

                    id = parsed;
                }

                switch (await commands.CreateUserAsync(username, id, CancellationToken.None))
                {
                    case CreateUserResult.Created created:
                        Console.WriteLine($"Cuenta creada: {username.Trim().ToLowerInvariant()} (id {created.UserId})");
                        Console.WriteLine($"Contraseña temporal (se muestra una sola vez): {created.TemporaryPassword}");
                        Console.WriteLine("La persona deberá cambiarla al entrar.");
                        return 0;
                    case CreateUserResult.UsernameTaken:
                        Console.Error.WriteLine("Ese nombre de usuario ya existe. No se ha hecho nada.");
                        return 1;
                    case CreateUserResult.IdTaken:
                        Console.Error.WriteLine("Ese id ya pertenece a otra cuenta. No se ha hecho nada.");
                        return 1;
                    default:
                        Console.Error.WriteLine("Nombre de usuario no válido: de 3 a 30 caracteres (letras sin acentos, números, punto, guion o guion bajo).");
                        return 1;
                }

            case ["reset-password", var username]:
                if (await commands.ResetPasswordAsync(username, CancellationToken.None) is ResetPasswordResult.Reset reset)
                {
                    Console.WriteLine($"Contraseña temporal de {username.Trim().ToLowerInvariant()} (se muestra una sola vez): {reset.TemporaryPassword}");
                    Console.WriteLine("Se han cerrado sus sesiones y deberá cambiarla al entrar.");
                    return 0;
                }

                Console.Error.WriteLine("Ese usuario no existe. No se ha hecho nada.");
                return 1;

            default:
                Console.Error.WriteLine("Uso:");
                Console.Error.WriteLine("  admin create-user <usuario> [--id <guid>]");
                Console.Error.WriteLine("  admin reset-password <usuario>");
                return 2;
        }
    }
}
