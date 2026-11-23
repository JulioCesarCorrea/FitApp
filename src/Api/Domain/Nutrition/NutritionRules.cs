using FitnessApp.Api.Domain.Profile;

namespace FitnessApp.Api.Domain.Nutrition;

/// <summary>Objetivo diario de calorías y macros (SPEC-nutrition-001). Orientativo: la app no sustituye a un profesional (P8).</summary>
public sealed record NutritionTarget(int Calories, int ProteinG, int FatG, int CarbsG, int BasalKcal);

/// <summary>Gramos de proteína, grasa y carbohidratos del objetivo diario.</summary>
public sealed record Macros(int ProteinG, int FatG, int CarbsG);

/// <summary>Fibra, azúcares y sodio de una cantidad concreta; null = sin dato (no es cero). SPEC-nutrition-004.</summary>
public sealed record MicroPortion(decimal? FiberG, decimal? SugarsG, int? SodiumMg);

/// <summary>Calorías y macros de una cantidad concreta de un alimento (calorías enteras, macros con un decimal).</summary>
public sealed record Portion(int Kcal, decimal ProteinG, decimal FatG, decimal CarbsG);

/// <summary>Valores por 100 g de un ingrediente y sus gramos (SPEC-nutrition-005).</summary>
public sealed record IngredientValues(
    decimal KcalPer100g, decimal ProteinPer100g, decimal FatPer100g, decimal CarbsPer100g,
    decimal? FiberPer100g, decimal? SugarsPer100g, int? SodiumMgPer100g, int Grams);

/// <summary>Calorías y macros de una receta o de unas raciones; fibra, azúcares y sodio null = sin dato.</summary>
public sealed record RecipeValues(int Kcal, decimal ProteinG, decimal FatG, decimal CarbsG, decimal? FiberG, decimal? SugarsG, int? SodiumMg);

/// <summary>Reglas deterministas de nutrición (P1, P4). Los vectores de tests/Api.Tests/Nutrition/nutrition-vectors.json las fijan (ADR-0004).</summary>
public static class NutritionRules
{
    public const string Masculino = "masculino";

    private static readonly Dictionary<string, decimal> ActivityFactors = new()
    {
        ["sedentario"] = 1.2m, ["ligero"] = 1.375m, ["moderado"] = 1.55m, ["muy_activo"] = 1.725m,
    };

    private static readonly Dictionary<string, decimal> GoalFactors = new()
    {
        ["bajar_grasa"] = 0.85m, ["ganar_musculo"] = 1.10m, ["mantener"] = 1.00m,
    };

    public const decimal FatShareOfCalories = 0.25m;
    public const int KcalPerGramProtein = 4;
    public const int KcalPerGramCarbs = 4;
    public const int KcalPerGramFat = 9;

    /// <summary>Metabolismo basal de Mifflin-St Jeor.</summary>
    public static decimal Basal(string sex, decimal weightKg, int heightCm, int age) =>
        10m * weightKg + 6.25m * heightCm - 5m * age + (sex == Masculino ? 5m : -161m);

    /// <summary>Calorías objetivo: gasto × ajuste del objetivo, nunca por debajo del metabolismo basal, en múltiplos de 5 (AC-03).</summary>
    public static int Calories(decimal expenditure, decimal goalFactor, decimal basal) =>
        (int)(Math.Round(Math.Max(expenditure * goalFactor, basal) / 5m, MidpointRounding.AwayFromZero) * 5m);

    public static decimal ProteinPerKg(string goal) => goal == "bajar_grasa" ? 2.0m : 1.8m;

    /// <summary>
    /// Reparto de macros para unas calorías (SPEC-nutrition-002, AC-03): proteína por kilo según el objetivo, grasa al 25 % de
    /// las calorías y carbohidratos lo que queda (nunca negativo). Lo usan el objetivo calculado y el ajustado a mano.
    /// </summary>
    public static Macros MacrosFor(int calories, decimal weightKg, string goal)
    {
        var protein = (int)Math.Round(weightKg * ProteinPerKg(goal), MidpointRounding.AwayFromZero);
        var fat = (int)Math.Round(calories * FatShareOfCalories / KcalPerGramFat, MidpointRounding.AwayFromZero);
        var carbs = Math.Max(0, (int)Math.Round(
            (calories - protein * KcalPerGramProtein - fat * KcalPerGramFat) / (decimal)KcalPerGramCarbs, MidpointRounding.AwayFromZero));
        return new Macros(protein, fat, carbs);
    }

    /// <summary>Objetivo diario desde el perfil y el último peso (AC-01).</summary>
    public static NutritionTarget Target(
        string sex, DateOnly birthDate, int heightCm, string activityLevel, string goal, decimal weightKg, DateOnly today)
    {
        var age = ProfileRules.AgeOn(birthDate, today);
        var basal = Basal(sex, weightKg, heightCm, age);
        var expenditure = basal * ActivityFactors[activityLevel];
        var calories = Calories(expenditure, GoalFactors[goal], basal);

        var macros = MacrosFor(calories, weightKg, goal);

        return new NutritionTarget(calories, macros.ProteinG, macros.FatG, macros.CarbsG, (int)Math.Round(basal, MidpointRounding.AwayFromZero));
    }

