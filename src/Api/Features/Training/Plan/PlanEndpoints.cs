using FitnessApp.Api.Common;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Infrastructure;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Training.Plan;

public sealed record PlanEntryRequest(Guid Id, string ExerciseId, int Order, decimal? MachineStepKg);

/// <param name="ConfirmWarnings">La persona confirma los avisos de restricciones (nivel aviso) y guarda igualmente.</param>
public sealed record SavePlanDayRequest(List<PlanEntryRequest> Entries, bool ConfirmWarnings = false);

public sealed record PlanEntryDto(Guid Id, string ExerciseId, int Order, decimal? MachineStepKg);

public sealed record PlanDayDto(string Day, List<PlanEntryDto> Entries);

public sealed record PlanDto(List<PlanDayDto> Days);

public sealed record RestrictionHit(string ExerciseId, string ExerciseName, string[] Zones);

public sealed class SavePlanDayValidator : AbstractValidator<SavePlanDayRequest>
{
    public const int MaxEntriesPerDay = 30;

    public SavePlanDayValidator()
    {
        RuleFor(x => x.Entries).NotNull()
            .Must(e => e is { Count: <= MaxEntriesPerDay }).WithMessage($"Se admiten como máximo {MaxEntriesPerDay} ejercicios por día.")
            .Must(e => e.Select(x => x.Id).Distinct().Count() == e.Count).WithMessage("Hay identificadores repetidos.")
            // AC-training-002-10: un ejercicio puede estar en varios días, pero solo una vez en cada día.
            .Must(e => e.Select(x => x.ExerciseId).Distinct().Count() == e.Count)
            .WithMessage("Un ejercicio solo puede estar una vez por día.");
        RuleForEach(x => x.Entries).ChildRules(entry =>
        {
            entry.RuleFor(x => x.Id).NotEmpty().WithMessage("Cada entrada necesita su identificador.");
            entry.RuleFor(x => x.ExerciseId).NotEmpty().MaximumLength(120).WithMessage("Cada entrada necesita un ejercicio.");
            entry.RuleFor(x => x.Order).GreaterThanOrEqualTo(0).WithMessage("El orden no puede ser negativo.");
            entry.RuleFor(x => x.MachineStepKg).GreaterThan(0m).When(x => x.MachineStepKg is not null)
                .WithMessage("El escalón de la máquina debe ser mayor que cero.");
        });
    }
}

public abstract record SaveDayResult
{
    public sealed record Saved(PlanDayDto Day) : SaveDayResult;
    public sealed record UnknownExercises(string[] Ids) : SaveDayResult;
    public sealed record IdInUse : SaveDayResult;
    public sealed record Blocked(List<RestrictionHit> Hits) : SaveDayResult;
    public sealed record Warnings(List<RestrictionHit> Hits) : SaveDayResult;
}

/// <summary>Casos de uso de SPEC-training-002: ver y guardar la rutina de la persona (AC-03, 05, 06, 07, 08).</summary>
public sealed class PlanHandler(AppDbContext db)
{
    public async Task<PlanDto> GetAsync(Guid userId, CancellationToken ct)
    {
        var entries = await db.PlanEntries.AsNoTracking().Where(e => e.UserId == userId).ToListAsync(ct);

        var days = entries
            .GroupBy(e => e.Day)
            .OrderBy(g => Days.OrderOf(g.Key))
            .Select(g => ToDay(g.Key, g))
            .ToList();

        return new PlanDto(days);
    }

