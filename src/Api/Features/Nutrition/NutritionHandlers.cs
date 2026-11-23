using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using FitnessApp.Api.Domain;
using FitnessApp.Api.Domain.Nutrition;
using FitnessApp.Api.Infrastructure;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Nutrition;

public sealed record FoodRequest(
    string Name, string? Brand, string? Barcode,
    decimal KcalPer100g, decimal ProteinPer100g, decimal FatPer100g, decimal CarbsPer100g, string Source,
    string[]? Allergens = null, decimal? FiberPer100g = null, decimal? SugarsPer100g = null, int? SodiumMgPer100g = null);

public sealed record FoodDto(
    Guid Id, string Name, string? Brand, string? Barcode,
    decimal KcalPer100g, decimal ProteinPer100g, decimal FatPer100g, decimal CarbsPer100g, string Source, string[] Allergens,
    decimal? FiberPer100g, decimal? SugarsPer100g, int? SodiumMgPer100g);

/// <summary>SPEC-nutrition-003, AC-04: alérgenos del alimento que coinciden con las alergias del perfil.</summary>
public sealed record FoodConflictsDto(string[] Conflicts);

/// <summary>Con alimento: <c>FoodId</c> y <c>Grams</c>. Con receta (SPEC-nutrition-005): <c>RecipeId</c> y <c>Servings</c>.</summary>
public sealed record FoodEntryRequest(
    DateOnly Date, string Meal, Guid? FoodId = null, int Grams = 0, Guid? RecipeId = null, decimal? Servings = null);

public sealed record FoodEntryDto(
    Guid Id, DateOnly Date, string Meal, Guid? FoodId, int Grams, string Name, int Kcal, decimal ProteinG, decimal FatG, decimal CarbsG,
    decimal? FiberG = null, decimal? SugarsG = null, int? SodiumMg = null, Guid? RecipeId = null, decimal? Servings = null);

public sealed record WaterRequest(DateOnly Date, int Ml);

public sealed record WaterDto(Guid Id, DateOnly Date, int Ml);

/// <param name="CalculatedCalories">Calorías que darían las reglas de la spec14, aunque la persona haya ajustado las suyas (la app las usa para volver al calculado sin conexión).</param>
/// <param name="Source">«calculated» (reglas de la spec14) o «manual» (calorías ajustadas por la persona, SPEC-nutrition-002).</param>
public sealed record NutritionTargetDto(
    int Calories, int ProteinG, int FatG, int CarbsG, int BasalKcal, decimal WeightKg, DateOnly WeightDate, int CalculatedCalories,
    string Source = "calculated");

public sealed record TargetOverrideRequest(int Calories);

public sealed class TargetOverrideRequestValidator : AbstractValidator<TargetOverrideRequest>
{
    public const int MinCalories = 800;
    public const int MaxCalories = 6000;

    public TargetOverrideRequestValidator() =>
        RuleFor(x => x.Calories).InclusiveBetween(MinCalories, MaxCalories)
            .WithMessage($"Las calorías van de {MinCalories} a {MaxCalories}.");
}

public sealed record NutritionTotals(int Kcal, decimal ProteinG, decimal FatG, decimal CarbsG);

/// <param name="Partial">Alguna entrada no tenía fibra, azúcares o sodio: esos totales no la cuentan (SPEC-nutrition-004, AC-05).</param>
public sealed record DayTotals(
    int Kcal, decimal ProteinG, decimal FatG, decimal CarbsG, decimal FiberG, decimal SugarsG, int SodiumMg, int WaterMl, bool Partial);

public sealed record MealDto(string Name, List<FoodEntryDto> Entries);

/// <param name="Targets">Null si falta el perfil o el peso.</param>
/// <param name="Remaining">Objetivo menos lo consumido; negativo si se pasó. Null sin objetivo.</param>
public sealed record NutritionDayDto(
    DateOnly Date, List<MealDto> Meals, DayTotals Totals, NutritionTargetDto? Targets, NutritionTotals? Remaining, List<WaterDto> Water);

/// <param name="Logged">El día tiene alguna entrada; si no, no cuenta en los promedios.</param>
public sealed record HistoryDayDto(DateOnly Date, bool Logged, int Kcal, decimal ProteinG, decimal FatG, decimal CarbsG);

