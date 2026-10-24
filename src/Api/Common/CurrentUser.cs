namespace FitnessApp.Api.Common;

public interface ICurrentUser
{
    /// <summary>Id de la persona autenticada, o null si no hay sesión.</summary>
    Guid? Id { get; }
}

/// <summary>
/// Usuario de desarrollo: toma el id del encabezado X-User-Id. Solo se registra si
/// Auth:DevHeader es true. El login real es otra spec; sin él, toda petición recibe 401.
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
