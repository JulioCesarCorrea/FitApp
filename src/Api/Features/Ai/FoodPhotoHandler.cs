using System.Text.Json;
using FitnessApp.Api.Domain.Ai;
using FitnessApp.Api.Domain.Nutrition;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FitnessApp.Api.Features.Ai;

/// <summary>La foto va en base64 dentro del JSON (no multipart: la app la saca de la cámara ya en base64).</summary>
public sealed record FoodPhotoRequest(string ImageBase64);

/// <summary>Contrato de la foto de comida (SPEC-ai-003): solo la imagen, sin metadatos ni identificadores. Clase C: exige el consentimiento propio de esta función.</summary>
public sealed record FoodPhotoContract([property: AiField(DataClass.C)] string ImageMime, [property: AiField(DataClass.C)] int ImageBytes) : IAiContract;

/// <param name="Confidence">alta | media | baja, según la IA. Todo es una estimación (P4), nunca una medición.</param>
/// <param name="PossibleAllergens">Alérgenos que el nombre sugiere y que coinciden con tus alergias: orientativo, no una garantía.</param>
public sealed record FoodPhotoItemDto(
    string Name, int Grams, string Confidence, bool Estimate, decimal KcalPer100g, decimal ProteinPer100g, decimal FatPer100g, decimal CarbsPer100g,
    int Kcal, decimal ProteinG, decimal FatG, decimal CarbsG, string[] PossibleAllergens);

public sealed record FoodPhotoDto(string Kind, List<FoodPhotoItemDto> Items, string Disclaimer);

/// <summary>
/// Foto de comida con IA (SPEC-ai-003). La imagen se valida y se limpia de metadatos, se envía a la IA y se descarta: no se guarda en disco
/// ni en la base (la auditoría guarda el resultado y el tamaño, no la imagen). Lo que devuelve es una estimación que la persona corrige.
/// </summary>
public sealed class FoodPhotoHandler(AppDbContext db, AiGateway gateway, IOptions<AiOptions> options, TimeProvider clock)
{
    public const string PromptVersion = "food-photo-v1";
    public const int MaxPerDay = 10;
    private const int MaxItems = 8;
    private static readonly string[] Confidences = ["alta", "media", "baja"];

    private const string System =
        "Eres un asistente de nutrición. Mira la foto de una comida y estima los alimentos que se ven. Responde únicamente con JSON: " +
        "{\"items\":[{\"name\":\"...\",\"grams\":150,\"kcalPer100g\":130,\"proteinPer100g\":2.7,\"fatPer100g\":0.3,\"carbsPer100g\":28,\"confidence\":\"alta|media|baja\"}]}. " +
        "Nombra solo alimentos que se vean, con valores típicos por 100 g y los gramos que estimes por el tamaño de la ración. Máximo 8 elementos. " +
        "Si no hay comida en la foto, devuelve {\"items\":[]}. No des consejos médicos. Escribe los nombres en español.";

    public async Task<AssistantResult<FoodPhotoDto>> AnalyzeAsync(Guid userId, string? imageBase64, CancellationToken ct)
    {
        byte[]? bytes = null;
        try { bytes = string.IsNullOrWhiteSpace(imageBase64) ? null : Convert.FromBase64String(imageBase64); }
        catch (FormatException) { /* se trata como imagen inválida */ }
        var image = ImageSanitizer.Sanitize(bytes);
        if (image is null) return new AssistantResult<FoodPhotoDto>.BadRequest("La imagen no es válida: debe ser una foto JPEG o PNG de hasta 5 MB.");

        var dayStart = new DateTimeOffset(clock.GetUtcNow().Year, clock.GetUtcNow().Month, clock.GetUtcNow().Day, 0, 0, 0, TimeSpan.Zero);
        if (await db.AiAudits.AsNoTracking().CountAsync(a => a.UserId == userId && a.Feature == AiFeatures.FoodPhoto && a.CreatedAt >= dayStart, ct) >= options.Value.FoodPhotosPerDay)
            return new AssistantResult<FoodPhotoDto>.RateLimited(TimeSpan.FromHours(1));

        var contract = new FoodPhotoContract(image.MimeType, image.Bytes.Length);
        var outcome = await gateway.CompleteAsync(
            userId, AiFeatures.FoodPhoto, 3000,
            (model, max) => new AiRequest(model, System,
                [new AiMessage("user", $"Foto de una comida ({contract.ImageBytes} bytes). Estima los alimentos.", image.ToDataUrl())], max),
            PromptVersion, ct);

        switch (outcome)
        {
            case AiOutcome.Denied d: return new AssistantResult<FoodPhotoDto>.Denied(d.Reason, d.RetryAfter);
            case AiOutcome.Failed f: return new AssistantResult<FoodPhotoDto>.Failed(f.Message);
            case AiOutcome.Ok ok:
                if (ParseItems(ok.Completion.Text) is not { } parsed) return new AssistantResult<FoodPhotoDto>.Failed("La IA devolvió una respuesta que no se pudo usar. Inténtalo de nuevo.");
                var allergies = await db.Profiles.AsNoTracking().Where(p => p.UserId == userId).Select(p => p.Allergies).FirstOrDefaultAsync(ct) ?? [];
                var items = parsed.Select(p => p with { PossibleAllergens = Allergens.Conflicts(allergies, Allergens.MentionedIn(p.Name)) }).ToList();
                return new AssistantResult<FoodPhotoDto>.Done(new FoodPhotoDto("proposal", items, AiAssistantHandler.Disclaimer));
            default: return new AssistantResult<FoodPhotoDto>.Failed("Respuesta inesperada.");
        }
    }

    /// <summary>
    /// AC-ai-003-01 y 05: interpreta la respuesta y calcula las calorías y macros de cada ración con las reglas deterministas (P4). Se descarta
    /// lo que no cumple los rangos del alimento (los mismos que al crearlo a mano). Null si la respuesta no tiene la forma pedida.
    /// </summary>
    public static List<FoodPhotoItemDto>? ParseItems(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(AiOutputRules.StripFence(text));
            if (!doc.RootElement.TryGetProperty("items", out var list) || list.ValueKind != JsonValueKind.Array) return null;

            var result = new List<FoodPhotoItemDto>();
            foreach (var e in list.EnumerateArray().Take(MaxItems))
            {
                var name = AiOutputRules.Str(e, "name");
                if (name is null || name.Length > 80) continue;
                if (!e.TryGetProperty("grams", out var g) || !g.TryGetInt32(out var grams) || grams is < 1 or > 5000) continue;
                var kcal = Round1(e, "kcalPer100g", 900m);
                var protein = Round1(e, "proteinPer100g", 100m);
                var fat = Round1(e, "fatPer100g", 100m);
                var carbs = Round1(e, "carbsPer100g", 100m);
                if (kcal is null || protein is null || fat is null || carbs is null || protein + fat + carbs > 100m) continue;

                var confidence = AiOutputRules.Str(e, "confidence")?.ToLowerInvariant();
                var portion = NutritionRules.PortionOf(kcal.Value, protein.Value, fat.Value, carbs.Value, grams);
                result.Add(new FoodPhotoItemDto(
                    name, grams, confidence is not null && Confidences.Contains(confidence) ? confidence : "baja", true, kcal.Value, protein.Value, fat.Value, carbs.Value,
                    portion.Kcal, portion.ProteinG, portion.FatG, portion.CarbsG, []));
            }

            return result;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static decimal? Round1(JsonElement e, string name, decimal max) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var d) && d >= 0 && d <= max
            ? Math.Round(d, 1, MidpointRounding.AwayFromZero) : null;
}