/// <param name="Targets">Objetivo vigente de hoy, aplicado a todo el rango (no se guarda un historial de objetivos); null si falta perfil o peso.</param>
public sealed record NutritionHistoryDto(List<HistoryDayDto> Days, NutritionTargetDto? Targets);

public sealed record NutritionWeeklyDto(List<WeekIntake> Weeks, NutritionTargetDto? Targets);

public static class Meals
{
    public static readonly string[] Fixed = ["desayuno", "almuerzo", "cena", "snack"];
    public const int MaxLength = 30;

    /// <summary>Las comidas fijas se guardan siempre igual (sin mayúsculas ni espacios al borde); las libres conservan lo escrito.</summary>
    public static string Normalize(string meal)
    {
        var trimmed = meal.Trim();
        var fixedName = Fixed.FirstOrDefault(f => f.Equals(trimmed, StringComparison.OrdinalIgnoreCase));
        return fixedName ?? trimmed;
    }

    /// <summary>Orden de salida: las fijas, en su orden, y luego las libres por nombre.</summary>
    public static int Order(string meal) => Array.IndexOf(Fixed, meal) is var i and >= 0 ? i : Fixed.Length;
}

public sealed partial class FoodRequestValidator : AbstractValidator<FoodRequest>
{
    [GeneratedRegex(@"^\d{6,14}$")]
    private static partial Regex BarcodePattern();

    public FoodRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().Must(n => n.Trim().Length is >= 1 and <= 80).WithMessage("El nombre lleva entre 1 y 80 caracteres.");
        RuleFor(x => x.Brand).MaximumLength(60).WithMessage("La marca lleva como máximo 60 caracteres.");
        RuleFor(x => x.Barcode).Must(b => BarcodePattern().IsMatch(b!)).When(x => !string.IsNullOrWhiteSpace(x.Barcode))
            .WithMessage("El código de barras son entre 6 y 14 cifras.");
        RuleFor(x => x.KcalPer100g).InclusiveBetween(0m, 900m).WithMessage("Las calorías por 100 g van de 0 a 900.");
        RuleFor(x => x.ProteinPer100g).InclusiveBetween(0m, 100m).WithMessage("La proteína por 100 g va de 0 a 100 g.");
        RuleFor(x => x.FatPer100g).InclusiveBetween(0m, 100m).WithMessage("La grasa por 100 g va de 0 a 100 g.");
        RuleFor(x => x.CarbsPer100g).InclusiveBetween(0m, 100m).WithMessage("Los carbohidratos por 100 g van de 0 a 100 g.");
        foreach (var field in new Func<FoodRequest, decimal>[] { x => x.KcalPer100g, x => x.ProteinPer100g, x => x.FatPer100g, x => x.CarbsPer100g })
            RuleFor(x => field(x)).PrecisionScale(7, 1, ignoreTrailingZeros: true).WithMessage("Los valores admiten como máximo un decimal.");
        RuleFor(x => x).Must(x => x.ProteinPer100g + x.FatPer100g + x.CarbsPer100g <= 100m)
            .WithMessage("Proteína, grasa y carbohidratos no pueden sumar más de 100 g por 100 g.");
        RuleFor(x => x.FiberPer100g).InclusiveBetween(0m, 100m).When(x => x.FiberPer100g is not null)
            .WithMessage("La fibra por 100 g va de 0 a 100 g.");
        RuleFor(x => x.SugarsPer100g).InclusiveBetween(0m, 100m).When(x => x.SugarsPer100g is not null)
            .WithMessage("Los azúcares por 100 g van de 0 a 100 g.");
        RuleFor(x => x.SodiumMgPer100g).InclusiveBetween(0, 40000).When(x => x.SodiumMgPer100g is not null)
            .WithMessage("El sodio por 100 g va de 0 a 40000 mg.");
        RuleFor(x => x.FiberPer100g).PrecisionScale(7, 1, ignoreTrailingZeros: true).When(x => x.FiberPer100g is not null)
            .WithMessage("Los valores admiten como máximo un decimal.");
        RuleFor(x => x.SugarsPer100g).PrecisionScale(7, 1, ignoreTrailingZeros: true).When(x => x.SugarsPer100g is not null)
            .WithMessage("Los valores admiten como máximo un decimal.");
        RuleFor(x => x).Must(x => x.SugarsPer100g is null || x.SugarsPer100g <= x.CarbsPer100g)
            .WithMessage("Los azúcares no pueden superar los carbohidratos.");
        RuleFor(x => x.Source).Must(s => s is "manual" or "openfoodfacts").WithMessage("El origen es manual u openfoodfacts.");
        RuleFor(x => x.Allergens).Must(a => a is null || a.Length <= Allergens.MaxPerFood)
            .WithMessage($"Un alimento lleva como máximo {Allergens.MaxPerFood} alérgenos.");
        RuleForEach(x => x.Allergens).Must(Allergens.IsValid).WithMessage("Alérgeno no válido.");
    }
}

