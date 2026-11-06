using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Infrastructure;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Training.Sessions;

public sealed record TrainingSettingsDto(int StagnationThreshold);

public sealed class TrainingSettingsValidator : AbstractValidator<TrainingSettingsDto>
{
    public const int MinThreshold = 2;
    public const int MaxThreshold = 10;

    public TrainingSettingsValidator()
    {
        RuleFor(x => x.StagnationThreshold).InclusiveBetween(MinThreshold, MaxThreshold)
            .WithMessage($"El umbral de estancamiento debe estar entre {MinThreshold} y {MaxThreshold} sesiones.");
    }
}

/// <summary>Umbral de estancamiento de la persona (SPEC-training-003, AC-12).</summary>
public sealed class TrainingSettingsHandler(AppDbContext db)
{
    public async Task<TrainingSettingsDto> GetAsync(Guid userId, CancellationToken ct)
    {
        var row = await db.TrainingSettings.AsNoTracking().FirstOrDefaultAsync(s => s.UserId == userId, ct);
        return new TrainingSettingsDto(row?.StagnationThreshold ?? Stagnation.DefaultThreshold);
    }

    public async Task<TrainingSettingsDto> SaveAsync(Guid userId, TrainingSettingsDto request, CancellationToken ct)
    {
        var row = await db.TrainingSettings.FirstOrDefaultAsync(s => s.UserId == userId, ct);
        if (row is null)
        {
            row = new TrainingSettings { UserId = userId };
            db.TrainingSettings.Add(row);
        }

        row.StagnationThreshold = request.StagnationThreshold;
        await db.SaveChangesAsync(ct);
        return new TrainingSettingsDto(row.StagnationThreshold);
    }
}
