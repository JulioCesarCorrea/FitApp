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
    decimal KcalPer100g, decimal ProteinPer100g, decimal FatPer100g, decimal CarbsPer100g, string Source);

public sealed record FoodDto(
    Guid Id, string Name, string? Brand, string? Barcode,
    decimal KcalPer100g, decimal ProteinPer100g, decimal FatPer100g, decimal CarbsPer100g, string Source);

public sealed record FoodEntryRequest(DateOnly Date, string Meal, Guid FoodId, int Grams);

public sealed record FoodEntryDto(
    Guid Id, DateOnly Date, string Meal, Guid? FoodId, int Grams, string Name, int Kcal, decimal ProteinG, decimal FatG, decimal CarbsG);

public sealed record NutritionTargetDto(
    int Calories, int ProteinG, int FatG, int CarbsG, int BasalKcal, decimal WeightKg, DateOnly WeightDate);

public sealed record NutritionTotals(int Kcal, decimal ProteinG, decimal FatG, decimal CarbsG);

public sealed record MealDto(string Name, List<FoodEntryDto> Entries);

/// <param name="Targets">Null si falta el perfil o el peso.</param>
/// <param name="Remaining">Objetivo menos lo consumido; negativo si se pasó. Null sin objetivo.</param>
public sealed record NutritionDayDto(
    DateOnly Date, List<MealDto> Meals, NutritionTotals Totals, NutritionTargetDto? Targets, NutritionTotals? Remaining);

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
        RuleFor(x => x.Source).Must(s => s is "manual" or "openfoodfacts").WithMessage("El origen es manual u openfoodfacts.");
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
        RuleFor(x => x.Grams).InclusiveBetween(1, 5000).WithMessage("Los gramos van de 1 a 5000.");
        RuleFor(x => x.FoodId).NotEmpty().WithMessage("Falta el alimento.");
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

    public static FoodDto ToDto(Food f) =>
        new(f.Id, f.Name, f.Brand, f.Barcode, f.KcalPer100g, f.ProteinPer100g, f.FatPer100g, f.CarbsPer100g, f.Source);

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

        var food = await db.Foods.AsNoTracking().FirstOrDefaultAsync(f => f.Id == request.FoodId && f.UserId == userId, ct);
        if (food is null) return new PutEntryResult.UnknownFood();

        var created = existing is null;
        if (existing is null)
        {
            existing = new FoodEntry { Id = id, UserId = userId, CreatedAt = clock.GetUtcNow() };
            db.FoodEntries.Add(existing);
        }

        var portion = NutritionRules.PortionOf(food.KcalPer100g, food.ProteinPer100g, food.FatPer100g, food.CarbsPer100g, request.Grams);
        existing.Date = request.Date;
        existing.Meal = Meals.Normalize(request.Meal);
        existing.FoodId = food.Id;
        existing.Grams = request.Grams;
        existing.Name = food.Name;
        existing.Kcal = portion.Kcal;
        existing.ProteinG = portion.ProteinG;
        existing.FatG = portion.FatG;
        existing.CarbsG = portion.CarbsG;

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

    public static FoodEntryDto ToDto(FoodEntry e) => new(e.Id, e.Date, e.Meal, e.FoodId, e.Grams, e.Name, e.Kcal, e.ProteinG, e.FatG, e.CarbsG);
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
        return new TargetsResult.Ok(new NutritionTargetDto(
            target.Calories, target.ProteinG, target.FatG, target.CarbsG, target.BasalKcal,
            weight.WeightKg, DateOnly.FromDateTime(weight.MeasuredAt.UtcDateTime)));
    }

    public async Task<NutritionDayDto> DayAsync(Guid userId, DateOnly date, CancellationToken ct)
    {
        var entries = await db.FoodEntries.AsNoTracking().Where(e => e.UserId == userId && e.Date == date).ToListAsync(ct);
        var meals = entries
            .GroupBy(e => e.Meal)
            .OrderBy(g => Meals.Order(g.Key)).ThenBy(g => g.Key, StringComparer.OrdinalIgnoreCase)
            .Select(g => new MealDto(g.Key, g.OrderBy(e => e.CreatedAt).ThenBy(e => e.Id).Select(FoodEntryHandler.ToDto).ToList()))
            .ToList();
        var totals = new NutritionTotals(
            entries.Sum(e => e.Kcal), entries.Sum(e => e.ProteinG), entries.Sum(e => e.FatG), entries.Sum(e => e.CarbsG));

        var targets = await TargetsAsync(userId, ct) is TargetsResult.Ok ok ? ok.Target : null;
        var remaining = targets is null
            ? null
            : new NutritionTotals(
                targets.Calories - totals.Kcal, targets.ProteinG - totals.ProteinG, targets.FatG - totals.FatG, targets.CarbsG - totals.CarbsG);
        return new NutritionDayDto(date, meals, totals, targets, remaining);
    }
}
