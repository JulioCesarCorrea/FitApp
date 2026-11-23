using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Training.Sessions;

/// <param name="Partial">La semana en curso: todavía le pueden faltar sesiones.</param>
public sealed record TrainingWeekDto(DateOnly WeekStart, int Sessions, int Sets, decimal VolumeKg, bool Partial);

public sealed record TrainingWeeklyDto(List<TrainingWeekDto> Weeks);

/// <param name="Reps">Repeticiones de la serie principal (la primera).</param>
public sealed record ExercisePointDto(DateOnly Date, decimal LoadKg, int Reps, decimal VolumeKg, string Methodology);

public sealed record ExerciseProgressDto(List<ExercisePointDto> Points);

/// <summary>Casos de uso de SPEC-training-006: historial de entrenamiento. Todo filtra por la persona que llama (P7).</summary>
public sealed class TrainingHistoryHandler(AppDbContext db, TimeProvider clock)
{
    private static readonly Dictionary<string, int?> Ranges = new() { ["30d"] = 30, ["90d"] = 90, ["1y"] = 365, ["all"] = null };

    public const int MaxWeeks = 52;

    public static bool IsValidRange(string? range) => range is not null && Ranges.ContainsKey(range);

    private DateOnly Today => DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);

    /// <summary>AC-01 y 04: las últimas semanas ISO, también las sin sesiones (a cero), con la semana en curso marcada como parcial.</summary>
    public async Task<TrainingWeeklyDto> WeeklyAsync(Guid userId, int weeks, CancellationToken ct)
    {
        var thisWeek = TrainingHistory.WeekStart(Today);
        var from = thisWeek.AddDays(-7 * (weeks - 1));
        var logs = await db.ExerciseLogs.AsNoTracking().Where(l => l.UserId == userId && l.Date >= from)
            .Select(l => new { l.Date, l.LoadKg, l.FirstSetReps, l.SecondSetReps, l.RepsPerSet }).ToListAsync(ct);
        var byWeek = TrainingHistory.Weekly(logs.Select(l => new SessionLog(l.Date, l.LoadKg, l.FirstSetReps, l.SecondSetReps, l.RepsPerSet)))
            .ToDictionary(w => w.WeekStart);

        return new TrainingWeeklyDto(Enumerable.Range(0, weeks).Select(i => from.AddDays(7 * i)).Select(start =>
            byWeek.TryGetValue(start, out var w)
                ? new TrainingWeekDto(start, w.Sessions, w.Sets, w.VolumeKg, start == thisWeek)
                : new TrainingWeekDto(start, 0, 0, 0m, start == thisWeek)).ToList());
    }

    /// <summary>AC-02 y 05: la carga, las repeticiones y el volumen de cada sesión del ejercicio; null si el ejercicio no existe en el catálogo.</summary>
    public async Task<ExerciseProgressDto?> ExerciseAsync(Guid userId, string exerciseId, string range, CancellationToken ct)
    {
        if (!await db.Exercises.AnyAsync(e => e.Id == exerciseId, ct)) return null;

        var query = db.ExerciseLogs.AsNoTracking().Where(l => l.UserId == userId && l.ExerciseId == exerciseId);
        if (Ranges[range] is { } back)
        {
            var from = Today.AddDays(-back);
            query = query.Where(l => l.Date >= from);
        }

        var logs = await query.OrderBy(l => l.Date)
            .Select(l => new { l.Date, l.LoadKg, l.FirstSetReps, l.SecondSetReps, l.RepsPerSet, l.Methodology }).ToListAsync(ct);
        return new ExerciseProgressDto(logs.Select(l =>
        {
            var log = new SessionLog(l.Date, l.LoadKg, l.FirstSetReps, l.SecondSetReps, l.RepsPerSet);
            return new ExercisePointDto(l.Date, l.LoadKg, TrainingHistory.SetReps(log)[0], TrainingHistory.Volume(log), l.Methodology);
        }).ToList());
    }
}
