namespace FitnessApp.Api.Domain.Nutrition;

/// <summary>Alimento propio de una persona, con sus valores por 100 g (SPEC-nutrition-001). Clase C (P5).</summary>
public class Food
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Name { get; set; } = "";
    public string? Brand { get; set; }

    /// <summary>Código de barras; único por persona cuando existe.</summary>
    public string? Barcode { get; set; }

    public decimal KcalPer100g { get; set; }
    public decimal ProteinPer100g { get; set; }
    public decimal FatPer100g { get; set; }
    public decimal CarbsPer100g { get; set; }

    /// <summary>manual | openfoodfacts.</summary>
    public string Source { get; set; } = "manual";

    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>
/// Lo comido: copia el nombre y los valores de la cantidad para que cambiar o borrar el alimento no reescriba el historial (P4).
/// </summary>
public class FoodEntry
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }

    /// <summary>Día local de la persona.</summary>
    public DateOnly Date { get; set; }

    /// <summary>desayuno, almuerzo, cena, snack o un nombre libre.</summary>
    public string Meal { get; set; } = "";

    /// <summary>Vacío si el alimento se borró.</summary>
    public Guid? FoodId { get; set; }

    public int Grams { get; set; }
    public string Name { get; set; } = "";
    public int Kcal { get; set; }
    public decimal ProteinG { get; set; }
    public decimal FatG { get; set; }
    public decimal CarbsG { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
