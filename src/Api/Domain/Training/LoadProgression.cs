namespace FitnessApp.Api.Domain.Training;

public enum LoadAction { Mantener, Subir }

public sealed record LoadAdvice(LoadAction Action, decimal NextLoadKg);

/// <summary>Regla de progresión de carga (AC-training-001-07).</summary>
public static class LoadProgression
{
    public const int FirstSetTrigger = ExerciseLog.CeilingReps;
    public const int SecondSetOwnRepsTrigger = 8;

    /// <param name="incrementKg">Incremento del ejercicio: un plato, un disco o la siguiente mancuerna, en kg.</param>
    public static LoadAdvice Advise(ExerciseLog log, decimal incrementKg)
    {
        if (incrementKg <= 0)
            throw new ArgumentOutOfRangeException(nameof(incrementKg), "El incremento debe ser mayor que cero.");

        return log.FirstSet.OwnReps >= FirstSetTrigger && log.SecondSet.OwnReps >= SecondSetOwnRepsTrigger
            ? new LoadAdvice(LoadAction.Subir, log.LoadKg + incrementKg)
            : new LoadAdvice(LoadAction.Mantener, log.LoadKg);
    }
}
