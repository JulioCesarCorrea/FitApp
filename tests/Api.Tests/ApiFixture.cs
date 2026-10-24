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
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, cfg) => cfg.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Default"] = _connectionString,
            ["Auth:DevHeader"] = "true",
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
