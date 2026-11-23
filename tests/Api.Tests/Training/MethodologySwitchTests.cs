using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Features.Profile;
using FitnessApp.Api.Features.Training.Equipment;
using FitnessApp.Api.Features.Training.Sessions;

namespace FitnessApp.Api.Tests.Training;

/// <summary>Reglas puras de SPEC-training-007 contra los vectores compartidos (ADR-0004).</summary>
public sealed class MethodologySwitchVectorsTests
{
    private sealed record Case(string Name, string[] LogMethodologies, string? Current, int[] ExpectedIndexes);
    private sealed record Vectors(Case[] MethodologySwitch);

    private static readonly Vectors All = JsonSerializer.Deserialize<Vectors>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Training", "progression-vectors.json")),
        new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    public static TheoryData<string> Names() => [.. All.MethodologySwitch.Select(c => c.Name)];

    [Theory]
    [MemberData(nameof(Names))]
    public void AC_training_007_04_vectores_de_los_registros_que_cuentan_tras_un_cambio_de_metodologia(string name)
    {
        var c = All.MethodologySwitch.Single(x => x.Name == name);
        var rows = c.LogMethodologies.Select((m, i) => (Methodology: m, Index: i)).ToList();

        var relevant = MethodologyHistory.Relevant(rows, r => r.Methodology, c.Current);

        Assert.Equal(c.ExpectedIndexes, relevant.Select(r => r.Index));
    }
}

/// <summary>Verifica SPEC-training-007 (cambio de metodología hacia adelante) contra la API y Postgres reales.</summary>
[Collection("api")]
public sealed class MethodologySwitchApiTests(ApiFixture api)
{
    private const string Normal = "normal_4x15";
    private const string HeavyDuty = "heavy_duty_personalizado";
    private const string Press = "press-plano-con-mancuernas";

    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static DateOnly Ago(int days) => Today.AddDays(-days);

    private static ProfileRequest Profile(string? methodology) =>
        new("Julio", "masculino", new DateOnly(1995, 5, 20), 178, "mantener", null, null, null, methodology, null);

    private static Task<HttpResponseMessage> SetMethodology(HttpClient c, string? methodology) =>
        c.PutAsJsonAsync("/profile/methodology", new MethodologyRequest(methodology));

    private static ExerciseLogRequest HeavyDutyLog(int daysAgo, decimal load = 20m) => new(Press, Ago(daysAgo), load, 9, 5, 5);

    private static ExerciseLogRequest NormalLog(int daysAgo, decimal load = 15m) =>
        new(Press, Ago(daysAgo), load, Methodology: Normal, RepsPerSet: [15, 14, 13, 12]);

    private static Task<HttpResponseMessage> PutLog(HttpClient c, ExerciseLogRequest body) => c.PutAsJsonAsync($"/exercise-logs/{Guid.NewGuid()}", body);

    private static async Task Equip(HttpClient c) =>
        (await c.PutAsJsonAsync("/equipment", new EquipmentRequest([12.5m, 15m, 17.5m, 20m, 22.5m, 25m], [], [], 5m, 0m))).EnsureSuccessStatusCode();

    private static Task<HttpResponseMessage> Advice(HttpClient c) => c.GetAsync($"/exercises/{Press}/advice");

    // AC-01
    [Fact]
    public async Task AC_training_007_01_cambiar_la_metodologia_responde_200_con_la_fecha_y_repetirlo_no_la_cambia()
    {
        var client = api.ClientFor(Guid.NewGuid());
        (await client.PutAsJsonAsync("/profile", Profile(HeavyDuty))).EnsureSuccessStatusCode();

        var first = await SetMethodology(client, Normal);
        var again = await SetMethodology(client, Normal);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var changed = (await first.Content.ReadFromJsonAsync<MethodologyDto>())!;
        Assert.Equal(Normal, changed.Methodology);
        Assert.NotNull(changed.ChangedAt);
        var repeated = (await again.Content.ReadFromJsonAsync<MethodologyDto>())!;
        Assert.Equal(changed.ChangedAt!.Value.ToUnixTimeMilliseconds(), repeated.ChangedAt!.Value.ToUnixTimeMilliseconds()); // idempotente: no hay cambio nuevo
        Assert.Equal(Normal, (await client.GetFromJsonAsync<ProfileDto>("/profile"))!.Methodology);
    }

