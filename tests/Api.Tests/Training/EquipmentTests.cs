using FitnessApp.Api.Domain.Training;

namespace FitnessApp.Api.Tests.Training;

/// <summary>Verifica el cálculo de cargas de SPEC-training-002 (AC-09). Sin base de datos ni red.</summary>
public sealed class EquipmentTests
{
    private static EquipmentProfile Profile(
        decimal[]? dumbbells = null, decimal[]? discs = null, decimal step = 5m, decimal machineBase = 0m) =>
        new(dumbbells ?? [], new Dictionary<BarKind, decimal> { [BarKind.Recta] = 20m, [BarKind.Z] = 8m },
            discs ?? [], step, machineBase);

    [Fact]
    public void AC_training_002_09_mancuernas_usan_la_lista_de_la_persona_ordenada_y_sin_repetidos()
    {
        var loads = Profile(dumbbells: [22.5m, 20m, 25m, 20m]).LoadsFor(EquipmentKind.Mancuernas);

        Assert.Equal([20m, 22.5m, 25m], loads);
    }

    [Fact]
    public void AC_training_002_09_barra_suma_la_barra_y_las_combinaciones_de_discos_por_ambos_lados()
    {
        var loads = Profile(discs: [2.5m, 5m]).LoadsFor(EquipmentKind.Barra, BarKind.Recta);

        Assert.Equal([20m, 25m, 30m, 35m], loads);
    }

    [Fact]
    public void AC_training_002_09_cada_tipo_de_barra_usa_su_propio_peso()
    {
        var z = Profile(discs: [5m]).LoadsFor(EquipmentKind.Barra, BarKind.Z);

        Assert.Equal([8m, 18m], z);
    }

    [Fact]
    public void AC_training_002_09_una_barra_sin_peso_registrado_no_tiene_cargas()
    {
        Assert.Empty(Profile(discs: [5m]).LoadsFor(EquipmentKind.Barra, BarKind.Smith));
    }

    [Fact]
    public void AC_training_002_09_una_barra_exige_su_tipo()
    {
        Assert.Throws<ArgumentException>(() => Profile().LoadsFor(EquipmentKind.Barra));
    }

    [Fact]
    public void AC_training_002_09_maquina_usa_el_escalon_de_la_entrada_o_el_del_perfil()
    {
        var profile = Profile(step: 5m, machineBase: 10m);

        Assert.Equal([10m, 15m, 20m], profile.LoadsFor(EquipmentKind.Maquina).Take(3));
        Assert.Equal([10m, 12.5m, 15m], profile.LoadsFor(EquipmentKind.Maquina, machineStepOverride: 2.5m).Take(3));
    }

    [Fact]
    public void AC_training_002_09_peso_corporal_no_tiene_carga_siguiente()
    {
        Assert.Empty(Profile().LoadsFor(EquipmentKind.PesoCorporal));
    }

    [Fact]
    public void AC_training_002_09_la_progresion_usa_las_cargas_del_equipo_de_la_persona()
    {
        var loads = Profile(dumbbells: [20m, 22.5m, 25m]).LoadsFor(EquipmentKind.Mancuernas);
        var log = ExerciseLog.Register(new DateOnly(2026, 10, 27), 22.5m, [new EffectiveSet(12), new EffectiveSet(8, 5)]);

        var advice = LoadProgression.Advise(log, loads);

        Assert.Equal(LoadAction.Subir, advice.Action);
        Assert.Equal(25m, advice.NextLoadKg);
    }
}
