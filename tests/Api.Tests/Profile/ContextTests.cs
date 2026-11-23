using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FitnessApp.Api.Domain.Ai;
using FitnessApp.Api.Domain.Profile;
using FitnessApp.Api.Features.Ai;
using FitnessApp.Api.Features.Profile;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace FitnessApp.Api.Tests.Profile;

/// <summary>Reglas puras del contexto personal contra los vectores compartidos (SPEC-profile-002, AC-04 y AC-09).</summary>
public sealed class ContextRulesTests
{
    private sealed record Item(
        string Type, string Name, string? Brand, string? Dose, string? Frequency, DateOnly? StartedOn, DateOnly? EndedOn, string? Note, bool ShareWithAi);
    private sealed record SummaryCase(string Name, Item[] Items, string Expected);
    private sealed record PersonalCase(string Text, bool Expected);
    private sealed record Vectors(DateOnly Today, SummaryCase[] Summary, PersonalCase[] Personal);

    private static readonly Vectors All = JsonSerializer.Deserialize<Vectors>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Profile", "context-vectors.json")),
        new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    public static TheoryData<int> SummaryIndexes() => [.. Enumerable.Range(0, All.Summary.Length)];
    public static TheoryData<int> PersonalIndexes() => [.. Enumerable.Range(0, All.Personal.Length)];

    [Theory]
    [MemberData(nameof(SummaryIndexes))]
    public void AC_profile_002_09_vectores_del_resumen_para_la_ia(int index)
    {
        var c = All.Summary[index];
        var items = c.Items.Select(i => new ContextItem
        {
            Id = Guid.NewGuid(), Type = i.Type, Name = i.Name, Brand = i.Brand, Dose = i.Dose, Frequency = i.Frequency, StartedOn = i.StartedOn,
            EndedOn = i.EndedOn, Note = i.Note, ShareWithAi = i.ShareWithAi,
        });

        Assert.Equal(c.Expected, ContextRules.Summary(items, All.Today));
    }

    [Fact]
    public void AC_profile_002_09_el_resumen_no_incluye_la_marca_ni_las_fechas_y_se_recorta_sin_partir_una_entrada()
    {
        var items = Enumerable.Range(0, 49).Select(i => new ContextItem
        {
            Type = "suplemento", Name = $"Suplemento {i:00} con un nombre largo", Brand = "MARCA-SECRETA", Dose = "10 g", Frequency = "diario",
            StartedOn = new DateOnly(2026, 1, 1), ShareWithAi = true,
        }).ToList();

        var summary = ContextRules.Summary(items, All.Today);

        Assert.True(summary.Length <= ContextRules.MaxSummaryChars);
        Assert.DoesNotContain("MARCA-SECRETA", summary);
        Assert.DoesNotContain("2026", summary);
        Assert.EndsWith("a diario", summary); // termina en una entrada completa
        Assert.True(summary.Split("; ").Length < 49); // el tope dejó fuera las últimas
    }

    [Theory]
    [MemberData(nameof(PersonalIndexes))]
    public void AC_profile_002_04_vectores_de_datos_personales_en_notas(int index)
    {
        var c = All.Personal[index];

        Assert.Equal(c.Expected, ContextRules.LooksPersonal(c.Text));
    }
}

/// <summary>Verifica SPEC-profile-002 contra la API y Postgres reales.</summary>
[Collection("api")]
public sealed class ContextTests : IDisposable
{
    private readonly ApiFixture api;

    public ContextTests(ApiFixture api)
    {
        this.api = api;
        api.Ai.Reset();
    }

    public void Dispose() => api.Ai.Reset();

    private static ContextItemRequest Creatine(bool share = false) =>
        new("suplemento", "Creatina", "Marca X", "5 g", "diario", new DateOnly(2026, 10, 1), null, null, share);

    private static Task<HttpResponseMessage> Put(HttpClient c, Guid id, ContextItemRequest r) => c.PutAsJsonAsync($"/context-items/{id}", r);

    private static async Task<List<ContextItemDto>> List(HttpClient c, string query = "") =>
        (await c.GetFromJsonAsync<List<ContextItemDto>>($"/context-items{query}"))!;

