namespace FitnessApp.Api.Domain.Training;

/// <summary>Zonas del catálogo. «hombros» es un grupo que contiene las tres cabezas (SPEC-training-002).</summary>
public static class Zones
{
    private static readonly Dictionary<string, string[]> Groups = new(StringComparer.OrdinalIgnoreCase)
    {
        ["hombros"] = ["hombro_frontal", "hombro_lateral", "hombro_posterior"],
    };

    /// <summary>Una restricción sobre un grupo cubre a todos sus miembros; sobre una zona, solo a ella.</summary>
    public static bool Covers(string restrictionZone, string exerciseZone) =>
        string.Equals(restrictionZone, exerciseZone, StringComparison.OrdinalIgnoreCase)
        || (Groups.TryGetValue(restrictionZone, out var members)
            && members.Contains(exerciseZone, StringComparer.OrdinalIgnoreCase));
}
