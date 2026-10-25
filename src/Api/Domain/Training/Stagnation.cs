namespace FitnessApp.Api.Domain.Training;

public sealed record StagnationResult(bool IsStagnant, int SessionsWithoutProgress)
{
    public string? Message => IsStagnant
        ? $"Llevas {SessionsWithoutProgress} sesiones sin mejorar en este ejercicio."
        : null;
}

/// <summary>Detecta estancamiento sobre el historial propio (AC-training-001-09). Es una sugerencia, no un veredicto.</summary>
public static class Stagnation
{
    public const int DefaultThreshold = 3;

    /// <param name="history">Sesiones realizadas, de la más antigua a la más reciente.</param>
    public static StagnationResult Check(IReadOnlyList<ExerciseLog> history, int threshold = DefaultThreshold)
    {
        if (threshold < 1) throw new ArgumentOutOfRangeException(nameof(threshold));

        var streak = 0;
        for (var i = history.Count - 1; i >= 1 && !Improved(history[i - 1], history[i]); i--)
            streak++;

        return new StagnationResult(streak >= threshold, streak);
    }

    // Más carga cuenta como progreso; con la misma carga, más repeticiones propias. Las asistidas no cuentan.
    private static bool Improved(ExerciseLog previous, ExerciseLog current) =>
        current.LoadKg > previous.LoadKg
        || (current.LoadKg == previous.LoadKg
            && (current.FirstSet.OwnReps > previous.FirstSet.OwnReps
                || current.SecondSet.OwnReps > previous.SecondSet.OwnReps));
}
