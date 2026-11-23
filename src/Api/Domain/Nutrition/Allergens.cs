using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace FitnessApp.Api.Domain.Nutrition;

/// <summary>
/// Alérgenos de los alimentos (SPEC-nutrition-003): los 14 de declaración obligatoria en la UE y las palabras con las que la
/// persona suele escribir sus alergias en el perfil (texto libre). Orientativo: manda siempre el etiquetado del producto (P3, P8).
/// Los vectores de tests/Api.Tests/Nutrition/allergen-vectors.json los ejecutan la API y la app (ADR-0004).
/// </summary>
public static partial class Allergens
{
    public const int MaxPerFood = 14;

    /// <summary>Etiqueta → palabras (sin acentos ni mayúsculas) con las que la persona puede escribir esa alergia.</summary>
    private static readonly (string Tag, string[] Words)[] Catalog =
    [
        ("gluten", ["gluten", "trigo", "celiaco", "celiaca", "celiaquia", "cebada", "centeno"]),
        ("crustaceos", ["crustaceo", "gamba", "langostino", "camaron", "cangrejo", "langosta", "marisco"]),
        ("huevo", ["huevo", "ovoalbumina"]),
        ("pescado", ["pescado", "atun", "salmon", "merluza", "bacalao"]),
        ("cacahuete", ["cacahuete", "cacahuate", "mani", "peanut"]),
        ("soja", ["soja", "soya"]),
        ("leche", ["leche", "lactosa", "lacteo", "lactea", "caseina"]),
        ("frutos_secos", ["fruto seco", "frutos secos", "nuez", "nueces", "almendra", "avellana", "pistacho", "anacardo", "castana", "macadamia", "pecana"]),
        ("apio", ["apio"]),
        ("mostaza", ["mostaza"]),
        ("sesamo", ["sesamo", "ajonjoli"]),
        ("sulfitos", ["sulfito", "dioxido de azufre"]),
        ("altramuces", ["altramuz", "altramuces", "lupino"]),
        ("moluscos", ["molusco", "mejillon", "almeja", "calamar", "pulpo", "ostra", "caracol"]),
    ];

    public static readonly string[] All = [.. Catalog.Select(c => c.Tag)];

    public static bool IsValid(string tag) => Array.IndexOf(All, tag) >= 0;

    /// <summary>Etiquetas válidas, sin repetir y en el orden del catálogo (así la API y la app guardan lo mismo).</summary>
    public static string[] Normalize(IEnumerable<string>? tags) =>
        All.Where(a => tags?.Contains(a) == true).ToArray();

    /// <summary>
    /// AC-nutrition-003-04: alérgenos del alimento que coinciden con alguna alergia escrita en el perfil. Se compara por palabras
    /// completas (con plural), así «mani» no coincide con «manitas».
    /// </summary>
    public static string[] Conflicts(IEnumerable<string> profileAllergies, IEnumerable<string> foodTags)
    {
        var typed = profileAllergies.Select(Fold).Where(t => t.Length > 0).ToList();
        var present = Normalize(foodTags);
        return Catalog
            .Where(c => present.Contains(c.Tag) && typed.Any(t => c.Words.Any(w => WordRegex(w).IsMatch(t))))
            .Select(c => c.Tag).ToArray();
    }

    /// <summary>Etiquetas cuyas palabras aparecen en un texto, p. ej. el nombre de un alimento («yogur de leche» → leche) (SPEC-ai-003, AC-07).</summary>
    public static string[] MentionedIn(string text)
    {
        var folded = Fold(text);
        return Catalog.Where(c => c.Words.Any(w => WordRegex(w).IsMatch(folded))).Select(c => c.Tag).ToArray();
    }

    private static Regex WordRegex(string word) =>
        new($"(^|[^a-z]){Regex.Escape(word)}(s|es)?([^a-z]|$)", RegexOptions.CultureInvariant);

    public static string Fold(string text) =>
        new string(text.Normalize(NormalizationForm.FormD)
            .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).ToArray())
            .ToLowerInvariant().Trim();
}
