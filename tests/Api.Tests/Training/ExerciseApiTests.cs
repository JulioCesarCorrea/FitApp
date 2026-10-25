using System.Net;
using System.Net.Http.Json;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Features.Training.Catalog;
using FitnessApp.Api.Features.Training.Equipment;
using FitnessApp.Api.Features.Training.Plan;

namespace FitnessApp.Api.Tests.Training;

/// <summary>Verifica SPEC-training-002 contra la API y Postgres reales. Cada test cita su criterio de aceptación.</summary>
[Collection("api")]
public sealed class ExerciseApiTests(ApiFixture api)
{
    private const string PressPlano = "press-plano-con-barra";
    private const string Crunch = "crunch-en-suelo";
    private const string ElevacionLateral = "elevaciones-laterales-con-mancuernas";

    private static SavePlanDayRequest Day(bool confirm = false, params (Guid Id, string Exercise, int Order)[] entries) =>
        new(entries.Select(e => new PlanEntryRequest(e.Id, e.Exercise, e.Order, null)).ToList(), confirm);

    private static (Guid, string, int) Entry(string exercise, int order = 0) => (Guid.NewGuid(), exercise, order);

    // AC-01
    [Fact]
    public async Task AC_training_002_01_el_catalogo_llega_agrupado_en_secciones_con_sus_imagenes()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var catalog = await client.GetFromJsonAsync<CatalogDto>("/exercises");