public sealed class FoodEntryRequestValidator : AbstractValidator<FoodEntryRequest>
{
    private static readonly DateOnly Earliest = new(2000, 1, 1);

    public FoodEntryRequestValidator(TimeProvider clock)
    {
        RuleFor(x => x.Date).Must(d => d >= Earliest).WithMessage("La fecha no es válida.")
            // Un día de margen por las zonas horarias (como el peso y los registros de sesiones).
            .Must(d => d <= DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime).AddDays(1)).WithMessage("La fecha no puede ser futura.");
        RuleFor(x => x.Meal).NotEmpty().Must(m => m.Trim().Length is >= 1 and <= Meals.MaxLength)
            .WithMessage($"La comida lleva entre 1 y {Meals.MaxLength} caracteres.");
        RuleFor(x => x).Must(x => (x.FoodId is not null && x.FoodId != Guid.Empty) ^ (x.RecipeId is not null && x.RecipeId != Guid.Empty))
            .WithMessage("Indica un alimento o una receta, no los dos.");
        RuleFor(x => x.Grams).InclusiveBetween(1, 5000).When(x => x.RecipeId is null).WithMessage("Los gramos van de 1 a 5000.");
        RuleFor(x => x.Servings).NotNull().InclusiveBetween(0.25m, 20m).PrecisionScale(6, 2, ignoreTrailingZeros: true)
            .When(x => x.RecipeId is not null).WithMessage("Las raciones van de 0,25 a 20, con hasta dos decimales.");
    }
}

public abstract record PutFoodResult
{
    public sealed record Saved(FoodDto Food, bool Created) : PutFoodResult;
    public sealed record NotFound : PutFoodResult;
    public sealed record BarcodeTaken : PutFoodResult;
}

public abstract record PutEntryResult
{
    public sealed record Saved(FoodEntryDto Entry, bool Created) : PutEntryResult;
    public sealed record NotFound : PutEntryResult;
    public sealed record UnknownFood : PutEntryResult;
    public sealed record UnknownRecipe : PutEntryResult;
}

public abstract record TargetsResult
{
    public sealed record Ok(NutritionTargetDto Target) : TargetsResult;
    public sealed record Missing(string What) : TargetsResult;
}

/// <summary>Casos de uso de SPEC-nutrition-001: alimentos propios. Todo filtra por la persona que llama (P7).</summary>
public sealed class FoodHandler(AppDbContext db, TimeProvider clock)
{
    /// <summary>AC-05, 06, 07: crea el alimento o reemplaza el que tiene ese id.</summary>
    public async Task<PutFoodResult> PutAsync(Guid userId, Guid id, FoodRequest request, CancellationToken ct)
    {
        var existing = await db.Foods.FirstOrDefaultAsync(f => f.Id == id, ct);
        if (existing is not null && existing.UserId != userId) return new PutFoodResult.NotFound();

        var barcode = string.IsNullOrWhiteSpace(request.Barcode) ? null : request.Barcode.Trim();
        if (barcode is not null && await db.Foods.AnyAsync(f => f.UserId == userId && f.Barcode == barcode && f.Id != id, ct))
            return new PutFoodResult.BarcodeTaken();

        var created = existing is null;
        if (existing is null)
        {
            existing = new Food { Id = id, UserId = userId, CreatedAt = clock.GetUtcNow() };
            db.Foods.Add(existing);
        }

        existing.Name = request.Name.Trim();
        existing.Brand = string.IsNullOrWhiteSpace(request.Brand) ? null : request.Brand.Trim();
        existing.Barcode = barcode;
        existing.KcalPer100g = request.KcalPer100g;
        existing.ProteinPer100g = request.ProteinPer100g;
        existing.FatPer100g = request.FatPer100g;
        existing.CarbsPer100g = request.CarbsPer100g;
        existing.Source = request.Source;
        existing.Allergens = Allergens.Normalize(request.Allergens);
        existing.FiberPer100g = request.FiberPer100g;
        existing.SugarsPer100g = request.SugarsPer100g;
        existing.SodiumMgPer100g = request.SodiumMgPer100g;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Carrera: otra petición guardó el mismo código de barras o el mismo id entre la lectura y la escritura.
            db.ChangeTracker.Clear();
            return new PutFoodResult.BarcodeTaken();
        }

