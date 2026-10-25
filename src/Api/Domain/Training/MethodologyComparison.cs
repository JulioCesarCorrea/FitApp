namespace FitnessApp.Api.Domain.Training;

public enum ComparisonType { Coincide, DentroDeLaVariacion, Diferencia }

public sealed record ParameterComparison(string Parameter, string Reference, string Person, ComparisonType Type);

public enum ProgressionKind { DobleProgresionPorcentaje, IncrementoFijo }

/// <summary>Parámetros de entrenamiento de una persona que se contrastan con la referencia.</summary>
public sealed record MethodProfile(
    int WorkingSets,
    int WorkingSetsNotToFailure,
    int AssistedRepsTypicalMax,
    int NegativeSeconds,
    int PositiveSeconds,
    int? RestSecondsBetweenSets,
    int MinTargetReps,
    int MaxRepsCeiling,
    ProgressionKind Progression,
    int DaysBetweenSessionsPerMuscle)
{
    /// <summary>Perfil «Heavy Duty personalizado» de SPEC-training-001.</summary>
    public static MethodProfile HeavyDutyPersonalizado { get; } = new(
        WorkingSets: 2,
        WorkingSetsNotToFailure: 1,
        AssistedRepsTypicalMax: 6,
        NegativeSeconds: 4,
        PositiveSeconds: 1,
        RestSecondsBetweenSets: null,
        MinTargetReps: ExerciseLog.MinTargetReps,
        MaxRepsCeiling: ExerciseLog.CeilingReps,
        Progression: ProgressionKind.IncrementoFijo,
        DaysBetweenSessionsPerMuscle: 7);
}

/// <summary>
/// Contrasta un perfil con la referencia de Heavy Duty (.claude/domain/heavy-duty.md, fuentes secundarias).
/// Solo describe diferencias; no las califica como correctas o incorrectas (AC-training-001-08).
/// </summary>
public static class MethodologyComparison
{
    public static IReadOnlyList<ParameterComparison> Compare(MethodProfile p) =>
    [
        new("Series de trabajo", "1–2", $"{p.WorkingSets}",
            p.WorkingSets is >= 1 and <= 2 ? ComparisonType.Coincide : ComparisonType.Diferencia),

        new("Series de trabajo sin llegar al fallo", "0 (solo la última va al fallo)", $"{p.WorkingSetsNotToFailure}",
            p.WorkingSetsNotToFailure == 0 ? ComparisonType.Coincide : ComparisonType.Diferencia),

        new("Repeticiones asistidas por serie", "sin número fijo (una fuente: 2–4)", $"hasta {p.AssistedRepsTypicalMax}",
            p.AssistedRepsTypicalMax <= 4 ? ComparisonType.DentroDeLaVariacion : ComparisonType.Diferencia),

        new("Tempo (negativa/positiva)", "4 s + 4 s o variantes", $"{p.NegativeSeconds} s / {p.PositiveSeconds} s",
            p.PositiveSeconds == 4 && p.NegativeSeconds is >= 3 and <= 6
                ? ComparisonType.DentroDeLaVariacion : ComparisonType.Diferencia),

        new("Descanso entre series", "3–5 min",
            p.RestSecondsBetweenSets is { } rest ? $"{rest} s" : "sin estándar",
            p.RestSecondsBetweenSets is >= 180 and <= 300 ? ComparisonType.Coincide : ComparisonType.Diferencia),

        new("Rango de repeticiones", "6–8, 6–10 u 8–12 según la fuente", $"{p.MinTargetReps}–{p.MaxRepsCeiling}",
            RepRange(p.MinTargetReps, p.MaxRepsCeiling)),

        new("Progresión", "doble progresión, subir 5–10 % al llegar al tope", p.Progression switch
            {
                ProgressionKind.DobleProgresionPorcentaje => "doble progresión por porcentaje",
                _ => "incremento fijo por ejercicio",
            },
            p.Progression == ProgressionKind.DobleProgresionPorcentaje ? ComparisonType.Coincide : ComparisonType.Diferencia),

        new("Días entre sesiones del mismo músculo", "~7", $"{p.DaysBetweenSessionsPerMuscle}",
            p.DaysBetweenSessionsPerMuscle >= 7 ? ComparisonType.Coincide : ComparisonType.DentroDeLaVariacion),
    ];

    private static ComparisonType RepRange(int min, int max) => (min, max) switch
    {
        (6, 8) or (6, 10) or (8, 12) => ComparisonType.Coincide,
        _ when min >= 6 && max <= 12 => ComparisonType.DentroDeLaVariacion,
        _ => ComparisonType.Diferencia,
    };
}
