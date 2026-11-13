using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Features.Training.Plan;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Training.Suggestions;

public sealed record AlternativeDto(string ExerciseId, string Name);

public sealed record SuggestionDto(
    string Key, string Kind, string? ExerciseId, string? Day, string Message, List<AlternativeDto>? Alternatives);

public sealed record AcceptSuggestionRequest(string? ReplacementExerciseId);

public abstract record AcceptSuggestionResult
{
    public sealed record Accepted(PlanEntryDto Entry) : AcceptSuggestionResult;
    public sealed record NotFound : AcceptSuggestionResult;
    public sealed record NotAnAlternative : AcceptSuggestionResult;
}

/// <summary>
/// Casos de uso de SPEC-training-005: calcula las sugerencias de la persona en cada consulta, acepta una sustitución y descarta.
/// Todo filtra por la persona que llama (P7). Las sugerencias no se guardan; solo los descartes.
/// </summary>
public sealed class SuggestionsHandler(AppDbContext db, TimeProvider clock)
{
    private sealed record Candidate(SuggestionDto Dto, int Priority, DateOnly SortDate, string? Day, DayOfWeek? DayOfWeek);

    /// <summary>AC-training-005-01 a 09 y 12: sugerencias vigentes, sin las descartadas, en orden y con tope.</summary>
    public async Task<List<SuggestionDto>> ListAsync(Guid userId, CancellationToken ct)
    {
        var all = await ComputeAsync(userId, ct);
        var dismissed = (await db.SuggestionDismissals.AsNoTracking().Where(d => d.UserId == userId).Select(d => d.Key).ToListAsync(ct)).ToHashSet();

        return all
            .Where(c => !dismissed.Contains(c.Dto.Key))
            .OrderBy(c => c.Priority).ThenByDescending(c => c.SortDate).ThenBy(c => c.Dto.Key, StringComparer.Ordinal)
            .Take(SuggestionRules.MaxSuggestions)
            .Select(c => c.Dto)
            .ToList();
    }