        return new PutFoodResult.Saved(ToDto(existing), created);
    }

    /// <summary>AC-09: las entradas ya registradas conservan sus valores (el alimento pasa a «borrado» en ellas).</summary>
    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct) =>
        await db.Foods.Where(f => f.Id == id && f.UserId == userId).ExecuteDeleteAsync(ct);

    /// <summary>AC-08: solo los alimentos propios, por nombre, sin distinguir mayúsculas ni acentos.</summary>
    public async Task<List<FoodDto>> ListAsync(Guid userId, string? query, CancellationToken ct)
    {
        var all = await db.Foods.AsNoTracking().Where(f => f.UserId == userId).ToListAsync(ct);
        var needle = Fold(query ?? "");
        return all
            .Where(f => needle.Length == 0 || Fold(f.Name).Contains(needle) || Fold(f.Brand ?? "").Contains(needle))
            .OrderBy(f => Fold(f.Name), StringComparer.Ordinal).ThenBy(f => f.Id)
            .Select(ToDto).ToList();
    }

    /// <summary>AC-04: null si el alimento no existe o es de otra persona.</summary>
    public async Task<FoodConflictsDto?> ConflictsAsync(Guid userId, Guid id, CancellationToken ct)
    {
        var food = await db.Foods.AsNoTracking().FirstOrDefaultAsync(f => f.Id == id && f.UserId == userId, ct);
        if (food is null) return null;

        var allergies = await db.Profiles.AsNoTracking().Where(p => p.UserId == userId).Select(p => p.Allergies).FirstOrDefaultAsync(ct);
        return new FoodConflictsDto(Allergens.Conflicts(allergies ?? [], food.Allergens));
    }

    public static FoodDto ToDto(Food f) =>
        new(f.Id, f.Name, f.Brand, f.Barcode, f.KcalPer100g, f.ProteinPer100g, f.FatPer100g, f.CarbsPer100g, f.Source, f.Allergens,
            f.FiberPer100g, f.SugarsPer100g, f.SodiumMgPer100g);

    private static string Fold(string text) =>
        new string(text.Normalize(NormalizationForm.FormD)
            .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).ToArray())
            .ToLowerInvariant().Trim();
}

