namespace FitnessApp.Api.Domain.Ai;

/// <summary>Contrato del análisis (SPEC-ai-002): solo agregados y etiquetas, clase B (P5), sin nombre ni identificadores.</summary>
public sealed record AnalysisContract(
    [property: AiField(DataClass.B)] string Scope,
    [property: AiField(DataClass.B)] string Aggregates,
    [property: AiField(DataClass.B)] string[] RestrictionLabels,
    [property: AiField(DataClass.B)] string[] AllergyTags) : IAiContract;

/// <summary>Contrato de las propuestas de plan: rutina del catálogo y alimentos propios (ya sin los que chocan con las alergias).</summary>
public sealed record PlanContract(
    [property: AiField(DataClass.B)] string Scope,
    [property: AiField(DataClass.B)] string Options,
    [property: AiField(DataClass.B)] string[] RestrictionLabels,
    [property: AiField(DataClass.B)] string[] AllergyTags) : IAiContract;

/// <summary>
/// Propuesta de la IA que la persona acepta o rechaza (SPEC-ai-002, P4): nada se aplica solo. Guarda los cambios ya validados contra las
/// reglas deterministas y, al aceptarla, queda como el origen «ia» de lo que se aplicó.
/// </summary>
public class AiProposal
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }

    /// <summary>training | nutrition.</summary>
    public string Scope { get; set; } = "";

    public string Summary { get; set; } = "";

    /// <summary>Lista de cambios en JSON (<c>ProposedChange</c>).</summary>
    public string ChangesJson { get; set; } = "[]";

    /// <summary>pending | accepted | rejected.</summary>
    public string Status { get; set; } = "pending";

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
}

/// <summary>Un cambio concreto de una propuesta: sustituir un ejercicio de la rutina o añadir un alimento propio a una comida de hoy.</summary>
public sealed record ProposedChange(
    string Kind, string Reason, string? Day = null, string? FromExerciseId = null, string? ToExerciseId = null, string? ToExerciseName = null,
    string? Meal = null, Guid? FoodId = null, string? FoodName = null, int? Grams = null)
{
    public const string ReplaceExercise = "replace_exercise";
    public const string AddEntry = "add_entry";
}
