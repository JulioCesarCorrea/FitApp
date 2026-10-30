namespace FitnessApp.Api.Domain.Training;

public enum EquipmentKind { Maquina, Mancuernas, Barra, PesoCorporal }

public enum BarKind { Recta, Z, Smith, RemoEnT }

/// <summary>
/// Cargas disponibles de una persona (SPEC-training-002, AC-09). Depende de su gimnasio.
/// <paramref name="DiscsKg"/> lleva un elemento por cada PAR de discos disponible.
/// </summary>
public sealed record EquipmentProfile(
    IReadOnlyList<decimal> DumbbellsKg,
    IReadOnlyDictionary<BarKind, decimal> BarsKg,
    IReadOnlyList<decimal> DiscsKg,
    decimal MachineStepKg,
    decimal MachineBaseKg = 0)
{
    public const int MaxDiscPairs = 16;
    public const int MaxMachineSteps = 100;

    /// <summary>Cargas posibles, de menor a mayor, para el equipo de un ejercicio.</summary>
    public IReadOnlyList<decimal> LoadsFor(EquipmentKind kind, BarKind? bar = null, decimal? machineStepOverride = null) =>
        kind switch
        {
            EquipmentKind.PesoCorporal => [],
            EquipmentKind.Mancuernas => DumbbellsKg.Distinct().Order().ToList(),
            EquipmentKind.Barra => BarbellLoads(bar ?? throw new ArgumentException("Una barra necesita su tipo.", nameof(bar))),
            _ => MachineLoads(machineStepOverride ?? MachineStepKg),
        };

    private List<decimal> BarbellLoads(BarKind bar)
    {
        if (!BarsKg.TryGetValue(bar, out var barKg)) return [];
        if (DiscsKg.Count > MaxDiscPairs)
            throw new InvalidOperationException($"Se admiten como máximo {MaxDiscPairs} pares de discos.");

        var sums = new HashSet<decimal> { 0m };
        foreach (var disc in DiscsKg)
            foreach (var s in sums.ToList())
                sums.Add(s + disc);

        return sums.Select(s => barKg + 2 * s).Order().ToList();
    }

    private List<decimal> MachineLoads(decimal step) =>
        step <= 0
            ? []
            : Enumerable.Range(0, MaxMachineSteps).Select(k => MachineBaseKg + k * step).ToList();
}
