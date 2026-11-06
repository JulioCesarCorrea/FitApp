using System.Net;
using System.Net.Http.Json;
using FitnessApp.Api.Features.Training.Plan;
using FitnessApp.Api.Features.Training.Restrictions;

namespace FitnessApp.Api.Tests.Training;

/// <summary>Verifica las restricciones de SPEC-profile-001 (AC-06 a 10) contra la API y Postgres reales.</summary>
[Collection("api")]
public sealed class RestrictionTests(ApiFixture api)
{
    private const string PressPlano = "press-plano-con-barra"; // zona principal: pecho
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static RestrictionRequest Pecho(string level = "aviso", DateOnly? reviewOn = null) =>
        new("pecho", ["empuje_horizontal"], level, reviewOn);

    private static Task<HttpResponseMessage> Put(HttpClient c, Guid id, RestrictionRequest body) =>
        c.PutAsJsonAsync($"/restrictions/{id}", body);

    // Los record con arrays se comparan por referencia: se comparan los valores.
    private static void AssertSame(RestrictionDto expected, RestrictionDto actual)
    {
        Assert.Equal(expected.Id, actual.Id);
        Assert.Equal(expected.Zone, actual.Zone);
        Assert.Equal(expected.AvoidedMovements, actual.AvoidedMovements);
        Assert.Equal(expected.Level, actual.Level);
        Assert.Equal(expected.ReviewOn, actual.ReviewOn);
    }

    private static Task<List<RestrictionDto>?> List(HttpClient c) => c.GetFromJsonAsync<List<RestrictionDto>>("/restrictions");

    // AC-06
    [Fact]
    public async Task AC_profile_001_06_crea_la_restriccion_con_el_id_del_cliente_y_la_lista()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();

