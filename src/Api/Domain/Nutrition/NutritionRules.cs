using FitnessApp.Api.Domain.Profile;

namespace FitnessApp.Api.Domain.Nutrition;

/// <summary>Objetivo diario de calorías y macros (SPEC-nutrition-001). Orientativo: la app no sustituye a un profesional (P8).</summary>
public sealed record NutritionTarget(int Calories, int ProteinG, int FatG, int CarbsG, int BasalKcal);

/// <summary>Calorías y macros de una cantidad concreta de un alimento (calorías enteras, macros con un decimal).</summary>
public sealed record Portion(int Kcal, decimal ProteinG, decimal FatG, decimal CarbsG);

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

    /// <summary>Objetivo diario desde el perfil y el último peso (AC-01).</summary>
    public static NutritionTarget Target(
        string sex, DateOnly birthDate, int heightCm, string activityLevel, string goal, decimal weightKg, DateOnly today)
    {
        var age = ProfileRules.AgeOn(birthDate, today);
        var basal = Basal(sex, weightKg, heightCm, age);
        var expenditure = basal * ActivityFactors[activityLevel];
        var calories = Calories(expenditure, GoalFactors[goal], basal);

        var protein = (int)Math.Round(weightKg * ProteinPerKg(goal), MidpointRounding.AwayFromZero);
        var fat = (int)Math.Round(calories * FatShareOfCalories / KcalPerGramFat, MidpointRounding.AwayFromZero);
        var carbs = Math.Max(0, (int)Math.Round(
            (calories - protein * KcalPerGramProtein - fat * KcalPerGramFat) / (decimal)KcalPerGramCarbs, MidpointRounding.AwayFromZero));

        return new NutritionTarget(calories, protein, fat, carbs, (int)Math.Round(basal, MidpointRounding.AwayFromZero));
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

    private static decimal Tenths(decimal value) => Math.Round(value * 10m, MidpointRounding.AwayFromZero);
}
