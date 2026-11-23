using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace FitnessApp.Api.Domain.Ai;

/// <summary>Una afirmación de un análisis: distingue dato registrado, estimación e inferencia y cita su fuente (P4, SPEC-ai-002 AC-01).</summary>
public sealed record AnalysisClaim(string Text, string Kind, string Source, bool Verified);

public sealed record AnalysisSection(string Title, List<AnalysisClaim> Claims);

/// <summary>
/// Validación de lo que devuelve la IA (SPEC-ai-002, P4): la respuesta es un texto que no se fía. Se descarta lo que no cumple la forma
/// pedida y una «medición registrada» con un número que no está en los datos enviados pasa a inferencia (la IA no inventa mediciones).
/// </summary>
public static partial class AiOutputRules
{
    public const string Registered = "registrado";
    public const string Estimate = "estimacion";
    public const string Inference = "inferencia";

    public const int MaxSections = 6;
    public const int MaxClaimsPerSection = 8;
    public const int MaxTextLength = 400;

    /// <summary>Los números enteros pequeños (días, series, semanas) se admiten siempre: no son mediciones.</summary>
    private const int FreeIntegerLimit = 12;

    [GeneratedRegex(@"\d+(?:[.,]\d+)?")]
    private static partial Regex NumberPattern();

    /// <summary>Quita el cercado de código (```json) con que a veces envuelven la respuesta.</summary>
    public static string StripFence(string text)
    {
        var t = text.Trim();
        if (!t.StartsWith("```", StringComparison.Ordinal)) return t;
        var firstBreak = t.IndexOf('\n');
        var lastFence = t.LastIndexOf("```", StringComparison.Ordinal);
        return firstBreak >= 0 && lastFence > firstBreak ? t[(firstBreak + 1)..lastFence].Trim() : t;
    }

    /// <summary>Números de un texto en forma canónica (punto decimal, sin ceros a la derecha).</summary>
    public static HashSet<string> Numbers(string text)
    {
        var set = new HashSet<string>();
        foreach (Match m in NumberPattern().Matches(text))
        {
            if (decimal.TryParse(m.Value.Replace(',', '.'), NumberStyles.Number, CultureInfo.InvariantCulture, out var value))
                set.Add(value.ToString("0.#########", CultureInfo.InvariantCulture));
        }

        return set;
    }

    private static bool IsFree(string number) =>
        decimal.TryParse(number, NumberStyles.Number, CultureInfo.InvariantCulture, out var v) && v == decimal.Truncate(v) && v <= FreeIntegerLimit;

    /// <summary>
    /// Interpreta el análisis. Devuelve null si no tiene la forma pedida. «registrado» exige una fuente conocida y que todos sus números
    /// estén en los datos enviados; si no, se degrada a inferencia y se marca como no verificado.
    /// </summary>
    public static List<AnalysisSection>? ParseAnalysis(string text, IReadOnlySet<string> allowedSources, IReadOnlySet<string> knownNumbers)
    {
        try
        {
            using var doc = JsonDocument.Parse(StripFence(text));
            if (!doc.RootElement.TryGetProperty("sections", out var sections) || sections.ValueKind != JsonValueKind.Array) return null;

            var result = new List<AnalysisSection>();
            foreach (var s in sections.EnumerateArray().Take(MaxSections))
            {
                var title = Str(s, "title");
                if (title is null || !s.TryGetProperty("claims", out var claims) || claims.ValueKind != JsonValueKind.Array) continue;

                var list = new List<AnalysisClaim>();
                foreach (var c in claims.EnumerateArray().Take(MaxClaimsPerSection))
                {
                    var claimText = Str(c, "text");
                    if (claimText is null) continue;
                    var kind = Str(c, "kind")?.ToLowerInvariant() is { } k && (k is Registered or Estimate or Inference) ? k : Inference;
                    var source = Str(c, "source") ?? "";

                    var verified = true;
                    if (kind == Registered && (!allowedSources.Contains(source) || Numbers(claimText).Any(n => !knownNumbers.Contains(n) && !IsFree(n))))
                    {
                        kind = Inference;
                        verified = false;
                    }

                    list.Add(new AnalysisClaim(claimText, kind, source, verified));
                }

                if (list.Count > 0) result.Add(new AnalysisSection(title, list));
            }

            return result.Count > 0 ? result : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static string? Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            && v.GetString() is { Length: > 0 } s ? (s.Length > MaxTextLength ? s[..MaxTextLength] : s) : null;
}