    private async Task<T> InDb<T>(Func<AppDbContext, Task<T>> action)
    {
        using var scope = api.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    // AC-profile-002-01
    [Fact]
    public async Task AC_profile_002_01_crea_con_201_y_reenviarla_es_idempotente_con_200()
    {
        var userId = Guid.NewGuid();
        var client = api.ClientFor(userId);
        var id = Guid.NewGuid();

        var created = await Put(client, id, Creatine());
        var same = await Put(client, id, Creatine());
        var changed = await Put(client, id, Creatine() with { Dose = "3 g" });

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(HttpStatusCode.OK, same.StatusCode);
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var items = await List(client);
        Assert.Single(items);
        Assert.Equal("3 g", items[0].Dose);
        Assert.Equal(userId, await InDb(db => db.ContextItems.Where(i => i.Id == id).Select(i => i.UserId).SingleAsync()));
    }

    // AC-profile-002-02
    [Theory]
    [InlineData("desconocido", "Creatina", null, null, null, null)]
    [InlineData("suplemento", "", null, null, null, null)]
    [InlineData("suplemento", "Creatina", "una marca extremadamente larga que supera con holgura los cuarenta caracteres", null, null, null)]
    [InlineData("suplemento", "Creatina", null, "5 g", "cada rato", null)]
    [InlineData("suplemento", "Creatina", null, null, null, "fechas")]
    public async Task AC_profile_002_02_una_entrada_fuera_de_las_reglas_responde_400_y_no_guarda(
        string type, string name, string? brand, string? dose, string? frequency, string? badDates)
    {
        var client = api.ClientFor(Guid.NewGuid());
        var request = new ContextItemRequest(type, name, brand, dose, frequency,
            badDates is null ? null : new DateOnly(2026, 10, 10), badDates is null ? null : new DateOnly(2026, 10, 1), null, false);

        var response = await Put(client, Guid.NewGuid(), request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(await List(client));
    }

    // AC-profile-002-03
    [Fact]
    public async Task AC_profile_002_03_la_medicacion_no_se_puede_compartir_y_se_guarda_sin_compartir()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var request = new ContextItemRequest("medicacion", "Ibuprofeno", null, "400 mg", "segun_necesidad", null, null, null, ShareWithAi: true);

        var rejected = await Put(client, Guid.NewGuid(), request);
        var saved = await Put(client, Guid.NewGuid(), request with { ShareWithAi = false });

        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);
        var items = await List(client);
        Assert.Single(items);
        Assert.False(items[0].ShareWithAi);
    }

    // AC-profile-002-04
    [Theory]
    [InlineData("Escríbeme a julio@correo.com")]
    [InlineData("Llámame al 612 345 678")]
    public async Task AC_profile_002_04_una_nota_con_un_dato_personal_evidente_responde_400(string text)
    {
        var client = api.ClientFor(Guid.NewGuid());

        var bad = await Put(client, Guid.NewGuid(), new ContextItemRequest("nota", "Aviso", null, null, null, null, null, text, false));
        var withDose = await Put(client, Guid.NewGuid(), new ContextItemRequest("nota", "Aviso", null, "5 g", null, null, null, "Duermo poco", false));
        var good = await Put(client, Guid.NewGuid(), new ContextItemRequest("nota", "Sueño", null, null, null, null, null, "Duermo unas 6 h", true));
        var tooLong = await Put(client, Guid.NewGuid(), new ContextItemRequest("nota", "Larga", null, null, null, null, null, new string('a', 281), false));

        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, withDose.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        Assert.Equal(HttpStatusCode.Created, good.StatusCode);
        Assert.Single(await List(client));
    }

    // AC-profile-002-05 y 06
    [Fact]
    public async Task AC_profile_002_05_lista_solo_las_suyas_ordenadas_y_con_active_solo_las_activas()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        await Put(client, Guid.NewGuid(), new ContextItemRequest("habito", "Cafeína", null, "2 tazas", "diario", null, null, null, false));
        await Put(client, Guid.NewGuid(), Creatine() with { Name = "Zinc" });
        await Put(client, Guid.NewGuid(), Creatine() with { Name = "Creatina", EndedOn = today.AddDays(-3) });
        await Put(client, Guid.NewGuid(), Creatine() with { Name = "Magnesio", EndedOn = today.AddDays(10) });

        var all = await List(client);
        var active = await List(client, "?active=true");

