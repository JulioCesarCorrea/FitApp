namespace FitnessApp.Api.Domain.Progress;

public sealed record DailyWeight(DateOnly Date, decimal WeightKg);

public sealed record WeekStats(DateOnly WeekStart, decimal AvgKg, decimal MinKg, decimal MaxKg, int Count, decimal? ChangeKg);

/// <summary>
/// Historial de peso (SPEC-progress-002): un peso por día (el último), tendencia y resumen por semana ISO. Todo con enteros en
/// centésimas de kilo, así la API y la app dan exactamente lo mismo (ADR-0004, vectores progress-vectors.json). Los días son UTC.
/// </summary>
public static class WeightStats
{
    private static long Hundredths(decimal kg) => (long)Math.Round(kg * 100m, MidpointRounding.AwayFromZero);

    /// <summary>AC-01 y 02: el último peso de cada día, por fecha.</summary>
    public static List<DailyWeight> Daily(IEnumerable<(DateTimeOffset At, decimal Kg)> entries) =>
        entries
            .Select((e, i) => (Day: DateOnly.FromDateTime(e.At.UtcDateTime), e.At, e.Kg, Index: i))
            .GroupBy(e => e.Day)
            .Select(g => g.OrderBy(e => e.At).ThenBy(e => e.Index).Last())
            .OrderBy(e => e.Day)
            .Select(e => new DailyWeight(e.Day, e.Kg))
            .ToList();

    /// <summary>
    /// AC-02: media móvil exponencial con alfa 0,1 sobre los pesos diarios (los días sin dato no se rellenan):
    /// t0 = w0 y t(i) = (w(i) + 9·t(i-1)) / 10 redondeado hacia arriba en la mitad, en centésimas.
    /// </summary>
    public static List<DailyWeight> Trend(IReadOnlyList<DailyWeight> daily)
    {
        var result = new List<DailyWeight>(daily.Count);
        long? previous = null;
        foreach (var d in daily)
        {
            var w = Hundredths(d.WeightKg);
            var t = previous is null ? w : (w + 9 * previous.Value + 5) / 10;
            result.Add(new DailyWeight(d.Date, t / 100m));
            previous = t;
        }

        return result;
    }

    /// <summary>AC-05: por semana ISO (lunes a domingo) el promedio, el mínimo, el máximo y el cambio del promedio respecto a la semana anterior con datos.</summary>
    public static List<WeekStats> Weekly(IReadOnlyList<DailyWeight> daily)
    {
        var result = new List<WeekStats>();
        long? previousAvg = null;
        foreach (var week in daily.GroupBy(d => d.Date.AddDays(-(((int)d.Date.DayOfWeek + 6) % 7))).OrderBy(g => g.Key))
        {
            var values = week.Select(d => Hundredths(d.WeightKg)).ToList();
            var avg = (2 * values.Sum() + values.Count) / (2L * values.Count);
            result.Add(new WeekStats(
                week.Key, avg / 100m, values.Min() / 100m, values.Max() / 100m, values.Count,
                previousAvg is null ? null : (avg - previousAvg.Value) / 100m));
            previousAvg = avg;
        }

        return result;
    }
}
