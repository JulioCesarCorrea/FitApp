using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FitnessApp.Api.Domain.Ai;
using FitnessApp.Api.Features.Ai;
using FitnessApp.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace FitnessApp.Api.Tests.Ai;

/// <summary>Contrato tipado de prueba: campos solo de clase B.</summary>
public sealed record ProbeContract([property: AiField(DataClass.B)] string Question) : IAiContract;

/// <summary>Contratos mal hechos que el guardián debe rechazar (nunca se usan en producción).</summary>
public sealed record BadContractWithName([property: AiField(DataClass.A)] string DisplayName) : IAiContract;
public sealed record BadContractUnmarked(string Whatever) : IAiContract;

/// <summary>Verifica SPEC-ai-001 contra la API y Postgres reales con un proveedor falso. Cada test cita su criterio de aceptación.</summary>
[Collection("api")]
public sealed class AiBaseTests : IDisposable
{
    private const string Chat = AiFeatures.Chat;

    private readonly ApiFixture api;

    public AiBaseTests(ApiFixture api)
    {
        this.api = api;
        api.Ai.Reset();
    }

    public void Dispose() => api.Ai.Reset();

    /// <summary>Un modelo propio por prueba: la cuota por modelo se suma de toda la base compartida.</summary>
    private static string UniqueModel() => $"modelo-de-prueba-{Guid.NewGuid():N}";

    private static AiRequest Request(string model, int maxTokens, string question = "¿Qué como antes de entrenar?") =>
        new(model, "Eres un asistente de entrenamiento y nutrición.", [new AiMessage("user", question)], maxTokens);

    private static async Task<AiOutcome> Ask(WebApplicationFactory<Program> factory, Guid user, string feature = Chat, int reserved = 1000, string question = "Hola")
    {
        using var scope = factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AiGateway>()
            .CompleteAsync(user, feature, reserved, (model, max) => Request(model, max, question), "chat-v1", CancellationToken.None);
    }

    private static async Task Consent(WebApplicationFactory<Program> factory, Guid user, string feature = Chat)
    {
        using var scope = factory.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AiAccountHandler>().GrantAsync(user, feature, CancellationToken.None);
    }

    private static FakeAiProvider ProviderOf(WebApplicationFactory<Program> factory) => factory.Services.GetRequiredService<FakeAiProvider>();

    private static async Task<List<AiAudit>> Audits(WebApplicationFactory<Program> factory, Guid user)
    {
        using var scope = factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().AiAudits.AsNoTracking().Where(a => a.UserId == user)
            .OrderBy(a => a.CreatedAt).ToListAsync();
    }

    // AC-ai-001-01
    [Fact]
    public async Task AC_ai_001_01_sin_consentimiento_responde_consent_required_y_no_llama_al_proveedor()
    {
        var user = Guid.NewGuid();
        var before = api.Ai.Calls.Count;

        var outcome = await Ask(api, user);

        Assert.Equal(new AiOutcome.Denied(AiDenial.ConsentRequired, null), outcome);
        Assert.Equal(before, api.Ai.Calls.Count);
        Assert.Empty(await Audits(api, user));
    }

