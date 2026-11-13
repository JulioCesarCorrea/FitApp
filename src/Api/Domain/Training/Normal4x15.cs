namespace FitnessApp.Api.Domain.Training;

/// <summary>Registro de un ejercicio con la metodología «normal» 4×15 (SPEC-training-004): 4 series con la misma carga.</summary>
public sealed record NormalLog(DateOnly Date, decimal LoadKg, IReadOnlyList<int> Reps)
{
    public int TotalReps => Reps.Sum();
}

/// <summary>
/// Reglas de la metodología «normal» 4×15 (SPEC-training-004). Las series 1 a 3 se detienen en 15 repeticiones y la 4.ª
/// va al fallo propio, sin asistidas. La progresión es una doble progresión 12–15.
/// </summary>
public static class Normal4x15
{
    public const string Name = "normal_4x15";
    public const int Sets = 4;
    public const int TargetReps = 15;
    public const int BandFloorReps = 12;
    public const int MaxFailureReps = 50;

    /// <param name="allowZeroLoad">Ejercicios de peso corporal: la carga es el lastre y puede ser 0.</param>
    public static NormalLog Register(DateOnly date, decimal loadKg, IReadOnlyList<int> reps, bool allowZeroLoad = false)
    {
        if (reps.Count != Sets)
            throw new ArgumentException($"Se exigen exactamente {Sets} series.", nameof(reps));
        if (loadKg < 0 || (loadKg == 0 && !allowZeroLoad))
            throw new ArgumentOutOfRangeException(nameof(loadKg), "La carga debe ser mayor que cero.");
        for (var i = 0; i < Sets - 1; i++)
            if (reps[i] is < 1 or > TargetReps)
                throw new ArgumentOutOfRangeException(nameof(reps), $"Las series 1 a 3 llevan entre 1 y {TargetReps} repeticiones.");
        if (reps[Sets - 1] is < 1 or > MaxFailureReps)
            throw new ArgumentOutOfRangeException(nameof(reps), $"La serie 4 lleva entre 1 y {MaxFailureReps} repeticiones.");

        return new NormalLog(date, loadKg, reps.ToArray());
    }

    /// <summary>Evalúa la serie 1: menos de 12 es carga alta, 12 a 14 en banda y 15 es el techo (AC-training-004-06).</summary>
    public static FirstSetEvaluation EvaluateFirstSet(int reps) => reps switch
    {
        < 1 or > TargetReps => throw new ArgumentOutOfRangeException(nameof(reps), $"Debe estar entre 1 y {TargetReps}."),
        < BandFloorReps => FirstSetEvaluation.PorDebajo,
        < TargetReps => FirstSetEvaluation.EnBanda,
        _ => FirstSetEvaluation.Techo,
    };

    /// <summary>Sube a la siguiente carga del equipo si las 4 series llegaron a 15 repeticiones propias o más (AC-training-004-05).</summary>
    public static LoadAdvice Advise(NormalLog log, IReadOnlyList<decimal> availableLoads)
    {
        if (log.Reps.Any(r => r < TargetReps)) return new LoadAdvice(LoadAction.Mantener, log.LoadKg);

        var higher = availableLoads.Where(l => l > log.LoadKg).ToList();
        return higher.Count > 0
            ? new LoadAdvice(LoadAction.Subir, higher.Min())
            : new LoadAdvice(LoadAction.Mantener, log.LoadKg, MissingLoadData: true);
    }

    /// <summary>
    /// Estancamiento (AC-training-004-07): sin progreso es no subir la carga ni sumar repeticiones totales con la misma carga.
    /// Bajar de carga reinicia la comparación.
    /// </summary>
    public static StagnationResult CheckStagnation(IReadOnlyList<NormalLog> history, int threshold = Stagnation.DefaultThreshold)
    {
        if (threshold < 1) throw new ArgumentOutOfRangeException(nameof(threshold));

        var streak = 0;
        for (var i = history.Count - 1; i >= 1; i--)
        {
            var (previous, current) = (history[i - 1], history[i]);
            if (current.LoadKg < previous.LoadKg || Improved(previous, current)) break;
            streak++;
        }

        return new StagnationResult(streak >= threshold, streak);
    }

    private static bool Improved(NormalLog previous, NormalLog current) =>
        current.LoadKg > previous.LoadKg
        || (current.LoadKg == previous.LoadKg && current.TotalReps > previous.TotalReps);
}
