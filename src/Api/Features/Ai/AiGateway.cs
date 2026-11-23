using FitnessApp.Api.Domain.Ai;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FitnessApp.Api.Features.Ai;

public enum AiDenial
{
    /// <summary>Sin clave, sin modelo para la función o tope global de coste: AC-ai-001-06, 12 y 15 (503 ai_disabled).</summary>
    Disabled,

    /// <summary>La persona no ha dado su consentimiento: AC-ai-001-01 (403 consent_required).</summary>
    ConsentRequired,

    /// <summary>Tope de la persona superado: AC-ai-001-05 (429 budget_exceeded).</summary>
    UserBudget,

    /// <summary>Cuota del proveedor por modelo, diaria o por minuto: AC-ai-001-14 (429 provider_quota).</summary>
    ProviderQuota,
}

public abstract record AiAdmission
{
    public sealed record Allowed(string Model, int MaxOutputTokens) : AiAdmission;
    public sealed record Denied(AiDenial Reason, TimeSpan? RetryAfter = null) : AiAdmission;
}

public abstract record AiOutcome
{
    public sealed record Ok(AiCompletion Completion) : AiOutcome;
    public sealed record Denied(AiDenial Reason, TimeSpan? RetryAfter) : AiOutcome;

    /// <summary>El proveedor falló o devolvió algo inválido: AC-ai-001-07 (502).</summary>
    public sealed record Failed(string Message) : AiOutcome;
}

/// <summary>
/// Única puerta de la IA (SPEC-ai-001, P1, P4, P5, P6): comprueba consentimiento, topes y cuotas antes de llamar al proveedor, audita
/// cada llamada y traduce sus errores. Nada de esto se ejecuta si la IA está desactivada; el resto de la API no depende de ella.
/// </summary>
public sealed class AiGateway(AppDbContext db, IAiProvider provider, IOptions<AiOptions> options, TimeProvider clock)
{
    private AiOptions Options => options.Value;

    private DateTimeOffset Now => clock.GetUtcNow();

    /// <summary>Funciones que se pueden usar ahora (hay clave y modelo): lo que la app muestra como disponible (AC-ai-001-15).</summary>
    public bool IsAvailable(string feature) => Options.Enabled && Options.ModelFor(feature) is not null;

    /// <summary>
    /// Decide si una llamada de <paramref name="feature"/> puede hacerse. <paramref name="reservedTokens"/> es el peor caso de la
    /// llamada (entrada estimada más salida máxima): se comprueba antes de empezar, también en streaming.
    /// </summary>
    public async Task<AiAdmission> AdmitAsync(Guid userId, string feature, int reservedTokens, CancellationToken ct)
    {
        if (!IsAvailable(feature)) return new AiAdmission.Denied(AiDenial.Disabled);
        var model = Options.ModelFor(feature)!;

        await PurgeAsync(ct);

        if (!await db.AiConsents.AnyAsync(c => c.UserId == userId && c.Feature == feature, ct))
            return new AiAdmission.Denied(AiDenial.ConsentRequired);

        var monthStart = new DateTimeOffset(Now.Year, Now.Month, 1, 0, 0, 0, TimeSpan.Zero);
        var monthRows = db.AiAudits.AsNoTracking().Where(a => a.CreatedAt >= monthStart);
        if (await monthRows.SumAsync(a => (decimal?)a.CostUsd, ct) is { } global && global >= Options.GlobalMonthlyUsd)
            return new AiAdmission.Denied(AiDenial.Disabled);
        if (await monthRows.Where(a => a.UserId == userId).SumAsync(a => (decimal?)a.CostUsd, ct) is { } own && own >= Options.UserMonthlyUsd)
            return new AiAdmission.Denied(AiDenial.UserBudget);

        var dayStart = new DateTimeOffset(Now.Year, Now.Month, Now.Day, 0, 0, 0, TimeSpan.Zero);
        var todayUser = await TokensAsync(db.AiAudits.Where(a => a.UserId == userId && a.CreatedAt >= dayStart), ct);
        if (todayUser + reservedTokens > Options.UserDailyTokens) return new AiAdmission.Denied(AiDenial.UserBudget, dayStart.AddDays(1) - Now);

        var todayModel = await TokensAsync(db.AiAudits.Where(a => a.Model == model && a.CreatedAt >= dayStart), ct);
        if (todayModel + reservedTokens > Options.ModelDailyTokens) return new AiAdmission.Denied(AiDenial.ProviderQuota, dayStart.AddDays(1) - Now);

        var lastMinute = Now.AddMinutes(-1);
        var minuteModel = await TokensAsync(db.AiAudits.Where(a => a.Model == model && a.CreatedAt >= lastMinute), ct);
        if (minuteModel + reservedTokens > Options.ModelMinuteTokens) return new AiAdmission.Denied(AiDenial.ProviderQuota, TimeSpan.FromSeconds(60));

        return new AiAdmission.Allowed(model, Options.MaxOutputTokens);
    }

