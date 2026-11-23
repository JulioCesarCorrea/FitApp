namespace FitnessApp.Api.Domain.Training;

/// <summary>
/// Qué registros cuentan para el consejo de carga y el estancamiento tras un cambio de metodología (SPEC-training-007): solo los
/// de la metodología vigente de la persona; cada registro conserva la suya y nada se convierte. Sin metodología vigente (sin perfil
/// guardado) manda la del último registro, como antes (SPEC-training-004, AC-08). Vectores `methodologySwitch` en
/// progression-vectors.json, compartidos con la app (ADR-0004).
/// </summary>
public static class MethodologyHistory
{
    public static List<T> Relevant<T>(IReadOnlyList<T> orderedRows, Func<T, string> methodologyOf, string? current)
    {
        var methodology = current ?? (orderedRows.Count > 0 ? methodologyOf(orderedRows[^1]) : null);
        return orderedRows.Where(r => methodologyOf(r) == methodology).ToList();
    }
}