    [Fact]
    public async Task AC_training_007_01_sin_perfil_responde_422_y_sin_sesion_401()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await SetMethodology(client, Normal);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Equal("perfil", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("missing").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await SetMethodology(api.CreateClient(), Normal)).StatusCode);
    }

    // AC-02
    [Theory]
    [InlineData("otra")]
    [InlineData("")]
    [InlineData(null)]
    public async Task AC_training_007_02_una_metodologia_desconocida_responde_400_y_no_cambia_nada(string? methodology)
    {
        var client = api.ClientFor(Guid.NewGuid());
        (await client.PutAsJsonAsync("/profile", Profile(HeavyDuty))).EnsureSuccessStatusCode();

        var response = await SetMethodology(client, methodology);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(HeavyDuty, (await client.GetFromJsonAsync<ProfileDto>("/profile"))!.Methodology);
    }

    // AC-03
    [Fact]
    public async Task AC_training_007_03_tras_el_cambio_cada_registro_conserva_su_metodologia_y_sus_valores()
    {
        var client = api.ClientFor(Guid.NewGuid());
        (await client.PutAsJsonAsync("/profile", Profile(HeavyDuty))).EnsureSuccessStatusCode();
        await PutLog(client, HeavyDutyLog(10, load: 20m));

        await SetMethodology(client, Normal);
        await PutLog(client, NormalLog(3, load: 15m));
        var history = (await client.GetFromJsonAsync<List<ExerciseLogDto>>($"/exercises/{Press}/history"))!.OrderBy(l => l.Date).ToList();

        Assert.Equal([HeavyDuty, Normal], history.Select(l => l.Methodology));
        Assert.Equal((20m, 9, 5, 5), (history[0].LoadKg, history[0].FirstSetReps, history[0].SecondSetReps, history[0].SecondSetAssistedReps));
        Assert.Equal([15, 14, 13, 12], history[1].RepsPerSet);
    }

    // AC-04
    [Fact]
    public async Task AC_training_007_04_tras_el_cambio_el_consejo_y_el_estancamiento_solo_cuentan_la_metodologia_vigente()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Equip(client);
        (await client.PutAsJsonAsync("/profile", Profile(HeavyDuty))).EnsureSuccessStatusCode();
        await PutLog(client, HeavyDutyLog(30));
        await PutLog(client, HeavyDutyLog(20));
        Assert.Equal(HttpStatusCode.OK, (await Advice(client)).StatusCode);

        await SetMethodology(client, Normal);

        Assert.Equal(HttpStatusCode.NoContent, (await Advice(client)).StatusCode); // sin registros 4×15: la primera carga parte del equipamiento
        await PutLog(client, NormalLog(2, load: 15m));
        var advice = (await (await Advice(client)).Content.ReadFromJsonAsync<AdviceDto>())!;
        Assert.Equal(0, advice.Stagnation.SessionsWithoutProgress); // los dos registros de Heavy Duty no cuentan
        Assert.False(advice.Stagnation.IsStagnant);
    }

    // AC-04: volver a una metodología anterior empieza de cero con lo nuevo aparte
    [Fact]
    public async Task AC_training_007_04_sin_perfil_manda_la_metodologia_del_ultimo_registro_como_antes()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Equip(client);
        await PutLog(client, NormalLog(2));

        Assert.Equal(HttpStatusCode.OK, (await Advice(client)).StatusCode);
    }

    // AC-07 (P7)
    [Fact]
    public async Task AC_training_007_07_cambiar_la_metodologia_no_afecta_a_otra_persona()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        (await owner.PutAsJsonAsync("/profile", Profile(HeavyDuty))).EnsureSuccessStatusCode();
        (await other.PutAsJsonAsync("/profile", Profile(HeavyDuty))).EnsureSuccessStatusCode();

        await SetMethodology(owner, Normal);

        Assert.Equal(HeavyDuty, (await other.GetFromJsonAsync<ProfileDto>("/profile"))!.Methodology);
        Assert.Equal(HttpStatusCode.OK, (await SetMethodology(other, HeavyDuty)).StatusCode);
        Assert.Equal(Normal, (await owner.GetFromJsonAsync<ProfileDto>("/profile"))!.Methodology);
    }

    // AC-01: también cambia la fecha al cambiar con PUT /profile
    [Fact]
    public async Task AC_training_007_01_cambiar_la_metodologia_desde_el_perfil_tambien_registra_la_fecha_pero_guardarlo_igual_no()
    {
        var client = api.ClientFor(Guid.NewGuid());
        (await client.PutAsJsonAsync("/profile", Profile(HeavyDuty))).EnsureSuccessStatusCode();
        var same = await SetMethodology(client, HeavyDuty);
        Assert.Null((await same.Content.ReadFromJsonAsync<MethodologyDto>())!.ChangedAt); // nunca cambió

        (await client.PutAsJsonAsync("/profile", Profile(Normal))).EnsureSuccessStatusCode();
        var after = await SetMethodology(client, Normal);

        Assert.NotNull((await after.Content.ReadFromJsonAsync<MethodologyDto>())!.ChangedAt);
    }
}
