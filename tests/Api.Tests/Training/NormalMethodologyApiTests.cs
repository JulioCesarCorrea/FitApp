using System.Net;
using System.Net.Http.Json;
using FitnessApp.Api.Features.Profile;
using FitnessApp.Api.Features.Training.Equipment;
using FitnessApp.Api.Features.Training.Sessions;

namespace FitnessApp.Api.Tests.Training;

/// <summary>Verifica SPEC-training-004 (metodología «normal» 4×15) contra la API y Postgres reales.</summary>
[Collection("api")]
public sealed class NormalMethodologyApiTests(ApiFixture api)
{
    private const string Normal = "normal_4x15";
    private const string HeavyDuty = "heavy_duty_personalizado";
    private const string PressMancuernas = "press-plano-con-mancuernas";
    private const string Fondos = "fondos-en-paralelas-para-pecho";

    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static DateOnly Ago(int days) => Today.AddDays(-days);

    private static ExerciseLogRequest Body4x15(
        string exercise = PressMancuernas, DateOnly? date = null, decimal load = 22.5m, int[]? reps = null) =>
        new(exercise, date ?? Ago(1), load, Methodology: Normal, RepsPerSet: reps ?? [15, 14, 13, 12]);

    private static ExerciseLogRequest BodyHeavyDuty(DateOnly? date = null, decimal load = 22.5m) =>
        new(PressMancuernas, date ?? Ago(1), load, 9, 5, 5);

    private static Task<HttpResponseMessage> Put(HttpClient c, Guid id, ExerciseLogRequest body) =>
        c.PutAsJsonAsync($"/exercise-logs/{id}", body);

    private static async Task Equip(HttpClient c, params decimal[] dumbbells) =>
        (await c.PutAsJsonAsync("/equipment", new EquipmentRequest(dumbbells, [], [], 5m, 0m))).EnsureSuccessStatusCode();

    private static Task<AdviceDto?> Advice(HttpClient c, string exercise = PressMancuernas) =>
        c.GetFromJsonAsync<AdviceDto>($"/exercises/{exercise}/advice");

    private static async Task<List<ExerciseLogDto>> History(HttpClient c, string exercise = PressMancuernas) =>
        (await c.GetFromJsonAsync<List<ExerciseLogDto>>($"/exercises/{exercise}/history"))!;

    // AC-01
    [Fact]
    public async Task AC_training_004_01_el_perfil_acepta_normal_4x15_y_rechaza_valores_desconocidos()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var valid = new ProfileRequest("Julio", "masculino", new DateOnly(1995, 5, 20), 178, "mantener", null, null, null, Normal, null);

