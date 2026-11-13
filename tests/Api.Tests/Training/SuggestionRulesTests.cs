using FitnessApp.Api.Domain.Training;

namespace FitnessApp.Api.Tests.Training;

/// <summary>Reglas puras de SPEC-training-005, sin base de datos ni red.</summary>
public sealed class SuggestionRulesTests
{
    private static CatalogExercise Exercise(string id, string equipment, int sort, params string[] movements) =>
        new() { Id = id, Name = id, PrimaryZone = "pecho", Equipment = Enum.Parse<EquipmentKind>(equipment), SortOrder = sort, Movements = movements };

    [Theory]
    [InlineData("2026-11-09", "2026-11-09")] // lunes
    [InlineData("2026-11-12", "2026-11-09")] // jueves
    [InlineData("2026-11-15", "2026-11-09")] // domingo
    public void AC_training_005_06_el_lunes_de_la_semana(string date, string monday)
    {
        Assert.Equal(DateOnly.Parse(monday), SuggestionRules.MondayOf(DateOnly.Parse(date)));
    }

    [Fact]
    public void AC_training_005_06_un_dia_sin_registros_en_las_dos_semanas_se_omite_y_uno_registrado_en_cualquiera_no()
    {
        var today = new DateOnly(2026, 11, 12); // jueves; semanas evaluadas: del 26-oct al 8-nov
        var old = new DateOnly(2026, 10, 20); // historial anterior a esas dos semanas
        var plan = new HashSet<DayOfWeek> { DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Saturday };
        var logs = new HashSet<DateOnly> { old, new DateOnly(2026, 10, 28), new DateOnly(2026, 11, 7) }; // miércoles y sábado

        var omitted = SuggestionRules.OmittedDays(plan, logs, today);

        var item = Assert.Single(omitted);
        Assert.Equal((DayOfWeek.Tuesday, new DateOnly(2026, 11, 2)), item);
    }

    [Fact]
    public void AC_training_005_06_sin_historial_anterior_a_las_dos_semanas_no_se_evalua()
    {
        var today = new DateOnly(2026, 11, 12);
        var plan = new HashSet<DayOfWeek> { DayOfWeek.Tuesday };

        Assert.Empty(SuggestionRules.OmittedDays(plan, new HashSet<DateOnly>(), today));
        Assert.Empty(SuggestionRules.OmittedDays(plan, new HashSet<DateOnly> { new(2026, 10, 27) }, today)); // ya dentro de las semanas
    }

    [Theory]
    [InlineData(4, true)]
    [InlineData(5, false)]
    [InlineData(1, true)]
    public void AC_training_005_07_menos_de_5_dias_entre_dos_registros(int gap, bool expected)
    {
        var today = new DateOnly(2026, 11, 12);
        var dates = new[] { today.AddDays(-10 - gap), today.AddDays(-10) };

        Assert.Equal(expected, SuggestionRules.ShortRecovery(dates, today) is not null);
    }

    [Fact]
    public void AC_training_005_07_se_devuelve_el_ultimo_par_y_se_ignora_lo_anterior_a_4_semanas()
    {
        var today = new DateOnly(2026, 11, 12);
        var dates = new[] { today.AddDays(-40), today.AddDays(-38), today.AddDays(-9), today.AddDays(-5), today.AddDays(-2) };

        var pair = SuggestionRules.ShortRecovery(dates, today);

        Assert.Equal((today.AddDays(-5), today.AddDays(-2)), pair);
        Assert.Null(SuggestionRules.ShortRecovery([today.AddDays(-40), today.AddDays(-38)], today));
    }

    [Fact]
    public void AC_training_005_03_las_alternativas_se_ordenan_por_movimiento_compartido_luego_por_otro_equipo_y_luego_por_catalogo()
    {
        var current = Exercise("actual", "Mancuernas", 10, "empuje_horizontal");
        var candidates = new[]
        {
            Exercise("a-otro-movimiento-misma-mano", "Mancuernas", 1, "empuje_inclinado"),
            Exercise("b-comparte-mismo-equipo", "Mancuernas", 5, "empuje_horizontal"),
            Exercise("c-comparte-otro-equipo-tarde", "Maquina", 9, "empuje_horizontal"),
            Exercise("d-comparte-otro-equipo-pronto", "Barra", 2, "empuje_horizontal"),
            Exercise("e-otro-movimiento-otro-equipo", "Barra", 3, "empuje_inclinado"),
        };

        var ranked = SuggestionRules.RankAlternatives(current, candidates).Select(c => c.Id);

        Assert.Equal(["d-comparte-otro-equipo-pronto", "c-comparte-otro-equipo-tarde", "b-comparte-mismo-equipo"], ranked);
    }

    [Fact]
    public void AC_training_005_01_la_clave_incluye_el_tipo_la_referencia_y_la_fecha_del_dato()
    {
        Assert.Equal("metodo:press:2026-11-01", SuggestionRules.Key(SuggestionKind.Metodo, "press", new DateOnly(2026, 11, 1)));
        Assert.Equal("restriccion-choque:press:martes:aviso", SuggestionRules.Key(SuggestionKind.RestriccionChoque, "press:martes:aviso"));
    }
}
