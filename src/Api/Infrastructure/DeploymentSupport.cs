using Npgsql;

namespace FitnessApp.Api.Infrastructure;

/// <summary>Ajustes de despliegue (SPEC-deploy-001). Se leen al usarse, no al arrancar, para que las pruebas puedan sobrescribirlos.</summary>
public sealed class DatabaseOptions
{
    /// <summary>Aplica las migraciones al arrancar (AC-deploy-001-03). Apagado por defecto.</summary>
    public bool MigrateOnStartup { get; set; }
}

public sealed class ProxyOptions
{
    /// <summary>
    /// Confía en X-Forwarded-For y X-Forwarded-Proto (AC-deploy-001-04). Solo detrás del proxy de la plataforma:
    /// si la API fuera accesible directamente, cualquiera podría falsear su IP.
    /// </summary>
    public bool TrustForwardedHeaders { get; set; }
}

/// <summary>Convierte la URL de la base que dan las plataformas (<c>postgresql://usuario:clave@host:puerto/base</c>) al formato de Npgsql.</summary>
public static class DatabaseUrl
{
    /// <exception cref="FormatException">La URL no es válida. El mensaje nunca incluye la URL: lleva la clave.</exception>
    public static string ToConnectionString(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("postgresql" or "postgres")
            || string.IsNullOrEmpty(uri.Host)
            || string.IsNullOrEmpty(uri.UserInfo)
            || uri.AbsolutePath.Trim('/').Length == 0)
        {
            throw new FormatException(
                "DATABASE_URL no es válida: se espera postgresql://usuario:clave@host:puerto/base.");
        }

        var credentials = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.IsDefaultPort || uri.Port < 0 ? 5432 : uri.Port,
            Username = Uri.UnescapeDataString(credentials[0]),
            Password = credentials.Length > 1 ? Uri.UnescapeDataString(credentials[1]) : null,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.Trim('/')),
        };

        foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = pair.Split('=', 2);
            if (kv[0].Equals("sslmode", StringComparison.OrdinalIgnoreCase) && kv.Length == 2
                && Enum.TryParse<SslMode>(kv[1].Replace("-", ""), ignoreCase: true, out var mode))
            {
                builder.SslMode = mode;
            }
        }

        return builder.ConnectionString;
    }

    /// <summary>La cadena explícita manda; si no hay, se usa DATABASE_URL (AC-deploy-001-01 y 02).</summary>
    public static string? Resolve(IConfiguration configuration)
    {
        var explicitString = configuration.GetConnectionString("Default");
        if (!string.IsNullOrWhiteSpace(explicitString)) return explicitString;

        var url = configuration["DATABASE_URL"];
        return string.IsNullOrWhiteSpace(url) ? null : ToConnectionString(url);
    }
}

public static class ListenUrl
{
    /// <summary>
    /// Dirección de escucha en un contenedor (AC-deploy-001-06): la variable PORT que fija la plataforma.
    /// Null si no hay un puerto válido (la imagen base escucha en el 8080) o si la persona ya fijó las direcciones
    /// (<c>ASPNETCORE_URLS</c> o <c>--urls</c>).
    /// </summary>
    public static string? ForContainer(string? port, string? configuredUrls)
    {
        if (!string.IsNullOrWhiteSpace(configuredUrls)) return null;
        return int.TryParse(port, out var p) && p is > 0 and <= 65535 ? $"http://0.0.0.0:{p}" : null;
    }
}
