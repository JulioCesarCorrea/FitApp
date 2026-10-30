using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Training.Sessions;

public sealed record StagnationDto(bool IsStagnant, int SessionsWithoutProgress, string? Message);

/// <param name="Action">subir | mantener.</param>
/// <param name="FirstSetEvaluation">por_debajo | en_banda | meta_alcanzada | por_encima | techo.</param>
public sealed record AdviceDto(
    string Action, decimal NextLoadKg, bool MissingLoadData, string FirstSetEvaluation, StagnationDto Stagnation);

public abstract record AdviceResult
{
    public sealed record UnknownExercise : AdviceResult;
    public sealed record NoRecords : AdviceResult;
    public sealed record Advice(AdviceDto Dto) : AdviceResult;
}

/// <summary>Consejo de carga y aviso de estancamiento de un ejercicio (SPEC-training-003, AC-09, 10, 11). Determinista, sin IA (P1, P4).</summary>
public sealed class AdviceHandler(AppDbContext db)
{
    public async Task<AdviceResult> GetAsync(Guid userId, string exerciseId, CancellationToken ct)
    {
        var exercise = await db.Exercises.AsNoTracking().FirstOrDefaultAsync(e => e.Id == exerciseId, ct);
        if (exercise is null) return new AdviceResult.UnknownExercise();

        var rows = await db.ExerciseLogs.AsNoTracking()
            .Where(l => l.UserId == userId && l.ExerciseId == exerciseId)
            .OrderBy(l => l.Date)
            .ToListAsync(ct);
        if (rows.Count == 0) return new AdviceResult.NoRecords();

        var history = rows.Select(r => new ExerciseLog(
            r.Date, r.LoadKg, new EffectiveSet(r.FirstSetReps), new EffectiveSet(r.SecondSetReps, r.SecondSetAssistedReps))).ToList();
        var last = history[^1];

        var threshold = (await db.TrainingSettings.AsNoTracking().FirstOrDefaultAsync(s => s.UserId == userId, ct))
            ?.StagnationThreshold ?? Stagnation.DefaultThreshold;

        var load = exercise.Equipment == EquipmentKind.PesoCorporal
            ? new LoadAdvice(LoadAction.Mantener, last.LoadKg) // el peso corporal no tiene carga siguiente que proponer
            : LoadProgression.Advise(last, await LoadsAsync(userId, exercise, ct));

        var stagnation = Stagnation.Check(history, threshold);
        return new AdviceResult.Advice(new AdviceDto(
            load.Action == LoadAction.Subir ? "subir" : "mantener",
            load.NextLoadKg,
            load.MissingLoadData,
            Name(ExerciseLog.EvaluateFirstSet(last.FirstSet.OwnReps)),
            new StagnationDto(stagnation.IsStagnant, stagnation.SessionsWithoutProgress, stagnation.Message)));
    }

    // Cargas posibles con el equipamiento de la persona; sin perfil guardado no hay cargas.
    private async Task<IReadOnlyList<decimal>> LoadsAsync(Guid userId, CatalogExercise exercise, CancellationToken ct)
    {
        var settings = await db.Equipment.AsNoTracking().FirstOrDefaultAsync(e => e.UserId == userId, ct);
        if (settings is null) return [];

        var bars = new Dictionary<BarKind, decimal>();
        if (settings.RectaBarKg is { } recta) bars[BarKind.Recta] = recta;
        if (settings.ZBarKg is { } z) bars[BarKind.Z] = z;
        if (settings.SmithBarKg is { } smith) bars[BarKind.Smith] = smith;
        if (settings.RemoEnTBarKg is { } remo) bars[BarKind.RemoEnT] = remo;
        var profile = new EquipmentProfile(
            settings.DumbbellsKg, bars, settings.DiscsKg, settings.MachineStepKg, settings.MachineBaseKg);

        // El escalón propio de la máquina, si la rutina de la persona lo define para este ejercicio.
        var step = await db.PlanEntries.AsNoTracking()
            .Where(p => p.UserId == userId && p.ExerciseId == exercise.Id && p.MachineStepKg != null)
            .Select(p => p.MachineStepKg)
            .FirstOrDefaultAsync(ct);

        return profile.LoadsFor(exercise.Equipment, exercise.Bar, step);
    }

    private static string Name(FirstSetEvaluation e) => e switch
    {
        FirstSetEvaluation.PorDebajo => "por_debajo",
        FirstSetEvaluation.EnBanda => "en_banda",
        FirstSetEvaluation.MetaAlcanzada => "meta_alcanzada",
        FirstSetEvaluation.PorEncima => "por_encima",
        _ => "techo",
    };
}
