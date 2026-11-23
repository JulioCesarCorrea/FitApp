using FitnessApp.Api.Common;
using FitnessApp.Api.Domain.Ai;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FitnessApp.Api.Features.Ai;

public sealed record AiFeatureDto(string Feature, bool Consented, bool Available);

public sealed record AiConsentsDto(List<AiFeatureDto> Features);

public sealed record AiUsageCallDto(string Feature, string Model, int Tokens, decimal CostUsd, string Status, DateTimeOffset CreatedAt);

/// <param name="MonthCostUsd">Gasto estimado de la persona este mes (0 en el plan gratuito).</param>
public sealed record AiUsageDto(
    decimal MonthCostUsd, decimal MonthlyCapUsd, long TokensToday, int DailyTokenCap, List<AiUsageCallDto> Recent);

/// <summary>Casos de uso de SPEC-ai-001: consentimientos y uso. Todo filtra por la persona que llama (P7).</summary>
public sealed class AiAccountHandler(AppDbContext db, AiGateway gateway, IOptions<AiOptions> options, TimeProvider clock)
{
    public async Task<AiConsentsDto> ConsentsAsync(Guid userId, CancellationToken ct)
    {
        var given = (await db.AiConsents.AsNoTracking().Where(c => c.UserId == userId).Select(c => c.Feature).ToListAsync(ct)).ToHashSet();
        return new AiConsentsDto(AiFeatures.All.Select(f => new AiFeatureDto(f, given.Contains(f), gateway.IsAvailable(f))).ToList());
    }

    /// <summary>AC-02: idempotente.</summary>
    public async Task GrantAsync(Guid userId, string feature, CancellationToken ct)
    {
        if (await db.AiConsents.AnyAsync(c => c.UserId == userId && c.Feature == feature, ct)) return;
        db.AiConsents.Add(new AiConsent { UserId = userId, Feature = feature, GrantedAt = clock.GetUtcNow() });
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear(); // carrera: otra petición lo concedió a la vez
        }
    }

    public Task RevokeAsync(Guid userId, string feature, CancellationToken ct) =>
        db.AiConsents.Where(c => c.UserId == userId && c.Feature == feature).ExecuteDeleteAsync(ct);

    /// <summary>AC-09: gasto y tokens de hoy de la persona y sus llamadas recientes, sin ver las de otra.</summary>
    public async Task<AiUsageDto> UsageAsync(Guid userId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var monthStart = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero);
        var dayStart = new DateTimeOffset(now.Year, now.Month, now.Day, 0, 0, 0, TimeSpan.Zero);
        var own = db.AiAudits.AsNoTracking().Where(a => a.UserId == userId);

        var cost = await own.Where(a => a.CreatedAt >= monthStart).SumAsync(a => (decimal?)a.CostUsd, ct) ?? 0m;
        var tokens = await own.Where(a => a.CreatedAt >= dayStart).SumAsync(a => (long?)(a.PromptTokens + a.CompletionTokens), ct) ?? 0;
        var recent = await own.OrderByDescending(a => a.CreatedAt).Take(20)
            .Select(a => new AiUsageCallDto(a.Feature, a.Model, a.PromptTokens + a.CompletionTokens, a.CostUsd, a.Status, a.CreatedAt)).ToListAsync(ct);
        return new AiUsageDto(cost, options.Value.UserMonthlyUsd, tokens, options.Value.UserDailyTokens, recent);
    }
}