/// <summary>Casos de uso de SPEC-nutrition-001: lo comido en el día.</summary>
public sealed class FoodEntryHandler(AppDbContext db, TimeProvider clock)
{
    /// <summary>AC-10, 11: guarda la entrada con una copia del nombre y los valores de esa cantidad.</summary>
    public async Task<PutEntryResult> PutAsync(Guid userId, Guid id, FoodEntryRequest request, CancellationToken ct)
    {
        var existing = await db.FoodEntries.FirstOrDefaultAsync(e => e.Id == id, ct);
        if (existing is not null && existing.UserId != userId) return new PutEntryResult.NotFound();

        Food? food = null;
        Recipe? recipe = null;
        if (request.RecipeId is { } recipeId)
        {
            recipe = await db.Recipes.AsNoTracking().Include(r => r.Ingredients).FirstOrDefaultAsync(r => r.Id == recipeId && r.UserId == userId, ct);
            if (recipe is null) return new PutEntryResult.UnknownRecipe();
        }
        else
        {
            food = await db.Foods.AsNoTracking().FirstOrDefaultAsync(f => f.Id == request.FoodId && f.UserId == userId, ct);
            if (food is null) return new PutEntryResult.UnknownFood();
        }

        var created = existing is null;
        if (existing is null)
        {
            existing = new FoodEntry { Id = id, UserId = userId, CreatedAt = clock.GetUtcNow() };
            db.FoodEntries.Add(existing);
        }

        existing.Date = request.Date;
        existing.Meal = Meals.Normalize(request.Meal);
        if (recipe is not null)
        {
            // SPEC-nutrition-005, AC-04: la entrada copia los valores de esas raciones; cambiar o borrar la receta no la reescribe.
            var eaten = NutritionRules.ScaleRecipe(RecipeHandler.TotalOf(recipe), recipe.Servings, request.Servings!.Value);
            existing.FoodId = null;
            existing.RecipeId = recipe.Id;
            existing.Servings = request.Servings;
            existing.Grams = 0;
            existing.Name = recipe.Name;
            (existing.Kcal, existing.ProteinG, existing.FatG, existing.CarbsG) = (eaten.Kcal, eaten.ProteinG, eaten.FatG, eaten.CarbsG);
            (existing.FiberG, existing.SugarsG, existing.SodiumMg) = (eaten.FiberG, eaten.SugarsG, eaten.SodiumMg);
        }
        else
        {
            var portion = NutritionRules.PortionOf(food!.KcalPer100g, food.ProteinPer100g, food.FatPer100g, food.CarbsPer100g, request.Grams);
            existing.FoodId = food.Id;
            existing.RecipeId = null;
            existing.Servings = null;
            existing.Grams = request.Grams;
            existing.Name = food.Name;
            existing.Kcal = portion.Kcal;
            existing.ProteinG = portion.ProteinG;
            existing.FatG = portion.FatG;
            existing.CarbsG = portion.CarbsG;
            var micros = NutritionRules.MicrosOf(food.FiberPer100g, food.SugarsPer100g, food.SodiumMgPer100g, request.Grams);
            existing.FiberG = micros.FiberG;
            existing.SugarsG = micros.SugarsG;
            existing.SodiumMg = micros.SodiumMg;
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Carrera: otra petición guardó el mismo id entre la lectura y la escritura; se resuelve como reemplazo.
            db.ChangeTracker.Clear();
            return await PutAsync(userId, id, request, ct);
        }

        return new PutEntryResult.Saved(ToDto(existing), created);
    }

    /// <summary>AC-12: borrar es definitivo; uno ajeno o inexistente no hace nada.</summary>
    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct) =>
        await db.FoodEntries.Where(e => e.Id == id && e.UserId == userId).ExecuteDeleteAsync(ct);

    public static FoodEntryDto ToDto(FoodEntry e) =>
        new(e.Id, e.Date, e.Meal, e.FoodId, e.Grams, e.Name, e.Kcal, e.ProteinG, e.FatG, e.CarbsG, e.FiberG, e.SugarsG, e.SodiumMg, e.RecipeId, e.Servings);
}

public sealed class WaterRequestValidator : AbstractValidator<WaterRequest>
{
    private static readonly DateOnly Earliest = new(2000, 1, 1);

    public WaterRequestValidator(TimeProvider clock)
    {
        RuleFor(x => x.Date).Must(d => d >= Earliest).WithMessage("La fecha no es válida.")
            .Must(d => d <= DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime).AddDays(1)).WithMessage("La fecha no puede ser futura.");
        RuleFor(x => x.Ml).InclusiveBetween(1, 5000).WithMessage("Los mililitros van de 1 a 5000.");
    }
}

