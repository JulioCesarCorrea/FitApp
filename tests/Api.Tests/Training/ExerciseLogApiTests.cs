using System.Net;
using System.Net.Http.Json;
using FitnessApp.Api.Features.Training.Equipment;
using FitnessApp.Api.Features.Training.Sessions;

namespace FitnessApp.Api.Tests.Training;

/// <summary>Verifica SPEC-training-003 contra la API y Postgres reales. Cada test cita su criterio de aceptación.</summary>
[Collection("api")]
public sealed class ExerciseLogApiTests(ApiFixture api)
{
    private const string PressMancuernas = "press-plano-con-mancuernas";
    private const string PressBarra = "press-plano-con-barra";
    private const string Fondos = "fondos-en-paralelas-para-pecho";

    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static DateOnly Ago(int days) => Today.AddDays(-days);

    private static ExerciseLogRequest Body(
        string exercise = PressMancuernas, DateOnly? date = null, decimal load = 22.5m,
        int set1 = 9, int set2 = 5, int assisted = 5) =>
        new(exercise, date ?? Ago(1), load, set1, set2, assisted);

    private static Task<HttpResponseMessage> Put(HttpClient c, Guid id, ExerciseLogRequest body) =>
        c.PutAsJsonAsync($"/exercise-logs/{id}", body);

    private static Task<List<ExerciseLogDto>?> History(HttpClient c, string exercise) =>
        c.GetFromJsonAsync<List<ExerciseLogDto>>($"/exercises/{exercise}/history");

    private static async Task Equip(HttpClient c, params decimal[] dumbbells) =>
        (await c.PutAsJsonAsync("/equipment", new EquipmentRequest(dumbbells, [], [], 5m, 0m))).EnsureSuccessStatusCode();

    // AC-01
    [Fact]
    public async Task AC_training_003_01_crea_el_registro_con_el_id_del_cliente()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();