    public async Task<SaveDayResult> SaveDayAsync(Guid userId, DayOfWeek day, SavePlanDayRequest request, CancellationToken ct)
    {
        var requested = request.Entries;
        var requestedIds = requested.Select(e => e.Id).ToList();

        var exerciseIds = requested.Select(e => e.ExerciseId).Distinct().ToList();
        var catalog = await db.Exercises.AsNoTracking().Where(e => exerciseIds.Contains(e.Id)).ToDictionaryAsync(e => e.Id, ct);
        var unknown = exerciseIds.Where(id => !catalog.ContainsKey(id)).ToArray();
        if (unknown.Length > 0) return new SaveDayResult.UnknownExercises(unknown);

        var rows = await db.PlanEntries
            .Where(e => (e.UserId == userId && e.Day == day) || requestedIds.Contains(e.Id))
            .ToListAsync(ct);

        // Mismo id de otra persona o de otro día: no se revela nada (como en los pesos).
        if (rows.Any(r => requestedIds.Contains(r.Id) && (r.UserId != userId || r.Day != day)))
            return new SaveDayResult.IdInUse();

        var current = rows.Where(r => r.UserId == userId && r.Day == day).ToDictionary(r => r.Id);

        var restrictions = (await db.Restrictions.AsNoTracking().Where(r => r.UserId == userId).ToListAsync(ct))
            .Select(r => new Restriction(r.Zone, r.AvoidedMovements.ToHashSet(), r.Level, r.ReviewOn))
            .ToList();

        var blocked = new List<RestrictionHit>();
        var warnings = new List<RestrictionHit>();
        foreach (var entry in requested.Where(e => !current.ContainsKey(e.Id)))
        {
            var item = catalog[entry.ExerciseId];
            var exercise = new Exercise(
                item.Name,
                item.SecondaryZones.Append(item.PrimaryZone).ToHashSet(),
                item.Movements.ToHashSet());
            var check = RestrictionRules.Check(exercise, restrictions);
            var hit = new RestrictionHit(item.Id, item.Name, check.Affecting.Select(r => r.Zone).Distinct().ToArray());

            if (check.Outcome == RestrictionOutcome.Bloqueado) blocked.Add(hit);
            else if (check.Outcome == RestrictionOutcome.Aviso) warnings.Add(hit);
        }

        if (blocked.Count > 0) return new SaveDayResult.Blocked(blocked);
        if (warnings.Count > 0 && !request.ConfirmWarnings) return new SaveDayResult.Warnings(warnings);

        db.PlanEntries.RemoveRange(current.Values.Where(r => !requestedIds.Contains(r.Id)));
        foreach (var entry in requested)
        {
            if (current.TryGetValue(entry.Id, out var existing))
            {
                existing.ExerciseId = entry.ExerciseId;
                existing.Order = entry.Order;
                existing.MachineStepKg = entry.MachineStepKg;
                continue;
            }

            db.PlanEntries.Add(new PlanEntry
            {
                Id = entry.Id,
                UserId = userId,
                Day = day,
                ExerciseId = entry.ExerciseId,
                Order = entry.Order,
                MachineStepKg = entry.MachineStepKg,
            });
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Carrera: otra petición con el mismo id se guardó entre la lectura y la escritura.
            db.ChangeTracker.Clear();
            return new SaveDayResult.IdInUse();
        }

        var saved = await db.PlanEntries.AsNoTracking().Where(e => e.UserId == userId && e.Day == day).ToListAsync(ct);
        return new SaveDayResult.Saved(ToDay(day, saved));
    }

    private static PlanDayDto ToDay(DayOfWeek day, IEnumerable<PlanEntry> entries) =>
        new(Days.NameOf(day),
            entries.OrderBy(e => e.Order).Select(e => new PlanEntryDto(e.Id, e.ExerciseId, e.Order, e.MachineStepKg)).ToList());
}

public static class PlanEndpoints
{
    public static void MapPlanEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/plan", async (ICurrentUser user, PlanHandler handler, CancellationToken ct) =>
            user.Id is not { } userId ? Results.Unauthorized() : Results.Ok(await handler.GetAsync(userId, ct)));

        app.MapPut("/plan/days/{day}", async (
                string day,
                SavePlanDayRequest request,
                ICurrentUser user,
                PlanHandler handler,
                CancellationToken ct) =>
            {
                if (user.Id is not { } userId) return Results.Unauthorized();
                if (!Days.TryParse(day, out var dayOfWeek))
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["day"] = ["Día no válido."] });

                return await handler.SaveDayAsync(userId, dayOfWeek, request, ct) switch
                {
                    SaveDayResult.Saved saved => Results.Ok(saved.Day),
                    SaveDayResult.UnknownExercises unknown => Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["entries"] = unknown.Ids.Select(id => $"El ejercicio '{id}' no existe en el catálogo.").ToArray(),
                    }),
                    SaveDayResult.Blocked blocked => Results.Problem(
                        statusCode: StatusCodes.Status422UnprocessableEntity,
                        title: "Un ejercicio choca con una restricción en nivel bloqueo.",
                        extensions: new Dictionary<string, object?> { ["blocked"] = blocked.Hits }),
                    SaveDayResult.Warnings warnings => Results.Problem(
                        statusCode: StatusCodes.Status409Conflict,
                        title: "Hay avisos de restricciones; confirma para guardar.",
                        extensions: new Dictionary<string, object?> { ["warnings"] = warnings.Hits }),
                    _ => Results.Problem(
                        statusCode: StatusCodes.Status409Conflict,
                        title: "El identificador ya está en uso."),
                };
            })
            .AddEndpointFilter<ValidationFilter<SavePlanDayRequest>>();
    }
}
