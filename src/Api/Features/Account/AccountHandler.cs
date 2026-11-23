using FitnessApp.Api.Domain;
using FitnessApp.Api.Domain.Ai;
using FitnessApp.Api.Domain.Auth;
using FitnessApp.Api.Domain.Nutrition;
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
    string? ExperienceLevel, int? DaysPerWeek, string Methodology, string[] Allergies, DateTimeOffset? MethodologyChangedAt);

public sealed record ExportRestriction(Guid Id, string Zone, string[] AvoidedMovements, string Level, DateOnly? ReviewOn);

public sealed record ExportWeight(Guid Id, decimal WeightKg, DateTimeOffset MeasuredAt);

public sealed record ExportPlanEntry(Guid Id, string Day, string ExerciseId, int Order, decimal? MachineStepKg);

public sealed record ExportEquipment(
    decimal[] DumbbellsKg, decimal[] DiscsKg, decimal? RectaBarKg, decimal? ZBarKg, decimal? SmithBarKg,
    decimal? RemoEnTBarKg, decimal MachineStepKg, decimal MachineBaseKg);

public sealed record ExportExerciseLog(
    Guid Id, string ExerciseId, DateOnly Date, decimal LoadKg, int FirstSetReps, int SecondSetReps, int SecondSetAssistedReps,
    string Methodology, int[]? RepsPerSet);

public sealed record ExportFood(
    Guid Id, string Name, string? Brand, string? Barcode, decimal KcalPer100g, decimal ProteinPer100g, decimal FatPer100g,
    decimal CarbsPer100g, string Source, string[] Allergens, decimal? FiberPer100g, decimal? SugarsPer100g, int? SodiumMgPer100g);

public sealed record ExportFoodEntry(
    Guid Id, DateOnly Date, string Meal, Guid? FoodId, int Grams, string Name, int Kcal, decimal ProteinG, decimal FatG, decimal CarbsG,
    decimal? FiberG, decimal? SugarsG, int? SodiumMg, Guid? RecipeId, decimal? Servings);

public sealed record ExportRecipeIngredient(
    Guid? FoodId, string Name, int Grams, decimal KcalPer100g, decimal ProteinPer100g, decimal FatPer100g, decimal CarbsPer100g,
    decimal? FiberPer100g, decimal? SugarsPer100g, int? SodiumMgPer100g);

public sealed record ExportRecipe(Guid Id, string Name, int Servings, List<ExportRecipeIngredient> Ingredients);

public sealed record ExportAiConsent(string Feature, DateTimeOffset GrantedAt);

/// <summary>Llamada a la IA con sus metadatos y, mientras no se haya purgado, el texto enviado y recibido (nunca la clave del proveedor).</summary>
public sealed record ExportAiCall(
    string Feature, string Model, int PromptTokens, int CompletionTokens, decimal CostUsd, string Status, string? SentText, string? ResponseText,
    DateTimeOffset CreatedAt);

public sealed record ExportWaterEntry(Guid Id, DateOnly Date, int Ml);

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
    List<ExportExerciseLog> ExerciseLogs,
    List<string> DismissedSuggestions,
    List<ExportFood> Foods,
    List<ExportFoodEntry> FoodEntries,
    int? NutritionOverrideCalories,
    List<ExportWaterEntry> WaterEntries,
    List<ExportRecipe> Recipes,
    List<ExportAiConsent> AiConsents,
    List<ExportAiCall> AiCalls);

