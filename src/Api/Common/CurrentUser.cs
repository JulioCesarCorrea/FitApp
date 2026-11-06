namespace FitnessApp.Api.Common;

public interface ICurrentUser
{
    /// <summary>Id de la persona autenticada, o null si no hay sesión.</summary>
    Guid? Id { get; }
}

/// <summary>Usuario del token de acceso (SPEC-auth-001): el id sale de la firma verificada, nunca de un dato del cliente.</summary>
public sealed class JwtCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public Guid? Id =>
        Guid.TryParse(accessor.HttpContext?.User.FindFirst("sub")?.Value, out var id) ? id : null;
}

/// <summary>
/// Usuario de desarrollo: toma el id del encabezado X-User-Id. Solo se registra si
/// Auth:DevHeader es true (desarrollo y pruebas). Con un token válido manda el token.
/// </summary>
public sealed class DevHeaderCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public Guid? Id =>
        accessor.HttpContext?.Request.Headers.TryGetValue("X-User-Id", out var v) == true
        && Guid.TryParse(v.ToString(), out var id)
            ? id
            : null;
}

public sealed class AnonymousCurrentUser : ICurrentUser
{
    public Guid? Id => null;
}
