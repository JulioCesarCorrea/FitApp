namespace FitnessApp.Api.Domain.Training;

public enum LoadAction { Mantener, Subir }

/// <param name="MissingLoadData">Se cumplió la condición de subir, pero no hay una carga superior registrada.</param>
public sealed record LoadAdvice(LoadAction Action, decimal NextLoadKg, bool MissingLoadData = false);

/// <summary>Regla de progresión de carga (AC-training-001-07).</summary>
public static class LoadProgression
{
    public const int FirstSetTrigger = ExerciseLog.CeilingReps;
    public const int SecondSetOwnRepsTrigger = 8;

    /// <param name="availableLoads">Cargas posibles del equipo del ejercicio (EquipmentProfile.LoadsFor).</param>
    public static LoadAdvice Advise(ExerciseLog log, IReadOnlyList<decimal> availableLoads)
    {
        var triggered = log.FirstSet.OwnReps >= FirstSetTrigger && log.SecondSet.OwnReps >= SecondSetOwnRepsTrigger;
        if (!triggered) return new LoadAdvice(LoadAction.Mantener, log.LoadKg);

        var higher = availableLoads.Where(l => l > log.LoadKg).ToList();
        return higher.Count > 0
            ? new LoadAdvice(LoadAction.Subir, higher.Min())
            : new LoadAdvice(LoadAction.Mantener, log.LoadKg, MissingLoadData: true);
    }
}
