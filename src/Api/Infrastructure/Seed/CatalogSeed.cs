using System.Text.Json;
using System.Text.Json.Serialization;
using FitnessApp.Api.Domain.Training;

namespace FitnessApp.Api.Infrastructure.Seed;

/// <summary>Carga inicial del catálogo base desde el JSON incrustado (catalog.json).</summary>
public static class CatalogSeed
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public static IReadOnlyList<CatalogExercise> Load()
    {
        var assembly = typeof(CatalogSeed).Assembly;
        var resource = assembly.GetManifestResourceNames().Single(n => n.EndsWith("catalog.json", StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(resource)!;
        return JsonSerializer.Deserialize<List<CatalogExercise>>(stream, Options)!;
    }
}
