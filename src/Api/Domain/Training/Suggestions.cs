namespace FitnessApp.Api.Domain.Training;

public enum SuggestionKind
{
    RestriccionChoque,
    RestriccionRevision,
    EjercicioEstancado,
    Metodo,
    DiaOmitido,
    RecuperacionCorta,
}

/// <summary>Descarte de una sugerencia por la persona (SPEC-training-005, AC-12). La sugerencia en sí no se guarda.</summary>
public class SuggestionDismissal
{
    public Guid UserId { get; set; }

    /// <summary>Identifica el caso: <c>tipo:referencia:fecha del dato más reciente</c>. Cambia cuando hay datos nuevos.</summary>
    public string Key { get; set; } = "";

    public DateTimeOffset DismissedAt { get; set; }
}

/// <summary>
/// Reglas deterministas de las sugerencias de rutina y de corrección del método (SPEC-training-005). Sin IA (P1, P4):
/// describen lo registrado y nunca califican el método de la persona.
/// </summary>
public static class SuggestionRules
{
    public const int MaxAlternatives = 3;
    public const int MaxSuggestions = 20;
    public const int ShortRecoveryDays = 5;
    public const int RecoveryWindowDays = 28;

    // Heavy Duty: serie 1 por debajo de 6; serie 1 en el techo (12) y serie 2 con 8 propias o más.
    private const int HeavyDutyFloor = ExerciseLog.MinTargetReps;

    public static string Kind(SuggestionKind kind) => kind switch
    {
        SuggestionKind.RestriccionChoque => "restriccion-choque",
        SuggestionKind.RestriccionRevision => "restriccion-revision",
        SuggestionKind.EjercicioEstancado => "ejercicio-estancado",
        SuggestionKind.Metodo => "metodo",
        SuggestionKind.DiaOmitido => "dia-omitido",
        _ => "recuperacion-corta",
    };

    /// <summary>Clave estable de un caso: cambia cuando hay datos nuevos, por lo que un descarte caduca con ellos.</summary>
    public static string Key(SuggestionKind kind, string reference, DateOnly? data = null) =>
        data is { } date ? $"{Kind(kind)}:{reference}:{date:yyyy-MM-dd}" : $"{Kind(kind)}:{reference}";

    /// <summary>
    /// Alternativas para sustituir un ejercicio (AC-training-005-03): ya vienen filtradas por zona, plan y restricciones.
    /// Primero las que comparten algún movimiento con el actual, luego las de otro equipo y por último el orden del catálogo.
    /// </summary>
    public static IReadOnlyList<CatalogExercise> RankAlternatives(CatalogExercise current, IEnumerable<CatalogExercise> candidates) =>
        candidates
            .OrderBy(c => c.Movements.Intersect(current.Movements, StringComparer.OrdinalIgnoreCase).Any() ? 0 : 1)
            .ThenBy(c => c.Equipment != current.Equipment ? 0 : 1)
            .ThenBy(c => c.SortOrder)
            .Take(MaxAlternatives)
            .ToList();

    /// <summary>
    /// Observación sobre el método con los dos últimos registros (AC-training-005-04 y 05). Null si no hay nada que decir.
    /// Solo cuenta si los dos son de la misma metodología.
    /// </summary>
    public static string? MethodMessage(IReadOnlyList<ExerciseLogEntry> byDate)
    {
        if (byDate.Count < 2) return null;
        var (a, b) = (byDate[^2], byDate[^1]);
        if (a.Methodology != b.Methodology) return null;

        if (b.Methodology == Normal4x15.Name)
        {
            if (a.RepsPerSet is not { Length: Normal4x15.Sets } ra || b.RepsPerSet is not { Length: Normal4x15.Sets } rb) return null;

            if (ra[^1] < Normal4x15.BandFloorReps && rb[^1] < Normal4x15.BandFloorReps)
                return $"En tus dos últimas sesiones la serie 4 quedó por debajo de {Normal4x15.BandFloorReps} repeticiones: la carga fue alta para este rango.";
            if (ra.All(r => r >= Normal4x15.TargetReps) && rb.All(r => r >= Normal4x15.TargetReps) && a.LoadKg == b.LoadKg)
                return $"En tus dos últimas sesiones llegaste a {Normal4x15.TargetReps} repeticiones en las 4 series con la misma carga; el consejo de carga propone subirla.";
            return null;
        }

        if (a.FirstSetReps < HeavyDutyFloor && b.FirstSetReps < HeavyDutyFloor)
            return $"En tus dos últimas sesiones la serie 1 quedó por debajo de {HeavyDutyFloor} repeticiones: la carga fue alta para ese rango.";
        if (a.SecondSetAssistedReps == 0 && b.SecondSetAssistedReps == 0)
            return "En tus dos últimas sesiones no registraste repeticiones asistidas en la serie 2.";

        static bool AtCeiling(ExerciseLogEntry l) =>
            l.FirstSetReps >= LoadProgression.FirstSetTrigger && l.SecondSetReps >= LoadProgression.SecondSetOwnRepsTrigger;
        if (AtCeiling(a) && AtCeiling(b) && a.LoadKg == b.LoadKg)
            return "En tus dos últimas sesiones llegaste al techo con la misma carga; el consejo de carga propone subirla.";
        return null;
    }

    /// <summary>Lunes de la semana de una fecha.</summary>
    public static DateOnly MondayOf(DateOnly date) => date.AddDays(-(((int)date.DayOfWeek + 6) % 7));

    /// <summary>
    /// Días del plan sin ningún registro en las dos últimas semanas completas, de lunes a domingo (AC-training-005-06).
    /// Solo se evalúa si la persona ya tenía registros desde antes de esas dos semanas; así una cuenta nueva no recibe avisos.
    /// Devuelve cada día con el lunes de la última semana evaluada.
    /// </summary>
    public static IReadOnlyList<(DayOfWeek Day, DateOnly WeekStart)> OmittedDays(
        IReadOnlySet<DayOfWeek> planDays, IReadOnlySet<DateOnly> logDates, DateOnly today)
    {
        var lastWeek = MondayOf(today).AddDays(-7);
        var weekBefore = lastWeek.AddDays(-7);
        if (!logDates.Any(d => d < weekBefore)) return [];

        var result = new List<(DayOfWeek, DateOnly)>();
        foreach (var day in planDays.OrderBy(d => ((int)d + 6) % 7))
        {
            var offset = ((int)day + 6) % 7;
            if (!logDates.Contains(weekBefore.AddDays(offset)) && !logDates.Contains(lastWeek.AddDays(offset)))
                result.Add((day, lastWeek));
        }

        return result;
    }

    /// <summary>
    /// Último par de registros del mismo ejercicio con menos de 5 días entre ellos dentro de las últimas 4 semanas
    /// (AC-training-005-07). Null si no hay ninguno.
    /// </summary>
    public static (DateOnly Earlier, DateOnly Later)? ShortRecovery(IReadOnlyList<DateOnly> sortedDates, DateOnly today)
    {
        for (var i = sortedDates.Count - 1; i >= 1; i--)
        {
            var (earlier, later) = (sortedDates[i - 1], sortedDates[i]);
            if (later < today.AddDays(-RecoveryWindowDays)) break;
            if (later.DayNumber - earlier.DayNumber < ShortRecoveryDays) return (earlier, later);
        }

        return null;
    }
}