        var saved = await client.PutAsJsonAsync("/profile", valid);
        var invalid = await client.PutAsJsonAsync("/profile", valid with { Methodology = "otra" });

        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);
        Assert.Equal(Normal, (await client.GetFromJsonAsync<ProfileDto>("/profile"))!.Methodology);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    // AC-02
    [Fact]
    public async Task AC_training_004_02_guarda_el_registro_4x15_y_reenviarlo_no_duplica()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        var body = Body4x15(date: Ago(2), reps: [15, 15, 14, 12]);

        var first = await Put(client, id, body);
        var again = await Put(client, id, body);
        var changed = await Put(client, id, body with { RepsPerSet = [15, 15, 15, 15] });

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var saved = Assert.Single(await History(client));
        Assert.Equal(Normal, saved.Methodology);
        Assert.Equal([15, 15, 15, 15], saved.RepsPerSet!);
        Assert.Equal(Ago(2), saved.Date);
    }

    [Fact]
    public async Task AC_training_004_02_aplica_las_reglas_de_fecha_catalogo_y_unicidad_de_heavy_duty()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Put(client, Guid.NewGuid(), Body4x15(date: Ago(1)));

        var sameDay = await Put(client, Guid.NewGuid(), Body4x15(date: Ago(1)));
        var future = await Put(client, Guid.NewGuid(), Body4x15(date: Today.AddDays(5)));
        var unknown = await Put(client, Guid.NewGuid(), Body4x15(exercise: "no-existe"));

        Assert.Equal(HttpStatusCode.Conflict, sameDay.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, unknown.StatusCode);
    }

    // AC-03
    [Theory]
    [InlineData(new[] { 15, 15, 15 })] // faltan series
    [InlineData(new[] { 15, 15, 15, 15, 15 })] // sobran series
    [InlineData(new[] { 16, 15, 15, 15 })] // la serie 1 pasa de 15
    [InlineData(new[] { 15, 0, 15, 15 })] // una serie intermedia sin repeticiones
    [InlineData(new[] { 15, 15, 15, 0 })] // la serie 4 sin repeticiones
    [InlineData(new[] { 15, 15, 15, 51 })] // la serie 4 pasa del tope
    public async Task AC_training_004_03_un_registro_4x15_que_rompe_las_reglas_responde_400_y_no_guarda(int[] reps)
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await Put(client, Guid.NewGuid(), Body4x15(reps: reps));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(await History(client));
    }

    [Fact]
    public async Task AC_training_004_03_mezclar_campos_de_heavy_duty_con_4x15_o_pedir_carga_invalida_responde_400()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var mixed = await Put(client, Guid.NewGuid(), Body4x15() with { FirstSetReps = 9 });
        var noReps = await Put(client, Guid.NewGuid(), Body4x15() with { RepsPerSet = null });
        var zeroLoad = await Put(client, Guid.NewGuid(), Body4x15(load: 0m));
        var decimals = await Put(client, Guid.NewGuid(), Body4x15(load: 22.555m));
        var heavyWithReps = await Put(client, Guid.NewGuid(), BodyHeavyDuty() with { RepsPerSet = [15, 15, 15, 15] });
        var unknownMethod = await Put(client, Guid.NewGuid(), Body4x15() with { Methodology = "otra" });

        foreach (var response in new[] { mixed, noReps, zeroLoad, decimals, heavyWithReps, unknownMethod })
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(await History(client));
    }

    [Fact]
    public async Task AC_training_004_03_el_peso_corporal_admite_carga_cero_en_4x15()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await Put(client, Guid.NewGuid(), Body4x15(exercise: Fondos, load: 0m));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // AC-04
    [Fact]
    public async Task AC_training_004_04_un_registro_sin_metodologia_es_de_heavy_duty_y_conserva_su_contrato()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var request = new ExerciseLogRequest(PressMancuernas, Ago(1), 22.5m, 10, 6, 4);

        var response = await Put(client, Guid.NewGuid(), request);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var saved = Assert.Single(await History(client));
        Assert.Equal(HeavyDuty, saved.Methodology);
        Assert.Null(saved.RepsPerSet);
        Assert.Equal((10, 6, 4), (saved.FirstSetReps, saved.SecondSetReps, saved.SecondSetAssistedReps));
    }

    // AC-05
    [Fact]
    public async Task AC_training_004_05_con_las_cuatro_series_en_15_sube_a_la_siguiente_carga()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Equip(client, 20m, 22.5m, 25m);
        await Put(client, Guid.NewGuid(), Body4x15(load: 22.5m, reps: [15, 15, 15, 18]));

        var advice = (await Advice(client))!;

        Assert.Equal("subir", advice.Action);
        Assert.Equal(25m, advice.NextLoadKg);
        Assert.False(advice.MissingLoadData);
    }

    [Fact]
    public async Task AC_training_004_05_si_una_serie_no_llega_a_15_mantiene_y_sin_carga_superior_avisa()
    {
        var keep = api.ClientFor(Guid.NewGuid());
        await Equip(keep, 20m, 22.5m, 25m);
        await Put(keep, Guid.NewGuid(), Body4x15(load: 22.5m, reps: [15, 15, 15, 14]));
        var top = api.ClientFor(Guid.NewGuid());
        await Equip(top, 20m, 22.5m);
        await Put(top, Guid.NewGuid(), Body4x15(load: 22.5m, reps: [15, 15, 15, 15]));

        var kept = (await Advice(keep))!;
        var atTop = (await Advice(top))!;

        Assert.Equal("mantener", kept.Action);
        Assert.Equal(22.5m, kept.NextLoadKg);
        Assert.Equal("mantener", atTop.Action);
        Assert.True(atTop.MissingLoadData);
    }

    [Fact]
    public async Task AC_training_004_05_el_peso_corporal_siempre_mantiene()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Put(client, Guid.NewGuid(), Body4x15(exercise: Fondos, load: 0m, reps: [15, 15, 15, 15]));

        var advice = (await Advice(client, Fondos))!;

        Assert.Equal("mantener", advice.Action);
        Assert.False(advice.MissingLoadData);
    }

    // AC-06
    [Theory]
    [InlineData(10, "por_debajo")]
    [InlineData(12, "en_banda")]
    [InlineData(14, "en_banda")]
    [InlineData(15, "techo")]
    public async Task AC_training_004_06_evalua_la_serie_1_segun_el_rango_12_15(int first, string expected)
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Put(client, Guid.NewGuid(), Body4x15(reps: [first, 10, 10, 10]));

        var advice = (await Advice(client))!;

        Assert.Equal(expected, advice.FirstSetEvaluation);
    }

    // AC-07
    [Fact]
    public async Task AC_training_004_07_tres_sesiones_sin_progreso_avisan_del_estancamiento_y_bajar_de_carga_reinicia()
    {
        var client = api.ClientFor(Guid.NewGuid());
        for (var i = 0; i < 4; i++)
            await Put(client, Guid.NewGuid(), Body4x15(date: Ago(40 - i * 7), load: 40m, reps: [12, 12, 12, 10]));

        var stagnant = (await Advice(client))!;
        await Put(client, Guid.NewGuid(), Body4x15(date: Ago(1), load: 35m, reps: [12, 12, 12, 10]));
        var reset = (await Advice(client))!;

        Assert.True(stagnant.Stagnation.IsStagnant);
        Assert.Equal(3, stagnant.Stagnation.SessionsWithoutProgress);
        Assert.False(reset.Stagnation.IsStagnant);
        Assert.Equal(0, reset.Stagnation.SessionsWithoutProgress);
    }

    [Fact]
    public async Task AC_training_004_07_sumar_repeticiones_con_la_misma_carga_es_progreso_y_respeta_el_umbral_de_la_persona()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await client.PutAsJsonAsync("/training-settings", new TrainingSettingsDto(2));
        await Put(client, Guid.NewGuid(), Body4x15(date: Ago(21), load: 40m, reps: [12, 12, 12, 10]));
        await Put(client, Guid.NewGuid(), Body4x15(date: Ago(14), load: 40m, reps: [12, 12, 12, 10]));
        await Put(client, Guid.NewGuid(), Body4x15(date: Ago(7), load: 40m, reps: [12, 12, 12, 10]));

        Assert.True((await Advice(client))!.Stagnation.IsStagnant);

        await Put(client, Guid.NewGuid(), Body4x15(date: Ago(1), load: 40m, reps: [12, 12, 12, 11]));
        Assert.False((await Advice(client))!.Stagnation.IsStagnant);
    }

    // AC-08
    [Fact]
    public async Task AC_training_004_08_el_consejo_sale_del_ultimo_registro_y_el_historial_trae_la_metodologia_de_cada_uno()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Equip(client, 20m, 22.5m, 25m);
        for (var i = 0; i < 4; i++)
            await Put(client, Guid.NewGuid(), BodyHeavyDuty(date: Ago(60 - i * 7)));
        await Put(client, Guid.NewGuid(), Body4x15(date: Ago(1), load: 22.5m, reps: [15, 15, 15, 15]));

        var advice = (await Advice(client))!;
        var history = await History(client);

        // Las 4 sesiones de Heavy Duty estancadas no cuentan para el 4×15, que solo tiene una sesión.
        Assert.Equal("subir", advice.Action);
        Assert.False(advice.Stagnation.IsStagnant);
        Assert.Equal(5, history.Count);
        Assert.Equal([HeavyDuty, HeavyDuty, HeavyDuty, HeavyDuty, Normal], history.Select(h => h.Methodology));
        Assert.True(history.Select(h => h.Date).SequenceEqual(history.Select(h => h.Date).Order()));
    }

    [Fact]
    public async Task AC_training_004_08_si_el_ultimo_registro_es_de_heavy_duty_se_usan_sus_reglas()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Equip(client, 20m, 22.5m, 25m);
        await Put(client, Guid.NewGuid(), Body4x15(date: Ago(10), load: 22.5m, reps: [15, 15, 15, 15]));
        await Put(client, Guid.NewGuid(), new ExerciseLogRequest(PressMancuernas, Ago(1), 22.5m, 9, 5, 5));

        var advice = (await Advice(client))!;

        Assert.Equal("mantener", advice.Action);
        Assert.Equal("meta_alcanzada", advice.FirstSetEvaluation);
    }

    // AC-09 (P7)
    [Fact]
    public async Task AC_training_004_09_otra_persona_no_ve_ni_cambia_los_registros_4x15()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();
        await Put(owner, id, Body4x15());

        var edit = await Put(other, id, Body4x15(reps: [10, 10, 10, 10]));
        await other.DeleteAsync($"/exercise-logs/{id}");

        Assert.Equal(HttpStatusCode.NotFound, edit.StatusCode);
        Assert.Empty(await History(other));
        Assert.Equal(HttpStatusCode.NoContent, (await other.GetAsync($"/exercises/{PressMancuernas}/advice")).StatusCode);
        var kept = Assert.Single(await History(owner));
        Assert.Equal([15, 14, 13, 12], kept.RepsPerSet!);
    }
}
