using FitnessApp.Api.Domain.Progress;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Progress.Weights;

public sealed record WeightPointDto(DateOnly Date, decimal WeightKg);

/// <param name="Change">Último menos primer peso del rango; null con menos de dos puntos.</param>
/// <param name="Trend">Estimación calculada (media móvil), no un dato registrado (P4).</param>
public sealed record WeightSummaryDto(List<WeightPointDto> Points, decimal? Min, decimal? Max, decimal? Change, List<WeightPointDto> Trend);

public sealed record WeekDto(DateOnly WeekStart, decimal AvgKg, decimal MinKg, decimal MaxKg, int Count, decimal? ChangeKg);

public sealed record WeightWeeklyDto(List<WeekDto> Weeks);

/// <summary>Casos de uso de SPEC-progress-002: historial de peso. Todo filtra por la persona que llama (P7).</summary>
public sealed class WeightHistoryHandler(AppDbContext db, TimeProvider clock)
{
    private static readonly Dictionary<string, int?> Ranges = new() { ["30d"] = 30, ["90d"] = 90, ["1y"] = 365, ["all"] = null };

    public const int MaxWeeks = 104;

    public static bool IsValidRange(string? range) => range is not null && Ranges.ContainsKey(range);

    private async Task<List<DailyWeight>> DailyAsync(Guid userId, CancellationToken ct)
    {
        var rows = await db.Weights.AsNoTracking().Where(w => w.UserId == userId).Select(w => new { w.MeasuredAt, w.WeightKg }).ToListAsync(ct);
        return WeightStats.Daily(rows.Select(r => (r.MeasuredAt, r.WeightKg)));
    }

    private DateOnly Today => DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);

    /// <summary>AC-01 y 03: puntos del rango, mínimo, máximo, cambio y tendencia.</summary>
    public async Task<WeightSummaryDto> SummaryAsync(Guid userId, string range, CancellationToken ct)
    {
        var days = (await DailyAsync(userId, ct)).AsEnumerable();
        if (Ranges[range] is { } back) days = days.Where(d => d.Date >= Today.AddDays(-back));
        var points = days.ToList();

        return new WeightSummaryDto(
            points.Select(p => new WeightPointDto(p.Date, p.WeightKg)).ToList(),
            points.Count == 0 ? null : points.Min(p => p.WeightKg),
            points.Count == 0 ? null : points.Max(p => p.WeightKg),
            points.Count < 2 ? null : points[^1].WeightKg - points[0].WeightKg,
            WeightStats.Trend(points).Select(p => new WeightPointDto(p.Date, p.WeightKg)).ToList());
    }

    /// <summary>AC-05: las últimas <paramref name="weeks"/> semanas ISO con datos.</summary>
    public async Task<WeightWeeklyDto> WeeklyAsync(Guid userId, int weeks, CancellationToken ct)
    {
        var thisMonday = Today.AddDays(-(((int)Today.DayOfWeek + 6) % 7));
        var from = thisMonday.AddDays(-7 * (weeks - 1));
        var all = WeightStats.Weekly(await DailyAsync(userId, ct));
        return new WeightWeeklyDto(all.Where(w => w.WeekStart >= from)
            .Select(w => new WeekDto(w.WeekStart, w.AvgKg, w.MinKg, w.MaxKg, w.Count, w.ChangeKg)).ToList());
    }
}
