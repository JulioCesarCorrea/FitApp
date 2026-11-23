using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FitnessApp.Api.Domain.Ai;
using FitnessApp.Api.Domain.Nutrition;
using FitnessApp.Api.Domain.Profile;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Features.Nutrition;
using FitnessApp.Api.Features.Training.Sessions;
using FitnessApp.Api.Features.Profile;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FitnessApp.Api.Features.Ai;

public sealed record ChatMessageRequest(string Role, string Text);

public sealed record ChatRequest(string Text, List<ChatMessageRequest>? History = null, bool? UseMyData = null);

/// <summary>Contrato del chat (SPEC-ai-004): el texto de la pregunta, la conversación reciente y, si la persona lo pide, agregados (clase B).</summary>
public sealed record ChatContract(
    [property: AiField(DataClass.B)] string Question,
    [property: AiField(DataClass.B)] string[] History,
    [property: AiField(DataClass.B)] string? Aggregates,
    [property: AiField(DataClass.B)] string[] RestrictionLabels,
    [property: AiField(DataClass.B)] string[] AllergyTags,
    [property: AiField(DataClass.B)] string? PersonalContext = null) : IAiContract;

public abstract record ChatPrepared
{
    public sealed record Ready(Guid UserId, AiRequest Request, int Reserved, MedicalResult Medical) : ChatPrepared;
    public sealed record Emergency(string Category, string Text) : ChatPrepared;
    public sealed record Denied(AiDenial Reason, TimeSpan? RetryAfter) : ChatPrepared;
    public sealed record RateLimited(TimeSpan RetryAfter) : ChatPrepared;
    public sealed record Invalid(string Message) : ChatPrepared;
}

