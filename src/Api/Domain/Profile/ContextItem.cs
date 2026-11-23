using System.Text;
using System.Text.RegularExpressions;

namespace FitnessApp.Api.Domain.Profile;

/// <summary>
/// Entrada de contexto personal (SPEC-profile-002): suplemento, hábito, medicación o nota. Suplementos, hábitos y notas son clase B solo con el
/// interruptor «compartir con la IA» y solo en el resumen compacto; la medicación es clase A y nunca sale (P5).
/// </summary>
public class ContextItem
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Type { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Brand { get; set; }
    public string? Dose { get; set; }
    public string? Frequency { get; set; }
    public DateOnly? StartedOn { get; set; }
    public DateOnly? EndedOn { get; set; }
    public string? Note { get; set; }
    public bool ShareWithAi { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public static partial class ContextRules
{
    public const string Supplement = "suplemento";
    public const string Habit = "habito";
    public const string Medication = "medicacion";
    public const string NoteType = "nota";

    public static readonly string[] Types = [Supplement, Habit, Medication, NoteType];
    public static readonly string[] Frequencies = ["diario", "dias_alternos", "semanal", "segun_necesidad"];

    public const int MaxName = 60;
    public const int MaxBrand = 40;
    public const int MaxDose = 40;
    public const int MaxNote = 280;

    /// <summary>AC-08: tope de entradas activas por persona (acota el espacio y el coste de contexto).</summary>
    public const int MaxActive = 50;

    /// <summary>AC-09: tope del resumen para la IA, unos 300 tokens (el plan gratuito permite 8.000 tokens por minuto).</summary>
    public const int MaxSummaryChars = 1200;

    /// <summary>AC-01: activa es la entrada sin baja o con la baja en el futuro.</summary>
    public static bool IsActive(DateOnly? endedOn, DateOnly today) => endedOn is null || endedOn > today;

    private static string FrequencyLabel(string frequency) => frequency switch
    {
        "diario" => "a diario",
        "dias_alternos" => "días alternos",
        "semanal" => "semanal",
        "segun_necesidad" => "según necesidad",
        _ => frequency,
    };

    /// <summary>
    /// AC-09 (P4): resumen compacto para la IA, calculado con código. Solo entradas activas de tipo suplemento, hábito o nota con el interruptor
    /// activo; sin marca ni fechas; ordenado por tipo y nombre; recortado sin partir una entrada. La medicación nunca entra.
    /// </summary>
    public static string Summary(IEnumerable<ContextItem> items, DateOnly today)
    {
        var shared = items
            .Where(i => i.ShareWithAi && i.Type != Medication && Types.Contains(i.Type) && IsActive(i.EndedOn, today))
            .OrderBy(i => Array.IndexOf(Types, i.Type)).ThenBy(i => i.Name, StringComparer.Ordinal);

        var sb = new StringBuilder();
        foreach (var item in shared)
        {
            var parts = new List<string> { item.Name.Trim() };
            if (item.Type == NoteType)
            {
                if (!string.IsNullOrWhiteSpace(item.Note)) parts.Add(item.Note.Trim());
            }
            else
            {
                if (!string.IsNullOrWhiteSpace(item.Dose)) parts.Add(item.Dose.Trim());
                if (!string.IsNullOrWhiteSpace(item.Frequency)) parts.Add(FrequencyLabel(item.Frequency));
            }

            var line = $"{item.Type}: {string.Join(", ", parts)}";
            var next = sb.Length == 0 ? line : $"; {line}";
            if (sb.Length + next.Length > MaxSummaryChars) break;
            sb.Append(next);
        }

        return sb.ToString();
    }

    /// <summary>AC-04: patrones evidentes de dato personal (correo, teléfono, enlace o usuario de red social) que no deben ir en una nota.</summary>
    public static bool LooksPersonal(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;
        if (Email().IsMatch(text) || Link().IsMatch(text) || Handle().IsMatch(text)) return true;

        // Teléfono o documento: 7 o más dígitos aunque vengan separados por espacios, puntos o guiones.
        var digits = 0;
        foreach (var c in text)
        {
            if (char.IsDigit(c)) digits++;
            else if (c is not (' ' or '-' or '.' or '+' or '(' or ')')) digits = 0;
            if (digits >= 7) return true;
        }
        return false;
    }

    [GeneratedRegex(@"[\w.+-]+@[\w-]+\.[\w.-]+", RegexOptions.IgnoreCase)]
    private static partial Regex Email();

    [GeneratedRegex(@"(https?://|www\.)\S+", RegexOptions.IgnoreCase)]
    private static partial Regex Link();

    [GeneratedRegex(@"(^|\s)@\w{3,}")]
    private static partial Regex Handle();
}
