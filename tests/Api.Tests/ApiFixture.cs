using FitnessApp.Api.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
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
        }));
    }

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
