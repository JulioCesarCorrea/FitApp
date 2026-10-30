namespace FitnessApp.Api.Domain.Auth;

/// <summary>Cuenta de una persona (SPEC-auth-001). El id es el `user_id` de todos sus datos (P7).</summary>
public class AppUser
{
    public Guid Id { get; set; }

    /// <summary>En minúsculas y sin espacios al borde; único.</summary>
    public string Username { get; set; } = "";

    public string PasswordHash { get; set; } = "";

    /// <summary>Tras un alta o un restablecimiento del administrador la persona debe cambiar la contraseña.</summary>
    public bool MustChangePassword { get; set; }

    /// <summary>Fallos de contraseña seguidos; al llegar al límite se bloquea la cuenta.</summary>
    public int FailedLogins { get; set; }

    public DateTimeOffset? LockedUntil { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Token de renovación: solo se guarda su hash. Se usa una vez; cada cadena comparte `FamilyId`.</summary>
public class RefreshToken
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
    public Guid FamilyId { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
