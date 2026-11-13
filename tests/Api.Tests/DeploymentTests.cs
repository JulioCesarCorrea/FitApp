using System.Net;
using System.Net.Http.Json;
using FitnessApp.Api.Features.Auth;
using FitnessApp.Api.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace FitnessApp.Api.Tests;

/// <summary>Verifica SPEC-deploy-001: lo que deja la API lista para desplegar. Cada test cita su AC.</summary>
public sealed class DeploymentUnitTests
{
    private static IConfiguration Config(params (string Key, string? Value)[] values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values.ToDictionary(v => v.Key, v => v.Value)).Build();

    // AC-01
    [Fact]
    public void AC_deploy_001_01_convierte_la_url_de_la_plataforma_a_una_cadena_de_npgsql()
    {
        var cs = new NpgsqlConnectionStringBuilder(
            DatabaseUrl.ToConnectionString("postgresql://usuario:clave@postgres.railway.internal:5433/railway"));

        Assert.Equal("postgres.railway.internal", cs.Host);
        Assert.Equal(5433, cs.Port);
        Assert.Equal("usuario", cs.Username);
        Assert.Equal("clave", cs.Password);
        Assert.Equal("railway", cs.Database);
    }

    [Fact]
    public void AC_deploy_001_01_acepta_postgres_sin_puerto_y_decodifica_los_caracteres_especiales_de_la_clave()
    {
        var cs = new NpgsqlConnectionStringBuilder(
            DatabaseUrl.ToConnectionString("postgres://u%40x:p%40ss%3Aw%2Frd%23@host/base"));

        Assert.Equal(5432, cs.Port);
        Assert.Equal("u@x", cs.Username);
        Assert.Equal("p@ss:w/rd#", cs.Password);
        Assert.Equal("base", cs.Database);
    }

    [Theory]
    [InlineData("require", SslMode.Require)]
    [InlineData("disable", SslMode.Disable)]
    [InlineData("verify-full", SslMode.VerifyFull)]
    public void AC_deploy_001_01_respeta_sslmode(string value, SslMode expected)
    {
        var cs = new NpgsqlConnectionStringBuilder(
            DatabaseUrl.ToConnectionString($"postgresql://u:p@host:5432/base?sslmode={value}"));

        Assert.Equal(expected, cs.SslMode);
    }

    [Fact]
    public void AC_deploy_001_01_sin_cadena_explicita_resuelve_la_database_url()
    {
        var resolved = DatabaseUrl.Resolve(Config(("DATABASE_URL", "postgresql://u:p@host:5432/base")));

        Assert.Equal("host", new NpgsqlConnectionStringBuilder(resolved).Host);
    }

    // AC-02
    [Fact]
    public void AC_deploy_001_02_la_cadena_explicita_manda_sobre_database_url()
    {
        var resolved = DatabaseUrl.Resolve(Config(
            ("ConnectionStrings:Default", "Host=local;Database=x;Username=u;Password=p"),
            ("DATABASE_URL", "postgresql://u:p@remoto:5432/base")));

        Assert.Equal("local", new NpgsqlConnectionStringBuilder(resolved).Host);
    }

    [Fact]
    public void AC_deploy_001_02_sin_ninguna_de_las_dos_no_hay_base()
    {
        Assert.Null(DatabaseUrl.Resolve(Config()));
    }

    [Theory]
    [InlineData("no-es-una-url")]
    [InlineData("mysql://u:p@host/base")]
    [InlineData("postgresql://host/base")] // sin usuario
    [InlineData("postgresql://u:SECRETA@host")] // sin base
    public void AC_deploy_001_02_una_database_url_mal_formada_falla_sin_mostrar_la_clave(string url)
    {
        var error = Assert.Throws<FormatException>(() => DatabaseUrl.Resolve(Config(("DATABASE_URL", url))));

        Assert.Contains("DATABASE_URL no es válida", error.Message);
        Assert.DoesNotContain("SECRETA", error.Message);
        Assert.DoesNotContain(url, error.Message);
    }

    // AC-06
    [Theory]
    [InlineData("3000", null, "http://0.0.0.0:3000")]
    [InlineData("8080", "", "http://0.0.0.0:8080")]
    [InlineData(null, null, null)] // sin PORT: escucha la imagen base (8080)
    [InlineData("", null, null)]
    [InlineData("abc", null, null)]
    [InlineData("70000", null, null)]
    [InlineData("3000", "http://0.0.0.0:5080", null)] // unas direcciones fijadas a mano mandan
    public void AC_deploy_001_06_escucha_en_el_puerto_de_la_plataforma(string? port, string? urls, string? expected)
    {
        Assert.Equal(expected, ListenUrl.ForContainer(port, urls));
    }
}

