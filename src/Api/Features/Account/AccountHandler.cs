using FitnessApp.Api.Domain;
using FitnessApp.Api.Domain.Auth;
using FitnessApp.Api.Domain.Profile;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Features.Auth;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Account;

public sealed record DeleteAccountRequest(string? Password);

public sealed record ExportUser(string Username, DateTimeOffset CreatedAt);

public sealed record ExportProfile(
    string DisplayName, string Sex, DateOnly BirthDate, int HeightCm, string Goal, string ActivityLevel,
    string? ExperienceLevel, int? DaysPerWeek, string Methodology, string[] Allergies);

public sealed record ExportRestriction(Guid Id, string Zone, string[] AvoidedMovements, string Level, DateOnly? ReviewOn);

public sealed record ExportWeight(Guid Id, decimal WeightKg, DateTimeOffset MeasuredAt);

public sealed record ExportPlanEntry(Guid Id, string Day, string ExerciseId, int Order, decimal? MachineStepKg);

public sealed record ExportEquipment(
    decimal[] DumbbellsKg, decimal[] DiscsKg, decimal? RectaBarKg, decimal? ZBarKg, decimal? SmithBarKg,
    decimal? RemoEnTBarKg, decimal MachineStepKg, decimal MachineBaseKg);

public sealed record ExportExerciseLog(
    Guid Id, string ExerciseId, DateOnly Date, decimal LoadKg, int FirstSetReps, int SecondSetReps, int SecondSetAssistedReps,
    string Methodology, int[]? RepsPerSet);

public sealed record AccountExport(
    int Version,
    DateTimeOffset ExportedAt,
    ExportUser User,
    ExportProfile? Profile,
    List<ExportRestriction> Restrictions,
    List<ExportWeight> Weights,
    List<ExportPlanEntry> Plan,
    ExportEquipment? Equipment,
    int? StagnationThreshold,
    List<ExportExerciseLog> ExerciseLogs);

/// <summary>
/// Entidades con datos de la persona. La exportación y el borrado las recorren y una prueba (AC-account-001-10)
/// falla si el modelo tiene una entidad con <c>UserId</c> que no figure aquí.
/// </summary>
public static class AccountData
{
    public static readonly Type[] PersonalEntities =
    [
        typeof(AppUser), typeof(RefreshToken), typeof(UserProfile), typeof(UserRestriction), typeof(WeightEntry),
        typeof(PlanEntry), typeof(EquipmentSettings), typeof(TrainingSettings), typeof(ExerciseLogEntry),
    ];
}

public abstract record DeleteAccountResult
{
    public sealed record Deleted : DeleteAccountResult;
    public sealed record WrongPassword : DeleteAccountResult;
}

/// <summary>Casos de uso de SPEC-account-001: exportar y borrar los datos de la cuenta.</summary>
public sealed class AccountHandler(AppDbContext db, PasswordService passwords, TimeProvider clock)
{
    public const int ExportVersion = 1;

    public async Task<AccountExport?> ExportAsync(Guid userId, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().Where(u => u.Id == userId)
            .Select(u => new ExportUser(u.Username, u.CreatedAt)).FirstOrDefaultAsync(ct);
        if (user is null) return null;

        var profile = await db.Profiles.AsNoTracking().Where(p => p.UserId == userId)
            .Select(p => new ExportProfile(p.DisplayName, p.Sex, p.BirthDate, p.HeightCm, p.Goal, p.ActivityLevel,
                p.ExperienceLevel, p.DaysPerWeek, p.Methodology, p.Allergies)).FirstOrDefaultAsync(ct);

        var restrictions = (await db.Restrictions.AsNoTracking().Where(r => r.UserId == userId).ToListAsync(ct))
            .Select(r => new ExportRestriction(r.Id, r.Zone, r.AvoidedMovements, r.Level.ToString().ToLowerInvariant(), r.ReviewOn))
            .OrderBy(r => r.Zone).ToList();

        var weights = await db.Weights.AsNoTracking().Where(w => w.UserId == userId).OrderBy(w => w.MeasuredAt)
            .Select(w => new ExportWeight(w.Id, w.WeightKg, w.MeasuredAt)).ToListAsync(ct);

        var plan = (await db.PlanEntries.AsNoTracking().Where(e => e.UserId == userId).ToListAsync(ct))
            .OrderBy(e => e.Day).ThenBy(e => e.Order)
            .Select(e => new ExportPlanEntry(e.Id, e.Day.ToString(), e.ExerciseId, e.Order, e.MachineStepKg)).ToList();

        var equipment = await db.Equipment.AsNoTracking().Where(e => e.UserId == userId)
            .Select(e => new ExportEquipment(e.DumbbellsKg, e.DiscsKg, e.RectaBarKg, e.ZBarKg, e.SmithBarKg,
                e.RemoEnTBarKg, e.MachineStepKg, e.MachineBaseKg)).FirstOrDefaultAsync(ct);

        var threshold = await db.TrainingSettings.AsNoTracking().Where(s => s.UserId == userId)
            .Select(s => (int?)s.StagnationThreshold).FirstOrDefaultAsync(ct);

        var logs = await db.ExerciseLogs.AsNoTracking().Where(l => l.UserId == userId).OrderBy(l => l.Date).ThenBy(l => l.ExerciseId)
            .Select(l => new ExportExerciseLog(l.Id, l.ExerciseId, l.Date, l.LoadKg, l.FirstSetReps, l.SecondSetReps, l.SecondSetAssistedReps, l.Methodology, l.RepsPerSet))
            .ToListAsync(ct);

        return new AccountExport(ExportVersion, clock.GetUtcNow(), user, profile, restrictions, weights, plan, equipment, threshold, logs);
    }

    /// <summary>Borra la cuenta y todos sus datos en una sola transacción (AC-account-001-05, 06, 09).</summary>
    public async Task<DeleteAccountResult> DeleteAsync(Guid userId, string? password, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || string.IsNullOrEmpty(password) || !passwords.Verify(user.PasswordHash, password))
            return new DeleteAccountResult.WrongPassword();

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.Weights.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.PlanEntries.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.Equipment.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.Restrictions.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.ExerciseLogs.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.TrainingSettings.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.Profiles.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.RefreshTokens.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.Users.Where(x => x.Id == userId).ExecuteDeleteAsync(ct);
        await transaction.CommitAsync(ct);
        return new DeleteAccountResult.Deleted();
    }
}
