using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Progress.Weights;

/// <summary>Caso de uso de SPEC-progress-001 (AC-05).</summary>
public sealed class ListWeightsHandler(AppDbContext db)
{
    public async Task<List<WeightDto>> HandleAsync(Guid userId, CancellationToken ct) =>
        await db.Weights
            .AsNoTracking()
            .Where(w => w.UserId == userId)
            .OrderByDescending(w => w.MeasuredAt)
            .Select(w => new WeightDto(w.Id, w.WeightKg, w.MeasuredAt))
            .ToListAsync(ct);
}
