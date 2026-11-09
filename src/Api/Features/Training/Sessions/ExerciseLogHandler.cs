using FitnessApp.Api.Domain.Profile;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Infrastructure;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Training.Sessions;

/// <param name="Methodology">heavy_duty_personalizado (por defecto) o normal_4x15 (SPEC-training-004).</param>
/// <param name="RepsPerSet">Solo 4×15: las repeticiones propias de las 4 series. Los tres campos de Heavy Duty quedan en 0.</param>
public sealed record ExerciseLogRequest(
    string ExerciseId, DateOnly Date, decimal LoadKg, int FirstSetReps = 0, int SecondSetReps = 0, int SecondSetAssistedReps = 0,
    string? Methodology = null, int[]? RepsPerSet = null)
{
    public bool IsNormal => Methodology == Normal4x15.Name;
}

public sealed record ExerciseLogDto(
    Guid Id, string ExerciseId, DateOnly Date, decimal LoadKg, int FirstSetReps, int SecondSetReps, int SecondSetAssistedReps,
    string Methodology = ProfileRules.DefaultMethodology, int[]? RepsPerSet = null);

public sealed class ExerciseLogRequestValidator : AbstractValidator<ExerciseLogRequest>
{
    public const decimal MaxLoadKg = 1000m;
    private static readonly DateOnly EarliestDate = new(2000, 1, 1);

    public ExerciseLogRequestValidator(TimeProvider clock)
    {
        RuleFor(x => x.ExerciseId).NotEmpty().MaximumLength(120).WithMessage("Falta el ejercicio.");
        RuleFor(x => x.Date)
            .Must(d => d >= EarliestDate).WithMessage("La fecha no es válida.")
            // Un día de margen por las zonas horarias (como en el peso).
            .Must(d => d <= DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime).AddDays(1))
            .WithMessage("La fecha no puede ser futura.");
        RuleFor(x => x.LoadKg).InclusiveBetween(0m, MaxLoadKg).WithMessage($"La carga debe estar entre 0 y {MaxLoadKg} kg.");
        RuleFor(x => x.LoadKg).PrecisionScale(7, 2, ignoreTrailingZeros: true).WithMessage("La carga admite como máximo 2 decimales.");
        RuleFor(x => x.Methodology).Must(m => m is Normal4x15.Name or ProfileRules.DefaultMethodology).When(x => x.Methodology is not null)
            .WithMessage("La metodología no es válida.");

        // Heavy Duty personalizado (por defecto): las dos series con asistidas.
        When(x => !x.IsNormal, () =>
        {
            RuleFor(x => x.RepsPerSet).Null().WithMessage("Las repeticiones por serie son de la metodología 4×15.");
            RuleFor(x => x.FirstSetReps).InclusiveBetween(1, ExerciseLog.CeilingReps)
                .WithMessage($"La serie 1 lleva entre 1 y {ExerciseLog.CeilingReps} repeticiones.");
            RuleFor(x => x.SecondSetReps).GreaterThanOrEqualTo(1)
                .WithMessage("La serie 2 necesita al menos 1 repetición propia.");
            RuleFor(x => x.SecondSetAssistedReps).GreaterThanOrEqualTo(0)
                .WithMessage("Las repeticiones asistidas no pueden ser negativas.");
        });

        // Normal 4×15: cuatro series, sin campos de Heavy Duty.
        When(x => x.IsNormal, () =>
        {
            RuleFor(x => x.RepsPerSet).NotNull().Must(r => r is { Length: Normal4x15.Sets })
                .WithMessage($"Se exigen exactamente {Normal4x15.Sets} series.");
            RuleFor(x => x).Must(x => x.FirstSetReps == 0 && x.SecondSetReps == 0 && x.SecondSetAssistedReps == 0)
                .WithMessage("Los campos de Heavy Duty no se mezclan con la metodología 4×15.");
        });
    }
}

public abstract record PutLogResult
{
    public sealed record Saved(ExerciseLogDto Log, bool Created) : PutLogResult;
    public sealed record UnknownExercise : PutLogResult;
    public sealed record InvalidLoad(string Message) : PutLogResult;
    public sealed record NotFound : PutLogResult;
    public sealed record DateConflict : PutLogResult;
}

