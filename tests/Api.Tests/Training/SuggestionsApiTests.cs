using System.Net;
using System.Net.Http.Json;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Features.Training.Plan;
using FitnessApp.Api.Features.Training.Sessions;
using FitnessApp.Api.Features.Training.Suggestions;
using FitnessApp.Api.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace FitnessApp.Api.Tests.Training;

/// <summary>Verifica SPEC-training-005 (sugerencias de rutina y corrección del método) contra la API y Postgres reales.</summary>
[Collection("api")]
public sealed class SuggestionsApiTests(ApiFixture api)
{
    private const string PressMancuernas = "press-plano-con-mancuernas";
    private const string PressBarra = "press-plano-con-barra";
    private const string PressMaquina = "press-de-pecho-en-maquina";

    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static DateOnly Ago(int days) => Today.AddDays(-days);

    private static Task<HttpResponseMessage> PutDay(HttpClient c, string day, params string[] exercises) =>
        c.PutAsJsonAsync($"/plan/days/{day}", new SavePlanDayRequest(
            exercises.Select((e, i) => new PlanEntryRequest(Guid.NewGuid(), e, i, null)).ToList(), ConfirmWarnings: true));

    private static async Task Log(HttpClient c, string exercise, DateOnly date, decimal load = 22.5m, int first = 9, int second = 5, int assisted = 5) =>
        (await c.PutAsJsonAsync($"/exercise-logs/{Guid.NewGuid()}", new ExerciseLogRequest(exercise, date, load, first, second, assisted)))
            .EnsureSuccessStatusCode();

    private static async Task Log4x15(HttpClient c, string exercise, DateOnly date, params int[] reps) =>
        (await c.PutAsJsonAsync($"/exercise-logs/{Guid.NewGuid()}",
            new ExerciseLogRequest(exercise, date, 22.5m, Methodology: "normal_4x15", RepsPerSet: reps))).EnsureSuccessStatusCode();

    /// <summary>Cuatro sesiones idénticas, una por semana, la última hace un día: estancamiento con el umbral por defecto (3).</summary>
    private static async Task Stagnate(HttpClient c, string exercise = PressMancuernas, int lastAgo = 1)
    {
        for (var i = 0; i < 4; i++) await Log(c, exercise, Ago(lastAgo + 7 * (3 - i)));
    }

    private static Task<List<SuggestionDto>> List(HttpClient c) =>
        c.GetFromJsonAsync<List<SuggestionDto>>("/suggestions")!;

    private static async Task<List<SuggestionDto>> Of(HttpClient c, string kind) =>
        (await List(c)).Where(s => s.Kind == kind).ToList();

    private async Task InDb(Func<AppDbContext, Task> action)
    {
        using var scope = api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await action(db);
        await db.SaveChangesAsync();
    }

