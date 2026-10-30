using FitnessApp.Api.Domain.Training;

namespace FitnessApp.Api.Tests.Training;

/// <summary>Verifica SPEC-training-001. Cada test cita su criterio de aceptación. Sin base de datos ni red.</summary>
public sealed class TrainingDomainTests
{
    private static readonly DateOnly Day = new(2026, 10, 27);

    private static ExerciseLog Log(int set1, int set2Own, int assisted = 5, decimal load = 100m, int dayOffset = 0) =>
        ExerciseLog.Register(Day.AddDays(dayOffset), load, [new EffectiveSet(set1), new EffectiveSet(set2Own, assisted)]);

    private static IReadOnlySet<string> Set(params string[] items) => new HashSet<string>(items);

    // AC-01
    [Theory]
    [InlineData(DayOfWeek.Tuesday, "Pierna, énfasis en cuádriceps")]
    [InlineData(DayOfWeek.Wednesday, "Espalda y hombros")]
    [InlineData(DayOfWeek.Thursday, "Pierna, énfasis en glúteo")]
    [InlineData(DayOfWeek.Saturday, "Pecho, tríceps y bíceps")]
    public void AC_training_001_01_el_plan_devuelve_el_foco_de_cada_dia(DayOfWeek day, string focus)
    {
        Assert.Equal(focus, WeeklyPlan.HeavyDutyPersonalizado.FocusFor(day)!.Name);
    }

    [Theory]
    [InlineData(DayOfWeek.Monday)]
    [InlineData(DayOfWeek.Friday)]
    [InlineData(DayOfWeek.Sunday)]
    public void AC_training_001_01_los_demas_dias_no_tienen_entrenamiento(DayOfWeek day)
    {
        Assert.Null(WeeklyPlan.HeavyDutyPersonalizado.FocusFor(day));
    }