/// <summary>
/// Casos de uso de SPEC-training-003: guardar, reemplazar y borrar el registro de un ejercicio, y su historial.
/// Todo acceso filtra por la persona que llama (P7): un id ajeno se trata como inexistente.
/// </summary>
public sealed class ExerciseLogHandler(AppDbContext db, TimeProvider clock)
{
    /// <summary>Crea el registro o reemplaza el que tiene ese id (AC-01, 02, 03, 04, 06).</summary>
    public async Task<PutLogResult> PutAsync(Guid userId, Guid id, ExerciseLogRequest request, CancellationToken ct) =>
        await PutAsync(userId, id, request, retry: true, ct);

    private async Task<PutLogResult> PutAsync(Guid userId, Guid id, ExerciseLogRequest request, bool retry, CancellationToken ct)
    {
        var exercise = await db.Exercises.AsNoTracking().FirstOrDefaultAsync(e => e.Id == request.ExerciseId, ct);
        if (exercise is null) return new PutLogResult.UnknownExercise();

        try
        {
            var bodyweight = exercise.Equipment == EquipmentKind.PesoCorporal;
            if (request.IsNormal)
                Normal4x15.Register(request.Date, request.LoadKg, request.RepsPerSet!, bodyweight);
            else
                ExerciseLog.Register(
                    request.Date, request.LoadKg,
                    [new EffectiveSet(request.FirstSetReps), new EffectiveSet(request.SecondSetReps, request.SecondSetAssistedReps)],
                    allowZeroLoad: bodyweight);
        }
        catch (ArgumentException e)
        {
            return new PutLogResult.InvalidLoad(e.Message);
        }

        var existing = await db.ExerciseLogs.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (existing is not null && existing.UserId != userId) return new PutLogResult.NotFound();

        var taken = await db.ExerciseLogs.AnyAsync(
            l => l.UserId == userId && l.ExerciseId == request.ExerciseId && l.Date == request.Date && l.Id != id, ct);
        if (taken) return new PutLogResult.DateConflict();

        var created = existing is null;
        if (existing is null)
        {
            existing = new ExerciseLogEntry { Id = id, UserId = userId, CreatedAt = clock.GetUtcNow() };
            db.ExerciseLogs.Add(existing);
        }

        existing.ExerciseId = request.ExerciseId;
        existing.Date = request.Date;
        existing.LoadKg = request.LoadKg;
        if (request.IsNormal)
        {
            // Las columnas de Heavy Duty repiten la serie 1 y la 4; la fuente de verdad es RepsPerSet.
            existing.Methodology = Normal4x15.Name;
            existing.RepsPerSet = request.RepsPerSet!.ToArray();
            existing.FirstSetReps = request.RepsPerSet![0];
            existing.SecondSetReps = request.RepsPerSet![^1];
            existing.SecondSetAssistedReps = 0;
        }
        else
        {
            existing.Methodology = ProfileRules.DefaultMethodology;
            existing.RepsPerSet = null;
            existing.FirstSetReps = request.FirstSetReps;
            existing.SecondSetReps = request.SecondSetReps;
            existing.SecondSetAssistedReps = request.SecondSetAssistedReps;
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Carrera: otra petición guardó el mismo id o el mismo día entre la lectura y la escritura.
            db.ChangeTracker.Clear();
            return retry ? await PutAsync(userId, id, request, retry: false, ct) : new PutLogResult.DateConflict();
        }

        return new PutLogResult.Saved(ToDto(existing), created);
    }

    /// <summary>Borra el registro propio; si no existe o es de otra persona no hace nada (AC-07, AC-13).</summary>
    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct) =>
        await db.ExerciseLogs.Where(l => l.Id == id && l.UserId == userId).ExecuteDeleteAsync(ct);

    /// <summary>Historial propio de un ejercicio, de la fecha más antigua a la más reciente (AC-08). Null si el ejercicio no existe.</summary>
    public async Task<List<ExerciseLogDto>?> HistoryAsync(Guid userId, string exerciseId, CancellationToken ct)
    {
        if (!await db.Exercises.AnyAsync(e => e.Id == exerciseId, ct)) return null;

        var rows = await db.ExerciseLogs.AsNoTracking()
            .Where(l => l.UserId == userId && l.ExerciseId == exerciseId)
            .OrderBy(l => l.Date)
            .ToListAsync(ct);
        return rows.Select(ToDto).ToList();
    }

    private static ExerciseLogDto ToDto(ExerciseLogEntry l) =>
        new(l.Id, l.ExerciseId, l.Date, l.LoadKg, l.FirstSetReps, l.SecondSetReps, l.SecondSetAssistedReps, l.Methodology, l.RepsPerSet);
}