/// <summary>
/// Preguntas a la IA en streaming (SPEC-ai-004). Antes de llamar al proveedor decide un clasificador determinista si el tema es médico
/// (aviso fijo) o una emergencia (texto fijo y sin llamada). La API no guarda la conversación: la guarda la app en el teléfono.
/// </summary>
public sealed partial class ChatHandler(
    AppDbContext db, AiGateway gateway, IAiProvider provider, IOptions<AiOptions> options, NutritionHandler nutrition, TrainingHistoryHandler training,
    ContextHandler context, TimeProvider clock)
{
    public const string PromptVersion = "chat-v1";
    public const int MaxTextLength = 1000;
    public const int MaxHistory = 10;
    public static readonly TimeSpan StreamTimeout = TimeSpan.FromSeconds(60);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Una respuesta en curso por persona (AC-ai-004-13): el plan gratuito del hosting tiene pocos recursos.</summary>
    private static readonly ConcurrentDictionary<Guid, bool> InFlight = new();

    [GeneratedRegex(@"[\w.+-]+@[\w-]+\.[\w.-]+")]
    private static partial Regex EmailPattern();

    [GeneratedRegex(@"\+?\d[\d\s().-]{7,}\d")]
    private static partial Regex PhonePattern();

    public async Task<ChatPrepared> PrepareAsync(Guid userId, ChatRequest request, CancellationToken ct)
    {
        var text = (request.Text ?? "").Trim();
        if (text.Length is < 1 or > MaxTextLength) return new ChatPrepared.Invalid($"La pregunta lleva entre 1 y {MaxTextLength} caracteres.");
        if (EmailPattern().IsMatch(text) || PhonePattern().IsMatch(text))
            return new ChatPrepared.Invalid("No escribas correos ni teléfonos en las preguntas: la IA no necesita tus datos de contacto.");
        if ((request.History ?? []).Any(m => m.Role is not ("user" or "assistant") || (m.Text ?? "").Length > MaxTextLength * 2))
            return new ChatPrepared.Invalid("La conversación no es válida.");

        // AC-06: una emergencia no llega a la IA, no cuesta nada y no gasta cuota; la respuesta es un texto fijo.
        var medical = MedicalTopics.Classify(text);
        if (medical.IsEmergency) return new ChatPrepared.Emergency(MedicalTopics.Emergency, medical.Notice!);

        var opts = options.Value;
        var now = clock.GetUtcNow();
        var chats = db.AiAudits.AsNoTracking().Where(a => a.UserId == userId && a.Feature == AiFeatures.Chat);
        if (await chats.CountAsync(a => a.CreatedAt >= now.AddHours(-1), ct) >= opts.ChatPerHour) return new ChatPrepared.RateLimited(TimeSpan.FromMinutes(10));
        if (await chats.CountAsync(a => a.CreatedAt >= now.AddDays(-1), ct) >= opts.ChatPerDay) return new ChatPrepared.RateLimited(TimeSpan.FromHours(1));

        var history = (request.History ?? []).TakeLast(MaxHistory).ToList();
        var (restrictions, allergyTags, minor) = await ProfileLabelsAsync(userId, ct);
        var aggregates = request.UseMyData == true ? await AggregatesAsync(userId, ct) : null;
        var contract = new ChatContract(text, history.Select(m => $"{m.Role}: {m.Text}").ToArray(), aggregates, request.UseMyData == true ? restrictions : [], request.UseMyData == true ? allergyTags : [],
            request.UseMyData == true ? await context.SummaryAsync(userId, ct) : null);

        var system = SystemPrompt(contract, medical, minor || restrictions.Any(r => !r.Contains(":contexto")));
        var messages = history.Select(m => new AiMessage(m.Role, m.Text)).Append(new AiMessage("user", text)).ToList();
        var reserved = (system.Length + messages.Sum(m => m.Text.Length)) / 3 + opts.MaxOutputTokens;

        var admission = await gateway.AdmitAsync(userId, AiFeatures.Chat, reserved, ct);
        if (admission is AiAdmission.Denied denied) return new ChatPrepared.Denied(denied.Reason, denied.RetryAfter);
        var allowed = (AiAdmission.Allowed)admission;
        return new ChatPrepared.Ready(userId, new AiRequest(allowed.Model, system, messages, allowed.MaxOutputTokens), reserved, medical);
    }

    private async Task<(string[] Restrictions, string[] AllergyTags, bool Minor)> ProfileLabelsAsync(Guid userId, CancellationToken ct)
    {
        var rows = await db.Restrictions.AsNoTracking().Where(r => r.UserId == userId).ToListAsync(ct);
        var profile = await db.Profiles.AsNoTracking().Where(p => p.UserId == userId).Select(p => new { p.Allergies, p.BirthDate }).FirstOrDefaultAsync(ct);
        var tags = profile is null ? [] : Allergens.All.Where(t => Allergens.Conflicts(profile.Allergies, [t]).Length > 0).ToArray();
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var minor = profile is not null && ProfileRules.AgeOn(profile.BirthDate, today) < 18;
        var labels = rows.Select(r => $"{r.Zone}:{r.Level.ToString().ToLowerInvariant()}" + (r.AvoidedMovements.Length > 0 ? $":{string.Join('+', r.AvoidedMovements)}" : "")).ToArray();
        return (labels, tags, minor);
    }

    /// <summary>AC-04: agregados de las últimas semanas (clase B); lo concreto (series, comidas) no sale.</summary>
    private async Task<string> AggregatesAsync(Guid userId, CancellationToken ct)
    {
        var weeks = (await training.WeeklyAsync(userId, 4, ct)).Weeks;
        var food = await nutrition.WeeklyAsync(userId, 4, ct);
        return JsonSerializer.Serialize(new
        {
            entrenamiento_semanal = weeks.Select(w => new { semana = w.WeekStart.ToString("yyyy-MM-dd"), sesiones = w.Sessions, series = w.Sets, volumenKg = w.VolumeKg }),
            nutricion_objetivo = food.Targets is { } t ? new { kcal = t.Calories, proteinaG = t.ProteinG, grasaG = t.FatG, carbohidratosG = t.CarbsG } : null,
            nutricion_semanal = food.Weeks.Select(w => new { semana = w.WeekStart.ToString("yyyy-MM-dd"), diasRegistrados = w.DaysLogged, kcalMedias = w.AvgKcal }),
        }, Json);
    }

    private static string SystemPrompt(ChatContract contract, MedicalResult medical, bool careful)
    {
        var sb = new StringBuilder(
            "Eres un asistente de entrenamiento y nutrición. Responde en español, con frases cortas y claras. Distingue siempre lo que es un dato de la " +
            "persona, una estimación y una inferencia, y no inventes mediciones. No des diagnósticos, ni dosis, ni consejos médicos, y no cambies nada " +
            "de la rutina ni de los objetivos: si algo conviene cambiar, sugiere pedir una propuesta en «Análisis y planes».");
        if (medical.IsMedical) sb.Append(" El tema toca la salud: da solo información general y recomienda consultar a un profesional sanitario.");
        if (careful) sb.Append(" La persona es menor de edad o tiene restricciones: sé especialmente prudente, recomienda consultar a un profesional y no sugieras movimientos que choquen con sus restricciones.");
        if (contract.Aggregates is not null) sb.Append($"\nDatos de la persona (agregados): {contract.Aggregates}");
        if (contract.RestrictionLabels.Length > 0) sb.Append($"\nRestricciones: {string.Join("; ", contract.RestrictionLabels)}");
        if (contract.AllergyTags.Length > 0) sb.Append($"\nAlergias: {string.Join(", ", contract.AllergyTags)}");
        if (contract.PersonalContext is not null) sb.Append($"\nContexto que la persona ha querido compartir (suplementos, hábitos y notas): {contract.PersonalContext}");
        return sb.ToString();
    }

    /// <summary>La primera respuesta en curso de la persona; null si ya tiene otra (AC-ai-004-13).</summary>
    public static bool TryBegin(Guid userId) => InFlight.TryAdd(userId, true);

    public static void End(Guid userId) => InFlight.TryRemove(userId, out _);

    private static async Task WriteAsync(Stream body, object payload, CancellationToken ct)
    {
        await body.WriteAsync(Encoding.UTF8.GetBytes($"data: {JsonSerializer.Serialize(payload, Json)}\n\n"), ct);
        await body.FlushAsync(ct);
    }

    /// <summary>
    /// AC-01, 05, 11, 12, 14: escribe la respuesta como eventos (<c>meta</c>, <c>delta</c>, <c>done</c> o <c>error</c>) y, pase lo que pase,
    /// audita lo consumido. Pasados 60 s o si la persona se desconecta, se corta.
    /// </summary>
    public async Task StreamAsync(ChatPrepared.Ready ready, Stream body, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(StreamTimeout);
        var text = new StringBuilder();
        int prompt = 0, completion = 0;
        var status = "ok";
        string? error = null;

        try
        {
            await WriteAsync(body, new { type = "meta", medical = ready.Medical.IsMedical, category = ready.Medical.Category, notice = ready.Medical.Notice }, ct);
            await foreach (var chunk in provider.StreamAsync(ready.Request, cts.Token))
            {
                if (chunk.TextDelta is { } delta)
                {
                    text.Append(delta);
                    await WriteAsync(body, new { type = "delta", text = delta }, ct);
                }

                if (chunk.PromptTokens is { } p) (prompt, completion) = (p, chunk.CompletionTokens ?? 0);
            }

            await WriteAsync(body, new { type = "done", usage = new { promptTokens = prompt, completionTokens = completion } }, ct);
        }
        catch (OperationCanceledException)
        {
            status = "error";
            error = ct.IsCancellationRequested ? "La persona cortó la respuesta." : "La respuesta tardó más de 60 s y se cortó.";
            if (!ct.IsCancellationRequested) await TryWriteErrorAsync(body, "timeout", "La respuesta tardó demasiado y se cortó.");
        }
        catch (AiProviderException ex)
        {
            status = ex.Kind == AiFailureKind.Quota ? "quota" : "error";
            error = ex.Message;
            await TryWriteErrorAsync(body, ex.Kind == AiFailureKind.Quota ? "provider_quota" : "provider_error",
                ex.Kind == AiFailureKind.Quota ? "El servicio de IA no admite más peticiones ahora mismo." : "El servicio de IA no respondió bien.");
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException or JsonException or InvalidOperationException)
        {
            status = "error";
            error = ex.Message;
            await TryWriteErrorAsync(body, "provider_error", "El servicio de IA no respondió bien.");
        }
        finally
        {
            // Sin cifras del proveedor (corte a mitad) se estiman con la longitud, para que el tope no se pueda esquivar cortando.
            if (prompt == 0 && completion == 0)
            {
                prompt = (ready.Request.System.Length + ready.Request.Messages.Sum(m => m.Text.Length)) / 3;
                completion = text.Length / 3;
            }

            await gateway.AuditAsync(
                ready.UserId, AiFeatures.Chat, ready.Request, text.Length == 0 ? null : text.ToString(), prompt, completion, status, error,
                $"{PromptVersion}|{MedicalTopics.Version}|{ready.Medical.Category ?? "-"}", CancellationToken.None);
        }
    }

    private static async Task TryWriteErrorAsync(Stream body, string code, string message)
    {
        try { await WriteAsync(body, new { type = "error", code, message }, CancellationToken.None); }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or OperationCanceledException) { /* la persona ya se fue */ }
    }
}
