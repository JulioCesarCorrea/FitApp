namespace FitnessApp.Api.Domain.Training;

public enum RestrictionLevel { Contexto = 1, Aviso = 2, Bloqueo = 3 }

/// <summary>Restricción del perfil de una persona (P3). Es un dato, no una regla del código.</summary>
public sealed record Restriction(
    string Zone,
    IReadOnlySet<string> AvoidedMovements,
    RestrictionLevel Level,
    DateOnly? ReviewOn = null)
{
    /// <summary>Avisa que toca revisarla; el nivel no cambia solo (AC-training-001-10).</summary>
    public bool IsDueForReview(DateOnly today) => ReviewOn is { } date && today >= date;
}

public sealed record Exercise(string Name, IReadOnlySet<string> Zones, IReadOnlySet<string> Movements);

public enum RestrictionOutcome { Permitido, Contexto, Aviso, Bloqueado }

public sealed record RestrictionCheck(RestrictionOutcome Outcome, IReadOnlyList<Restriction> Affecting);

/// <summary>Aplica el nivel de las restricciones a un ejercicio (AC-training-001-06).</summary>
public static class RestrictionRules
{
    public static RestrictionCheck Check(Exercise exercise, IEnumerable<Restriction> restrictions)
    {
        var affecting = restrictions.Where(r => Affects(r, exercise)).ToList();
        if (affecting.Count == 0) return new RestrictionCheck(RestrictionOutcome.Permitido, affecting);

        var outcome = affecting.Max(r => r.Level) switch
        {
            RestrictionLevel.Bloqueo => RestrictionOutcome.Bloqueado,
            RestrictionLevel.Aviso => RestrictionOutcome.Aviso,
            _ => RestrictionOutcome.Contexto,
        };
        return new RestrictionCheck(outcome, affecting);
    }

    private static bool Affects(Restriction r, Exercise e) =>
        e.Zones.Any(z => Zones.Covers(r.Zone, z))
        || r.AvoidedMovements.Any(m => e.Movements.Contains(m, StringComparer.OrdinalIgnoreCase));
}
