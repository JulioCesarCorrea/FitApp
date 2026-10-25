using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace FitnessApp.Api.Tests;

public sealed record WeightBody(Guid Id, decimal WeightKg, DateTimeOffset MeasuredAt);

/// <summary>Verifica SPEC-progress-001. Cada test cita su criterio de aceptación.</summary>
[Collection("api")]
public sealed class WeightTests(ApiFixture api)
{
    private static WeightBody Body(decimal kg = 80.5m, DateTimeOffset? at = null) =>
        new(Guid.NewGuid(), kg, at ?? DateTimeOffset.UtcNow.AddHours(-1));

    [Fact]
    public async Task AC_progress_001_01_crea_registro_con_id_del_cliente()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var body = Body();

        var response = await client.PostAsJsonAsync("/weights", body);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var list = await client.GetFromJsonAsync<List<WeightBody>>("/weights");
        Assert.Contains(list!, w => w.Id == body.Id && w.WeightKg == 80.5m);
    }

    [Fact]
    public async Task AC_progress_001_02_reintento_con_mismo_id_no_duplica()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var body = Body();

        var first = await client.PostAsJsonAsync("/weights", body);
        var retry = await client.PostAsJsonAsync("/weights", body);

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        var list = await client.GetFromJsonAsync<List<WeightBody>>("/weights");
        Assert.Single(list!, w => w.Id == body.Id);
    }

    [Fact]
    public async Task AC_progress_001_03_id_de_otra_persona_responde_409_sin_revelar()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var intruder = api.ClientFor(Guid.NewGuid());
        var body = Body(70m);
        await owner.PostAsJsonAsync("/weights", body);

        var response = await intruder.PostAsJsonAsync("/weights", body with { WeightKg = 99m });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var ownerList = await owner.GetFromJsonAsync<List<WeightBody>>("/weights");
        Assert.Equal(70m, Assert.Single(ownerList!, w => w.Id == body.Id).WeightKg);
        var intruderList = await intruder.GetFromJsonAsync<List<WeightBody>>("/weights");
        Assert.Empty(intruderList!);
    }

    [Theory]
    [InlineData(20)]
    [InlineData(500)]
    [InlineData(-3)]
    public async Task AC_progress_001_04_peso_fuera_de_rango_responde_400(decimal kg)
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.PostAsJsonAsync("/weights", Body(kg));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<WeightBody>>("/weights"))!);
    }

    [Fact]
    public async Task AC_progress_001_04_fecha_lejana_en_el_futuro_responde_400()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.PostAsJsonAsync("/weights", Body(at: DateTimeOffset.UtcNow.AddDays(3)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task AC_progress_001_05_lista_solo_los_propios_ordenados_por_fecha_desc()
    {
        var a = api.ClientFor(Guid.NewGuid());
        var b = api.ClientFor(Guid.NewGuid());
        var older = Body(80m, DateTimeOffset.UtcNow.AddDays(-2));
        var newer = Body(79m, DateTimeOffset.UtcNow.AddDays(-1));
        await a.PostAsJsonAsync("/weights", older);
        await a.PostAsJsonAsync("/weights", newer);
        await b.PostAsJsonAsync("/weights", Body(60m));

        var list = await a.GetFromJsonAsync<List<WeightBody>>("/weights");

        Assert.Equal([newer.Id, older.Id], list!.Select(w => w.Id).ToArray());
    }

    [Theory]
    [InlineData("{\"id\":\"no-es-guid\",\"weightKg\":80,\"measuredAt\":\"2026-01-01T00:00:00Z\"}")]
    [InlineData("esto no es json")]
    public async Task AC_progress_001_06_cuerpo_invalido_responde_400_no_500(string json)
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.PostAsync("/weights", new StringContent(json, System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<WeightBody>>("/weights"))!);
    }

    [Fact]
    public async Task Sin_sesion_responde_401()
    {
        var anonymous = api.CreateClient();

        var response = await anonymous.GetAsync("/weights");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