    /// <summary>
    /// Valores de una cantidad de alimento. Los valores por 100 g llevan como máximo un decimal; se calcula con enteros
    /// (décimas) para que la API y la app den exactamente lo mismo (AC-10, AC-18).
    /// </summary>
    public static Portion PortionOf(decimal kcalPer100g, decimal proteinPer100g, decimal fatPer100g, decimal carbsPer100g, int grams) => new(
        (int)Math.Round(Tenths(kcalPer100g) * (decimal)grams / 1000m, MidpointRounding.AwayFromZero),
        Math.Round(Tenths(proteinPer100g) * (decimal)grams / 100m, MidpointRounding.AwayFromZero) / 10m,
        Math.Round(Tenths(fatPer100g) * (decimal)grams / 100m, MidpointRounding.AwayFromZero) / 10m,
        Math.Round(Tenths(carbsPer100g) * (decimal)grams / 100m, MidpointRounding.AwayFromZero) / 10m);

    /// <summary>
    /// SPEC-nutrition-004, AC-03: fibra y azúcares con un decimal y sodio en mg enteros, con el mismo cálculo por enteros que
    /// <see cref="PortionOf"/>. Un valor sin dato en el alimento queda sin dato en la entrada.
    /// </summary>
    public static MicroPortion MicrosOf(decimal? fiberPer100g, decimal? sugarsPer100g, int? sodiumMgPer100g, int grams) => new(
        fiberPer100g is { } f ? Math.Round(Tenths(f) * (decimal)grams / 100m, MidpointRounding.AwayFromZero) / 10m : null,
        sugarsPer100g is { } s ? Math.Round(Tenths(s) * (decimal)grams / 100m, MidpointRounding.AwayFromZero) / 10m : null,
        sodiumMgPer100g is { } na ? (int)Math.Round(na * (decimal)grams / 100m, MidpointRounding.AwayFromZero) : null);

    /// <summary>
    /// SPEC-nutrition-005, AC-03: suma de los ingredientes, cada uno redondeado como una entrada (<see cref="PortionOf"/> y
    /// <see cref="MicrosOf"/>). Si algún ingrediente no tiene fibra, azúcares o sodio, ese total queda sin dato.
    /// </summary>
    public static RecipeValues RecipeTotal(IEnumerable<IngredientValues> ingredients)
    {
        var parts = ingredients
            .Select(i => (Portion: PortionOf(i.KcalPer100g, i.ProteinPer100g, i.FatPer100g, i.CarbsPer100g, i.Grams),
                          Micros: MicrosOf(i.FiberPer100g, i.SugarsPer100g, i.SodiumMgPer100g, i.Grams)))
            .ToList();
        return new RecipeValues(
            parts.Sum(p => p.Portion.Kcal), parts.Sum(p => p.Portion.ProteinG), parts.Sum(p => p.Portion.FatG), parts.Sum(p => p.Portion.CarbsG),
            parts.Any(p => p.Micros.FiberG is null) ? null : parts.Sum(p => p.Micros.FiberG!.Value),
            parts.Any(p => p.Micros.SugarsG is null) ? null : parts.Sum(p => p.Micros.SugarsG!.Value),
            parts.Any(p => p.Micros.SodiumMg is null) ? null : parts.Sum(p => p.Micros.SodiumMg!.Value));
    }

    /// <summary>
    /// Valores de unas raciones de una receta de <paramref name="recipeServings"/> raciones: total × comidas / raciones, con las
    /// mismas reglas de redondeo (calorías y sodio enteros, macros con un decimal). Con 1 ración da los valores «por ración».
    /// </summary>
    public static RecipeValues ScaleRecipe(RecipeValues total, int recipeServings, decimal servings)
    {
        var factor = servings / recipeServings;
        decimal OneDecimal(decimal v) => Math.Round(v * 10m * factor, MidpointRounding.AwayFromZero) / 10m;
        return new RecipeValues(
            (int)Math.Round(total.Kcal * factor, MidpointRounding.AwayFromZero),
            OneDecimal(total.ProteinG), OneDecimal(total.FatG), OneDecimal(total.CarbsG),
            total.FiberG is { } f ? OneDecimal(f) : null,
            total.SugarsG is { } s ? OneDecimal(s) : null,
            total.SodiumMg is { } n ? (int)Math.Round(n * factor, MidpointRounding.AwayFromZero) : null);
    }

    private static decimal Tenths(decimal value) => Math.Round(value * 10m, MidpointRounding.AwayFromZero);
}