/// <summary>Casos de uso de SPEC-nutrition-004: agua bebida. Todo filtra por la persona que llama (P7).</summary>
public sealed class WaterHandler(AppDbContext db, TimeProvider clock)
{
    /// <summary>AC-06: crea el registro o reemplaza el que tiene ese id; null si el id es de otra persona.</summary>
    public async Task<(WaterDto Water, bool Created)?> PutAsync(Guid userId, Guid id, WaterRequest request, CancellationToken ct)
    {
        var existing = await db.WaterEntries.FirstOrDefaultAsync(w => w.Id == id, ct);
        if (existing is not null && existing.UserId != userId) return null;

        var created = existing is null;
        if (existing is null)
        {
            existing = new WaterEntry { Id = id, UserId = userId, CreatedAt = clock.GetUtcNow() };
            db.WaterEntries.Add(existing);
        }

        existing.Date = request.Date;
        existing.Ml = request.Ml;
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Carrera: otra petición guardó el mismo id entre la lectura y la escritura; se resuelve como reemplazo.
            db.ChangeTracker.Clear();
            return await PutAsync(userId, id, request, ct);
        }

        return (new WaterDto(existing.Id, existing.Date, existing.Ml), created);
    }

    /// <summary>AC-06: uno ajeno o inexistente no hace nada.</summary>
    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct) =>
        await db.WaterEntries.Where(w => w.Id == id && w.UserId == userId).ExecuteDeleteAsync(ct);
}

/// <summary>Objetivo diario y resumen del día (SPEC-nutrition-001, AC-01, 04, 13).</summary>
public sealed class NutritionHandler(AppDbContext db, TimeProvider clock)
{
    public async Task<TargetsResult> TargetsAsync(Guid userId, CancellationToken ct)
    {
        var profile = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == userId, ct);
        if (profile is null) return new TargetsResult.Missing("perfil");

        var weight = await db.Weights.AsNoTracking().Where(w => w.UserId == userId)
            .OrderByDescending(w => w.MeasuredAt).FirstOrDefaultAsync(ct);
        if (weight is null) return new TargetsResult.Missing("peso");

        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var target = NutritionRules.Target(
            profile.Sex, profile.BirthDate, profile.HeightCm, profile.ActivityLevel, profile.Goal, weight.WeightKg, today);
        var weightDate = DateOnly.FromDateTime(weight.MeasuredAt.UtcDateTime);

        // SPEC-nutrition-002 (AC-02, 07): si la persona fijó sus calorías, mandan; los macros se recalculan con el peso vigente.
        var fixedCalories = await db.TargetOverrides.AsNoTracking()
            .Where(o => o.UserId == userId).Select(o => (int?)o.Calories).FirstOrDefaultAsync(ct);
        if (fixedCalories is { } calories)
        {
            var macros = NutritionRules.MacrosFor(calories, weight.WeightKg, profile.Goal);
            return new TargetsResult.Ok(new NutritionTargetDto(
                calories, macros.ProteinG, macros.FatG, macros.CarbsG, target.BasalKcal, weight.WeightKg, weightDate,
                target.Calories, "manual"));
        }

