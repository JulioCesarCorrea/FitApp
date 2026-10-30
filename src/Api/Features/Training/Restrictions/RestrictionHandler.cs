using FitnessApp.Api.Common;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Infrastructure;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Training.Restrictions;

/// <param name="Level">contexto | aviso | bloqueo.</param>
public sealed record RestrictionRequest(string Zone, string[]? AvoidedMovements, string Level, DateOnly? ReviewOn);

public sealed record RestrictionDto(Guid Id, string Zone, string[] AvoidedMovements, string Level, DateOnly? ReviewOn);

public sealed class RestrictionRequestValidator : AbstractValidator<RestrictionRequest>
{
    public RestrictionRequestValidator(TimeProvider clock)
    {
        RuleFor(x => x.Zone).Must(z => !string.IsNullOrWhiteSpace(z) && z.Trim().Length <= 60)
            .WithMessage("Falta la zona.");
        RuleFor(x => x.Level).Must(l => RestrictionHandler.TryParseLevel(l, out _))
            .WithMessage("El nivel debe ser contexto, aviso o bloqueo.");
        // Un día de margen por las zonas horarias, como el resto de fechas.
        RuleFor(x => x.ReviewOn).Must(d => d >= DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime).AddDays(-1))
            .When(x => x.ReviewOn is not null)
            .WithMessage("La fecha de revisión no puede ser anterior a hoy.");
    }
}

public abstract record PutRestrictionResult
{
    public sealed record Saved(RestrictionDto Restriction, bool Created) : PutRestrictionResult;
    public sealed record Invalid(Dictionary<string, string[]> Errors) : PutRestrictionResult;
    public sealed record NotFound : PutRestrictionResult;
}

/// <summary>Gestión de las restricciones de la persona (SPEC-profile-001, AC-06 a 10; P3). Todo filtra por su `user_id` (P7).</summary>
public sealed class RestrictionHandler(AppDbContext db)
{
    public const int MaxPerUser = 30;

    public static bool TryParseLevel(string? text, out RestrictionLevel level)
    {
        level = default;
        return text is not null
            && Enum.TryParse(text.Trim(), ignoreCase: true, out level)
            && Enum.IsDefined(level);
    }

    public async Task<List<RestrictionDto>> ListAsync(Guid userId, CancellationToken ct)
    {
        var rows = await db.Restrictions.AsNoTracking().Where(r => r.UserId == userId).OrderBy(r => r.Zone).ThenBy(r => r.Id).ToListAsync(ct);
        return rows.Select(ToDto).ToList();
    }

    public async Task<PutRestrictionResult> PutAsync(Guid userId, Guid id, RestrictionRequest request, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            var zone = request.Zone.Trim().ToLowerInvariant();
            var movements = (request.AvoidedMovements ?? [])
                .Select(m => m.Trim().ToLowerInvariant()).Where(m => m.Length > 0).Distinct().ToArray();
            TryParseLevel(request.Level, out var level);

            // Zonas y movimientos válidos: los del catálogo (y el grupo «hombros»).
            var catalog = await db.Exercises.AsNoTracking()
                .Select(e => new { e.PrimaryZone, e.SecondaryZones, e.Movements }).ToListAsync(ct);
            var zones = catalog.SelectMany(e => e.SecondaryZones.Append(e.PrimaryZone)).Append("hombros").ToHashSet();
            var knownMovements = catalog.SelectMany(e => e.Movements).ToHashSet();

            var errors = new Dictionary<string, string[]>();
            if (!zones.Contains(zone)) errors["zone"] = [$"La zona '{request.Zone.Trim()}' no existe en el catálogo."];
            var unknown = movements.Where(m => !knownMovements.Contains(m)).ToArray();
            if (unknown.Length > 0) errors["avoidedMovements"] = unknown.Select(m => $"El movimiento '{m}' no existe en el catálogo.").ToArray();
            if (errors.Count > 0) return new PutRestrictionResult.Invalid(errors);

            var existing = await db.Restrictions.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (existing is not null && existing.UserId != userId) return new PutRestrictionResult.NotFound();

            if (existing is null && await db.Restrictions.CountAsync(r => r.UserId == userId, ct) >= MaxPerUser)
                return new PutRestrictionResult.Invalid(new() { ["restrictions"] = [$"Se admiten como máximo {MaxPerUser} restricciones."] });

            var created = existing is null;
            if (existing is null)
            {
                existing = new UserRestriction { Id = id, UserId = userId };
                db.Restrictions.Add(existing);
            }

            existing.Zone = zone;
            existing.AvoidedMovements = movements;
            existing.Level = level;
            existing.ReviewOn = request.ReviewOn;

            try
            {
                await db.SaveChangesAsync(ct);
                return new PutRestrictionResult.Saved(ToDto(existing), created);
            }
            catch (DbUpdateException) when (attempt == 0)
            {
                // Carrera con otro envío del mismo id: se vuelve a resolver una vez.
                db.ChangeTracker.Clear();
            }
        }
    }

    /// <summary>Borra la restricción propia; si no existe o es de otra persona no hace nada.</summary>
    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct) =>
        await db.Restrictions.Where(r => r.Id == id && r.UserId == userId).ExecuteDeleteAsync(ct);

    private static RestrictionDto ToDto(UserRestriction r) =>
        new(r.Id, r.Zone, r.AvoidedMovements, r.Level.ToString().ToLowerInvariant(), r.ReviewOn);
}

public static class RestrictionEndpoints
{
    public static void MapRestrictionEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/restrictions", async (ICurrentUser user, RestrictionHandler handler, CancellationToken ct) =>
            user.Id is not { } userId ? Results.Unauthorized() : Results.Ok(await handler.ListAsync(userId, ct)));

        app.MapPut("/restrictions/{id:guid}", async (
                Guid id, RestrictionRequest request, ICurrentUser user, RestrictionHandler handler, CancellationToken ct) =>
            {
                if (user.Id is not { } userId) return Results.Unauthorized();

                return await handler.PutAsync(userId, id, request, ct) switch
                {
                    PutRestrictionResult.Saved { Created: true } saved => Results.Created($"/restrictions/{id}", saved.Restriction),
                    PutRestrictionResult.Saved saved => Results.Ok(saved.Restriction),
                    PutRestrictionResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                    _ => Results.NotFound(),
                };
            })
            .AddEndpointFilter<ValidationFilter<RestrictionRequest>>();

        app.MapDelete("/restrictions/{id:guid}", async (Guid id, ICurrentUser user, RestrictionHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();

            await handler.DeleteAsync(userId, id, ct);
            return Results.NoContent();
        });
    }
}