    // AC-ai-001-02
    [Fact]
    public async Task AC_ai_001_02_el_consentimiento_se_activa_y_se_retira_de_forma_idempotente_y_el_listado_lo_refleja()
    {
        var client = api.ClientFor(Guid.NewGuid());

        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync($"/ai/consents/{Chat}", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync($"/ai/consents/{Chat}", null)).StatusCode);
        var granted = (await client.GetFromJsonAsync<AiConsentsDto>("/ai/consents"))!;
        Assert.Equal([AiFeatures.Analysis, Chat, AiFeatures.FoodPhoto], granted.Features.OrderBy(f => f.Feature).Select(f => f.Feature));
        Assert.Equal(Chat, Assert.Single(granted.Features.Where(f => f.Consented)).Feature);
        Assert.All(granted.Features, f => Assert.True(f.Available));

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/ai/consents/{Chat}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/ai/consents/{Chat}")).StatusCode);
        Assert.DoesNotContain((await client.GetFromJsonAsync<AiConsentsDto>("/ai/consents"))!.Features, f => f.Consented);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsync("/ai/consents/inventada", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.CreateClient().GetAsync("/ai/consents")).StatusCode);
    }

    // AC-ai-001-03
    [Fact]
    public void AC_ai_001_03_ningun_contrato_tiene_campos_sin_clase_o_de_clase_A_y_el_guardian_detecta_los_malos()
    {
        var contracts = typeof(AiGateway).Assembly.GetTypes().Where(t => t.IsClass && typeof(IAiContract).IsAssignableFrom(t) && !t.IsAbstract).ToList();

        Assert.All(contracts, t => Assert.Empty(AiContractGuard.Violations(t)));
        Assert.Equal([$"{nameof(BadContractWithName)}.DisplayName"], AiContractGuard.Violations(typeof(BadContractWithName)));
        Assert.Equal([$"{nameof(BadContractUnmarked)}.Whatever"], AiContractGuard.Violations(typeof(BadContractUnmarked)));
        Assert.Empty(AiContractGuard.Violations(typeof(ProbeContract)));
    }

    // AC-ai-001-04
    [Fact]
    public async Task AC_ai_001_04_cada_llamada_deja_una_fila_de_auditoria_con_o_sin_error()
    {
        var user = Guid.NewGuid();
        await Consent(api, user);
        api.Ai.Throw = null;
        api.Ai.Handler = _ => new AiCompletion("Come algo ligero con hidratos.", 120, 30);

        var ok = await Ask(api, user, question: "¿Qué como antes de entrenar?");
        api.Ai.Throw = new AiProviderException(AiFailureKind.Failure, "caído");
        var failed = await Ask(api, user);
        api.Ai.Throw = null;

        Assert.IsType<AiOutcome.Ok>(ok);
        Assert.IsType<AiOutcome.Failed>(failed);
        var rows = await Audits(api, user);
        Assert.Equal(["ok", "error"], rows.Select(r => r.Status));
        Assert.Equal((Chat, "openai/gpt-oss-120b", 120, 30, "chat-v1"), (rows[0].Feature, rows[0].Model, rows[0].PromptTokens, rows[0].CompletionTokens, rows[0].PromptVersion));
        Assert.Contains("¿Qué como antes de entrenar?", rows[0].SentText);
        Assert.Equal("Come algo ligero con hidratos.", rows[0].ResponseText);
        Assert.Equal("caído", rows[1].Error);
    }

    // AC-ai-001-05
    [Fact]
    public async Task AC_ai_001_05_con_el_tope_por_persona_superado_responde_budget_exceeded_sin_llamar_al_proveedor()
    {
        using var factory = api.WithAuth(("Ai:UserDailyTokens", "300"));
        var user = Guid.NewGuid();
        await Consent(factory, user);
        Assert.IsType<AiOutcome.Ok>(await Ask(factory, user, reserved: 100)); // gasta 120 tokens
        Assert.IsType<AiOutcome.Ok>(await Ask(factory, user, reserved: 100)); // 240
        var calls = ProviderOf(factory).Calls.Count;

        var outcome = await Ask(factory, user, reserved: 100); // 240 + 100 > 300

        Assert.IsType<AiOutcome.Denied>(outcome);
        Assert.Equal(AiDenial.UserBudget, ((AiOutcome.Denied)outcome).Reason);
        Assert.Equal(calls, ProviderOf(factory).Calls.Count);
    }

    [Fact]
    public async Task AC_ai_001_05_con_el_tope_de_dolares_por_persona_superado_tambien_se_niega()
    {
        using var factory = api.WithAuth(
            ("Ai:Prices:openai/gpt-oss-120b:InputPerMillionUsd", "10000"), ("Ai:Prices:openai/gpt-oss-120b:OutputPerMillionUsd", "10000"),
            ("Ai:UserMonthlyUsd", "1"), ("Ai:GlobalMonthlyUsd", "100000"));
        var user = Guid.NewGuid();
        await Consent(factory, user);
        Assert.IsType<AiOutcome.Ok>(await Ask(factory, user)); // 120 tokens × 10.000 USD/M = 1,2 USD

        var outcome = await Ask(factory, user);

        Assert.Equal(AiDenial.UserBudget, Assert.IsType<AiOutcome.Denied>(outcome).Reason);
    }

    // AC-ai-001-06
    [Fact]
    public async Task AC_ai_001_06_con_el_tope_global_superado_cualquier_persona_recibe_ai_disabled_sin_llamar_al_proveedor()
    {
        // El gasto del mes es de toda la base compartida: el tope global se pone 1 USD por encima de lo ya gastado.
        decimal spent;
        using (var scope = api.Services.CreateScope())
        {
            var start = new DateTimeOffset(DateTimeOffset.UtcNow.Year, DateTimeOffset.UtcNow.Month, 1, 0, 0, 0, TimeSpan.Zero);
            spent = await scope.ServiceProvider.GetRequiredService<AppDbContext>().AiAudits.Where(a => a.CreatedAt >= start).SumAsync(a => (decimal?)a.CostUsd) ?? 0m;
        }

        using var factory = api.WithAuth(
            ("Ai:Prices:openai/gpt-oss-120b:InputPerMillionUsd", "10000"), ("Ai:Prices:openai/gpt-oss-120b:OutputPerMillionUsd", "10000"),
            ("Ai:GlobalMonthlyUsd", (spent + 1m).ToString(System.Globalization.CultureInfo.InvariantCulture)), ("Ai:UserMonthlyUsd", "100000"));
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        await Consent(factory, first);
        await Consent(factory, second);
        Assert.IsType<AiOutcome.Ok>(await Ask(factory, first));
        var calls = ProviderOf(factory).Calls.Count;

        var outcome = await Ask(factory, second);

        Assert.Equal(AiDenial.Disabled, Assert.IsType<AiOutcome.Denied>(outcome).Reason);
        Assert.Equal(calls, ProviderOf(factory).Calls.Count);
    }

    // AC-ai-001-07
    [Fact]
    public async Task AC_ai_001_07_si_el_proveedor_falla_se_audita_y_se_responde_con_un_error_sin_dejar_datos_a_medias()
    {
        var user = Guid.NewGuid();
        await Consent(api, user);
        api.Ai.Throw = new AiProviderException(AiFailureKind.Failure, "respuesta inválida");

        var outcome = await Ask(api, user);
        api.Ai.Throw = null;

        Assert.IsType<AiOutcome.Failed>(outcome);
        var row = Assert.Single(await Audits(api, user));
        Assert.Equal(("error", 0, 0), (row.Status, row.PromptTokens, row.CompletionTokens));
        Assert.Null(row.ResponseText);
    }

    // AC-ai-001-09
    [Fact]
    public async Task AC_ai_001_09_el_uso_trae_el_gasto_los_tokens_de_hoy_y_las_llamadas_recientes_solo_de_la_persona()
    {
        var user = Guid.NewGuid();
        var other = Guid.NewGuid();
        await Consent(api, user);
        await Consent(api, other);
        await Ask(api, user);
        await Ask(api, other);
        await Ask(api, other);

        var usage = (await api.ClientFor(user).GetFromJsonAsync<AiUsageDto>("/ai/usage"))!;

        Assert.Equal(120, usage.TokensToday);
        Assert.Single(usage.Recent);
        Assert.Equal((0m, 5m, 80_000), (usage.MonthCostUsd, usage.MonthlyCapUsd, usage.DailyTokenCap));
    }

    // AC-ai-001-10 (P7)
    [Fact]
    public async Task AC_ai_001_10_una_persona_no_ve_los_consentimientos_ni_el_uso_de_otra()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        await owner.PutAsync($"/ai/consents/{Chat}", null);

        Assert.DoesNotContain((await other.GetFromJsonAsync<AiConsentsDto>("/ai/consents"))!.Features, f => f.Consented);
        Assert.Empty((await other.GetFromJsonAsync<AiUsageDto>("/ai/usage"))!.Recent);
        Assert.Contains((await owner.GetFromJsonAsync<AiConsentsDto>("/ai/consents"))!.Features, f => f.Consented);
    }

    // AC-ai-001-12
    [Fact]
    public async Task AC_ai_001_12_sin_clave_la_api_arranca_y_las_funciones_responden_ai_disabled()
    {
        using var factory = api.WithAuth(("Ai:ApiKey", ""));
        var user = Guid.NewGuid();
        await Consent(factory, user);

        var outcome = await Ask(factory, user);
        var consents = (await factory.CreateClient().GetAsync("/health")).StatusCode;

        Assert.Equal(AiDenial.Disabled, Assert.IsType<AiOutcome.Denied>(outcome).Reason);
        Assert.Empty(ProviderOf(factory).Calls);
        Assert.NotEqual(HttpStatusCode.InternalServerError, consents);
    }

    // AC-ai-001-14
    [Fact]
    public async Task AC_ai_001_14_con_la_cuota_diaria_o_por_minuto_del_modelo_agotada_responde_provider_quota_sin_llamar_al_proveedor()
    {
        using var daily = api.WithAuth(("Ai:Models:chat", UniqueModel()), ("Ai:ModelDailyTokens", "250"), ("Ai:ModelMinuteTokens", "100000"));
        var user = Guid.NewGuid();
        await Consent(daily, user);
        Assert.IsType<AiOutcome.Ok>(await Ask(daily, user, reserved: 100));
        Assert.IsType<AiOutcome.Ok>(await Ask(daily, user, reserved: 100));
        var calls = ProviderOf(daily).Calls.Count;

        var exceeded = Assert.IsType<AiOutcome.Denied>(await Ask(daily, user, reserved: 100));

        Assert.Equal(AiDenial.ProviderQuota, exceeded.Reason);
        Assert.NotNull(exceeded.RetryAfter);
        Assert.Equal(calls, ProviderOf(daily).Calls.Count);

        using var minute = api.WithAuth(("Ai:Models:chat", UniqueModel()), ("Ai:ModelMinuteTokens", "250"));
        var other = Guid.NewGuid();
        await Consent(minute, other);
        Assert.IsType<AiOutcome.Ok>(await Ask(minute, other, reserved: 100));
        Assert.IsType<AiOutcome.Ok>(await Ask(minute, other, reserved: 100));
        Assert.Equal(TimeSpan.FromSeconds(60), Assert.IsType<AiOutcome.Denied>(await Ask(minute, other, reserved: 100)).RetryAfter);
    }

    [Fact]
    public async Task AC_ai_001_14_si_el_proveedor_responde_429_se_traslada_con_el_tiempo_de_espera_y_se_audita_sin_reintentar()
    {
        var user = Guid.NewGuid();
        await Consent(api, user);
        api.Ai.Throw = new AiProviderException(AiFailureKind.Quota, "429", TimeSpan.FromSeconds(42));
        var before = api.Ai.Calls.Count;

        var outcome = await Ask(api, user);
        api.Ai.Throw = null;

        var denied = Assert.IsType<AiOutcome.Denied>(outcome);
        Assert.Equal((AiDenial.ProviderQuota, TimeSpan.FromSeconds(42)), (denied.Reason, denied.RetryAfter));
        Assert.Equal(before + 1, api.Ai.Calls.Count); // una sola llamada: sin reintentos que gasten cuota
        Assert.Equal("quota", Assert.Single(await Audits(api, user)).Status);
    }

    // AC-ai-001-15
    [Fact]
    public async Task AC_ai_001_15_si_una_funcion_no_tiene_modelo_solo_esa_queda_desactivada_y_el_listado_lo_indica()
    {
        using var factory = api.WithAuth(("Ai:Models:food_photo", ""));
        var user = Guid.NewGuid();
        await Consent(factory, user, AiFeatures.FoodPhoto);
        await Consent(factory, user, Chat);

        var photo = await Ask(factory, user, AiFeatures.FoodPhoto);
        var chat = await Ask(factory, user, Chat);
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Id", user.ToString());
        var features = (await client.GetFromJsonAsync<AiConsentsDto>("/ai/consents"))!.Features.ToDictionary(f => f.Feature);

        Assert.Equal(AiDenial.Disabled, Assert.IsType<AiOutcome.Denied>(photo).Reason);
        Assert.IsType<AiOutcome.Ok>(chat);
        Assert.False(features[AiFeatures.FoodPhoto].Available);
        Assert.True(features[Chat].Available);
    }

    // Auditoría: el texto se purga pasado el plazo y las filas enteras pasado el de los metadatos
    [Fact]
    public async Task AC_ai_001_04_el_texto_de_la_auditoria_se_purga_a_los_30_dias_y_las_filas_al_año()
    {
        var user = Guid.NewGuid();
        await Consent(api, user);
        await Ask(api, user);
        using (var scope = api.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.AiAudits.Add(new AiAudit { Id = Guid.NewGuid(), UserId = user, Feature = Chat, Model = "m", SentText = "viejo", ResponseText = "viejo", CreatedAt = DateTimeOffset.UtcNow.AddDays(-31) });
            db.AiAudits.Add(new AiAudit { Id = Guid.NewGuid(), UserId = user, Feature = Chat, Model = "m", SentText = "antiguo", CreatedAt = DateTimeOffset.UtcNow.AddDays(-400) });
            await db.SaveChangesAsync();
        }

        await Ask(api, user); // la purga se hace al admitir una llamada

        var rows = await Audits(api, user);
        Assert.DoesNotContain(rows, r => r.SentText == "antiguo"); // fila de más de un año: borrada
        var old = Assert.Single(rows.Where(r => r.Model == "m"));
        Assert.Equal((null, null), (old.SentText, old.ResponseText)); // de 31 días: se conserva el metadato, no el texto
        Assert.Equal(2, rows.Count(r => r.Model != "m" && r.SentText != null)); // las recientes conservan su texto
    }

    // AC-ai-001-11
    [Fact]
    public async Task AC_ai_001_11_la_exportacion_incluye_consentimientos_y_auditoria_y_nunca_la_clave()
    {
        var token = await api.CreateAccountTokenAsync();
        var userId = Guid.Parse(new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(token).Subject);
        await Consent(api, userId);
        await Ask(api, userId);
        var client = api.ClientWithToken(token);

        var text = await client.GetStringAsync("/account/export");

        using var json = JsonDocument.Parse(text);
        Assert.Equal(Chat, json.RootElement.GetProperty("aiConsents")[0].GetProperty("feature").GetString());
        Assert.Equal(100, json.RootElement.GetProperty("aiCalls")[0].GetProperty("promptTokens").GetInt32());
        Assert.DoesNotContain("clave-de-pruebas", text);
        Assert.DoesNotContain("apiKey", text, StringComparison.OrdinalIgnoreCase);
    }
}
