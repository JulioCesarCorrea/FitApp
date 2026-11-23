namespace FitnessApp.Api.Domain.Nutrition;

/// <summary>Lo comido en un día con algún registro (SPEC-nutrition-006): los días sin registro no cuentan.</summary>
public sealed record DayIntake(DateOnly Date, int Kcal, decimal ProteinG, decimal FatG, decimal CarbsG);

/// <param name="DaysOnTarget">Días dentro del margen de las calorías objetivo; null sin objetivo.</param>
public sealed record WeekIntake(
    DateOnly WeekStart, int DaysLogged, int AvgKcal, decimal AvgProteinG, decimal AvgFatG, decimal AvgCarbsG, int? DaysOnTarget);

/// <summary>
/// Historial de nutrición (SPEC-nutrition-006): promedios por semana ISO solo sobre los días con registro y adherencia a las
/// calorías objetivo. Cálculo por enteros (décimas de gramo) para que la API y la app den lo mismo (ADR-0004, vectores `weekly`).
/// </summary>
public static class NutritionHistory
{
    /// <summary>Margen de adherencia: ±10 % de las calorías objetivo.</summary>
    public static bool OnTarget(int kcal, int targetKcal) => Math.Abs(kcal - targetKcal) * 10L <= targetKcal;

    public static List<WeekIntake> Weekly(IEnumerable<DayIntake> loggedDays, int? targetKcal)
    {
        static long Tenths(decimal v) => (long)Math.Round(v * 10m, MidpointRounding.AwayFromZero);
        static long Avg(long sum, int n) => (2 * sum + n) / (2L * n);

        return loggedDays
            .GroupBy(d => d.Date.AddDays(-(((int)d.Date.DayOfWeek + 6) % 7)))
            .OrderBy(g => g.Key)
            .Select(g =>
            {
                var days = g.ToList();
                var n = days.Count;
                return new WeekIntake(
                    g.Key, n, (int)Avg(days.Sum(d => (long)d.Kcal), n),
                    Avg(days.Sum(d => Tenths(d.ProteinG)), n) / 10m,
                    Avg(days.Sum(d => Tenths(d.FatG)), n) / 10m,
                    Avg(days.Sum(d => Tenths(d.CarbsG)), n) / 10m,
                    targetKcal is { } t ? days.Count(d => OnTarget(d.Kcal, t)) : null);
            })
            .ToList();
    }
}
