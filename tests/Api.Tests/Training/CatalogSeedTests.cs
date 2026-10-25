using System.Text.RegularExpressions;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Infrastructure.Seed;

namespace FitnessApp.Api.Tests.Training;

/// <summary>Verifica que la carga inicial del catálogo respeta el vocabulario aprobado (SPEC-training-002). Sin base de datos.</summary>
public sealed class CatalogSeedTests
{
    private static readonly string[] Zonas =
    [
        "pecho", "espalda", "trapecio", "hombro_frontal", "hombro_lateral", "hombro_posterior", "biceps", "triceps",
        "antebrazos", "abdomen", "espalda_baja", "cuadriceps", "gluteo", "isquiotibiales", "aductores", "pantorrillas",
    ];

    private static readonly string[] Secciones =
    [
        "Pecho", "Espalda", "Hombros", "Cuádriceps", "Glúteo", "Isquiotibiales", "Bíceps", "Tríceps", "Pantorrillas", "Abdomen",
    ];

    [Fact]
    public void AC_training_002_01_el_catalogo_base_tiene_103_ejercicios_en_10_secciones()
    {
        var catalog = CatalogSeed.Load();

        Assert.Equal(103, catalog.Count);
        Assert.Equal(Secciones, catalog.Select(e => e.Section).Distinct().ToArray());
    }

    [Fact]
    public void AC_training_002_01_los_identificadores_son_unicos_y_en_ascii()
    {
        var ids = CatalogSeed.Load().Select(e => e.Id).ToList();

        Assert.Equal(ids.Count, ids.Distinct().Count());
        Assert.All(ids, id => Assert.Matches(new Regex("^[a-z0-9-]+$"), id));
    }

    [Fact]
    public void AC_training_002_01_las_zonas_pertenecen_a_la_lista_controlada()
    {
        foreach (var e in CatalogSeed.Load())
        {
            Assert.Contains(e.PrimaryZone, Zonas);
            Assert.All(e.SecondaryZones, z => Assert.Contains(z, Zonas));
        }
    }

    [Fact]
    public void AC_training_002_01_las_barras_declaran_su_tipo_y_los_demas_equipos_no()
    {
        foreach (var e in CatalogSeed.Load())
            Assert.Equal(e.Equipment == EquipmentKind.Barra, e.Bar is not null);
    }
}
