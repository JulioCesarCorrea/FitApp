namespace FitnessApp.Api.Domain.Training;

public sealed record SessionLog(DateOnly Date, decimal LoadKg, int FirstSetReps, int SecondSetReps, int[]? RepsPerSet);

/// <param name="Sessions">Días distintos con algún registro (dos ejercicios el mismo día son una sesión).</param>
public sealed record WeekTraining(DateOnly WeekStart, int Sessions, int Sets, decimal VolumeKg);

/// <summary>
/// Historial de entrenamiento (SPEC-training-006): series y volumen de cada registro y resumen por semana ISO. Volumen =
/// Σ carga × repeticiones de las series registradas (las asistidas de Heavy Duty no suman); una serie sin carga cuenta como serie
/// pero no suma volumen. Un registro 4×15 usa <c>RepsPerSet</c> como fuente de verdad (SPEC-training-004). Vectores compartidos
/// con la app (ADR-0004: training-history-vectors.json).
/// </summary>
public static class TrainingHistory
{
    /// <summary>Repeticiones de cada serie: las cuatro de 4×15, o la primera y la segunda de Heavy Duty.</summary>
    public static int[] SetReps(SessionLog log) => log.RepsPerSet is { Length: > 0 } reps ? reps : [log.FirstSetReps, log.SecondSetReps];

    public static int Sets(SessionLog log) => SetReps(log).Length;

    public static decimal Volume(SessionLog log) => log.LoadKg * SetReps(log).Sum();

    public static DateOnly WeekStart(DateOnly date) => date.AddDays(-(((int)date.DayOfWeek + 6) % 7));

    /// <summary>Solo las semanas con registros, de la más antigua a la más reciente.</summary>
    public static List<WeekTraining> Weekly(IEnumerable<SessionLog> logs) =>
        logs.GroupBy(l => WeekStart(l.Date)).OrderBy(g => g.Key)
            .Select(g => new WeekTraining(g.Key, g.Select(l => l.Date).Distinct().Count(), g.Sum(Sets), g.Sum(Volume)))
            .ToList();
}
