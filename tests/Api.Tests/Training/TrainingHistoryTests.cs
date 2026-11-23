using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Features.Training.Sessions;

namespace FitnessApp.Api.Tests.Training;

/// <summary>Reglas puras de SPEC-training-006 contra los vectores compartidos (ADR-0004).</summary>
public sealed class TrainingHistoryVectorsTests
{
    private sealed record LogCase(DateOnly Date, decimal LoadKg, int FirstSetReps, int SecondSetReps, int[]? RepsPerSet);
    private sealed record WeekCase(DateOnly WeekStart, int Sessions, int Sets, decimal VolumeKg);
    private sealed record Case(string Name, LogCase[] Logs, decimal[] Volumes, int[] Sets, WeekCase[] Weekly);
    private sealed record Vectors(Case[] Cases);

    private static readonly Vectors All = JsonSerializer.Deserialize<Vectors>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Training", "training-history-vectors.json")),
        new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    public static TheoryData<string> Names() => [.. All.Cases.Select(c => c.Name)];

    [Theory]
    [MemberData(nameof(Names))]
    public void AC_training_006_03_vectores_de_series_volumen_y_resumen_semanal(string name)
    {
        var c = All.Cases.Single(x => x.Name == name);
        var logs = c.Logs.Select(l => new SessionLog(l.Date, l.LoadKg, l.FirstSetReps, l.SecondSetReps, l.RepsPerSet)).ToList();

        Assert.Equal(c.Volumes, logs.Select(TrainingHistory.Volume));
        Assert.Equal(c.Sets, logs.Select(TrainingHistory.Sets));
        Assert.Equal(
            c.Weekly.Select(w => (w.WeekStart, w.Sessions, w.Sets, w.VolumeKg)),
            TrainingHistory.Weekly(logs).Select(w => (w.WeekStart, w.Sessions, w.Sets, w.VolumeKg)));
    }
}

/// <summary>Verifica SPEC-training-006 contra la API y Postgres reales. Cada test cita su criterio de aceptación.</summary>
[Collection("api")]
public sealed class TrainingHistoryApiTests(ApiFixture api)
{
    private const string PressMancuernas = "press-plano-con-mancuernas";
    private const string PressBarra = "press-plano-con-barra";

    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static Task Log(HttpClient c, string exercise, int daysAgo, decimal load = 22.5m, int set1 = 9, int set2 = 5, int assisted = 5) =>
        c.PutAsJsonAsync($"/exercise-logs/{Guid.NewGuid()}", new ExerciseLogRequest(exercise, Today.AddDays(-daysAgo), load, set1, set2, assisted));

    private static Task<TrainingWeeklyDto?> Weekly(HttpClient c, int weeks = 12) => c.GetFromJsonAsync<TrainingWeeklyDto>($"/training/weekly?weeks={weeks}");

    private static Task<ExerciseProgressDto?> Progress(HttpClient c, string exercise, string range = "all") =>
        c.GetFromJsonAsync<ExerciseProgressDto>($"/training/exercises/{exercise}/history?range={range}");

    // AC-01
    [Fact]
    public async Task AC_training_006_01_el_resumen_semanal_trae_sesiones_series_y_volumen_con_las_semanas_vacias_a_cero()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var thisMonday = Today.AddDays(-(((int)Today.DayOfWeek + 6) % 7));
        var daysSinceLastMonday = Today.DayNumber - thisMonday.AddDays(-7).DayNumber;
        await Log(client, PressMancuernas, daysSinceLastMonday, load: 20m, set1: 10, set2: 8); // lunes de la semana pasada: 20 × 18 = 360
        await Log(client, PressBarra, daysSinceLastMonday, load: 40m, set1: 5, set2: 5); // el mismo día: una sola sesión, 40 × 10 = 400

        var weeks = (await Weekly(client, 3))!.Weeks;

        Assert.Equal(3, weeks.Count);
        Assert.Equal(thisMonday.AddDays(-14), weeks[0].WeekStart);
        Assert.Equal((0, 0, 0m), (weeks[0].Sessions, weeks[0].Sets, weeks[0].VolumeKg)); // sin sesiones: a cero
        Assert.Equal((1, 4, 760m), (weeks[1].Sessions, weeks[1].Sets, weeks[1].VolumeKg)); // 2 ejercicios, 1 sesión, 2 series cada uno
        Assert.Equal(thisMonday, weeks[2].WeekStart);
    }

    // AC-09
    [Fact]
    public async Task AC_training_006_09_la_semana_en_curso_se_marca_como_parcial()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var weeks = (await Weekly(client, 2))!.Weeks;

        Assert.Equal([false, true], weeks.Select(w => w.Partial));
    }

    // AC-02
    [Fact]
    public async Task AC_training_006_02_el_historial_del_ejercicio_trae_la_carga_las_repeticiones_y_el_volumen_por_sesion_en_orden()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Log(client, PressMancuernas, 6, load: 20m, set1: 9, set2: 8);
        await Log(client, PressMancuernas, 13, load: 17.5m, set1: 10, set2: 8);
        await Log(client, PressMancuernas, 200, load: 15m, set1: 10, set2: 7);

        var all = (await Progress(client, PressMancuernas))!.Points;
        var recent = (await Progress(client, PressMancuernas, "30d"))!.Points;

        Assert.Equal([Today.AddDays(-200), Today.AddDays(-13), Today.AddDays(-6)], all.Select(p => p.Date));
        Assert.Equal((20m, 9, 340m, "heavy_duty_personalizado"), (all[2].LoadKg, all[2].Reps, all[2].VolumeKg, all[2].Methodology)); // 20 × (9 + 8)
        Assert.Equal(2, recent.Count);
    }

    // AC-05
    [Fact]
    public async Task AC_training_006_05_un_ejercicio_sin_registros_responde_vacio_y_uno_inexistente_404()
    {
        var client = api.ClientFor(Guid.NewGuid());

        Assert.Empty((await Progress(client, PressMancuernas))!.Points);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/training/exercises/no-existe/history")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync($"/training/exercises/{PressMancuernas}/history?range=7d")).StatusCode);
    }

    // AC-04
    [Fact]
    public async Task AC_training_006_04_sin_sesiones_responde_200_con_semanas_a_cero_y_semanas_invalidas_400()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var weeks = (await Weekly(client))!.Weeks;

        Assert.Equal(12, weeks.Count);
        Assert.All(weeks, w => Assert.Equal((0, 0, 0m), (w.Sessions, w.Sets, w.VolumeKg)));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/training/weekly?weeks=0")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/training/weekly?weeks=53")).StatusCode);
    }

    // AC-06 (P7)
    [Fact]
    public async Task AC_training_006_06_el_historial_solo_cuenta_las_sesiones_de_la_persona()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        await Log(owner, PressMancuernas, 1, load: 20m);
        await Log(other, PressMancuernas, 1, load: 50m);

        var ownerProgress = (await Progress(owner, PressMancuernas))!.Points;

        Assert.Equal(20m, Assert.Single(ownerProgress).LoadKg);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.CreateClient().GetAsync("/training/weekly")).StatusCode);
    }
}
