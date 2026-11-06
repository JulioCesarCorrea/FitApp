using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using FitnessApp.Api.Domain.Auth;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace FitnessApp.Api.Features.Auth;

/// <summary>Ajustes de SPEC-auth-001 (sección «Auth» de la configuración). Se leen al usarse, no al arrancar.</summary>
public sealed class AuthOptions
{
    public const string Issuer = "fitness-api";
    public const string Audience = "fitness-app";
    public const int LockoutThreshold = 5;
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    public string? JwtKey { get; set; }
    public string? InviteCode { get; set; }
    public int AccessTokenMinutes { get; set; } = 60;
    public int RefreshTokenDays { get; set; } = 90;
    public int RateLimitPerMinute { get; set; } = 20;

    /// <summary>Acepta el encabezado X-User-Id. Solo en desarrollo y pruebas; nunca en producción.</summary>
    public bool DevHeader { get; set; }
}

/// <summary>Reglas del nombre de usuario y la contraseña.</summary>
public static partial class AuthRules
{
    public const int MinPasswordLength = 10;
    public const int MaxPasswordLength = 128;

    [GeneratedRegex("^[a-z0-9._-]{3,30}$")]
    private static partial Regex UsernamePattern();

    public static string NormalizeUsername(string? username) => (username ?? "").Trim().ToLowerInvariant();

    public static bool IsValidUsername(string normalized) => UsernamePattern().IsMatch(normalized);

    /// <summary>Motivo por el que la contraseña no vale, o null si es válida.</summary>
    public static string? PasswordProblem(string? password, string normalizedUsername)
    {
        if (string.IsNullOrEmpty(password)) return "Falta la contraseña.";
        if (password.Length < MinPasswordLength) return $"La contraseña debe tener al menos {MinPasswordLength} caracteres.";
        if (password.Length > MaxPasswordLength) return $"La contraseña admite como máximo {MaxPasswordLength} caracteres.";
        if (string.Equals(password.Trim(), normalizedUsername, StringComparison.OrdinalIgnoreCase))
            return "La contraseña no puede ser igual al nombre de usuario.";
        return null;
    }
}

/// <summary>Contraseñas con PBKDF2 (PasswordHasher: sal propia y parámetros versionados).</summary>
public sealed class PasswordService
{
    private readonly PasswordHasher<AppUser> _hasher = new();
    private readonly string _dummyHash;

    public PasswordService()
    {
        _dummyHash = Hash("contraseña-de-relleno-para-igualar-tiempos");
    }

    public string Hash(string password) => _hasher.HashPassword(null!, password);

    public bool Verify(string hash, string password) =>
        _hasher.VerifyHashedPassword(null!, hash, password) != PasswordVerificationResult.Failed;

    /// <summary>Hace el mismo trabajo que una verificación real, para que un usuario inexistente no tarde menos (AC-06).</summary>
    public void SpendTime(string password) => _hasher.VerifyHashedPassword(null!, _dummyHash, password);
}

/// <summary>Clave de firma de los tokens. Sin clave propia solo se admite en desarrollo y pruebas, con una temporal.</summary>
public sealed class JwtKeyProvider(IOptions<AuthOptions> options, IHostEnvironment environment, ILogger<JwtKeyProvider> logger)
{
    private const int MinKeyBytes = 32;
    private SymmetricSecurityKey? _key;

    public SymmetricSecurityKey SigningKey => _key ??= Resolve();

    private SymmetricSecurityKey Resolve()
    {
        var configured = options.Value.JwtKey;
        if (!string.IsNullOrEmpty(configured) && Encoding.UTF8.GetByteCount(configured) >= MinKeyBytes)
            return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(configured));

        if (!environment.IsDevelopment() && !environment.IsEnvironment("Testing"))
            throw new InvalidOperationException(
                $"Falta Auth:JwtKey (al menos {MinKeyBytes} bytes). Defínela en appsettings.Local.json o en una variable de entorno.");

        logger.LogWarning("Auth:JwtKey no está definida: se usa una clave temporal y las sesiones no sobreviven a un reinicio.");
        return new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(MinKeyBytes));
    }
}

/// <summary>Emite los tokens de acceso (JWT) y de renovación (aleatorio y opaco).</summary>
public sealed class TokenService(IOptions<AuthOptions> options, JwtKeyProvider keys, TimeProvider clock)
{
    public (string Token, int ExpiresIn) CreateAccessToken(AppUser user)
    {
        var minutes = options.Value.AccessTokenMinutes;
        var now = clock.GetUtcNow();
        var claims = new List<Claim> { new("sub", user.Id.ToString()), new("username", user.Username) };
        if (user.MustChangePassword) claims.Add(new Claim("mcp", "1"));

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = AuthOptions.Issuer,
            Audience = AuthOptions.Audience,
            Subject = new ClaimsIdentity(claims),
            NotBefore = now.UtcDateTime,
            Expires = now.AddMinutes(minutes).UtcDateTime,
            SigningCredentials = new SigningCredentials(keys.SigningKey, SecurityAlgorithms.HmacSha256),
        };
        return (new JsonWebTokenHandler().CreateToken(descriptor), minutes * 60);
    }

    public (string Raw, string Hash) NewRefreshToken()
    {
        var raw = Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));
        return (raw, Hash(raw));
    }

    public static string Hash(string raw) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));

    public DateTimeOffset RefreshExpiry() => clock.GetUtcNow().AddDays(options.Value.RefreshTokenDays);
}
