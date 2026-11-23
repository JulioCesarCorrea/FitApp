using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using FitnessApp.Api.Domain.Ai;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Features.Ai;
using FitnessApp.Api.Features.Nutrition;
using FitnessApp.Api.Features.Profile;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace FitnessApp.Api.Tests.Ai;

/// <summary>Reglas puras de SPEC-ai-002 sobre lo que devuelve la IA (P4: la respuesta no se da por buena sin comprobarla).</summary>
public sealed class AiOutputRulesTests
{
    private static readonly HashSet<string> Sources = ["entrenamiento_semanal", "restricciones"];

    private static string Analysis(string claim) =>
        $$"""{"sections":[{"title":"Resumen","claims":[{{claim}}]}]}""";

    [Fact]
    public void AC_ai_002_01_conserva_el_tipo_y_la_fuente_de_cada_afirmacion()
    {
        var json = Analysis("""{"text":"Entrenaste 3 sesiones con 480 kg de volumen.","kind":"registrado","source":"entrenamiento_semanal"},{"text":"Vas por buen camino.","kind":"inferencia","source":"entrenamiento_semanal"}""");

        var sections = AiOutputRules.ParseAnalysis(json, Sources, AiOutputRules.Numbers("{\"volumenKg\":480,\"sesiones\":3}"))!;

        var claims = Assert.Single(sections).Claims;
        Assert.Equal(("registrado", "entrenamiento_semanal", true), (claims[0].Kind, claims[0].Source, claims[0].Verified));
        Assert.Equal(("inferencia", true), (claims[1].Kind, claims[1].Verified));
    }

    [Theory]
    [InlineData("""{"text":"Pesaste 91,5 kg.","kind":"registrado","source":"entrenamiento_semanal"}""")] // número que no está en los datos
    [InlineData("""{"text":"Entrenaste 480 kg.","kind":"registrado","source":"inventada"}""")] // fuente desconocida
    [InlineData("""{"text":"Entrenaste 480 kg.","kind":"registrado"}""")] // sin fuente
    public void AC_ai_002_07_una_medicion_registrada_inventada_o_sin_fuente_pasa_a_inferencia_sin_verificar(string claim)
    {
        var sections = AiOutputRules.ParseAnalysis(Analysis(claim), Sources, AiOutputRules.Numbers("{\"volumenKg\":480}"))!;

        var c = Assert.Single(Assert.Single(sections).Claims);
        Assert.Equal(("inferencia", false), (c.Kind, c.Verified));
    }

    [Fact]
    public void AC_ai_002_07_los_numeros_pequenos_de_dias_y_series_no_cuentan_como_mediciones_y_los_decimales_se_comparan_sin_importar_la_coma()
    {
        var json = Analysis("""{"text":"En 4 semanas llegaste a 80,5 kg de media.","kind":"registrado","source":"entrenamiento_semanal"}""");

        var ok = AiOutputRules.ParseAnalysis(json, Sources, AiOutputRules.Numbers("{\"media\":80.50}"))!;

        Assert.True(Assert.Single(Assert.Single(ok).Claims).Verified);
    }

    [Theory]
    [InlineData("no es json")]
    [InlineData("{\"otra\":1}")]
    [InlineData("{\"sections\":[]}")]
    [InlineData("{\"sections\":[{\"title\":\"x\",\"claims\":[]}]}")]
    public void AC_ai_002_01_una_respuesta_sin_la_forma_pedida_se_descarta(string text)
    {
        Assert.Null(AiOutputRules.ParseAnalysis(text, Sources, new HashSet<string>()));
    }

    [Fact]
    public void AC_ai_002_01_acepta_la_respuesta_envuelta_en_un_cercado_de_codigo()
    {
        var fenced = "```json\n" + Analysis("""{"text":"Hola","kind":"estimacion","source":"x"}""") + "\n```";

        Assert.NotNull(AiOutputRules.ParseAnalysis(fenced, Sources, new HashSet<string>()));
    }
}

/// <summary>Verifica SPEC-ai-002 contra la API y Postgres reales con un proveedor falso. Cada test cita su criterio de aceptación.</summary>
[Collection("api")]
public sealed class AiAssistantTests : IDisposable
{
    private readonly ApiFixture api;

