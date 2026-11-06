namespace FitnessApp.Api.Domain.Training;

public readonly record struct Tempo(int NegativeSeconds, int PositiveSeconds)
{
    /// <summary>4 s de negativa y 1 s de positiva (AC-training-001-05).</summary>
    public static Tempo Standard { get; } = new(4, 1);
}

public enum FirstSetEvaluation { PorDebajo, EnBanda, MetaAlcanzada, PorEncima, Techo }

/// <summary>Serie efectiva. Las repeticiones asistidas (spotter) van aparte de las propias.</summary>
public sealed record EffectiveSet(int OwnReps, int AssistedReps = 0);

/// <summary>Registro de un ejercicio en una sesión: exactamente 2 series efectivas (AC-training-001-02).</summary>
public sealed record ExerciseLog(DateOnly Date, decimal LoadKg, EffectiveSet FirstSet, EffectiveSet SecondSet)
{
    public const int RequiredSets = 2;
    public const int MinTargetReps = 6;
    public const int TargetReps = 9;
    public const int CeilingReps = 12;

    public Tempo Tempo => Tempo.Standard;

    /// <param name="allowZeroLoad">Ejercicios de peso corporal: la carga es el lastre y puede ser 0 (SPEC-training-003, AC-03).</param>
    public static ExerciseLog Register(
        DateOnly date, decimal loadKg, IReadOnlyList<EffectiveSet> sets, bool allowZeroLoad = false)
    {
        if (sets.Count != RequiredSets)
            throw new ArgumentException($"Se exigen exactamente {RequiredSets} series efectivas.", nameof(sets));
        if (loadKg < 0 || (loadKg == 0 && !allowZeroLoad))
            throw new ArgumentOutOfRangeException(nameof(loadKg), "La carga debe ser mayor que cero.");

        var (first, second) = (sets[0], sets[1]);
        if (first.AssistedReps != 0)
            throw new ArgumentException("La serie 1 no lleva repeticiones asistidas.", nameof(sets));
        if (first.OwnReps is < 1 or > CeilingReps)
            throw new ArgumentOutOfRangeException(nameof(sets), $"La serie 1 se detiene como máximo en {CeilingReps} repeticiones.");
        if (second.OwnReps < 1 || second.AssistedReps < 0)
            throw new ArgumentOutOfRangeException(nameof(sets), "La serie 2 necesita al menos 1 repetición propia.");

        return new ExerciseLog(date, loadKg, first, second);
    }

    /// <summary>Evalúa las repeticiones de la serie 1 (AC-training-001-03).</summary>
    public static FirstSetEvaluation EvaluateFirstSet(int reps) => reps switch
    {
        < 1 or > CeilingReps => throw new ArgumentOutOfRangeException(nameof(reps), $"Debe estar entre 1 y {CeilingReps}."),
        < MinTargetReps => FirstSetEvaluation.PorDebajo,
        < TargetReps => FirstSetEvaluation.EnBanda,
        TargetReps => FirstSetEvaluation.MetaAlcanzada,
        < CeilingReps => FirstSetEvaluation.PorEncima,
        _ => FirstSetEvaluation.Techo,
    };
}
