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

    /// <summary>Alérgenos declarados del alimento (SPEC-nutrition-003), con las etiquetas de <see cref="Allergens"/>; vacío = sin dato.</summary>
    public string[] Allergens { get; set; } = [];

    /// <summary>Por 100 g (SPEC-nutrition-004); null = sin dato.</summary>
    public decimal? FiberPer100g { get; set; }
    public decimal? SugarsPer100g { get; set; }
    public int? SodiumMgPer100g { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>
/// Calorías diarias fijadas a mano por la persona (SPEC-nutrition-002). Una fila por persona; sustituye solo a las calorías,
/// los macros se reparten con las mismas reglas. Sin fila rige el objetivo calculado.
/// </summary>
public class TargetOverride
{
    public Guid UserId { get; set; }
    public int Calories { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
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

    /// <summary>Copia de esa cantidad (SPEC-nutrition-004); null = el alimento no tenía el dato.</summary>
    public decimal? FiberG { get; set; }
    public decimal? SugarsG { get; set; }
    public int? SodiumMg { get; set; }

    /// <summary>Receta registrada (SPEC-nutrition-005): con ella <see cref="Grams"/> es 0 y vale <see cref="Servings"/>.</summary>
    public Guid? RecipeId { get; set; }
    public decimal? Servings { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>
/// Plato compuesto de alimentos propios (SPEC-nutrition-005). Clase C (P5). Cada ingrediente guarda una copia de los valores del
/// alimento al guardar la receta, así borrar o cambiar el alimento no reescribe la receta (P4).
/// </summary>
public class Recipe
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Name { get; set; } = "";
    public int Servings { get; set; }
    public List<RecipeIngredient> Ingredients { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class RecipeIngredient
{
    public Guid Id { get; set; }
    public Guid RecipeId { get; set; }

    /// <summary>Vacío si el alimento se borró («alimento eliminado»).</summary>
    public Guid? FoodId { get; set; }

    public int Position { get; set; }
    public string Name { get; set; } = "";
    public int Grams { get; set; }
    public decimal KcalPer100g { get; set; }
    public decimal ProteinPer100g { get; set; }
    public decimal FatPer100g { get; set; }
    public decimal CarbsPer100g { get; set; }
    public decimal? FiberPer100g { get; set; }
    public decimal? SugarsPer100g { get; set; }
    public int? SodiumMgPer100g { get; set; }
}

/// <summary>Agua bebida en un día, en mililitros (SPEC-nutrition-004). Clase B.</summary>
public class WaterEntry
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public DateOnly Date { get; set; }
    public int Ml { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