        var response = await Put(client, id, Pecho("bloqueo", Today.AddDays(30)));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var saved = Assert.Single(await List(client) ?? []);
        AssertSame(new RestrictionDto(id, "pecho", ["empuje_horizontal"], "bloqueo", Today.AddDays(30)), saved);
    }

    [Fact]
    public async Task AC_profile_001_06_reenviar_el_mismo_id_reemplaza_sin_duplicar()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        await Put(client, id, Pecho("aviso"));

        var response = await Put(client, id, new RestrictionRequest("hombros", [], "contexto", null));
        var again = await Put(client, id, new RestrictionRequest("hombros", [], "contexto", null));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        var saved = Assert.Single(await List(client) ?? []);
        AssertSame(new RestrictionDto(id, "hombros", [], "contexto", null), saved);
    }

    [Fact]
    public async Task AC_profile_001_06_sin_token_responde_401()
    {
        var anonymous = api.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/restrictions")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Put(anonymous, Guid.NewGuid(), Pecho())).StatusCode);
    }

    // AC-07
    public static TheoryData<string, RestrictionRequest> Invalid() => new()
    {
        { "zona inexistente", new RestrictionRequest("rodilla_izquierda", [], "aviso", null) },
        { "zona vacía", new RestrictionRequest("  ", [], "aviso", null) },
        { "movimiento inexistente", new RestrictionRequest("pecho", ["saltar_la_cuerda"], "aviso", null) },
        { "nivel desconocido", new RestrictionRequest("pecho", [], "muy_grave", null) },
        { "revisión de hace dos días", new RestrictionRequest("pecho", [], "aviso", Today.AddDays(-2)) },
    };

    [Theory]
    [MemberData(nameof(Invalid))]
    public async Task AC_profile_001_07_rechaza_datos_que_no_existen_y_no_guarda_nada(string caso, RestrictionRequest body)
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await Put(client, Guid.NewGuid(), body);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(await List(client) ?? []);
        Assert.NotEmpty(caso);
    }

    [Fact]
    public async Task AC_profile_001_07_el_grupo_hombros_y_la_fecha_de_hoy_son_validos()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await Put(client, Guid.NewGuid(), new RestrictionRequest("Hombros", [], "aviso", Today));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task AC_profile_001_07_admite_hasta_30_restricciones_por_persona()
    {
        var client = api.ClientFor(Guid.NewGuid());
        for (var i = 0; i < 30; i++)
            Assert.Equal(HttpStatusCode.Created, (await Put(client, Guid.NewGuid(), Pecho())).StatusCode);

        var extra = await Put(client, Guid.NewGuid(), Pecho());

        Assert.Equal(HttpStatusCode.BadRequest, extra.StatusCode);
        Assert.Equal(30, (await List(client))!.Count);
    }

    [Fact]
    public async Task AC_profile_001_07_editar_una_existente_con_30_guardadas_sigue_permitido()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var first = Guid.NewGuid();
        await Put(client, first, Pecho());
        for (var i = 0; i < 29; i++) await Put(client, Guid.NewGuid(), Pecho());

        var response = await Put(client, first, Pecho("bloqueo"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task AC_profile_001_07_el_id_de_una_restriccion_ajena_responde_404()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var intruder = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        await Put(owner, id, Pecho("aviso"));

        var response = await Put(intruder, id, Pecho("bloqueo"));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("aviso", Assert.Single(await List(owner) ?? []).Level);
        Assert.Empty(await List(intruder) ?? []);
    }

    // AC-08
    [Fact]
    public async Task AC_profile_001_08_borrar_responde_204_y_deja_de_listarse()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        await Put(client, id, Pecho());

        var first = await client.DeleteAsync($"/restrictions/{id}");
        var again = await client.DeleteAsync($"/restrictions/{id}");
        var unknown = await client.DeleteAsync($"/restrictions/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, unknown.StatusCode);
        Assert.Empty(await List(client) ?? []);
    }

    [Fact]
    public async Task AC_profile_001_08_borrar_la_de_otra_persona_responde_204_sin_efecto()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var intruder = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        await Put(owner, id, Pecho());

        var response = await intruder.DeleteAsync($"/restrictions/{id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Single(await List(owner) ?? []);
    }

    // AC-09
    private static SavePlanDayRequest Day() => new([new PlanEntryRequest(Guid.NewGuid(), PressPlano, 0, null)]);

    [Fact]
    public async Task AC_profile_001_09_un_bloqueo_impide_asignar_el_ejercicio_y_al_borrarlo_vuelve_a_poder()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        await Put(client, id, new RestrictionRequest("pecho", [], "bloqueo", null));

        var blocked = await client.PutAsJsonAsync("/plan/days/sabado", Day());
        await client.DeleteAsync($"/restrictions/{id}");
        var allowed = await client.PutAsJsonAsync("/plan/days/sabado", Day());

        Assert.Equal(HttpStatusCode.UnprocessableEntity, blocked.StatusCode);
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
    }

    [Fact]
    public async Task AC_profile_001_09_un_aviso_pide_confirmar_y_con_confirmacion_se_guarda()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Put(client, Guid.NewGuid(), new RestrictionRequest("pecho", [], "aviso", null));

        var warned = await client.PutAsJsonAsync("/plan/days/sabado", Day());
        var confirmed = await client.PutAsJsonAsync("/plan/days/sabado", Day() with { ConfirmWarnings = true });

        Assert.Equal(HttpStatusCode.Conflict, warned.StatusCode);
        Assert.Equal(HttpStatusCode.OK, confirmed.StatusCode);
    }

    [Fact]
    public async Task AC_profile_001_09_el_contexto_asigna_sin_interrumpir()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Put(client, Guid.NewGuid(), new RestrictionRequest("pecho", [], "contexto", null));

        var response = await client.PutAsJsonAsync("/plan/days/sabado", Day());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task AC_profile_001_09_un_movimiento_evitado_tambien_cuenta()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Put(client, Guid.NewGuid(), new RestrictionRequest("antebrazos", ["empuje_horizontal"], "bloqueo", null));

        var response = await client.PutAsJsonAsync("/plan/days/sabado", Day());

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // AC-10
    [Fact]
    public async Task AC_profile_001_10_las_restricciones_de_una_persona_no_afectan_a_la_rutina_de_otra()
    {
        var one = api.ClientFor(Guid.NewGuid());
        var two = api.ClientFor(Guid.NewGuid());
        await Put(one, Guid.NewGuid(), new RestrictionRequest("pecho", [], "bloqueo", null));

        var blockedForOne = await one.PutAsJsonAsync("/plan/days/sabado", Day());
        var allowedForTwo = await two.PutAsJsonAsync("/plan/days/sabado", Day());

        Assert.Equal(HttpStatusCode.UnprocessableEntity, blockedForOne.StatusCode);
        Assert.Equal(HttpStatusCode.OK, allowedForTwo.StatusCode);
        Assert.Empty(await List(two) ?? []);
    }
}