        return new TargetsResult.Ok(new NutritionTargetDto(
            target.Calories, target.ProteinG, target.FatG, target.CarbsG, target.BasalKcal, weight.WeightKg, weightDate, target.Calories));
    }

    /// <summary>AC-01, 06: fija las calorías (idempotente); sin perfil o sin peso responde qué falta.</summary>
    public async Task<TargetsResult> SetOverrideAsync(Guid userId, int calories, CancellationToken ct)
    {
        if (await TargetsAsync(userId, ct) is TargetsResult.Missing missing) return missing;

        var row = await db.TargetOverrides.FirstOrDefaultAsync(o => o.UserId == userId, ct);
        if (row is null)
        {
            row = new TargetOverride { UserId = userId };
            db.TargetOverrides.Add(row);
        }

        row.Calories = calories;
        row.UpdatedAt = clock.GetUtcNow();
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Carrera: otra petición creó la fila entre la lectura y la escritura; se resuelve como reemplazo.
            db.ChangeTracker.Clear();
            return await SetOverrideAsync(userId, calories, ct);
        }

        return await TargetsAsync(userId, ct);
    }

    /// <summary>AC-05: vuelve al objetivo calculado; repetirlo no hace nada.</summary>
    public async Task ClearOverrideAsync(Guid userId, CancellationToken ct) =>
        await db.TargetOverrides.Where(o => o.UserId == userId).ExecuteDeleteAsync(ct);

    public const int MaxHistoryDays = 92;
    public const int MaxHistoryWeeks = 52;

    private async Task<List<DayIntake>> LoggedDaysAsync(Guid userId, DateOnly from, DateOnly to, CancellationToken ct) =>
        (await db.FoodEntries.AsNoTracking().Where(e => e.UserId == userId && e.Date >= from && e.Date <= to)
            .Select(e => new { e.Date, e.Kcal, e.ProteinG, e.FatG, e.CarbsG }).ToListAsync(ct))
        .GroupBy(e => e.Date)
        .Select(g => new DayIntake(g.Key, g.Sum(e => e.Kcal), g.Sum(e => e.ProteinG), g.Sum(e => e.FatG), g.Sum(e => e.CarbsG)))
        .OrderBy(d => d.Date).ToList();

    /// <summary>SPEC-nutrition-006, AC-01 y 04: lo consumido cada día del rango; los días sin entradas van marcados como sin registro.</summary>
    public async Task<NutritionHistoryDto> HistoryAsync(Guid userId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var logged = (await LoggedDaysAsync(userId, from, to, ct)).ToDictionary(d => d.Date);
        var days = Enumerable.Range(0, to.DayNumber - from.DayNumber + 1).Select(i => from.AddDays(i))
            .Select(date => logged.TryGetValue(date, out var d)
                ? new HistoryDayDto(date, true, d.Kcal, d.ProteinG, d.FatG, d.CarbsG)
                : new HistoryDayDto(date, false, 0, 0, 0, 0)).ToList();
        return new NutritionHistoryDto(days, await TargetsAsync(userId, ct) is TargetsResult.Ok ok ? ok.Target : null);
    }

    /// <summary>SPEC-nutrition-006, AC-02: promedios por semana ISO de las últimas semanas y días dentro del margen del objetivo.</summary>
    public async Task<NutritionWeeklyDto> WeeklyAsync(Guid userId, int weeks, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var from = today.AddDays(-(((int)today.DayOfWeek + 6) % 7) - 7 * (weeks - 1));
        var targets = await TargetsAsync(userId, ct) is TargetsResult.Ok ok ? ok.Target : null;
        var result = NutritionHistory.Weekly(await LoggedDaysAsync(userId, from, today, ct), targets?.Calories);
        return new NutritionWeeklyDto(result, targets);
    }

    public async Task<NutritionDayDto> DayAsync(Guid userId, DateOnly date, CancellationToken ct)
    {
        var entries = await db.FoodEntries.AsNoTracking().Where(e => e.UserId == userId && e.Date == date).ToListAsync(ct);
        var meals = entries
            .GroupBy(e => e.Meal)
            .OrderBy(g => Meals.Order(g.Key)).ThenBy(g => g.Key, StringComparer.OrdinalIgnoreCase)
            .Select(g => new MealDto(g.Key, g.OrderBy(e => e.CreatedAt).ThenBy(e => e.Id).Select(FoodEntryHandler.ToDto).ToList()))
            .ToList();
        var water = await db.WaterEntries.AsNoTracking().Where(w => w.UserId == userId && w.Date == date)
            .OrderBy(w => w.CreatedAt).ThenBy(w => w.Id).Select(w => new WaterDto(w.Id, w.Date, w.Ml)).ToListAsync(ct);
        // AC-05: lo que no tiene dato no suma y se avisa con Partial.
        var totals = new DayTotals(
            entries.Sum(e => e.Kcal), entries.Sum(e => e.ProteinG), entries.Sum(e => e.FatG), entries.Sum(e => e.CarbsG),
            entries.Sum(e => e.FiberG ?? 0m), entries.Sum(e => e.SugarsG ?? 0m), entries.Sum(e => e.SodiumMg ?? 0), water.Sum(w => w.Ml),
            entries.Any(e => e.FiberG is null || e.SugarsG is null || e.SodiumMg is null));

        var targets = await TargetsAsync(userId, ct) is TargetsResult.Ok ok ? ok.Target : null;
        var remaining = targets is null
            ? null
            : new NutritionTotals(
                targets.Calories - totals.Kcal, targets.ProteinG - totals.ProteinG, targets.FatG - totals.FatG, targets.CarbsG - totals.CarbsG);
        return new NutritionDayDto(date, meals, totals, targets, remaining, water);
    }
}
