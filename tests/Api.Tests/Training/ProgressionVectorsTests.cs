using System.Text.Json;
using FitnessApp.Api.Domain.Training;

namespace FitnessApp.Api.Tests.Training;

/// <summary>
/// Ejecuta los vectores compartidos con la app (ADR-0004) contra el dominio de la API.
/// La app los ejecuta contra su copia en TypeScript: si una regla cambia, cambia primero el JSON.
/// </summary>
public sealed class ProgressionVectorsTests
{
    private sealed record LogCase(decimal LoadKg, int FirstSet, int SecondSet, int Assisted);
    private sealed record AdviceExpected(string Action, decimal NextLoadKg, bool MissingLoadData);
    private sealed record AdviceCase(string Name, LogCase Log, decimal[] AvailableLoads, AdviceExpected Expected);
    private sealed record StagnationExpected(bool IsStagnant, int SessionsWithoutProgress);
    private sealed record StagnationCase(string Name, int Threshold, LogCase[] History, StagnationExpected Expected);
    private sealed record ProfileCase(
        decimal[] DumbbellsKg, Dictionary<string, decimal> BarsKg, decimal[] DiscsKg, decimal MachineStepKg, decimal MachineBaseKg);
    private sealed record LoadsCase(
        string Name, ProfileCase Profile, string Kind, string? Bar, decimal? StepOverride, int? Take, decimal[] Expected);
    private sealed record NormalLogCase(decimal LoadKg, int[] Reps);
    private sealed record NormalAdviceExpected(string Action, decimal NextLoadKg, bool MissingLoadData, string FirstSetEvaluation);
    private sealed record NormalAdviceCase(string Name, NormalLogCase Log, decimal[] AvailableLoads, NormalAdviceExpected Expected);
    private sealed record NormalStagnationCase(string Name, int Threshold, NormalLogCase[] History, StagnationExpected Expected);
    private sealed record Vectors(
        AdviceCase[] Advice, LoadsCase[] Loads, StagnationCase[] Stagnation,
        NormalAdviceCase[] Advice4x15, NormalStagnationCase[] Stagnation4x15);

    private static readonly Vectors All = JsonSerializer.Deserialize<Vectors>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Training", "progression-vectors.json")),
        new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    private static readonly DateOnly Start = new(2026, 10, 5);

    private static ExerciseLog ToLog(LogCase c, int index) =>
        new(Start.AddDays(7 * index), c.LoadKg, new EffectiveSet(c.FirstSet), new EffectiveSet(c.SecondSet, c.Assisted));

    public static TheoryData<string> AdviceNames() => [.. All.Advice.Select(a => a.Name)];
    public static TheoryData<string> LoadsNames() => [.. All.Loads.Select(l => l.Name)];
    public static TheoryData<string> StagnationNames()=> [.. All.Stagnation.Select(s => s.Name)];
    public static TheoryData<string> Advice4x15Names() => [.. All.Advice4x15.Select(a => a.Name)];
    public static TheoryData<string> Stagnation4x15Names() => [.. All.Stagnation4x15.Select(s => s.Name)];

    private static NormalLog ToNormalLog(NormalLogCase c, int index) => new(Start.AddDays(7 * index), c.LoadKg, c.Reps);

    [Theory]
    [MemberData(nameof(AdviceNames))]
    public void AC_training_003_09_vectores_compartidos_de_consejo_de_carga(string name)
    {
        var c = All.Advice.Single(a => a.Name == name);

        var advice = LoadProgression.Advise(ToLog(c.Log, 0), c.AvailableLoads);

        Assert.Equal(c.Expected.Action, advice.Action == LoadAction.Subir ? "subir" : "mantener");
        Assert.Equal(c.Expected.NextLoadKg, advice.NextLoadKg);
        Assert.Equal(c.Expected.MissingLoadData, advice.MissingLoadData);
    }

    [Theory]
    [MemberData(nameof(LoadsNames))]
    public void AC_training_003_09_vectores_compartidos_de_cargas_posibles(string name)
    {
        var c = All.Loads.Single(l => l.Name == name);
        var bars = c.Profile.BarsKg.ToDictionary(
            b => b.Key switch { "recta" => BarKind.Recta, "z" => BarKind.Z, "smith" => BarKind.Smith, _ => BarKind.RemoEnT },
            b => b.Value);
        var profile = new EquipmentProfile(
            c.Profile.DumbbellsKg, bars, c.Profile.DiscsKg, c.Profile.MachineStepKg, c.Profile.MachineBaseKg);

        var loads = profile.LoadsFor(
            Enum.Parse<EquipmentKind>(c.Kind), c.Bar is null ? null : Enum.Parse<BarKind>(c.Bar), c.StepOverride);

        Assert.Equal(c.Expected, c.Take is { } take ? loads.Take(take) : loads);
    }

    [Theory]
    [MemberData(nameof(StagnationNames))]
    public void AC_training_003_10_vectores_compartidos_de_estancamiento(string name)
    {
        var c = All.Stagnation.Single(s => s.Name == name);

        var result = Stagnation.Check(c.History.Select(ToLog).ToList(), c.Threshold);

        Assert.Equal(c.Expected.IsStagnant, result.IsStagnant);
        Assert.Equal(c.Expected.SessionsWithoutProgress, result.SessionsWithoutProgress);
    }

    [Theory]
    [MemberData(nameof(Advice4x15Names))]
    public void AC_training_004_10_vectores_compartidos_de_consejo_de_carga_4x15(string name)
    {
        var c = All.Advice4x15.Single(a => a.Name == name);
        var log = ToNormalLog(c.Log, 0);

        var advice = Normal4x15.Advise(log, c.AvailableLoads);

        Assert.Equal(c.Expected.Action, advice.Action == LoadAction.Subir ? "subir" : "mantener");
        Assert.Equal(c.Expected.NextLoadKg, advice.NextLoadKg);
        Assert.Equal(c.Expected.MissingLoadData, advice.MissingLoadData);
        var evaluation = Normal4x15.EvaluateFirstSet(log.Reps[0]);
        Assert.Equal(c.Expected.FirstSetEvaluation, evaluation switch
        {
            FirstSetEvaluation.PorDebajo => "por_debajo",
            FirstSetEvaluation.EnBanda => "en_banda",
            _ => "techo",
        });
    }

    [Theory]
    [MemberData(nameof(Stagnation4x15Names))]
    public void AC_training_004_10_vectores_compartidos_de_estancamiento_4x15(string name)
    {
        var c = All.Stagnation4x15.Single(s => s.Name == name);

        var result = Normal4x15.CheckStagnation(c.History.Select(ToNormalLog).ToList(), c.Threshold);

        Assert.Equal(c.Expected.IsStagnant, result.IsStagnant);
        Assert.Equal(c.Expected.SessionsWithoutProgress, result.SessionsWithoutProgress);
    }
}
