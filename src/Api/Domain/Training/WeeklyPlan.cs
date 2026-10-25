namespace FitnessApp.Api.Domain.Training;

public sealed record TrainingFocus(string Name, IReadOnlyList<string> MuscleGroups);

/// <summary>Plan semanal fijo de una persona (AC-training-001-01). Los días sin entrada son de descanso.</summary>
public sealed class WeeklyPlan(IReadOnlyDictionary<DayOfWeek, TrainingFocus> days)
{
    public TrainingFocus? FocusFor(DayOfWeek day) => days.GetValueOrDefault(day);

    /// <summary>Plan del perfil «Heavy Duty personalizado» descrito en SPEC-training-001.</summary>
    public static WeeklyPlan HeavyDutyPersonalizado { get; } = new(new Dictionary<DayOfWeek, TrainingFocus>
    {
        [DayOfWeek.Tuesday] = new("Pierna, énfasis en cuádriceps", ["piernas", "cuádriceps"]),
        [DayOfWeek.Wednesday] = new("Espalda y hombros", ["espalda", "hombros"]),
        [DayOfWeek.Thursday] = new("Pierna, énfasis en glúteo", ["piernas", "glúteo"]),
        [DayOfWeek.Saturday] = new("Pecho, tríceps y bíceps", ["pecho", "tríceps", "bíceps"]),
    });
}