public static class AiEndpoints
{
    public static void MapAiEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/ai/consents", async (ICurrentUser user, AiAccountHandler handler, CancellationToken ct) =>
            user.Id is not { } userId ? Results.Unauthorized() : Results.Ok(await handler.ConsentsAsync(userId, ct)));

        app.MapPut("/ai/consents/{feature}", async (string feature, ICurrentUser user, AiAccountHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();
            if (!AiFeatures.IsValid(feature)) return Results.NotFound();

            await handler.GrantAsync(userId, feature, ct);
            return Results.Ok(new AiFeatureDto(feature, true, true));
        });

        app.MapDelete("/ai/consents/{feature}", async (string feature, ICurrentUser user, AiAccountHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();
            if (!AiFeatures.IsValid(feature)) return Results.NotFound();

            await handler.RevokeAsync(userId, feature, ct);
            return Results.NoContent();
        });

        app.MapPost("/ai/analysis", async (AnalysisRequest request, ICurrentUser user, AiAssistantHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();

            return await handler.AnalyzeAsync(userId, request.Scope, ct) switch
            {
                AssistantResult<AnalysisDto>.Done done => Results.Ok(done.Value),
                AssistantResult<AnalysisDto>.Denied d => AiResults.Denied(d.Reason, d.RetryAfter),
                AssistantResult<AnalysisDto>.Failed f => AiResults.Failed(f.Message),
                AssistantResult<AnalysisDto>.BadRequest b => Results.ValidationProblem(new Dictionary<string, string[]> { ["scope"] = [b.Message] }),
                _ => Results.StatusCode(500),
            };
        });

        app.MapPost("/ai/plan", async (PlanRequest request, ICurrentUser user, AiAssistantHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();

            return await handler.PlanAsync(userId, request.Scope, ct) switch
            {
                AssistantResult<ProposalDto>.Done done => Results.Created($"/ai/proposals/{done.Value.Id}", done.Value),
                AssistantResult<ProposalDto>.Denied d => AiResults.Denied(d.Reason, d.RetryAfter),
                AssistantResult<ProposalDto>.Failed f => AiResults.Failed(f.Message),
                AssistantResult<ProposalDto>.BadRequest b => Results.ValidationProblem(new Dictionary<string, string[]> { ["scope"] = [b.Message] }),
                _ => Results.StatusCode(500),
            };
        });

        app.MapGet("/ai/proposals", async (ICurrentUser user, AiAssistantHandler handler, CancellationToken ct) =>
            user.Id is not { } userId ? Results.Unauthorized() : Results.Ok(await handler.ListAsync(userId, ct)));

        app.MapPost("/ai/proposals/{id:guid}/accept", async (Guid id, ICurrentUser user, AiAssistantHandler handler, CancellationToken ct) =>
            user.Id is not { } userId ? Results.Unauthorized() : await handler.AcceptAsync(userId, id, ct) is { } r ? Results.Ok(r) : Results.NotFound());

        app.MapPost("/ai/proposals/{id:guid}/reject", async (Guid id, ICurrentUser user, AiAssistantHandler handler, CancellationToken ct) =>
            user.Id is not { } userId ? Results.Unauthorized() : await handler.RejectAsync(userId, id, ct) is { } r ? Results.Ok(r) : Results.NotFound());

        app.MapGet("/ai/usage", async (ICurrentUser user, AiAccountHandler handler, CancellationToken ct) =>
            user.Id is not { } userId ? Results.Unauthorized() : Results.Ok(await handler.UsageAsync(userId, ct)));
    }
}

/// <summary>Traducción de lo que decide la pasarela a respuestas HTTP (AC-ai-001-01, 05, 06, 07, 12, 14, 15).</summary>
public static class AiResults
{
    public static IResult Denied(AiDenial reason, TimeSpan? retryAfter) => reason switch
    {
        AiDenial.ConsentRequired => Problem(StatusCodes.Status403Forbidden, "consent_required", "Activa esta función en «Inteligencia artificial» para usarla."),
        AiDenial.UserBudget => Problem(StatusCodes.Status429TooManyRequests, "budget_exceeded", "Has llegado a tu límite de uso de la IA. Vuelve a intentarlo más tarde.", retryAfter),
        AiDenial.ProviderQuota => Problem(StatusCodes.Status429TooManyRequests, "provider_quota", "El servicio de IA no admite más peticiones ahora mismo.", retryAfter ?? TimeSpan.FromSeconds(60)),
        _ => Problem(StatusCodes.Status503ServiceUnavailable, "ai_disabled", "La IA no está disponible ahora mismo."),
    };

    public static IResult Failed(string message) => Problem(StatusCodes.Status502BadGateway, "provider_error", message);

    private static IResult Problem(int status, string code, string title, TimeSpan? retryAfter = null) => Results.Problem(
        statusCode: status, title: title,
        extensions: new Dictionary<string, object?> { ["code"] = code, ["retryAfterSeconds"] = retryAfter is { } r ? (int)Math.Ceiling(r.TotalSeconds) : null });
}
