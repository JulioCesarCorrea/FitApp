using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using FitnessApp.Api.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using Testcontainers.PostgreSql;
using Xunit;

namespace FitnessApp.Api.Tests;

/// <summary>
/// API en memoria sobre un Postgres real, compartido por todos los tests.
/// Si existe FITNESS_TEST_PG (cadena de conexión con permiso para crear bases) se usa ese
/// servidor y se crea una base temporal; si no, se levanta un contenedor con Testcontainers.
/// </summary>
public sealed class ApiFixture : WebApplicationFactory<Program>, IAsyncLifetime
{
    /// <summary>Clave de firma y código de invitación de las pruebas (SPEC-auth-001).</summary>
    public const string JwtKey = "clave-de-pruebas-con-al-menos-32-bytes-0123456789";
    public const string InviteCode = "codigo-de-pruebas";

    private static readonly string? ServerConnection = Environment.GetEnvironmentVariable("FITNESS_TEST_PG");

    private readonly PostgreSqlContainer? _container =
        ServerConnection is null ? new PostgreSqlBuilder("postgres:17").Build() : null;

    private string _dbName = "";
    private string _connectionString = "";

    /// <summary>Carpeta temporal con una imagen de ejemplo del catálogo (AC-training-002-02).</summary>
    public string ImagesDir { get; } = Path.Combine(Path.GetTempPath(), $"fitness-images-{Guid.NewGuid():N}");

    public async Task AddRestrictionAsync(
        Guid userId, string zone, FitnessApp.Api.Domain.Training.RestrictionLevel level, params string[] movements)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Restrictions.Add(new FitnessApp.Api.Domain.Training.UserRestriction
        {
            Id = Guid.NewGuid(), UserId = userId, Zone = zone, AvoidedMovements = movements, Level = level,
        });
        await db.SaveChangesAsync();
    }

    public async Task InitializeAsync()
    {
        if (_container is not null)
        {
            await _container.StartAsync();
            _connectionString = _container.GetConnectionString();
        }
        else
        {
            _dbName = $"fitness_test_{Guid.NewGuid():N}";
            await using var admin = new NpgsqlConnection(ServerConnection);
            await admin.OpenAsync();
            await using (var cmd = new NpgsqlCommand($"CREATE DATABASE \"{_dbName}\"", admin))
                await cmd.ExecuteNonQueryAsync();
            _connectionString = new NpgsqlConnectionStringBuilder(ServerConnection) { Database = _dbName }.ConnectionString;
        }

        using var scope = Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();

        Directory.CreateDirectory(ImagesDir);
        await File.WriteAllBytesAsync(Path.Combine(ImagesDir, "press-plano-con-barra-0.jpg"), [0xFF, 0xD8, 0xFF, 0xD9]);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, cfg) => cfg.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Default"] = _connectionString,
            ["Auth:DevHeader"] = "true",
            ["Exercises:ImagesPath"] = ImagesDir,
            ["Auth:JwtKey"] = JwtKey,
            ["Auth:InviteCode"] = InviteCode,
            // Todas las pruebas comparten origen; el límite real se prueba con una API aparte (AC-auth-001-08).
            ["Auth:RateLimitPerMinute"] = "100000",
        }));
    }

    /// <summary>Token firmado a mano para probar firmas inválidas, caducidad y cambio obligatorio de contraseña.</summary>
    public static string CreateToken(
        Guid userId, string username = "prueba", DateTime? expires = null, string? key = null, bool mustChangePassword = false)
    {
        var until = expires ?? DateTime.UtcNow.AddMinutes(30);
        var claims = new List<Claim> { new("sub", userId.ToString()), new("username", username) };
        if (mustChangePassword) claims.Add(new Claim("mcp", "1"));
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key ?? JwtKey)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken("fitness-api", "fitness-app", claims, until.AddHours(-1), until, credentials);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public HttpClient ClientWithToken(string accessToken, WebApplicationFactory<Program>? factory = null)
    {
        var client = (factory ?? this).CreateClient();
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
        return client;
    }

    /// <summary>API con otra configuración sobre la misma base (límite de peticiones, DevHeader apagado, sin código...).</summary>
    public WebApplicationFactory<Program> WithAuth(params (string Key, string? Value)[] settings) =>
        WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, cfg) =>
            cfg.AddInMemoryCollection(settings.ToDictionary(x => x.Key, x => x.Value))));

    public HttpClient ClientFor(Guid userId)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Id", userId.ToString());
        return client;
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        await base.DisposeAsync();
        if (_container is not null)
        {
            await _container.DisposeAsync();
            return;
        }

        NpgsqlConnection.ClearAllPools();
        await using var admin = new NpgsqlConnection(ServerConnection);
        await admin.OpenAsync();
        await using var cmd = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{_dbName}\" WITH (FORCE)", admin);
        await cmd.ExecuteNonQueryAsync();
    }
}

[CollectionDefinition("api")]
public sealed class ApiCollection : ICollectionFixture<ApiFixture>;
