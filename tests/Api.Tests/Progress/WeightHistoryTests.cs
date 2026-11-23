using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FitnessApp.Api.Domain.Progress;
using FitnessApp.Api.Features.Progress.Weights;

namespace FitnessApp.Api.Tests.Progress;

/// <summary>Reglas puras de SPEC-progress-002 contra los vectores compartidos (ADR-0004).</summary>
public sealed class WeightVectorsTests
{
    private sealed record Entry(DateTimeOffset MeasuredAt, decimal WeightKg);
    private sealed record Point(DateOnly Date, decimal WeightKg);
    private sealed record Week(DateOnly WeekStart, decimal AvgKg, decimal MinKg, decimal MaxKg, int Count, decimal? ChangeKg);
    private sealed record Series(string Name, Entry[] Entries, Point[] Daily, Point[] Trend, Week[] Weekly);
    private sealed record Vectors(Series[] Series);

    private static readonly Vectors All = JsonSerializer.Deserialize<Vectors>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Progress", "progress-vectors.json")),
        new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    public static TheoryData<string> Names() => [.. All.Series.Select(s => s.Name)];

    [Theory]
    [MemberData(nameof(Names))]
    public void AC_progress_002_02_vectores_del_peso_diario_la_tendencia_y_el_resumen_semanal(string name)
    {
        var c = All.Series.Single(s => s.Name == name);

        var daily = WeightStats.Daily(c.Entries.Select(e => (e.MeasuredAt, e.WeightKg)));
        var trend = WeightStats.Trend(daily);
        var weekly = WeightStats.Weekly(daily);

        Assert.Equal(c.Daily.Select(p => (p.Date, p.WeightKg)), daily.Select(p => (p.Date, p.WeightKg)));
        Assert.Equal(c.Trend.Select(p => (p.Date, p.WeightKg)), trend.Select(p => (p.Date, p.WeightKg)));
        Assert.Equal(
            c.Weekly.Select(w => (w.WeekStart, w.AvgKg, w.MinKg, w.MaxKg, w.Count, w.ChangeKg)),
            weekly.Select(w => (w.WeekStart, w.AvgKg, w.MinKg, w.MaxKg, w.Count, w.ChangeKg)));
    }
}