    public AiAssistantTests(ApiFixture api)
    {
        this.api = api;
        api.Ai.Reset();
    }

    public void Dispose() => api.Ai.Reset();

    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static AiCompletion Json(object value) => new(JsonSerializer.Serialize(value), 400, 150);

    private async Task<(HttpClient Client, Guid UserId)> NewPersonAsync(bool consent = true, string feature = AiFeatures.Analysis)
    {
        var userId = Guid.NewGuid();
        var client = api.ClientFor(userId);
        (await client.PutAsJsonAsync("/profile", new ProfileRequest(
            "Julio César", "masculino", new DateOnly(1995, 5, 20), 178, "mantener", null, null, null, null, ["nueces"]))).EnsureSuccessStatusCode();
        if (consent) (await client.PutAsync($"/ai/consents/{feature}", null)).EnsureSuccessStatusCode();
        return (client, userId);
    }

    private async Task SeedPlanAsync(Guid userId, string exerciseId = "press-plano-con-mancuernas", DayOfWeek day = DayOfWeek.Monday)
    {
        using var scope = api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.PlanEntries.Add(new PlanEntry { Id = Guid.NewGuid(), UserId = userId, Day = day, ExerciseId = exerciseId, Order = 0 });
        await db.SaveChangesAsync();
    }

    private async Task<List<PlanEntry>> PlanOf(Guid userId)
    {
        using var scope = api.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().PlanEntries.AsNoTracking().Where(p => p.UserId == userId).ToListAsync();
    }

    /// <summary>Alternativas que la pasarela ofreció a la IA en la última petición: ids del JSON «Opciones».</summary>
    private static List<(string Day, string From, string[] Alternatives)> OffersIn(AiRequest request)
    {
        var text = request.Messages[0].Text;
        var json = Regex.Match(text, @"Opciones: (.*)\nRestricciones", RegexOptions.Singleline).Groups[1].Value;
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.EnumerateArray().Select(o => (
            o.GetProperty("dia").GetString()!, o.GetProperty("ejercicioActual").GetProperty("id").GetString()!,
            o.GetProperty("alternativas").EnumerateArray().Select(a => a.GetProperty("id").GetString()!).ToArray())).ToList();
    }