/// <summary>
/// Entidades con datos de la persona. La exportación y el borrado las recorren y una prueba (AC-account-001-10)
/// falla si el modelo tiene una entidad con <c>UserId</c> que no figure aquí.
/// </summary>
public static class AccountData
{
    public static readonly Type[] PersonalEntities =
    [
        typeof(AppUser), typeof(RefreshToken), typeof(UserProfile), typeof(UserRestriction), typeof(WeightEntry),
        typeof(PlanEntry), typeof(EquipmentSettings), typeof(TrainingSettings), typeof(ExerciseLogEntry), typeof(SuggestionDismissal),
        typeof(Food), typeof(FoodEntry), typeof(TargetOverride), typeof(WaterEntry), typeof(Recipe), typeof(AiConsent), typeof(AiAudit),
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
    // 2: añade las calorías ajustadas a mano (SPEC-nutrition-002). 3: añade los alérgenos de los alimentos (SPEC-nutrition-003).
    // 4: fibra, azúcares y sodio de alimentos y entradas, y el agua (SPEC-nutrition-004). 5: recetas (SPEC-nutrition-005).
    // 6: fecha del último cambio de metodología (SPEC-training-007). 7: consentimientos y auditoría de la IA (SPEC-ai-001).
    public const int ExportVersion = 7;

    public async Task<AccountExport?> ExportAsync(Guid userId, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().Where(u => u.Id == userId)
            .Select(u => new ExportUser(u.Username, u.CreatedAt)).FirstOrDefaultAsync(ct);
        if (user is null) return null;

        var profile = await db.Profiles.AsNoTracking().Where(p => p.UserId == userId)
            .Select(p => new ExportProfile(p.DisplayName, p.Sex, p.BirthDate, p.HeightCm, p.Goal, p.ActivityLevel,
                p.ExperienceLevel, p.DaysPerWeek, p.Methodology, p.Allergies, p.MethodologyChangedAt)).FirstOrDefaultAsync(ct);

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

        var dismissed = await db.SuggestionDismissals.AsNoTracking().Where(d => d.UserId == userId).OrderBy(d => d.Key)
            .Select(d => d.Key).ToListAsync(ct);

        var foods = await db.Foods.AsNoTracking().Where(f => f.UserId == userId).OrderBy(f => f.Name)
            .Select(f => new ExportFood(f.Id, f.Name, f.Brand, f.Barcode, f.KcalPer100g, f.ProteinPer100g, f.FatPer100g, f.CarbsPer100g, f.Source, f.Allergens,
                f.FiberPer100g, f.SugarsPer100g, f.SodiumMgPer100g))
            .ToListAsync(ct);
        var foodEntries = await db.FoodEntries.AsNoTracking().Where(e => e.UserId == userId).OrderBy(e => e.Date).ThenBy(e => e.CreatedAt)
            .Select(e => new ExportFoodEntry(e.Id, e.Date, e.Meal, e.FoodId, e.Grams, e.Name, e.Kcal, e.ProteinG, e.FatG, e.CarbsG, e.FiberG, e.SugarsG, e.SodiumMg, e.RecipeId, e.Servings))
            .ToListAsync(ct);
        var water = await db.WaterEntries.AsNoTracking().Where(w => w.UserId == userId).OrderBy(w => w.Date).ThenBy(w => w.CreatedAt)
            .Select(w => new ExportWaterEntry(w.Id, w.Date, w.Ml)).ToListAsync(ct);

        var recipes = (await db.Recipes.AsNoTracking().Include(r => r.Ingredients).Where(r => r.UserId == userId).ToListAsync(ct))
            .OrderBy(r => r.Name)
            .Select(r => new ExportRecipe(r.Id, r.Name, r.Servings, r.Ingredients.OrderBy(i => i.Position).Select(i => new ExportRecipeIngredient(
                i.FoodId, i.Name, i.Grams, i.KcalPer100g, i.ProteinPer100g, i.FatPer100g, i.CarbsPer100g, i.FiberPer100g, i.SugarsPer100g,
                i.SodiumMgPer100g)).ToList()))
            .ToList();

        var aiConsents = await db.AiConsents.AsNoTracking().Where(c => c.UserId == userId).OrderBy(c => c.Feature)
            .Select(c => new ExportAiConsent(c.Feature, c.GrantedAt)).ToListAsync(ct);
        var aiCalls = await db.AiAudits.AsNoTracking().Where(c => c.UserId == userId).OrderBy(c => c.CreatedAt)
            .Select(c => new ExportAiCall(c.Feature, c.Model, c.PromptTokens, c.CompletionTokens, c.CostUsd, c.Status, c.SentText, c.ResponseText, c.CreatedAt))
            .ToListAsync(ct);

        var overrideCalories = await db.TargetOverrides.AsNoTracking().Where(o => o.UserId == userId)
            .Select(o => (int?)o.Calories).FirstOrDefaultAsync(ct);

        return new AccountExport(
            ExportVersion, clock.GetUtcNow(), user, profile, restrictions, weights, plan, equipment, threshold, logs, dismissed, foods, foodEntries,
            overrideCalories, water, recipes, aiConsents, aiCalls);
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
        await db.SuggestionDismissals.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.FoodEntries.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.Recipes.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.Foods.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.TargetOverrides.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.WaterEntries.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.AiConsents.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.AiAudits.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.TrainingSettings.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.Profiles.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.RefreshTokens.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        await db.Users.Where(x => x.Id == userId).ExecuteDeleteAsync(ct);
        await transaction.CommitAsync(ct);
        return new DeleteAccountResult.Deleted();
    }
}