    /// <summary>AC-training-005-12 y 13: descarta una sugerencia vigente; una clave desconocida o ajena no hace nada.</summary>
    public async Task DismissAsync(Guid userId, string key, CancellationToken ct)
    {
        if (!(await ComputeAsync(userId, ct)).Any(c => c.Dto.Key == key)) return;
        if (await db.SuggestionDismissals.AnyAsync(d => d.UserId == userId && d.Key == key, ct)) return;

        db.SuggestionDismissals.Add(new SuggestionDismissal { UserId = userId, Key = key, DismissedAt = clock.GetUtcNow() });
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear(); // carrera: otro descarte de la misma clave llegó antes
        }
    }

    /// <summary>AC-training-005-10, 11 y 13: sustituye el ejercicio en el mismo día y la misma posición.</summary>
    public async Task<AcceptSuggestionResult> AcceptAsync(Guid userId, string key, string? replacementId, CancellationToken ct)
    {
        var dismissed = await db.SuggestionDismissals.AnyAsync(d => d.UserId == userId && d.Key == key, ct);
        var suggestion = dismissed ? null : (await ComputeAsync(userId, ct)).FirstOrDefault(c => c.Dto.Key == key);
        if (suggestion?.Dto is not { ExerciseId: { } exerciseId, Alternatives: { } alternatives } || suggestion.DayOfWeek is not { } day)
            return new AcceptSuggestionResult.NotFound();
        if (replacementId is null || alternatives.All(a => a.ExerciseId != replacementId))
            return new AcceptSuggestionResult.NotAnAlternative();

        var entry = await db.PlanEntries.FirstOrDefaultAsync(e => e.UserId == userId && e.Day == day && e.ExerciseId == exerciseId, ct);
        if (entry is null) return new AcceptSuggestionResult.NotFound();

        entry.ExerciseId = replacementId;
        entry.MachineStepKg = null; // el escalón propio era de la máquina anterior
        await db.SaveChangesAsync(ct);
        return new AcceptSuggestionResult.Accepted(new PlanEntryDto(entry.Id, entry.ExerciseId, entry.Order, entry.MachineStepKg));
    }

    private async Task<List<Candidate>> ComputeAsync(Guid userId, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var catalog = await db.Exercises.AsNoTracking().ToDictionaryAsync(e => e.Id, ct);
        var plan = await db.PlanEntries.AsNoTracking().Where(e => e.UserId == userId).ToListAsync(ct);
        var logs = await db.ExerciseLogs.AsNoTracking().Where(l => l.UserId == userId).ToListAsync(ct);
        var restrictionRows = await db.Restrictions.AsNoTracking().Where(r => r.UserId == userId).ToListAsync(ct);
        var restrictions = restrictionRows.Select(r => new Restriction(r.Zone, r.AvoidedMovements.ToHashSet(), r.Level, r.ReviewOn)).ToList();
        var threshold = (await db.TrainingSettings.AsNoTracking().FirstOrDefaultAsync(s => s.UserId == userId, ct))
            ?.StagnationThreshold ?? Stagnation.DefaultThreshold;

        var result = new List<Candidate>();
        var logsByExercise = logs.GroupBy(l => l.ExerciseId).ToDictionary(g => g.Key, g => g.OrderBy(l => l.Date).ToList());

        RestrictionCheck Check(CatalogExercise e) => RestrictionRules.Check(
            new Exercise(e.Name, e.SecondaryZones.Append(e.PrimaryZone).ToHashSet(), e.Movements.ToHashSet()), restrictions);

        List<AlternativeDto> AlternativesFor(CatalogExercise current, DayOfWeek day)
        {
            var inDay = plan.Where(p => p.Day == day).Select(p => p.ExerciseId).ToHashSet();
            var allowed = catalog.Values
                .Where(c => c.PrimaryZone == current.PrimaryZone && c.Id != current.Id && !inDay.Contains(c.Id))
                .Where(c => Check(c).Outcome is RestrictionOutcome.Permitido or RestrictionOutcome.Contexto);
            return SuggestionRules.RankAlternatives(current, allowed).Select(c => new AlternativeDto(c.Id, c.Name)).ToList();
        }

        foreach (var entry in plan.OrderBy(p => Days.OrderOf(p.Day)).ThenBy(p => p.Order))
        {
            if (!catalog.TryGetValue(entry.ExerciseId, out var exercise)) continue;
            var dayName = Days.NameOf(entry.Day);
            var reference = $"{entry.ExerciseId}:{dayName}";

            // AC-09: un ejercicio del plan que choca con una restricción de aviso o bloqueo.
            var check = Check(exercise);
            if (check.Outcome is RestrictionOutcome.Aviso or RestrictionOutcome.Bloqueado)
            {
                var level = check.Outcome == RestrictionOutcome.Bloqueado ? "bloqueo" : "aviso";
                var zones = string.Join(", ", check.Affecting.Select(r => r.Zone).Distinct());
                result.Add(new Candidate(
                    new SuggestionDto(
                        SuggestionRules.Key(SuggestionKind.RestriccionChoque, $"{reference}:{level}"), SuggestionRules.Kind(SuggestionKind.RestriccionChoque),
                        exercise.Id, dayName,
                        $"«{exercise.Name}» ({dayName}) choca con tu restricción de {zones}, que está en nivel {level}.",
                        AlternativesFor(exercise, entry.Day)),
                    0, today, dayName, entry.Day));
            }

            if (!logsByExercise.TryGetValue(entry.ExerciseId, out var history)) continue;

            // AC-02: estancamiento activo con el umbral de la persona, solo con los registros de la última metodología.
            var last = history[^1];
            var sameMethod = history.Where(h => h.Methodology == last.Methodology).ToList();
            var stagnation = last.Methodology == Normal4x15.Name
                ? Normal4x15.CheckStagnation(sameMethod.Select(h => new NormalLog(h.Date, h.LoadKg, h.RepsPerSet ?? [])).ToList(), threshold)
                : Stagnation.Check(
                    sameMethod.Select(h => new ExerciseLog(
                        h.Date, h.LoadKg, new EffectiveSet(h.FirstSetReps), new EffectiveSet(h.SecondSetReps, h.SecondSetAssistedReps))).ToList(),
                    threshold);
            if (stagnation.IsStagnant)
            {
                result.Add(new Candidate(
                    new SuggestionDto(
                        SuggestionRules.Key(SuggestionKind.EjercicioEstancado, reference, last.Date), SuggestionRules.Kind(SuggestionKind.EjercicioEstancado),
                        exercise.Id, dayName,
                        $"Llevas {stagnation.SessionsWithoutProgress} sesiones sin mejorar en «{exercise.Name}». Si quieres, puedes sustituirlo por otro ejercicio.",
                        AlternativesFor(exercise, entry.Day)),
                    2, last.Date, dayName, entry.Day));
            }
        }

        // Las siguientes se calculan por ejercicio (no por día) para no repetirlas si está en varios días.
        foreach (var (exerciseId, history) in logsByExercise)
        {
            if (!catalog.TryGetValue(exerciseId, out var exercise)) continue;
            var last = history[^1];

            // AC-04 y 05: observaciones sobre el método con los dos últimos registros.
            if (SuggestionRules.MethodMessage(history) is { } methodMessage)
            {
                result.Add(new Candidate(
                    new SuggestionDto(
                        SuggestionRules.Key(SuggestionKind.Metodo, exerciseId, last.Date), SuggestionRules.Kind(SuggestionKind.Metodo),
                        exerciseId, null, $"«{exercise.Name}»: {methodMessage}", null),
                    3, last.Date, null, null));
            }

            // AC-07: dos registros del mismo ejercicio con menos de 5 días entre ellos.
            if (SuggestionRules.ShortRecovery(history.Select(h => h.Date).ToList(), today) is { } pair)
            {
                result.Add(new Candidate(
                    new SuggestionDto(
                        SuggestionRules.Key(SuggestionKind.RecuperacionCorta, exerciseId, pair.Later), SuggestionRules.Kind(SuggestionKind.RecuperacionCorta),
                        exerciseId, null,
                        $"«{exercise.Name}»: registraste dos sesiones con {pair.Later.DayNumber - pair.Earlier.DayNumber} días de diferencia " +
                        $"({pair.Earlier:yyyy-MM-dd} y {pair.Later:yyyy-MM-dd}). En Heavy Duty la referencia es de unos 7 días entre sesiones del mismo grupo.",
                        null),
                    5, pair.Later, null, null));
            }
        }

        // AC-06: días del plan sin registros en las dos últimas semanas completas.
        var planDays = plan.Where(p => catalog.ContainsKey(p.ExerciseId)).Select(p => p.Day).ToHashSet();
        foreach (var (day, weekStart) in SuggestionRules.OmittedDays(planDays, logs.Select(l => l.Date).ToHashSet(), today))
        {
            var dayName = Days.NameOf(day);
            result.Add(new Candidate(
                new SuggestionDto(
                    SuggestionRules.Key(SuggestionKind.DiaOmitido, dayName, weekStart), SuggestionRules.Kind(SuggestionKind.DiaOmitido),
                    null, dayName, $"No registraste ninguna sesión del {dayName} en las dos últimas semanas.", null),
                4, weekStart, dayName, day));
        }

        // AC-08: restricciones cuya fecha de revisión llegó (el nivel no cambia solo).
        foreach (var r in restrictionRows.Where(r => r.ReviewOn is { } due && today >= due))
        {
            result.Add(new Candidate(
                new SuggestionDto(
                    SuggestionRules.Key(SuggestionKind.RestriccionRevision, r.Zone, r.ReviewOn!.Value), SuggestionRules.Kind(SuggestionKind.RestriccionRevision),
                    null, null, $"Tu restricción de {r.Zone} tenía revisión el {r.ReviewOn:yyyy-MM-dd}. Revisa si sigue como está.", null),
                1, r.ReviewOn!.Value, null, null));
        }

        return result;
    }
}
