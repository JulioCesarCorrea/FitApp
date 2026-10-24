using FitnessApp.Api.Common;
using FitnessApp.Api.Domain;
using FitnessApp.Api.Infrastructure;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Progress.Weights;

public sealed record CreateWeightRequest(Guid Id, decimal WeightKg, DateTimeOffset MeasuredAt);

public sealed record WeightDto(Guid Id, decimal WeightKg, DateTimeOffset MeasuredAt);

public sealed class CreateWeightValidator : AbstractValidator<CreateWeightRequest>
{
    public CreateWeightValidator(TimeProvider clock)
    {
        RuleFor(x => x.Id).NotEmpty();
        RuleFor(x => x.WeightKg).GreaterThan(20m).LessThan(500m);
        RuleFor(x => x.WeightKg).PrecisionScale(5, 2, ignoreTrailingZeros: true);
        RuleFor(x => x.MeasuredAt).LessThanOrEqualTo(_ => clock.GetUtcNow().AddDays(1));
    }
}

/// <summary>Caso de uso de SPEC-progress-001 (AC-01, AC-02, AC-03).</summary>
public sealed class CreateWeightHandler(AppDbContext db, TimeProvider clock)
{
    public enum Outcome { Created, AlreadyExists, Conflict }

    public async Task<(Outcome Outcome, WeightDto Entry)> HandleAsync(
        Guid userId, CreateWeightRequest request, CancellationToken ct)
    {
        var existing = await db.Weights.AsNoTracking().FirstOrDefaultAsync(w => w.Id == request.Id, ct);
        if (existing is not null)
            return Existing(existing, userId);

        db.Weights.Add(new WeightEntry
        {
            Id = request.Id,
            UserId = userId,
            WeightKg = request.WeightKg,
            MeasuredAt = request.MeasuredAt.ToUniversalTime(),
            CreatedAt = clock.GetUtcNow(),
        });

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Carrera: otra petición con el mismo id se guardó entre la lectura y la escritura.
            db.ChangeTracker.Clear();
            var winner = await db.Weights.AsNoTracking().FirstAsync(w => w.Id == request.Id, ct);
            return Existing(winner, userId);
        }

        return (Outcome.Created, new WeightDto(request.Id, request.WeightKg, request.MeasuredAt.ToUniversalTime()));
    }

    // Mismo id y mismo usuario: reintento idempotente. Mismo id y otro usuario: no se revela nada.
    private static (Outcome, WeightDto) Existing(WeightEntry e, Guid userId) =>
        e.UserId == userId
            ? (Outcome.AlreadyExists, new WeightDto(e.Id, e.WeightKg, e.MeasuredAt))
            : (Outcome.Conflict, new WeightDto(Guid.Empty, 0, default));
}