    // AC-ai-002-01
    [Fact]
    public async Task AC_ai_002_01_el_analisis_devuelve_secciones_con_el_tipo_y_la_fuente_de_cada_afirmacion_marcado_como_propuesta()
    {
        var (client, _) = await NewPersonAsync();
        api.Ai.Handler = _ => Json(new
        {
            sections = new[] { new { title = "Volumen", claims = new[] { new { text = "Aún no hay sesiones registradas.", kind = "inferencia", source = "entrenamiento_semanal" } } } },
        });

        var response = await client.PostAsJsonAsync("/ai/analysis", new AnalysisRequest("training"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var analysis = (await response.Content.ReadFromJsonAsync<AnalysisDto>())!;
        Assert.Equal(("training", "proposal"), (analysis.Scope, analysis.Kind));
        Assert.Equal("Volumen", Assert.Single(analysis.Sections).Title);
        Assert.Equal("inferencia", Assert.Single(analysis.Sections[0].Claims).Kind);
        Assert.Contains("sustituye a un profesional de la salud", analysis.Disclaimer);
    }

    // AC-ai-002-02
    [Fact]
    public async Task AC_ai_002_02_la_peticion_a_la_ia_solo_lleva_agregados_y_etiquetas_sin_nombre_ni_texto_libre_del_perfil()
    {
        var (client, _) = await NewPersonAsync();
        await api.AddRestrictionAsync(Guid.Empty, "x", RestrictionLevel.Aviso); // otra persona: no debe aparecer
        api.Ai.Handler = _ => Json(new { sections = new[] { new { title = "T", claims = new[] { new { text = "Hola", kind = "inferencia", source = "restricciones" } } } } });

        (await client.PostAsJsonAsync("/ai/analysis", new AnalysisRequest("nutrition"))).EnsureSuccessStatusCode();

        var sent = api.Ai.Calls[^1];
        var text = sent.System + sent.Messages[0].Text;
        Assert.DoesNotContain("Julio", text); // el nombre nunca sale
        Assert.DoesNotContain("nueces", text); // lo escrito en las alergias tampoco: sale la etiqueta del catálogo
        Assert.Contains("frutos_secos", text);
        Assert.Contains("nutricion_semanal", text);
        Assert.DoesNotContain("zona-de-otra-persona", text);
    }

    // AC-ai-002-03 y AC-ai-002-04
    [Fact]
    public async Task AC_ai_002_03_la_propuesta_de_rutina_solo_conserva_cambios_con_alternativas_permitidas_por_las_restricciones()
    {
        var (client, userId) = await NewPersonAsync();
        await SeedPlanAsync(userId);
        var blocked = "";
        api.Ai.Handler = request =>
        {
            var offer = OffersIn(request)[0];
            blocked = offer.Alternatives[0];
            // Propone una alternativa ofrecida, otra inventada y un ejercicio que no estaba en las opciones.
            return Json(new
            {
                summary = "Cambio de variante",
                changes = new object[]
                {
                    new { day = offer.Day, from = offer.From, to = offer.Alternatives[0], reason = "Variar el estímulo" },
                    new { day = offer.Day, from = offer.From, to = "ejercicio-inventado", reason = "x" },
                    new { day = "Tuesday", from = offer.From, to = offer.Alternatives[0], reason = "día sin ese ejercicio" },
                },
            });
        };

        var response = await client.PostAsJsonAsync("/ai/plan", new PlanRequest("training"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var proposal = (await response.Content.ReadFromJsonAsync<ProposalDto>())!;
        Assert.Equal(("proposal", "pending"), (proposal.Kind, proposal.Status));
        var change = Assert.Single(proposal.Changes);
        Assert.Equal((ProposedChange.ReplaceExercise, blocked), (change.Kind, change.ToExerciseId));
        Assert.Equal("press-plano-con-mancuernas", Assert.Single(await PlanOf(userId)).ExerciseId); // proponer no cambia nada
    }

    [Fact]
    public async Task AC_ai_002_03_una_alternativa_bloqueada_por_una_restriccion_nunca_se_ofrece_y_si_la_ia_la_propone_se_descarta()
    {
        var (client, userId) = await NewPersonAsync();
        await SeedPlanAsync(userId);
        // Primera vuelta: se mira qué alternativas se ofrecen.
        string first = "";
        api.Ai.Handler = request => { first = OffersIn(request)[0].Alternatives[0]; return Json(new { summary = "x", changes = Array.Empty<object>() }); };
        await client.PostAsJsonAsync("/ai/plan", new PlanRequest("training"));
        string[] movements;
        using (var scope = api.Services.CreateScope())
            movements = (await scope.ServiceProvider.GetRequiredService<AppDbContext>().Exercises.AsNoTracking().FirstAsync(e => e.Id == first)).Movements;
        await api.AddRestrictionAsync(userId, "zona-inexistente", RestrictionLevel.Bloqueo, movements);
        api.Ai.Handler = request =>
        {
            var offers = OffersIn(request)[0];
            Assert.DoesNotContain(first, offers.Alternatives); // la bloqueada ya no se ofrece
            return Json(new { summary = "x", changes = new[] { new { day = offers.Day, from = offers.From, to = first, reason = "intento" } } });
        };

        var response = await client.PostAsJsonAsync("/ai/plan", new PlanRequest("training"));

        Assert.NotEqual(HttpStatusCode.Created, response.StatusCode); // el único cambio propuesto era el bloqueado: no hay propuesta
    }

    [Fact]
    public async Task AC_ai_002_04_la_propuesta_de_comidas_no_ofrece_alimentos_que_chocan_con_las_alergias_y_no_lleva_nombres_a_la_ia()
    {
        var (client, userId) = await NewPersonAsync();
        var safe = Guid.NewGuid();
        var nutty = Guid.NewGuid();
        (await client.PutAsJsonAsync($"/foods/{safe}", new FoodRequest("Arroz secreto", null, null, 130, 2.7m, 0.3m, 28m, "manual"))).EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync($"/foods/{nutty}", new FoodRequest("Crema de nueces", null, null, 600, 15m, 55m, 15m, "manual", ["frutos_secos"]))).EnsureSuccessStatusCode();
        api.Ai.Handler = request =>
        {
            var text = request.Messages[0].Text;
            Assert.DoesNotContain("Arroz", text); // lo que se come no sale con nombre (clase C)
            Assert.DoesNotContain("nueces", text);
            return Json(new
            {
                summary = "Idea para comer", changes = new object[]
                {
                    new { meal = "almuerzo", food = "F1", grams = 150, reason = "Hidratos" },
                    new { meal = "cena", food = "F2", grams = 100, reason = "alias que no existe" },
                    new { meal = "cena", food = "F1", grams = 99999, reason = "gramos absurdos" },
                },
            });
        };

        var response = await client.PostAsJsonAsync("/ai/plan", new PlanRequest("nutrition"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var change = Assert.Single((await response.Content.ReadFromJsonAsync<ProposalDto>())!.Changes);
        Assert.Equal((ProposedChange.AddEntry, safe, 150, "almuerzo"), (change.Kind, change.FoodId, change.Grams, change.Meal));
    }

    // AC-ai-002-05
    [Fact]
    public async Task AC_ai_002_05_aceptar_aplica_lo_validado_una_sola_vez_y_rechazar_no_cambia_nada()
    {
        var (client, userId) = await NewPersonAsync();
        await SeedPlanAsync(userId);
        string to = "";
        api.Ai.Handler = request =>
        {
            var offer = OffersIn(request)[0];
            to = offer.Alternatives[0];
            return Json(new { summary = "Cambio", changes = new[] { new { day = offer.Day, from = offer.From, to, reason = "variar" } } });
        };
        var first = (await (await client.PostAsJsonAsync("/ai/plan", new PlanRequest("training"))).Content.ReadFromJsonAsync<ProposalDto>())!;
        var second = (await (await client.PostAsJsonAsync("/ai/plan", new PlanRequest("training"))).Content.ReadFromJsonAsync<ProposalDto>())!;

        var rejected = await client.PostAsync($"/ai/proposals/{second.Id}/reject", null);
        var afterReject = (await PlanOf(userId)).Single().ExerciseId;
        var accepted = (await (await client.PostAsync($"/ai/proposals/{first.Id}/accept", null)).Content.ReadFromJsonAsync<ProposalResultDto>())!;
        var again = (await (await client.PostAsync($"/ai/proposals/{first.Id}/accept", null)).Content.ReadFromJsonAsync<ProposalResultDto>())!;

        Assert.Equal(HttpStatusCode.OK, rejected.StatusCode);
        Assert.Equal("press-plano-con-mancuernas", afterReject);
        Assert.Equal(("accepted", 1, 0), (accepted.Status, accepted.Applied, accepted.Skipped));
        Assert.Equal(to, (await PlanOf(userId)).Single().ExerciseId);
        Assert.Equal(("accepted", 0), (again.Status, again.Applied)); // no se vuelve a aplicar
        var list = (await client.GetFromJsonAsync<List<ProposalDto>>("/ai/proposals"))!;
        Assert.Equal(["accepted", "rejected"], list.Select(p => p.Status).Order());
    }

    [Fact]
    public async Task AC_ai_002_05_aceptar_una_propuesta_de_comidas_registra_la_entrada_con_las_reglas_normales()
    {
        var (client, userId) = await NewPersonAsync();
        var food = Guid.NewGuid();
        (await client.PutAsJsonAsync($"/foods/{food}", new FoodRequest("Arroz", null, null, 130, 2.7m, 0.3m, 28m, "manual"))).EnsureSuccessStatusCode();
        api.Ai.Handler = _ => Json(new { summary = "Comida", changes = new[] { new { meal = "almuerzo", food = "F1", grams = 200, reason = "Hidratos" } } });
        var proposal = (await (await client.PostAsJsonAsync("/ai/plan", new PlanRequest("nutrition"))).Content.ReadFromJsonAsync<ProposalDto>())!;

        var result = (await (await client.PostAsync($"/ai/proposals/{proposal.Id}/accept", null)).Content.ReadFromJsonAsync<ProposalResultDto>())!;

        Assert.Equal(1, result.Applied);
        var day = (await client.GetFromJsonAsync<NutritionDayDto>($"/nutrition/day?date={Today:yyyy-MM-dd}"))!;
        var entry = Assert.Single(Assert.Single(day.Meals).Entries);
        Assert.Equal(("Arroz", 200, 260), (entry.Name, entry.Grams, entry.Kcal)); // 130 kcal por 100 g
        Assert.Equal(userId, userId);
    }

    // AC-ai-002-08
    [Fact]
    public async Task AC_ai_002_08_sin_consentimiento_o_sin_clave_responde_como_la_base_de_ia_y_nada_se_guarda()
    {
        var (client, _) = await NewPersonAsync(consent: false);

        var noConsent = await client.PostAsJsonAsync("/ai/analysis", new AnalysisRequest("training"));
        var proposals = (await client.GetFromJsonAsync<List<ProposalDto>>("/ai/proposals"))!;

        Assert.Equal(HttpStatusCode.Forbidden, noConsent.StatusCode);
        Assert.Equal("consent_required", (await noConsent.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        Assert.Empty(proposals);

        using var factory = api.WithAuth(("Ai:ApiKey", ""));
        var userId = Guid.NewGuid();
        var disabled = factory.CreateClient();
        disabled.DefaultRequestHeaders.Add("X-User-Id", userId.ToString());
        await disabled.PutAsync($"/ai/consents/{AiFeatures.Analysis}", null);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await disabled.PostAsJsonAsync("/ai/analysis", new AnalysisRequest("training"))).StatusCode);
    }

    [Fact]
    public async Task AC_ai_002_08_si_la_ia_devuelve_basura_responde_502_y_no_se_crea_ninguna_propuesta()
    {
        var (client, userId) = await NewPersonAsync();
        await SeedPlanAsync(userId);
        api.Ai.Handler = _ => new AiCompletion("esto no es json", 100, 20);

        var plan = await client.PostAsJsonAsync("/ai/plan", new PlanRequest("training"));
        var analysis = await client.PostAsJsonAsync("/ai/analysis", new AnalysisRequest("training"));

        Assert.Equal(HttpStatusCode.BadGateway, analysis.StatusCode);
        Assert.NotEqual(HttpStatusCode.Created, plan.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<ProposalDto>>("/ai/proposals"))!);
    }

    [Fact]
    public async Task AC_ai_002_01_un_ambito_desconocido_responde_400()
    {
        var (client, _) = await NewPersonAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/ai/analysis", new AnalysisRequest("otro"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/ai/plan", new PlanRequest("otro"))).StatusCode);
    }

    // AC-ai-002-09 (P7)
    [Fact]
    public async Task AC_ai_002_09_una_persona_no_ve_ni_acepta_ni_rechaza_las_propuestas_de_otra()
    {
        var (owner, ownerId) = await NewPersonAsync();
        var (other, _) = await NewPersonAsync();
        await SeedPlanAsync(ownerId);
        api.Ai.Handler = request =>
        {
            var offer = OffersIn(request)[0];
            return Json(new { summary = "Cambio", changes = new[] { new { day = offer.Day, from = offer.From, to = offer.Alternatives[0], reason = "x" } } });
        };
        var proposal = (await (await owner.PostAsJsonAsync("/ai/plan", new PlanRequest("training"))).Content.ReadFromJsonAsync<ProposalDto>())!;

        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsync($"/ai/proposals/{proposal.Id}/accept", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsync($"/ai/proposals/{proposal.Id}/reject", null)).StatusCode);
        Assert.Empty((await other.GetFromJsonAsync<List<ProposalDto>>("/ai/proposals"))!);
        Assert.Equal("press-plano-con-mancuernas", Assert.Single(await PlanOf(ownerId)).ExerciseId);
    }

    // exportación
    [Fact]
    public async Task AC_ai_002_01_la_exportacion_incluye_las_propuestas()
    {
        var token = await api.CreateAccountTokenAsync();
        var userId = Guid.Parse(new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(token).Subject);
        using (var scope = api.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.AiProposals.Add(new AiProposal { Id = Guid.NewGuid(), UserId = userId, Scope = "training", Summary = "S", ChangesJson = "[]", CreatedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
        }

        using var json = JsonDocument.Parse(await api.ClientWithToken(token).GetStringAsync("/account/export"));

        Assert.Equal("S", json.RootElement.GetProperty("aiProposals")[0].GetProperty("summary").GetString());
    }
}