        Assert.Equal(10, catalog!.Sections.Count);
        Assert.Equal("Pecho", catalog.Sections[0].Name);
        Assert.Equal(13, catalog.Sections[0].Exercises.Count);
        var press = catalog.Sections[0].Exercises.Single(e => e.Id == PressPlano);
        Assert.Equal(["/exercise-images/press-plano-con-barra-0.jpg", "/exercise-images/press-plano-con-barra-1.jpg"], press.Images);
        Assert.Equal(103, catalog.Sections.Sum(s => s.Exercises.Count));
    }

    [Fact]
    public async Task AC_training_002_01_sin_sesion_responde_401()
    {
        var response = await api.CreateClient().GetAsync("/exercises");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // AC-02
    [Fact]
    public async Task AC_training_002_02_sirve_la_imagen_del_ejercicio()
    {
        var response = await api.CreateClient().GetAsync($"/exercise-images/{PressPlano}-0.jpg");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/jpeg", response.Content.Headers.ContentType!.MediaType);
    }

    [Theory]
    [InlineData("/exercise-images/no-existe-0.jpg")]
    [InlineData("/exercise-images/..%2Fappsettings.json")]
    [InlineData("/exercise-images/Press-Plano-0.jpg")]
    public async Task AC_training_002_02_no_sirve_archivos_que_no_son_del_catalogo(string url)
    {
        var response = await api.CreateClient().GetAsync(url);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // AC-03
    [Fact]
    public async Task AC_training_002_03_asigna_ejercicios_a_un_dia_y_el_mismo_ejercicio_puede_estar_en_varios_dias()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var martes = await client.PutAsJsonAsync("/plan/days/martes", Day(false, Entry(PressPlano, 0), Entry(Crunch, 1)));
        var jueves = await client.PutAsJsonAsync("/plan/days/jueves", Day(false, Entry(PressPlano, 0)));

        Assert.Equal(HttpStatusCode.OK, martes.StatusCode);
        Assert.Equal(HttpStatusCode.OK, jueves.StatusCode);
        var plan = await client.GetFromJsonAsync<PlanDto>("/plan");
        Assert.Equal(["martes", "jueves"], plan!.Days.Select(d => d.Day));
        Assert.Equal([PressPlano, Crunch], plan.Days[0].Entries.Select(e => e.ExerciseId));
        Assert.Equal([PressPlano], plan.Days[1].Entries.Select(e => e.ExerciseId));
    }

    [Theory]
    [InlineData("miércoles")]
    [InlineData("Sábado")]
    public async Task AC_training_002_03_acepta_los_dias_con_acento_y_mayusculas(string day)
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.PutAsJsonAsync($"/plan/days/{Uri.EscapeDataString(day)}", Day(false, Entry(PressPlano)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task AC_training_002_03_rechaza_un_ejercicio_que_no_esta_en_el_catalogo_y_un_dia_invalido()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var unknown = await client.PutAsJsonAsync("/plan/days/martes", Day(false, Entry("ejercicio-inventado")));
        var badDay = await client.PutAsJsonAsync("/plan/days/someday", Day(false, Entry(PressPlano)));

        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, badDay.StatusCode);
    }

    // AC-10
    [Fact]
    public async Task AC_training_002_10_rechaza_el_mismo_ejercicio_dos_veces_en_el_mismo_dia()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.PutAsJsonAsync("/plan/days/martes", Day(false, Entry(PressPlano, 0), Entry(PressPlano, 1)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("una vez por día", await response.Content.ReadAsStringAsync());
        Assert.Empty((await client.GetFromJsonAsync<PlanDto>("/plan"))!.Days);
    }

    [Fact]
    public async Task AC_training_002_10_el_mismo_ejercicio_si_puede_estar_en_dias_distintos()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var martes = await client.PutAsJsonAsync("/plan/days/martes", Day(false, Entry(PressPlano)));
        var jueves = await client.PutAsJsonAsync("/plan/days/jueves", Day(false, Entry(PressPlano)));

        Assert.Equal(HttpStatusCode.OK, martes.StatusCode);
        Assert.Equal(HttpStatusCode.OK, jueves.StatusCode);
    }

    // AC-04
    private static EquipmentRequest Equipment(decimal step = 5m, decimal[]? dumbbells = null) =>
        new(dumbbells ?? [20m, 22.5m, 25m], new Dictionary<string, decimal> { ["recta"] = 20m, ["z"] = 8m }, [2.5m, 5m], step, 0m);

    [Fact]
    public async Task AC_training_002_04_guarda_y_devuelve_el_perfil_de_equipamiento()
    {
        var client = api.ClientFor(Guid.NewGuid());
        Assert.False((await client.GetFromJsonAsync<EquipmentDto>("/equipment"))!.Configured);

        var put = await client.PutAsJsonAsync("/equipment", Equipment());
        var profile = await client.GetFromJsonAsync<EquipmentDto>("/equipment");

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.True(profile!.Configured);
        Assert.Equal([20m, 22.5m, 25m], profile.DumbbellsKg);
        Assert.Equal(20m, profile.BarsKg["recta"]);
        Assert.Equal([2.5m, 5m], profile.DiscsKg);
        Assert.Equal(5m, profile.MachineStepKg);
    }

    [Fact]
    public async Task AC_training_002_04_volver_a_guardar_reemplaza_el_perfil()
    {
        var client = api.ClientFor(Guid.NewGuid());

        await client.PutAsJsonAsync("/equipment", Equipment());
        await client.PutAsJsonAsync("/equipment", Equipment(step: 2.5m, dumbbells: [10m]));
        var profile = await client.GetFromJsonAsync<EquipmentDto>("/equipment");

        Assert.Equal([10m], profile!.DumbbellsKg);
        Assert.Equal(2.5m, profile.MachineStepKg);
    }

    [Fact]
    public async Task AC_training_002_04_rechaza_valores_menores_o_iguales_a_cero()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var step = await client.PutAsJsonAsync("/equipment", Equipment(step: 0m));
        var dumbbell = await client.PutAsJsonAsync("/equipment", Equipment(dumbbells: [20m, -5m]));

        Assert.Equal(HttpStatusCode.BadRequest, step.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, dumbbell.StatusCode);
    }

    [Fact]
    public async Task AC_training_002_04_el_escalon_propio_de_una_maquina_debe_ser_mayor_que_cero()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var request = new SavePlanDayRequest([new PlanEntryRequest(Guid.NewGuid(), "prensa-de-piernas-45", 0, 0m)]);

        var response = await client.PutAsJsonAsync("/plan/days/martes", request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // AC-05
    [Fact]
    public async Task AC_training_002_05_nivel_bloqueo_impide_asignar_el_ejercicio()
    {
        var userId = Guid.NewGuid();
        await api.AddRestrictionAsync(userId, "abdomen", RestrictionLevel.Bloqueo);
        var client = api.ClientFor(userId);

        var response = await client.PutAsJsonAsync("/plan/days/martes", Day(true, Entry(Crunch)));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<PlanDto>("/plan"))!.Days);
    }

    [Fact]
    public async Task AC_training_002_05_nivel_aviso_pide_confirmar_y_con_confirmacion_guarda()
    {
        var userId = Guid.NewGuid();
        await api.AddRestrictionAsync(userId, "hombros", RestrictionLevel.Aviso);
        var client = api.ClientFor(userId);
        var entry = Entry(ElevacionLateral);

        var sinConfirmar = await client.PutAsJsonAsync("/plan/days/miercoles", Day(false, entry));
        var confirmado = await client.PutAsJsonAsync("/plan/days/miercoles", Day(true, entry));

        Assert.Equal(HttpStatusCode.Conflict, sinConfirmar.StatusCode);
        Assert.Equal(HttpStatusCode.OK, confirmado.StatusCode);
    }

    [Fact]
    public async Task AC_training_002_05_un_aviso_ya_confirmado_no_se_vuelve_a_pedir()
    {
        var userId = Guid.NewGuid();
        await api.AddRestrictionAsync(userId, "hombros", RestrictionLevel.Aviso);
        var client = api.ClientFor(userId);
        var entry = Entry(ElevacionLateral);

        await client.PutAsJsonAsync("/plan/days/miercoles", Day(true, entry));
        var otraVez = await client.PutAsJsonAsync("/plan/days/miercoles", Day(false, entry));

        Assert.Equal(HttpStatusCode.OK, otraVez.StatusCode);
    }

    [Fact]
    public async Task AC_training_002_05_nivel_contexto_asigna_sin_interrumpir()
    {
        var userId = Guid.NewGuid();
        await api.AddRestrictionAsync(userId, "abdomen", RestrictionLevel.Contexto);
        var client = api.ClientFor(userId);

        var response = await client.PutAsJsonAsync("/plan/days/martes", Day(false, Entry(Crunch)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task AC_training_002_05_una_restriccion_de_otra_persona_no_afecta()
    {
        await api.AddRestrictionAsync(Guid.NewGuid(), "abdomen", RestrictionLevel.Bloqueo);
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.PutAsJsonAsync("/plan/days/martes", Day(false, Entry(Crunch)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // AC-06
    [Fact]
    public async Task AC_training_002_06_cada_persona_ve_solo_su_rutina()
    {
        var ana = api.ClientFor(Guid.NewGuid());
        var beto = api.ClientFor(Guid.NewGuid());

        await ana.PutAsJsonAsync("/plan/days/martes", Day(false, Entry(PressPlano)));

        Assert.Empty((await beto.GetFromJsonAsync<PlanDto>("/plan"))!.Days);
        Assert.Single((await ana.GetFromJsonAsync<PlanDto>("/plan"))!.Days);
    }

    [Fact]
    public async Task AC_training_002_06_el_id_de_una_entrada_de_otra_persona_responde_409_sin_revelar()
    {
        var ana = api.ClientFor(Guid.NewGuid());
        var beto = api.ClientFor(Guid.NewGuid());
        var entry = Entry(PressPlano);
        await ana.PutAsJsonAsync("/plan/days/martes", Day(false, entry));

        var response = await beto.PutAsJsonAsync("/plan/days/martes", Day(false, entry));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Single((await ana.GetFromJsonAsync<PlanDto>("/plan"))!.Days.Single().Entries);
    }

    // AC-07
    [Fact]
    public async Task AC_training_002_07_quitar_un_ejercicio_del_dia_lo_saca_de_la_rutina()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var press = Entry(PressPlano, 0);
        var crunch = Entry(Crunch, 1);
        await client.PutAsJsonAsync("/plan/days/martes", Day(false, press, crunch));

        await client.PutAsJsonAsync("/plan/days/martes", Day(false, press));

        var entries = (await client.GetFromJsonAsync<PlanDto>("/plan"))!.Days.Single().Entries;
        Assert.Equal([press.Item1], entries.Select(e => e.Id));
    }

    [Fact]
    public async Task AC_training_002_07_dejar_un_dia_vacio_lo_quita_del_plan()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await client.PutAsJsonAsync("/plan/days/martes", Day(false, Entry(PressPlano)));

        await client.PutAsJsonAsync("/plan/days/martes", Day());

        Assert.Empty((await client.GetFromJsonAsync<PlanDto>("/plan"))!.Days);
    }

    // AC-08
    [Fact]
    public async Task AC_training_002_08_reintentar_con_los_mismos_ids_no_duplica()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var body = Day(false, Entry(PressPlano, 0), Entry(Crunch, 1));

        var first = await client.PutAsJsonAsync("/plan/days/martes", body);
        var retry = await client.PutAsJsonAsync("/plan/days/martes", body);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        Assert.Equal(2, (await client.GetFromJsonAsync<PlanDto>("/plan"))!.Days.Single().Entries.Count);
    }

    [Fact]
    public async Task AC_training_002_08_cambiar_el_orden_actualiza_la_misma_entrada()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var press = Entry(PressPlano, 0);
        var crunch = Entry(Crunch, 1);
        await client.PutAsJsonAsync("/plan/days/martes", Day(false, press, crunch));

        await client.PutAsJsonAsync("/plan/days/martes", Day(false, (press.Item1, PressPlano, 1), (crunch.Item1, Crunch, 0)));

        var entries = (await client.GetFromJsonAsync<PlanDto>("/plan"))!.Days.Single().Entries;
        Assert.Equal([Crunch, PressPlano], entries.Select(e => e.ExerciseId));
    }
}