        var response = await Put(client, id, Body(date: Ago(2), load: 22.5m, set1: 10, set2: 6, assisted: 4));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var saved = Assert.Single(await History(client, PressMancuernas) ?? []);
        Assert.Equal(new ExerciseLogDto(id, PressMancuernas, Ago(2), 22.5m, 10, 6, 4), saved);
    }

    [Fact]
    public async Task AC_training_003_01_sin_sesion_responde_401()
    {
        var response = await api.CreateClient().PutAsJsonAsync($"/exercise-logs/{Guid.NewGuid()}", Body());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // AC-02
    [Fact]
    public async Task AC_training_003_02_reenviar_el_mismo_registro_no_duplica()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        var body = Body();

        var first = await Put(client, id, body);
        var retry = await Put(client, id, body);

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        Assert.Single(await History(client, PressMancuernas) ?? []);
    }

    [Fact]
    public async Task AC_training_003_02_editar_reemplaza_los_datos_del_mismo_id()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        await Put(client, id, Body(load: 20m, set1: 9));

        var response = await Put(client, id, Body(load: 22.5m, set1: 12, set2: 8, assisted: 3));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var saved = Assert.Single(await History(client, PressMancuernas) ?? []);
        Assert.Equal(new ExerciseLogDto(id, PressMancuernas, Ago(1), 22.5m, 12, 8, 3), saved);
    }

    // AC-03
    [Theory]
    [InlineData(PressMancuernas, 22.5, 13, 5, 5)] // la serie 1 se detiene en 12
    [InlineData(PressMancuernas, 22.5, 0, 5, 5)] // la serie 1 necesita repeticiones
    [InlineData(PressMancuernas, 22.5, 9, 0, 5)] // la serie 2 necesita repeticiones propias
    [InlineData(PressMancuernas, 22.5, 9, 5, -1)] // asistidas negativas
    [InlineData(PressMancuernas, 0, 9, 5, 5)] // un ejercicio con carga exige carga
    [InlineData(PressMancuernas, -5, 9, 5, 5)]
    [InlineData(PressMancuernas, 22.555, 9, 5, 5)] // más de 2 decimales
    [InlineData(Fondos, -2, 9, 5, 5)] // el peso corporal no admite carga negativa
    public async Task AC_training_003_03_rechaza_registros_que_rompen_las_reglas(
        string exercise, double load, int set1, int set2, int assisted)
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await Put(client, Guid.NewGuid(), Body(exercise, load: (decimal)load, set1: set1, set2: set2, assisted: assisted));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(await History(client, exercise) ?? []);
    }

    [Fact]
    public async Task AC_training_003_03_el_peso_corporal_admite_carga_cero()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await Put(client, Guid.NewGuid(), Body(Fondos, load: 0m));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // AC-04
    [Fact]
    public async Task AC_training_003_04_un_ejercicio_fuera_del_catalogo_responde_422()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await Put(client, Guid.NewGuid(), Body("no-existe"));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // AC-05
    [Fact]
    public async Task AC_training_003_05_una_fecha_posterior_a_manana_responde_400()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await Put(client, Guid.NewGuid(), Body(date: Today.AddDays(2)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task AC_training_003_05_manana_se_acepta_por_las_zonas_horarias()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await Put(client, Guid.NewGuid(), Body(date: Today.AddDays(1)));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // AC-06
    [Fact]
    public async Task AC_training_003_06_otro_registro_del_mismo_ejercicio_y_fecha_responde_409()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Put(client, Guid.NewGuid(), Body(date: Ago(3)));

        var response = await Put(client, Guid.NewGuid(), Body(date: Ago(3), load: 25m));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(22.5m, Assert.Single(await History(client, PressMancuernas) ?? []).LoadKg);
    }

    [Fact]
    public async Task AC_training_003_06_editar_la_fecha_hacia_un_dia_ocupado_responde_409()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        await Put(client, first, Body(date: Ago(10)));
        await Put(client, second, Body(date: Ago(9)));

        var response = await Put(client, second, Body(date: Ago(10)));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var dates = (await History(client, PressMancuernas) ?? []).Select(l => l.Date);
        Assert.Equal([Ago(10), Ago(9)], dates);
    }

    [Fact]
    public async Task AC_training_003_06_el_mismo_dia_en_ejercicios_distintos_es_valido()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Put(client, Guid.NewGuid(), Body(PressMancuernas, Ago(1)));

        var response = await Put(client, Guid.NewGuid(), Body(PressBarra, Ago(1), load: 60m));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // AC-07
    [Fact]
    public async Task AC_training_003_07_borrar_quita_el_registro_y_repetirlo_tambien_responde_204()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        await Put(client, id, Body());

        var first = await client.DeleteAsync($"/exercise-logs/{id}");
        var again = await client.DeleteAsync($"/exercise-logs/{id}");
        var unknown = await client.DeleteAsync($"/exercise-logs/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, unknown.StatusCode);
        Assert.Empty(await History(client, PressMancuernas) ?? []);
    }

    [Fact]
    public async Task AC_training_003_07_tras_borrar_se_puede_registrar_de_nuevo_ese_dia()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        await Put(client, id, Body(date: Ago(4)));
        await client.DeleteAsync($"/exercise-logs/{id}");

        var response = await Put(client, Guid.NewGuid(), Body(date: Ago(4)));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // AC-08
    [Fact]
    public async Task AC_training_003_08_el_historial_va_de_la_fecha_mas_antigua_a_la_mas_reciente_y_solo_del_ejercicio()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Put(client, Guid.NewGuid(), Body(date: Ago(1)));
        await Put(client, Guid.NewGuid(), Body(date: Ago(15)));
        await Put(client, Guid.NewGuid(), Body(date: Ago(8)));
        await Put(client, Guid.NewGuid(), Body(PressBarra, Ago(8), load: 60m));

        var history = await History(client, PressMancuernas);

        Assert.Equal([Ago(15), Ago(8), Ago(1)], history!.Select(l => l.Date));
        Assert.All(history, l => Assert.Equal(PressMancuernas, l.ExerciseId));
    }

    [Fact]
    public async Task AC_training_003_08_un_ejercicio_desconocido_responde_404()
    {
        var client = api.ClientFor(Guid.NewGuid());

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/exercises/no-existe/history")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/exercises/no-existe/advice")).StatusCode);
    }

    // AC-09
    [Fact]
    public async Task AC_training_003_09_propone_subir_a_la_siguiente_carga_del_equipo_de_la_persona()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Equip(client, 20m, 22.5m, 25m);
        await Put(client, Guid.NewGuid(), Body(load: 22.5m, set1: 12, set2: 8));

        var advice = await client.GetFromJsonAsync<AdviceDto>($"/exercises/{PressMancuernas}/advice");

        Assert.Equal("subir", advice!.Action);
        Assert.Equal(25m, advice.NextLoadKg);
        Assert.False(advice.MissingLoadData);
        Assert.Equal("techo", advice.FirstSetEvaluation);
    }

    [Fact]
    public async Task AC_training_003_09_mantiene_si_no_se_cumple_la_regla()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Equip(client, 20m, 22.5m, 25m);
        await Put(client, Guid.NewGuid(), Body(load: 22.5m, set1: 9, set2: 5));

        var advice = await client.GetFromJsonAsync<AdviceDto>($"/exercises/{PressMancuernas}/advice");

        Assert.Equal("mantener", advice!.Action);
        Assert.Equal(22.5m, advice.NextLoadKg);
        Assert.Equal("meta_alcanzada", advice.FirstSetEvaluation);
    }

    [Fact]
    public async Task AC_training_003_09_sin_carga_superior_mantiene_y_marca_que_falta_el_dato()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Equip(client, 20m, 22.5m);
        await Put(client, Guid.NewGuid(), Body(load: 22.5m, set1: 12, set2: 8));

        var advice = await client.GetFromJsonAsync<AdviceDto>($"/exercises/{PressMancuernas}/advice");

        Assert.Equal("mantener", advice!.Action);
        Assert.True(advice.MissingLoadData);
    }

    [Fact]
    public async Task AC_training_003_09_el_consejo_usa_el_ultimo_registro_por_fecha()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Equip(client, 20m, 22.5m, 25m);
        await Put(client, Guid.NewGuid(), Body(date: Ago(1), load: 20m, set1: 9, set2: 5));
        await Put(client, Guid.NewGuid(), Body(date: Ago(8), load: 22.5m, set1: 12, set2: 8));

        var advice = await client.GetFromJsonAsync<AdviceDto>($"/exercises/{PressMancuernas}/advice");

        Assert.Equal("mantener", advice!.Action);
        Assert.Equal(20m, advice.NextLoadKg);
    }

    [Fact]
    public async Task AC_training_003_09_el_peso_corporal_mantiene_sin_marcar_dato_faltante()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Put(client, Guid.NewGuid(), Body(Fondos, load: 0m, set1: 12, set2: 9));

        var advice = await client.GetFromJsonAsync<AdviceDto>($"/exercises/{Fondos}/advice");

        Assert.Equal("mantener", advice!.Action);
        Assert.False(advice.MissingLoadData);
    }

    [Fact]
    public async Task AC_training_003_09_sin_registros_no_hay_consejo()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.GetAsync($"/exercises/{PressMancuernas}/advice");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    // AC-10
    [Fact]
    public async Task AC_training_003_10_avisa_de_estancamiento_con_el_umbral_por_defecto()
    {
        var client = api.ClientFor(Guid.NewGuid());
        for (var i = 4; i >= 1; i--)
            await Put(client, Guid.NewGuid(), Body(date: Ago(i * 7)));

        var advice = await client.GetFromJsonAsync<AdviceDto>($"/exercises/{PressMancuernas}/advice");

        Assert.True(advice!.Stagnation.IsStagnant);
        Assert.Equal(3, advice.Stagnation.SessionsWithoutProgress);
        Assert.Equal("Llevas 3 sesiones sin mejorar en este ejercicio.", advice.Stagnation.Message);
    }

    [Fact]
    public async Task AC_training_003_10_usa_el_umbral_de_la_persona()
    {
        var client = api.ClientFor(Guid.NewGuid());
        for (var i = 3; i >= 1; i--)
            await Put(client, Guid.NewGuid(), Body(date: Ago(i * 7)));
        var before = await client.GetFromJsonAsync<AdviceDto>($"/exercises/{PressMancuernas}/advice");

        await client.PutAsJsonAsync("/training-settings", new TrainingSettingsDto(2));
        var after = await client.GetFromJsonAsync<AdviceDto>($"/exercises/{PressMancuernas}/advice");

        Assert.False(before!.Stagnation.IsStagnant);
        Assert.True(after!.Stagnation.IsStagnant);
        Assert.Equal(2, after.Stagnation.SessionsWithoutProgress);
    }

    // AC-11
    [Fact]
    public async Task AC_training_003_11_bajar_de_carga_reinicia_la_racha()
    {
        var client = api.ClientFor(Guid.NewGuid());
        for (var i = 4; i >= 2; i--)
            await Put(client, Guid.NewGuid(), Body(date: Ago(i * 7), load: 25m));
        await Put(client, Guid.NewGuid(), Body(date: Ago(7), load: 22.5m));

        var advice = await client.GetFromJsonAsync<AdviceDto>($"/exercises/{PressMancuernas}/advice");

        Assert.False(advice!.Stagnation.IsStagnant);
        Assert.Equal(0, advice.Stagnation.SessionsWithoutProgress);
    }

    // AC-12
    [Fact]
    public async Task AC_training_003_12_el_umbral_es_3_por_defecto_y_se_puede_cambiar()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var initial = await client.GetFromJsonAsync<TrainingSettingsDto>("/training-settings");
        var put = await client.PutAsJsonAsync("/training-settings", new TrainingSettingsDto(5));
        var changed = await client.GetFromJsonAsync<TrainingSettingsDto>("/training-settings");

        Assert.Equal(3, initial!.StagnationThreshold);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal(5, changed!.StagnationThreshold);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(11)]
    [InlineData(0)]
    [InlineData(-3)]
    public async Task AC_training_003_12_un_umbral_fuera_de_2_a_10_responde_400(int threshold)
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.PutAsJsonAsync("/training-settings", new TrainingSettingsDto(threshold));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(3, (await client.GetFromJsonAsync<TrainingSettingsDto>("/training-settings"))!.StagnationThreshold);
    }

    // AC-13
    [Fact]
    public async Task AC_training_003_13_otra_persona_no_ve_registros_historial_ni_consejo()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        await Equip(owner, 20m, 22.5m, 25m);
        await Put(owner, Guid.NewGuid(), Body(load: 22.5m, set1: 12, set2: 8));

        Assert.Empty(await History(other, PressMancuernas) ?? []);
        Assert.Equal(HttpStatusCode.NoContent, (await other.GetAsync($"/exercises/{PressMancuernas}/advice")).StatusCode);
    }

    [Fact]
    public async Task AC_training_003_13_editar_un_id_ajeno_responde_404_y_no_cambia_nada()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var intruder = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        await Put(owner, id, Body(load: 22.5m));

        var response = await Put(intruder, id, Body(load: 99m));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(22.5m, Assert.Single(await History(owner, PressMancuernas) ?? []).LoadKg);
        Assert.Empty(await History(intruder, PressMancuernas) ?? []);
    }

    [Fact]
    public async Task AC_training_003_13_borrar_un_id_ajeno_responde_204_sin_efecto()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var intruder = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        await Put(owner, id, Body());

        var response = await intruder.DeleteAsync($"/exercise-logs/{id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Single(await History(owner, PressMancuernas) ?? []);
    }

    [Fact]
    public async Task AC_training_003_13_el_umbral_de_una_persona_no_afecta_a_otra()
    {
        var one = api.ClientFor(Guid.NewGuid());
        var two = api.ClientFor(Guid.NewGuid());

        await one.PutAsJsonAsync("/training-settings", new TrainingSettingsDto(7));

        Assert.Equal(3, (await two.GetFromJsonAsync<TrainingSettingsDto>("/training-settings"))!.StagnationThreshold);
    }

    // AC-14
    [Fact]
    public async Task AC_training_003_14_dos_personas_pueden_registrar_el_mismo_ejercicio_el_mismo_dia()
    {
        var one = api.ClientFor(Guid.NewGuid());
        var two = api.ClientFor(Guid.NewGuid());

        var first = await Put(one, Guid.NewGuid(), Body(date: Ago(5), load: 22.5m));
        var second = await Put(two, Guid.NewGuid(), Body(date: Ago(5), load: 30m));

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);
        Assert.Equal(22.5m, Assert.Single(await History(one, PressMancuernas) ?? []).LoadKg);
        Assert.Equal(30m, Assert.Single(await History(two, PressMancuernas) ?? []).LoadKg);
    }

    [Fact]
    public async Task AC_training_003_14_el_consejo_de_cada_persona_usa_su_propio_equipamiento()
    {
        var withEquipment = api.ClientFor(Guid.NewGuid());
        var without = api.ClientFor(Guid.NewGuid());
        await Equip(withEquipment, 20m, 22.5m, 25m);
        await Put(withEquipment, Guid.NewGuid(), Body(load: 22.5m, set1: 12, set2: 8));
        await Put(without, Guid.NewGuid(), Body(load: 22.5m, set1: 12, set2: 8));

        var a = await withEquipment.GetFromJsonAsync<AdviceDto>($"/exercises/{PressMancuernas}/advice");
        var b = await without.GetFromJsonAsync<AdviceDto>($"/exercises/{PressMancuernas}/advice");

        Assert.Equal("subir", a!.Action);
        Assert.Equal("mantener", b!.Action);
        Assert.True(b.MissingLoadData);
    }
}
