namespace FitnessApp.Api.Features.Ai;

public sealed class ModelPrice
{
    /// <summary>Dólares por millón de tokens de entrada y de salida. 0 en el plan gratuito.</summary>
    public decimal InputPerMillionUsd { get; set; }
    public decimal OutputPerMillionUsd { get; set; }
}

/// <summary>
/// Configuración de la IA (SPEC-ai-001, ADR-0008). Sin <see cref="ApiKey"/> la IA queda desactivada y el resto de la API sigue igual (P1).
/// Los límites del plan gratuito son una referencia (2026-11-23, por confirmar en la consola del proveedor) y se pueden cambiar.
/// </summary>
public sealed class AiOptions
{
    public string? ApiKey { get; set; }
    public string BaseUrl { get; set; } = "https://api.groq.com/openai/v1";

    /// <summary>Modelo por función. Es configuración, no código: si el proveedor retira uno, se cambia aquí.</summary>
    public Dictionary<string, string> Models { get; set; } = new()
    {
        ["chat"] = "openai/gpt-oss-120b",
        ["analysis"] = "openai/gpt-oss-120b",
        ["food_photo"] = "qwen/qwen3.8-27b",
    };

    public Dictionary<string, ModelPrice> Prices { get; set; } = new();

    /// <summary>Tokens por persona al día (suma de entrada y salida).</summary>
    public int UserDailyTokens { get; set; } = 80_000;

    /// <summary>Tokens por modelo al día para toda la cuenta (plan gratuito de referencia: 200.000).</summary>
    public int ModelDailyTokens { get; set; } = 180_000;

    /// <summary>Tokens por modelo en el último minuto para toda la cuenta (plan gratuito de referencia: 8.000).</summary>
    public int ModelMinuteTokens { get; set; } = 7_000;

    public decimal GlobalMonthlyUsd { get; set; } = 30m;
    public decimal UserMonthlyUsd { get; set; } = 5m;
    public int MaxOutputTokens { get; set; } = 600;

    /// <summary>Preguntas al chat por persona (SPEC-ai-004, AC-13).</summary>
    public int ChatPerHour { get; set; } = 20;
    public int ChatPerDay { get; set; } = 30;
    public int AuditTextRetentionDays { get; set; } = 30;
    public int AuditMetadataRetentionDays { get; set; } = 365;

    public bool Enabled => !string.IsNullOrWhiteSpace(ApiKey);

    public string? ModelFor(string feature) => Models.TryGetValue(feature, out var m) && !string.IsNullOrWhiteSpace(m) ? m : null;

    /// <summary>Coste estimado de una llamada con los precios configurados (P4: calculado con código).</summary>
    public decimal CostOf(string model, int promptTokens, int completionTokens) =>
        Prices.TryGetValue(model, out var p)
            ? (promptTokens * p.InputPerMillionUsd + completionTokens * p.OutputPerMillionUsd) / 1_000_000m
            : 0m;
}