    private static async Task<long> TokensAsync(IQueryable<AiAudit> rows, CancellationToken ct) =>
        await rows.SumAsync(a => (long?)(a.PromptTokens + a.CompletionTokens), ct) ?? 0;

    /// <summary>
    /// Llamada completa sin streaming: admisión, proveedor y auditoría. <paramref name="build"/> arma la petición con el modelo admitido
    /// (los contratos tipados de cada función viven en su ficha).
    /// </summary>
    public async Task<AiOutcome> CompleteAsync(
        Guid userId, string feature, int reservedTokens, Func<string, int, AiRequest> build, string? promptVersion, CancellationToken ct)
    {
        var admission = await AdmitAsync(userId, feature, reservedTokens, ct);
        if (admission is AiAdmission.Denied denied) return new AiOutcome.Denied(denied.Reason, denied.RetryAfter);
        var allowed = (AiAdmission.Allowed)admission;

        var request = build(allowed.Model, allowed.MaxOutputTokens);
        try
        {
            var completion = await provider.CompleteAsync(request, ct);
            await AuditAsync(userId, feature, request, completion.Text, completion.PromptTokens, completion.CompletionTokens, "ok", null, promptVersion, ct);
            return new AiOutcome.Ok(completion);
        }
        catch (AiProviderException ex) when (ex.Kind == AiFailureKind.Quota)
        {
            // AC-ai-001-14: si el proveedor responde 429 se traslada a la persona sin reintentar (un reintento gastaría cuota).
            await AuditAsync(userId, feature, request, null, 0, 0, "quota", ex.Message, promptVersion, ct);
            return new AiOutcome.Denied(AiDenial.ProviderQuota, ex.RetryAfter ?? TimeSpan.FromSeconds(60));
        }
        catch (Exception ex) when (ex is AiProviderException or HttpRequestException or TaskCanceledException or InvalidOperationException or System.Text.Json.JsonException)
        {
            await AuditAsync(userId, feature, request, null, 0, 0, "error", ex.Message, promptVersion, ct);
            return new AiOutcome.Failed("El servicio de IA no respondió bien. Inténtalo más tarde.");
        }
    }

    /// <summary>AC-ai-001-04 y 09: una fila de auditoría por llamada, con éxito o con error (también la usa el streaming).</summary>
    public async Task AuditAsync(
        Guid userId, string feature, AiRequest request, string? response, int promptTokens, int completionTokens, string status,
        string? error, string? promptVersion, CancellationToken ct)
    {
        db.AiAudits.Add(new AiAudit
        {
            Id = Guid.NewGuid(), UserId = userId, Feature = feature, Model = request.Model,
            SentText = request.System + "\n" + string.Join("\n", request.Messages.Select(m => $"{m.Role}: {m.Text}")),
            ResponseText = response, PromptTokens = promptTokens, CompletionTokens = completionTokens,
            CostUsd = Options.CostOf(request.Model, promptTokens, completionTokens), Status = status, Error = error,
            PromptVersion = promptVersion, CreatedAt = Now,
        });
        await db.SaveChangesAsync(ct);
    }

    /// <summary>El texto de la auditoría se borra pasado su plazo y las filas enteras pasado el de los metadatos (espacio limitado).</summary>
    public async Task PurgeAsync(CancellationToken ct)
    {
        var textLimit = Now.AddDays(-Options.AuditTextRetentionDays);
        await db.AiAudits.Where(a => a.CreatedAt < textLimit && (a.SentText != null || a.ResponseText != null))
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.SentText, (string?)null).SetProperty(a => a.ResponseText, (string?)null), ct);
        var rowLimit = Now.AddDays(-Options.AuditMetadataRetentionDays);
        await db.AiAudits.Where(a => a.CreatedAt < rowLimit).ExecuteDeleteAsync(ct);
    }
}