    // AC-01
    [Fact]
    public async Task AC_training_005_01_sin_datos_la_lista_llega_vacia_y_sin_sesion_responde_401()
    {
        var client = api.ClientFor(Guid.NewGuid());

        Assert.Empty(await List(client));
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.CreateClient().GetAsync("/suggestions")).StatusCode);
    }

    // AC-02
    [Fact]
    public async Task AC_training_005_02_un_ejercicio_estancado_del_plan_trae_hasta_3_alternativas()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await PutDay(client, "martes", PressMancuernas);
        await Stagnate(client);

        var stagnant = Assert.Single(await Of(client, "ejercicio-estancado"));

        Assert.Equal(PressMancuernas, stagnant.ExerciseId);
        Assert.Equal("martes", stagnant.Day);
        Assert.Contains("3 sesiones sin mejorar", stagnant.Message);
        Assert.InRange(stagnant.Alternatives!.Count, 1, 3);
        Assert.StartsWith("ejercicio-estancado:", stagnant.Key);
    }

    [Fact]
    public async Task AC_training_005_02_si_el_ejercicio_no_esta_en_el_plan_o_progresa_no_hay_sugerencia()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Stagnate(client); // sin plan
        var other = api.ClientFor(Guid.NewGuid());
        await PutDay(other, "martes", PressMancuernas);
        await Log(other, PressMancuernas, Ago(15), first: 8);
        await Log(other, PressMancuernas, Ago(8), first: 9);
        await Log(other, PressMancuernas, Ago(1), first: 10); // mejora cada vez

        Assert.Empty(await Of(client, "ejercicio-estancado"));
        Assert.Empty(await Of(other, "ejercicio-estancado"));
    }

    // AC-03
    [Fact]
    public async Task AC_training_005_03_las_alternativas_son_de_la_misma_zona_sin_repetir_el_dia_ni_chocar_con_restricciones_y_van_ordenadas()
    {
        var userId = Guid.NewGuid();
        var client = api.ClientFor(userId);
        await PutDay(client, "martes", PressMancuernas, "press-inclinado-con-mancuernas");
        await api.AddRestrictionAsync(userId, "espalda", RestrictionLevel.Aviso, "carga_con_barra_libre"); // movimiento de las barras libres
        await Stagnate(client);

        var alternatives = (await Of(client, "ejercicio-estancado")).Single().Alternatives!;
        var ids = alternatives.Select(a => a.ExerciseId).ToList();

        Assert.DoesNotContain(PressMancuernas, ids);
        Assert.DoesNotContain("press-inclinado-con-mancuernas", ids); // ya está ese día
        Assert.DoesNotContain(PressBarra, ids); // choca con la restricción de nivel aviso
        Assert.Equal(PressMaquina, ids[0]); // comparte empuje_horizontal y es de otro equipo
        Assert.True(ids.Count <= 3);
    }

    // AC-04
    [Fact]
    public async Task AC_training_005_04_heavy_duty_serie_1_por_debajo_de_6_en_las_dos_ultimas_sesiones()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Log(client, PressMancuernas, Ago(8), first: 5);
        await Log(client, PressMancuernas, Ago(1), first: 4);

        var suggestion = Assert.Single(await Of(client, "metodo"));

        Assert.Equal(PressMancuernas, suggestion.ExerciseId);
        Assert.Contains("serie 1 quedó por debajo de 6", suggestion.Message);
    }

    [Fact]
    public async Task AC_training_005_04_heavy_duty_sin_asistidas_o_en_el_techo_sin_subir_la_carga()
    {
        var noAssisted = api.ClientFor(Guid.NewGuid());
        await Log(noAssisted, PressMancuernas, Ago(8), assisted: 0);
        await Log(noAssisted, PressMancuernas, Ago(1), assisted: 0);
        var ceiling = api.ClientFor(Guid.NewGuid());
        await Log(ceiling, PressMancuernas, Ago(8), first: 12, second: 8);
        await Log(ceiling, PressMancuernas, Ago(1), first: 12, second: 9);
        var healthy = api.ClientFor(Guid.NewGuid());
        await Log(healthy, PressMancuernas, Ago(8), first: 9);
        await Log(healthy, PressMancuernas, Ago(1), first: 10);

        Assert.Contains("no registraste repeticiones asistidas", (await Of(noAssisted, "metodo")).Single().Message);
        Assert.Contains("llegaste al techo con la misma carga", (await Of(ceiling, "metodo")).Single().Message);
        Assert.Empty(await Of(healthy, "metodo"));
    }

    // AC-05
    [Fact]
    public async Task AC_training_005_05_4x15_serie_4_por_debajo_de_12_o_cuatro_series_en_15_sin_subir_la_carga()
    {
        var heavy = api.ClientFor(Guid.NewGuid());
        await Log4x15(heavy, PressMancuernas, Ago(8), 12, 12, 11, 10);
        await Log4x15(heavy, PressMancuernas, Ago(1), 12, 12, 11, 9);
        var full = api.ClientFor(Guid.NewGuid());
        await Log4x15(full, PressMancuernas, Ago(8), 15, 15, 15, 15);
        await Log4x15(full, PressMancuernas, Ago(1), 15, 15, 15, 16);
        var ok = api.ClientFor(Guid.NewGuid());
        await Log4x15(ok, PressMancuernas, Ago(8), 15, 14, 13, 12);
        await Log4x15(ok, PressMancuernas, Ago(1), 15, 14, 13, 13);

        Assert.Contains("la serie 4 quedó por debajo de 12", (await Of(heavy, "metodo")).Single().Message);
        Assert.Contains("15 repeticiones en las 4 series", (await Of(full, "metodo")).Single().Message);
        Assert.Empty(await Of(ok, "metodo"));
    }

    [Fact]
    public async Task AC_training_005_05_dos_registros_de_metodologias_distintas_no_generan_observacion_de_metodo()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Log(client, PressMancuernas, Ago(8), first: 4);
        await Log4x15(client, PressMancuernas, Ago(1), 10, 10, 10, 8);

        Assert.Empty(await Of(client, "metodo"));
    }

    // AC-06
    [Fact]
    public async Task AC_training_005_06_un_dia_del_plan_sin_registros_en_las_dos_ultimas_semanas_se_avisa()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await PutDay(client, "martes", PressMancuernas);
        await PutDay(client, "miercoles", PressBarra);
        await PutDay(client, "jueves"); // un día sin ejercicios no genera nada
        var lastWeek = SuggestionRules.MondayOf(Today).AddDays(-7);
        await Log(client, PressMancuernas, SuggestionRules.MondayOf(Today).AddDays(-14).AddDays(-3)); // historial anterior a esas semanas
        await Log(client, PressBarra, lastWeek.AddDays(2)); // el miércoles de la semana pasada sí se registró

        var omitted = await Of(client, "dia-omitido");

        var tuesday = Assert.Single(omitted);
        Assert.Equal("martes", tuesday.Day);
        Assert.Contains("dos últimas semanas", tuesday.Message);
    }

    [Fact]
    public async Task AC_training_005_06_una_cuenta_sin_historial_anterior_no_recibe_avisos_de_dias()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await PutDay(client, "martes", PressMancuernas);

        Assert.Empty(await Of(client, "dia-omitido"));
    }

    // AC-07
    [Fact]
    public async Task AC_training_005_07_dos_sesiones_del_mismo_ejercicio_con_menos_de_5_dias_se_senalan_con_sus_fechas()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Log(client, PressMancuernas, Ago(10));
        await Log(client, PressMancuernas, Ago(7));

        var suggestion = Assert.Single(await Of(client, "recuperacion-corta"));

        Assert.Contains(Ago(10).ToString("yyyy-MM-dd"), suggestion.Message);
        Assert.Contains(Ago(7).ToString("yyyy-MM-dd"), suggestion.Message);
        Assert.Contains("unos 7 días", suggestion.Message);
    }

    [Fact]
    public async Task AC_training_005_07_con_5_dias_o_mas_o_fuera_de_las_4_semanas_no_hay_sugerencia()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Log(client, PressMancuernas, Ago(12));
        await Log(client, PressMancuernas, Ago(7)); // 5 días
        await Log(client, PressBarra, Ago(45));
        await Log(client, PressBarra, Ago(43)); // cerca, pero fuera de las 4 semanas

        Assert.Empty(await Of(client, "recuperacion-corta"));
    }

    // AC-08
    [Fact]
    public async Task AC_training_005_08_una_restriccion_con_la_revision_vencida_se_avisa_y_no_cambia_de_nivel()
    {
        var userId = Guid.NewGuid();
        var client = api.ClientFor(userId);
        await api.AddRestrictionAsync(userId, "abdomen", RestrictionLevel.Aviso);
        await InDb(async db =>
        {
            foreach (var r in db.Restrictions.Where(r => r.UserId == userId)) r.ReviewOn = Ago(1);
            await Task.CompletedTask;
        });

        var suggestion = Assert.Single(await Of(client, "restriccion-revision"));

        Assert.Contains("abdomen", suggestion.Message);
        await InDb(async db =>
        {
            Assert.All(db.Restrictions.Where(r => r.UserId == userId), r => Assert.Equal(RestrictionLevel.Aviso, r.Level));
            await Task.CompletedTask;
        });
    }

    // AC-09
    [Fact]
    public async Task AC_training_005_09_un_ejercicio_del_plan_que_choca_con_una_restriccion_posterior_trae_alternativas()
    {
        var userId = Guid.NewGuid();
        var client = api.ClientFor(userId);
        await PutDay(client, "martes", PressMancuernas);
        await api.AddRestrictionAsync(userId, "pecho", RestrictionLevel.Bloqueo, "empuje_horizontal");

        var clash = Assert.Single(await Of(client, "restriccion-choque"));

        Assert.Equal(PressMancuernas, clash.ExerciseId);
        Assert.Equal("martes", clash.Day);
        Assert.Contains("nivel bloqueo", clash.Message);
        Assert.DoesNotContain(clash.Alternatives!, a => a.ExerciseId == PressMaquina); // también comparte empuje_horizontal
    }

    // AC-10
    [Fact]
    public async Task AC_training_005_10_aceptar_una_alternativa_la_pone_en_el_mismo_dia_y_posicion_y_conserva_el_historial()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await PutDay(client, "martes", PressBarra, PressMancuernas);
        await Stagnate(client, PressMancuernas);
        var suggestion = (await Of(client, "ejercicio-estancado")).Single();
        var replacement = suggestion.Alternatives![0].ExerciseId;

        var response = await client.PostAsJsonAsync($"/suggestions/{suggestion.Key}/accept", new AcceptSuggestionRequest(replacement));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var entry = (await response.Content.ReadFromJsonAsync<PlanEntryDto>())!;
        Assert.Equal((replacement, 1), (entry.ExerciseId, entry.Order));
        var plan = (await client.GetFromJsonAsync<PlanDto>("/plan"))!;
        Assert.Equal([PressBarra, replacement], plan.Days.Single(d => d.Day == "martes").Entries.Select(e => e.ExerciseId));
        Assert.Equal(4, (await client.GetFromJsonAsync<List<ExerciseLogDto>>($"/exercises/{PressMancuernas}/history"))!.Count);
        Assert.Empty(await Of(client, "ejercicio-estancado"));
    }

    // AC-11
    [Fact]
    public async Task AC_training_005_11_una_sustitucion_que_no_es_alternativa_se_rechaza_y_no_cambia_el_plan()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await PutDay(client, "martes", PressMancuernas);
        await Stagnate(client);
        var suggestion = (await Of(client, "ejercicio-estancado")).Single();

        var notAlternative = await client.PostAsJsonAsync($"/suggestions/{suggestion.Key}/accept", new AcceptSuggestionRequest("sentadilla-libre"));
        var missing = await client.PostAsJsonAsync($"/suggestions/{suggestion.Key}/accept", new AcceptSuggestionRequest(null));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, notAlternative.StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, missing.StatusCode);
        var plan = (await client.GetFromJsonAsync<PlanDto>("/plan"))!;
        Assert.Equal(PressMancuernas, plan.Days.Single().Entries.Single().ExerciseId);
    }

    // AC-12
    [Fact]
    public async Task AC_training_005_12_descartar_la_oculta_y_vuelve_solo_si_cambian_los_datos_que_la_originan()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await PutDay(client, "martes", PressMancuernas);
        await Stagnate(client, lastAgo: 8);
        var first = (await Of(client, "ejercicio-estancado")).Single();

        var dismissed = await client.PostAsync($"/suggestions/{first.Key}/dismiss", null);
        var again = await client.PostAsync($"/suggestions/{first.Key}/dismiss", null);
        Assert.Equal(HttpStatusCode.NoContent, dismissed.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
        Assert.Empty(await Of(client, "ejercicio-estancado"));

        await Log(client, PressMancuernas, Ago(1)); // otra sesión sin mejorar: datos nuevos
        var returned = (await Of(client, "ejercicio-estancado")).Single();
        Assert.NotEqual(first.Key, returned.Key);
    }

    // AC-13
    [Fact]
    public async Task AC_training_005_13_una_clave_inexistente_o_de_otra_persona_no_se_acepta_y_descartarla_no_hace_nada()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        await PutDay(owner, "martes", PressMancuernas);
        await Stagnate(owner);
        var suggestion = (await Of(owner, "ejercicio-estancado")).Single();

        var accept = await other.PostAsJsonAsync($"/suggestions/{suggestion.Key}/accept", new AcceptSuggestionRequest(suggestion.Alternatives![0].ExerciseId));
        var unknown = await owner.PostAsJsonAsync("/suggestions/no-existe/accept", new AcceptSuggestionRequest(PressBarra));
        var dismiss = await other.PostAsync($"/suggestions/{suggestion.Key}/dismiss", null);

        Assert.Equal(HttpStatusCode.NotFound, accept.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, dismiss.StatusCode);
        Assert.Single(await Of(owner, "ejercicio-estancado")); // sigue vigente para su dueño
        Assert.Equal(PressMancuernas, (await owner.GetFromJsonAsync<PlanDto>("/plan"))!.Days.Single().Entries.Single().ExerciseId);
    }

    // AC-14 (P7)
    [Fact]
    public async Task AC_training_005_14_dos_personas_con_los_mismos_datos_solo_ven_y_cambian_las_suyas()
    {
        var one = api.ClientFor(Guid.NewGuid());
        var two = api.ClientFor(Guid.NewGuid());
        foreach (var c in new[] { one, two })
        {
            await PutDay(c, "martes", PressMancuernas);
            await Stagnate(c);
        }
        var oneSuggestion = (await Of(one, "ejercicio-estancado")).Single();

        await one.PostAsync($"/suggestions/{oneSuggestion.Key}/dismiss", null);

        Assert.Empty(await Of(one, "ejercicio-estancado"));
        Assert.Single(await Of(two, "ejercicio-estancado"));
    }
}
