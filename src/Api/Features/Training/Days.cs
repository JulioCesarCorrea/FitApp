using System.Globalization;
using System.Text;

namespace FitnessApp.Api.Features.Training;

/// <summary>Nombres de los días en español (sin acentos) para las rutas y las respuestas.</summary>
public static class Days
{
    private static readonly (string Name, DayOfWeek Day)[] All =
    [
        ("lunes", DayOfWeek.Monday),
        ("martes", DayOfWeek.Tuesday),
        ("miercoles", DayOfWeek.Wednesday),
        ("jueves", DayOfWeek.Thursday),
        ("viernes", DayOfWeek.Friday),
        ("sabado", DayOfWeek.Saturday),
        ("domingo", DayOfWeek.Sunday),
    ];

    public static string NameOf(DayOfWeek day) => All.Single(d => d.Day == day).Name;

    /// <summary>Orden de lunes a domingo.</summary>
    public static int OrderOf(DayOfWeek day) => Array.FindIndex(All, d => d.Day == day);

    /// <summary>Acepta mayúsculas y acentos (miércoles, sábado).</summary>
    public static bool TryParse(string? text, out DayOfWeek day)
    {
        day = default;
        if (string.IsNullOrWhiteSpace(text)) return false;

        var normalized = new string(text.Trim().Normalize(NormalizationForm.FormD)
            .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
            .ToArray()).ToLowerInvariant();

        foreach (var (name, d) in All)
        {
            if (name != normalized) continue;
            day = d;
            return true;
        }

        return false;
    }
}