    // AC-02
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(3)]
    public void AC_training_001_02_exige_exactamente_2_series_efectivas(int count)
    {
        var sets = Enumerable.Repeat(new EffectiveSet(8), count).ToList();

        Assert.Throws<ArgumentException>(() => ExerciseLog.Register(Day, 100m, sets));
    }

    [Fact]
    public void AC_training_001_02_acepta_2_series_efectivas()
    {
        var log = Log(9, 5);

        Assert.Equal(9, log.FirstSet.OwnReps);
        Assert.Equal(5, log.SecondSet.OwnReps);
    }

    // AC-03
    [Theory]
    [InlineData(1, FirstSetEvaluation.PorDebajo)]
    [InlineData(5, FirstSetEvaluation.PorDebajo)]
    [InlineData(6, FirstSetEvaluation.EnBanda)]
    [InlineData(8, FirstSetEvaluation.EnBanda)]
    [InlineData(9, FirstSetEvaluation.MetaAlcanzada)]
    [InlineData(10, FirstSetEvaluation.PorEncima)]
    [InlineData(11, FirstSetEvaluation.PorEncima)]
    [InlineData(12, FirstSetEvaluation.Techo)]
    public void AC_training_001_03_evalua_la_serie_1(int reps, FirstSetEvaluation expected)
    {
        Assert.Equal(expected, ExerciseLog.EvaluateFirstSet(reps));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(13)]
    public void AC_training_001_03_mas_de_12_o_menos_de_1_no_es_valido(int reps)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => ExerciseLog.EvaluateFirstSet(reps));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            ExerciseLog.Register(Day, 100m, [new EffectiveSet(reps), new EffectiveSet(5)]));
    }

    // AC-04
    [Fact]
    public void AC_training_001_04_la_serie_2_guarda_propias_y_asistidas_por_separado()
    {
        var log = Log(9, 6, assisted: 5);

        Assert.Equal(6, log.SecondSet.OwnReps);
        Assert.Equal(5, log.SecondSet.AssistedReps);
    }

    [Fact]
    public void AC_training_001_04_la_serie_1_no_lleva_asistidas()
    {
        Assert.Throws<ArgumentException>(() =>
            ExerciseLog.Register(Day, 100m, [new EffectiveSet(9, 2), new EffectiveSet(5, 5)]));
    }

    // AC-05
    [Fact]
    public void AC_training_001_05_el_tempo_es_4_segundos_de_negativa_y_1_de_positiva()
    {
        var tempo = Log(9, 5).Tempo;

        Assert.Equal(4, tempo.NegativeSeconds);
        Assert.Equal(1, tempo.PositiveSeconds);
    }

    // AC-06
    private static readonly Exercise Crunch = new("Crunch", Set("abdomen"), Set("flexión de tronco"));
    private static readonly Exercise Sentadilla = new("Sentadilla", Set("piernas", "cadera"), Set("flexión profunda de cadera"));
    private static readonly Exercise Remo = new("Remo", Set("espalda"), Set("tracción"));

    [Theory]
    [InlineData(RestrictionLevel.Contexto, RestrictionOutcome.Contexto)]
    [InlineData(RestrictionLevel.Aviso, RestrictionOutcome.Aviso)]
    [InlineData(RestrictionLevel.Bloqueo, RestrictionOutcome.Bloqueado)]
    public void AC_training_001_06_aplica_el_comportamiento_del_nivel(RestrictionLevel level, RestrictionOutcome expected)
    {
        var restriction = new Restriction("abdomen", Set(), level);

        var check = RestrictionRules.Check(Crunch, [restriction]);

        Assert.Equal(expected, check.Outcome);
        Assert.Contains(restriction, check.Affecting);
    }

    [Fact]
    public void AC_training_001_06_una_restriccion_por_movimiento_afecta_aunque_la_zona_no_coincida()
    {
        var restriction = new Restriction("cadera", Set("flexión profunda de cadera"), RestrictionLevel.Aviso);

        Assert.Equal(RestrictionOutcome.Aviso, RestrictionRules.Check(Sentadilla, [restriction]).Outcome);
    }

    [Fact]
    public void AC_training_001_06_sin_restriccion_aplicable_el_ejercicio_esta_permitido()
    {
        var restriction = new Restriction("abdomen", Set(), RestrictionLevel.Bloqueo);

        Assert.Equal(RestrictionOutcome.Permitido, RestrictionRules.Check(Remo, [restriction]).Outcome);
    }

    [Fact]
    public void AC_training_001_06_con_varias_restricciones_manda_el_nivel_mas_alto()
    {
        var aviso = new Restriction("piernas", Set(), RestrictionLevel.Aviso);
        var bloqueo = new Restriction("cadera", Set(), RestrictionLevel.Bloqueo);

        Assert.Equal(RestrictionOutcome.Bloqueado, RestrictionRules.Check(Sentadilla, [aviso, bloqueo]).Outcome);
    }

    [Theory]
    [InlineData("hombros", "hombro_lateral", RestrictionOutcome.Aviso)]
    [InlineData("hombros", "hombro_frontal", RestrictionOutcome.Aviso)]
    [InlineData("hombro_lateral", "hombro_lateral", RestrictionOutcome.Aviso)]
    [InlineData("hombro_lateral", "hombro_frontal", RestrictionOutcome.Permitido)]
    public void AC_training_001_06_una_restriccion_sobre_el_grupo_cubre_las_cabezas_y_sobre_una_cabeza_solo_esa(
        string restrictionZone, string exerciseZone, RestrictionOutcome expected)
    {
        var restriction = new Restriction(restrictionZone, Set(), RestrictionLevel.Aviso);
        var exercise = new Exercise("Elevación", Set(exerciseZone), Set("elevacion_de_hombro"));

        Assert.Equal(expected, RestrictionRules.Check(exercise, [restriction]).Outcome);
    }

    // AC-07
    private static readonly decimal[] Loads = [95m, 100m, 105m, 110m];

    [Fact]
    public void AC_training_001_07_sube_a_la_siguiente_carga_disponible_con_12_en_la_serie_1_y_8_propias_en_la_serie_2()
    {
        var advice = LoadProgression.Advise(Log(12, 8, load: 100m), Loads);

        Assert.Equal(LoadAction.Subir, advice.Action);
        Assert.Equal(105m, advice.NextLoadKg);
        Assert.False(advice.MissingLoadData);
    }

    [Theory]
    [InlineData(11, 8)]
    [InlineData(12, 7)]
    [InlineData(9, 5)]
    public void AC_training_001_07_mantiene_la_carga_si_no_se_cumplen_ambas_condiciones(int set1, int set2Own)
    {
        var advice = LoadProgression.Advise(Log(set1, set2Own, load: 100m), Loads);

        Assert.Equal(LoadAction.Mantener, advice.Action);
        Assert.Equal(100m, advice.NextLoadKg);
    }

    [Fact]
    public void AC_training_001_07_sin_carga_superior_mantiene_y_avisa_que_falta_el_dato()
    {
        var advice = LoadProgression.Advise(Log(12, 8, load: 110m), Loads);

        Assert.Equal(LoadAction.Mantener, advice.Action);
        Assert.Equal(110m, advice.NextLoadKg);
        Assert.True(advice.MissingLoadData);
    }

    // AC-08
    [Fact]
    public void AC_training_001_08_lista_cada_parametro_con_su_tipo()
    {
        var result = MethodologyComparison.Compare(MethodProfile.HeavyDutyPersonalizado)
            .ToDictionary(c => c.Parameter, c => c.Type);

        Assert.Equal(ComparisonType.Coincide, result["Series de trabajo"]);
        Assert.Equal(ComparisonType.Coincide, result["Días entre sesiones del mismo músculo"]);
        Assert.Equal(ComparisonType.DentroDeLaVariacion, result["Rango de repeticiones"]);
        Assert.Equal(ComparisonType.Diferencia, result["Series de trabajo sin llegar al fallo"]);
        Assert.Equal(ComparisonType.Diferencia, result["Repeticiones asistidas por serie"]);
        Assert.Equal(ComparisonType.Diferencia, result["Tempo (negativa/positiva)"]);
        Assert.Equal(ComparisonType.Diferencia, result["Descanso entre series"]);
        Assert.Equal(ComparisonType.Diferencia, result["Progresión"]);
    }

    [Fact]
    public void AC_training_001_08_un_perfil_igual_a_la_referencia_no_tiene_diferencias()
    {
        var reference = MethodProfile.HeavyDutyPersonalizado with
        {
            WorkingSetsNotToFailure = 0,
            AssistedRepsTypicalMax = 4,
            PositiveSeconds = 4,
            RestSecondsBetweenSets = 240,
            MinTargetReps = 6,
            MaxRepsCeiling = 8,
            Progression = ProgressionKind.DobleProgresionPorcentaje,
        };

        Assert.DoesNotContain(MethodologyComparison.Compare(reference), c => c.Type == ComparisonType.Diferencia);
    }

    // AC-10
    [Theory]
    [InlineData("2026-12-31", false)]
    [InlineData("2027-01-15", true)]
    [InlineData("2027-02-01", true)]
    public void AC_training_001_10_avisa_cuando_llega_o_pasa_la_fecha_de_revision(string today, bool due)
    {
        var restriction = new Restriction("abdomen", Set(), RestrictionLevel.Bloqueo, ReviewOn: new DateOnly(2027, 1, 15));

        Assert.Equal(due, restriction.IsDueForReview(DateOnly.Parse(today)));
    }

    [Fact]
    public void AC_training_001_10_sin_fecha_de_revision_nunca_avisa()
    {
        var restriction = new Restriction("abdomen", Set(), RestrictionLevel.Bloqueo);

        Assert.False(restriction.IsDueForReview(new DateOnly(2030, 1, 1)));
    }

    [Fact]
    public void AC_training_001_10_vencida_la_revision_el_nivel_no_cambia_solo()
    {
        var restriction = new Restriction("abdomen", Set(), RestrictionLevel.Bloqueo, ReviewOn: new DateOnly(2027, 1, 15));

        Assert.True(restriction.IsDueForReview(new DateOnly(2027, 3, 1)));
        Assert.Equal(RestrictionOutcome.Bloqueado, RestrictionRules.Check(Crunch, [restriction]).Outcome);
    }

    // AC-09
    [Fact]
    public void AC_training_001_09_avisa_tras_3_sesiones_sin_progreso()
    {
        var history = new[] { Log(9, 5, dayOffset: 0), Log(9, 5, dayOffset: 7), Log(9, 5, dayOffset: 14), Log(9, 5, dayOffset: 21) };

        var result = Stagnation.Check(history);

        Assert.True(result.IsStagnant);
        Assert.Equal(3, result.SessionsWithoutProgress);
        Assert.Equal("Llevas 3 sesiones sin mejorar en este ejercicio.", result.Message);
    }

    [Fact]
    public void AC_training_001_09_con_2_sesiones_sin_progreso_aun_no_avisa()
    {
        var history = new[] { Log(9, 5, dayOffset: 0), Log(9, 5, dayOffset: 7), Log(9, 5, dayOffset: 14) };

        var result = Stagnation.Check(history);

        Assert.False(result.IsStagnant);
        Assert.Null(result.Message);
    }

    [Fact]
    public void AC_training_001_09_mas_repeticiones_propias_cuentan_como_progreso()
    {
        var history = new[] { Log(9, 5, dayOffset: 0), Log(9, 5, dayOffset: 7), Log(9, 5, dayOffset: 14), Log(9, 6, dayOffset: 21) };

        Assert.False(Stagnation.Check(history).IsStagnant);
    }

    [Fact]
    public void AC_training_001_09_las_repeticiones_asistidas_no_cuentan_como_progreso()
    {
        var history = new[]
        {
            Log(9, 5, assisted: 3, dayOffset: 0), Log(9, 5, assisted: 4, dayOffset: 7),
            Log(9, 5, assisted: 5, dayOffset: 14), Log(9, 5, assisted: 6, dayOffset: 21),
        };

        Assert.True(Stagnation.Check(history).IsStagnant);
    }

    [Fact]
    public void AC_training_001_09_al_subir_la_carga_la_comparacion_se_reinicia()
    {
        var history = new[]
        {
            Log(9, 5, dayOffset: 0), Log(9, 5, dayOffset: 7), Log(9, 5, dayOffset: 14),
            Log(7, 4, load: 105m, dayOffset: 21),
        };

        Assert.False(Stagnation.Check(history).IsStagnant);
    }

    [Fact]
    public void AC_training_001_09_el_umbral_es_configurable()
    {
        var history = new[] { Log(9, 5, dayOffset: 0), Log(9, 5, dayOffset: 7), Log(9, 5, dayOffset: 14) };

        Assert.True(Stagnation.Check(history, threshold: 2).IsStagnant);
    }

    // SPEC-training-003, AC-03: el peso corporal admite carga 0 (lastre opcional); el resto exige carga mayor que cero.
    [Fact]
    public void AC_training_003_03_peso_corporal_admite_carga_cero_y_el_resto_no()
    {
        var sets = new[] { new EffectiveSet(9), new EffectiveSet(5, 5) };

        var log = ExerciseLog.Register(Day, 0m, sets, allowZeroLoad: true);

        Assert.Equal(0m, log.LoadKg);
        Assert.Throws<ArgumentOutOfRangeException>(() => ExerciseLog.Register(Day, 0m, sets));
        Assert.Throws<ArgumentOutOfRangeException>(() => ExerciseLog.Register(Day, -1m, sets, allowZeroLoad: true));
    }

    // SPEC-training-003, AC-11: bajar de carga reinicia la racha.
    [Fact]
    public void AC_training_003_11_bajar_de_carga_reinicia_la_racha()
    {
        var history = new[]
        {
            Log(9, 5, dayOffset: 0), Log(9, 5, dayOffset: 7), Log(9, 5, dayOffset: 14),
            Log(9, 5, load: 90m, dayOffset: 21),
        };

        var result = Stagnation.Check(history);

        Assert.False(result.IsStagnant);
        Assert.Equal(0, result.SessionsWithoutProgress);
    }

    [Fact]
    public void AC_training_003_11_tras_bajar_de_carga_la_racha_cuenta_desde_la_nueva_carga()
    {
        var history = new[]
        {
            Log(9, 5, dayOffset: 0), Log(9, 5, dayOffset: 7),
            Log(9, 5, load: 90m, dayOffset: 14), Log(9, 5, load: 90m, dayOffset: 21), Log(9, 5, load: 90m, dayOffset: 28),
            Log(9, 5, load: 90m, dayOffset: 35),
        };

        var result = Stagnation.Check(history);

        Assert.True(result.IsStagnant);
        Assert.Equal(3, result.SessionsWithoutProgress);
    }
}
