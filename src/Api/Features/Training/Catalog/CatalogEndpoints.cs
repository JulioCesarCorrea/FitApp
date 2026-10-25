using System.Text.RegularExpressions;
using FitnessApp.Api.Common;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Training.Catalog;

public sealed record ExerciseDto(
    string Id,
    string Name,
    string PrimaryZone,
    string[] SecondaryZones,
    string[] Movements,
    string Equipment,
    string? Bar,
    string[] Images);

public sealed record SectionDto(string Name, List<ExerciseDto> Exercises);

public sealed record CatalogDto(List<SectionDto> Sections);

/// <summary>Caso de uso de SPEC-training-002 (AC-01): el catálogo base agrupado por sección.</summary>
public sealed class ListCatalogHandler(AppDbContext db)
{
    public async Task<CatalogDto> HandleAsync(CancellationToken ct)
    {
        var rows = await db.Exercises.AsNoTracking().OrderBy(e => e.SortOrder).ToListAsync(ct);

        var sections = rows
            .GroupBy(e => e.Section)
            .Select(g => new SectionDto(g.Key, g.Select(e => new ExerciseDto(
                e.Id,
                e.Name,
                e.PrimaryZone,
                e.SecondaryZones,
                e.Movements,
                e.Equipment.ToString(),
                e.Bar?.ToString(),
                [$"/exercise-images/{e.Id}-0.jpg", $"/exercise-images/{e.Id}-1.jpg"])).ToList()))
            .ToList();

        return new CatalogDto(sections);
    }
}

public static partial class CatalogEndpoints
{
    // Solo nombres de imagen del catálogo: minúsculas, números y guiones, con -0 o -1 y extensión conocida.
    [GeneratedRegex(@"^[a-z0-9-]+-[01]\.(jpg|png)$")]
    private static partial Regex ImageName();

    public static void MapCatalogEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/exercises", async (ICurrentUser user, ListCatalogHandler handler, CancellationToken ct) =>
            user.Id is null ? Results.Unauthorized() : Results.Ok(await handler.HandleAsync(ct)));

        // AC-training-002-02: la imagen propia de cada ejercicio, desde la carpeta configurada.
        app.MapGet("/exercise-images/{file}", (string file, IConfiguration config) =>
        {
            var folder = config["Exercises:ImagesPath"];
            if (string.IsNullOrWhiteSpace(folder) || !ImageName().IsMatch(file)) return Results.NotFound();

            var path = Path.Combine(folder, file);
            if (!File.Exists(path)) return Results.NotFound();

            var type = file.EndsWith(".png", StringComparison.Ordinal) ? "image/png" : "image/jpeg";
            return Results.File(path, type);
        });
    }
}