/// <summary>Verifica SPEC-progress-002 contra la API y Postgres reales. Cada test cita su criterio de aceptación.</summary>
[Collection("api")]
public sealed class WeightHistoryApiTests(ApiFixture api)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.UtcNow;

    private static async Task Add(HttpClient c, decimal kg, int daysAgo, int hour = 8)
    {
        var at = new DateTimeOffset(Now.UtcDateTime.Date.AddDays(-daysAgo).AddHours(hour), TimeSpan.Zero);
        (await c.PostAsJsonAsync("/weights", new CreateWeightRequest(Guid.NewGuid(), kg, at))).EnsureSuccessStatusCode();
    }

    private static Task<WeightSummaryDto?> Summary(HttpClient c, string range) => c.GetFromJsonAsync<WeightSummaryDto>($"/weights/summary?range={range}");

    // AC-01
    [Fact]
    public async Task AC_progress_002_01_el_resumen_trae_los_puntos_del_rango_el_minimo_el_maximo_el_cambio_y_la_tendencia()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Add(client, 82m, 120); // fuera de 30d y de 90d, dentro de 1y
        await Add(client, 81m, 20);
        await Add(client, 80m, 10);
        await Add(client, 80.5m, 3);

        var month = (await Summary(client, "30d"))!;
        var year = (await Summary(client, "1y"))!;
        var all = (await Summary(client, "all"))!;

        Assert.Equal([81m, 80m, 80.5m], month.Points.Select(p => p.WeightKg));
        Assert.Equal((80m, 81m, -0.5m), (month.Min, month.Max, month.Change)); // último menos primero
        Assert.Equal(3, month.Trend.Count);
        Assert.Equal(81m, month.Trend[0].WeightKg); // la tendencia arranca en el primer peso del rango
        Assert.Equal(4, year.Points.Count);
        Assert.Equal(4, all.Points.Count);
        Assert.Equal(82m, all.Max);
    }

    // AC-01: el último peso de cada día
    [Fact]
    public async Task AC_progress_002_01_con_varios_pesos_el_mismo_dia_cuenta_el_ultimo()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Add(client, 81m, 1, hour: 7);
        await Add(client, 80.4m, 1, hour: 21);

        var summary = (await Summary(client, "30d"))!;

        Assert.Equal(80.4m, Assert.Single(summary.Points).WeightKg);
    }

    // AC-03
    [Fact]
    public async Task AC_progress_002_03_sin_pesos_o_con_uno_solo_responde_200_sin_cambio_ni_error()
    {
        var empty = api.ClientFor(Guid.NewGuid());
        var one = api.ClientFor(Guid.NewGuid());
        await Add(one, 80m, 2);

        var none = (await Summary(empty, "30d"))!;
        var single = (await Summary(one, "30d"))!;

        Assert.Empty(none.Points);
        Assert.Null(none.Min);
        Assert.Null(none.Change);
        Assert.Single(single.Points);
        Assert.Null(single.Change);
        Assert.Equal(80m, single.Min);
        Assert.Empty((await empty.GetFromJsonAsync<WeightWeeklyDto>("/weights/weekly"))!.Weeks);
    }

    // AC-04
    [Theory]
    [InlineData("/weights/summary?range=7d")]
    [InlineData("/weights/summary")]
    [InlineData("/weights/weekly?weeks=0")]
    [InlineData("/weights/weekly?weeks=105")]
    public async Task AC_progress_002_04_un_rango_o_unas_semanas_invalidos_responden_400(string url)
    {
        var client = api.ClientFor(Guid.NewGuid());

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(url)).StatusCode);
    }

    // AC-05
    [Fact]
    public async Task AC_progress_002_05_el_resumen_semanal_trae_promedio_minimo_maximo_y_cambio_respecto_a_la_semana_anterior()
    {
        var client = api.ClientFor(Guid.NewGuid());
        // Un lunes de hace 3 semanas y otro de hace 2: dos semanas distintas con un peso cada una más uno extra en la segunda.
        var thisMonday = Now.UtcDateTime.Date.AddDays(-(((int)Now.DayOfWeek + 6) % 7));
        var lastWeekMonday = thisMonday.AddDays(-14);
        foreach (var (kg, day) in new[] { (81m, lastWeekMonday.AddDays(-7)), (80m, lastWeekMonday), (80.5m, lastWeekMonday.AddDays(2)) })
        {
            (await client.PostAsJsonAsync("/weights", new CreateWeightRequest(Guid.NewGuid(), kg, new DateTimeOffset(day.AddHours(8), TimeSpan.Zero)))).EnsureSuccessStatusCode();
        }

        var weeks = (await client.GetFromJsonAsync<WeightWeeklyDto>("/weights/weekly?weeks=12"))!.Weeks;

        Assert.Equal(2, weeks.Count);
        Assert.Equal((DateOnly.FromDateTime(lastWeekMonday.AddDays(-7)), 81m, null), (weeks[0].WeekStart, weeks[0].AvgKg, weeks[0].ChangeKg));
        Assert.Equal((80.25m, 80m, 80.5m, 2, -0.75m), (weeks[1].AvgKg, weeks[1].MinKg, weeks[1].MaxKg, weeks[1].Count, weeks[1].ChangeKg));
        var recent = (await client.GetFromJsonAsync<WeightWeeklyDto>("/weights/weekly?weeks=1"))!.Weeks;
        Assert.Empty(recent); // la semana en curso no tiene pesos
    }

    // AC-06 (P7)
    [Fact]
    public async Task AC_progress_002_06_el_resumen_solo_cuenta_los_pesos_de_la_persona()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        await Add(owner, 80m, 2);
        await Add(other, 100m, 2);

        var summary = (await Summary(owner, "30d"))!;

        Assert.Equal(80m, Assert.Single(summary.Points).WeightKg);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.CreateClient().GetAsync("/weights/summary?range=30d")).StatusCode);
    }
}