[Collection("api")]
public sealed class DeploymentApiTests(ApiFixture api)
{
    private const string Password = "contraseña-segura-1";

    private static HttpRequestMessage FailedLogin(string forwardedFor, string username = "nadie") =>
        new(HttpMethod.Post, "/auth/login")
        {
            Content = JsonContent.Create(new LoginRequest(username, Password)),
            Headers = { { "X-Forwarded-For", forwardedFor } },
        };

    // AC-03
    [Fact]
    public async Task AC_deploy_001_03_con_migrate_on_startup_una_base_vacia_queda_con_esquema_y_catalogo()
    {
        var empty = await api.CreateEmptyDatabaseAsync();
        await using var factory = api.WithAuth(("ConnectionStrings:Default", empty), ("Database:MigrateOnStartup", "true"));

        var response = await factory.CreateClient().GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var connection = new NpgsqlConnection(empty);
        await connection.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT COUNT(*) FROM exercises", connection);
        Assert.True((long)(await cmd.ExecuteScalarAsync())! > 100); // el catálogo base (114 ejercicios) llega con las migraciones
    }

    [Fact]
    public async Task AC_deploy_001_03_sin_migrate_on_startup_no_toca_el_esquema()
    {
        var empty = await api.CreateEmptyDatabaseAsync();
        await using var factory = api.WithAuth(("ConnectionStrings:Default", empty), ("Database:MigrateOnStartup", "false"));

        var response = await factory.CreateClient().GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var connection = new NpgsqlConnection(empty);
        await connection.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'exercises'", connection);
        Assert.Equal(0L, await cmd.ExecuteScalarAsync());
    }

    // AC-04
    [Fact]
    public async Task AC_deploy_001_04_con_proxy_de_confianza_cada_ip_cuenta_por_separado()
    {
        await using var factory = api.WithAuth(("Auth:RateLimitPerMinute", "1"), ("Proxy:TrustForwardedHeaders", "true"));
        var client = factory.CreateClient();

        var first = await client.SendAsync(FailedLogin("203.0.113.10"));
        var otherIp = await client.SendAsync(FailedLogin("203.0.113.11"));
        var sameIp = await client.SendAsync(FailedLogin("203.0.113.10"));

        Assert.Equal(HttpStatusCode.Unauthorized, first.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, otherIp.StatusCode); // otra IP, otro cupo
        Assert.Equal(HttpStatusCode.TooManyRequests, sameIp.StatusCode);
    }

    [Fact]
    public async Task AC_deploy_001_04_sin_proxy_de_confianza_se_ignora_el_encabezado_y_todos_comparten_origen()
    {
        await using var factory = api.WithAuth(("Auth:RateLimitPerMinute", "1"), ("Proxy:TrustForwardedHeaders", "false"));
        var client = factory.CreateClient();

        var first = await client.SendAsync(FailedLogin("203.0.113.10"));
        var otherIp = await client.SendAsync(FailedLogin("203.0.113.11"));

        Assert.Equal(HttpStatusCode.Unauthorized, first.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, otherIp.StatusCode);
    }

    // AC-05
    [Fact]
    public void AC_deploy_001_05_en_produccion_con_dev_header_activo_la_api_no_arranca()
    {
        using var factory = api.WithAuth(("Auth:DevHeader", "true")).WithWebHostBuilder(b => b.UseEnvironment("Production"));

        var error = Assert.ThrowsAny<Exception>(() => factory.CreateClient());

        Assert.Contains("Auth:DevHeader", Flatten(error));
    }

    [Fact]
    public async Task AC_deploy_001_05_en_produccion_sin_dev_header_arranca_y_el_encabezado_ya_no_identifica()
    {
        await using var factory = api.WithAuth(("Auth:DevHeader", "false")).WithWebHostBuilder(b => b.UseEnvironment("Production"));
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Id", Guid.NewGuid().ToString());

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/weights")).StatusCode);
    }

    private static string Flatten(Exception e) =>
        string.Join(" | ", Enumerate(e).Select(x => x.Message));

    private static IEnumerable<Exception> Enumerate(Exception? e)
    {
        for (; e is not null; e = e.InnerException) yield return e;
    }
}