        Assert.Equal(["Creatina", "Magnesio", "Zinc", "Cafeína"], all.Select(i => i.Name));
        Assert.Equal(["Magnesio", "Zinc", "Cafeína"], active.Select(i => i.Name));
    }

    [Fact]
    public async Task AC_profile_002_06_dar_de_baja_conserva_la_entrada_y_borrar_responde_204_tambien_si_no_existe()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        await Put(client, id, Creatine());

        await Put(client, id, Creatine() with { EndedOn = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1) });

        Assert.Single(await List(client));
        Assert.Empty(await List(client, "?active=true"));
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/context-items/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/context-items/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/context-items/{Guid.NewGuid()}")).StatusCode);
        Assert.Empty(await List(client));
    }

    // AC-profile-002-07
    [Fact]
    public async Task AC_profile_002_07_otra_persona_no_ve_ni_cambia_ni_borra_las_entradas()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        await Put(owner, id, Creatine());

        var edit = await Put(other, id, Creatine() with { Dose = "99 g" });
        await other.DeleteAsync($"/context-items/{id}");

        Assert.Empty(await List(other));
        Assert.Equal(HttpStatusCode.NotFound, edit.StatusCode);
        Assert.Equal("5 g", (await List(owner)).Single().Dose);
    }

    // AC-profile-002-08
    [Fact]
    public async Task AC_profile_002_08_la_entrada_51_activa_responde_409_pero_editar_o_dar_de_baja_sigue_funcionando()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var ids = Enumerable.Range(0, ContextRules.MaxActive).Select(_ => Guid.NewGuid()).ToList();
        foreach (var id in ids) Assert.Equal(HttpStatusCode.Created, (await Put(client, id, Creatine())).StatusCode);

        var over = await Put(client, Guid.NewGuid(), Creatine());
        var edit = await Put(client, ids[0], Creatine() with { Dose = "4 g" });
        await Put(client, ids[1], Creatine() with { EndedOn = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1) });
        var afterRelease = await Put(client, Guid.NewGuid(), Creatine());

        Assert.Equal(HttpStatusCode.Conflict, over.StatusCode);
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
        Assert.Equal(HttpStatusCode.Created, afterRelease.StatusCode);
    }

    // AC-profile-002-10 y 11
    private async Task<HttpClient> PersonWithContextAsync(bool consent = true)
    {
        var client = api.ClientFor(Guid.NewGuid());
        (await client.PutAsJsonAsync("/profile", new ProfileRequest(
            "Julio César", "masculino", new DateOnly(1995, 5, 20), 178, "mantener", null, null, null, null, []))).EnsureSuccessStatusCode();
        if (consent) (await client.PutAsync($"/ai/consents/{AiFeatures.Chat}", null)).EnsureSuccessStatusCode();
        await Put(client, Guid.NewGuid(), Creatine(share: true) with { Name = "Creatina compartida" });
        await Put(client, Guid.NewGuid(), Creatine(share: false) with { Name = "Magnesio privado" });
        await Put(client, Guid.NewGuid(), new ContextItemRequest("medicacion", "Ibuprofeno-secreto", null, "400 mg", null, null, null, null, false));
        await Put(client, Guid.NewGuid(), Creatine(share: true) with { Name = "Vitamina de baja", EndedOn = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-2) });
        return client;
    }

    [Fact]
    public async Task AC_profile_002_10_con_usar_mis_datos_viaja_el_resumen_pero_nunca_medicacion_bajas_ni_entradas_sin_compartir()
    {
        var client = await PersonWithContextAsync();

        await client.PostAsJsonAsync("/ai/chat", new ChatRequest("¿Cómo voy?", null, true));

        var sent = api.Ai.Calls[^1].System;
        Assert.Contains("Creatina compartida, 5 g, a diario", sent);
        Assert.DoesNotContain("Magnesio privado", sent);
        Assert.DoesNotContain("Ibuprofeno-secreto", sent);
        Assert.DoesNotContain("Vitamina de baja", sent);
        Assert.DoesNotContain("Marca X", sent);
    }

    [Fact]
    public async Task AC_profile_002_10_el_contrato_de_la_ia_marca_el_contexto_como_clase_b()
    {
        Assert.Empty(AiContractGuard.Violations(typeof(ChatContract)));
        Assert.Empty(AiContractGuard.Violations(typeof(AnalysisContract)));
        Assert.Equal(DataClass.B, ((AiFieldAttribute)typeof(ChatContract).GetProperty(nameof(ChatContract.PersonalContext))!
            .GetCustomAttributes(typeof(AiFieldAttribute), true).Single()).DataClass);
        await Task.CompletedTask;
    }

    [Fact]
    public async Task AC_profile_002_11_sin_usar_mis_datos_o_sin_consentimiento_no_se_envia_el_resumen()
    {
        var client = await PersonWithContextAsync();
        await client.PostAsJsonAsync("/ai/chat", new ChatRequest("¿Cómo voy?", null, false));
        Assert.DoesNotContain("Creatina compartida", api.Ai.Calls[^1].System);

        var noConsent = await PersonWithContextAsync(consent: false);
        var calls = api.Ai.Calls.Count;
        var response = await noConsent.PostAsJsonAsync("/ai/chat", new ChatRequest("¿Cómo voy?", null, true));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(calls, api.Ai.Calls.Count);
    }
}
