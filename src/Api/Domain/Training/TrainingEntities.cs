namespace FitnessApp.Api.Domain.Training;

/// <summary>Ejercicio del catálogo base (SPEC-training-002). Solo lectura para las personas.</summary>
public class CatalogExercise
{
    /// <summary>Identificador estable en ASCII; también es el nombre base de sus imágenes.</summary>
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Section { get; set; } = "";
    public int SortOrder { get; set; }
    public string PrimaryZone { get; set; } = "";
    public string[] SecondaryZones { get; set; } = [];
    public string[] Movements { get; set; } = [];
    public EquipmentKind Equipment { get; set; }
    public BarKind? Bar { get; set; }
}

/// <summary>Ejercicio de la rutina de una persona en un día.</summary>
public class PlanEntry
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public DayOfWeek Day { get; set; }
    public string ExerciseId { get; set; } = "";
    public int Order { get; set; }

    /// <summary>Escalón propio de esta máquina; si es null se usa el del perfil de equipamiento.</summary>
    public decimal? MachineStepKg { get; set; }
}

/// <summary>Perfil de equipamiento de una persona (uno por persona).</summary>
public class EquipmentSettings
{
    public Guid UserId { get; set; }
    public decimal[] DumbbellsKg { get; set; } = [];
    public decimal[] DiscsKg { get; set; } = [];
    public decimal? RectaBarKg { get; set; }
    public decimal? ZBarKg { get; set; }
    public decimal? SmithBarKg { get; set; }
    public decimal? RemoEnTBarKg { get; set; }
    public decimal MachineStepKg { get; set; }
    public decimal MachineBaseKg { get; set; }
}

/// <summary>Registro de un ejercicio en una fecha (SPEC-training-003). Uno por persona, ejercicio y fecha.</summary>
public class ExerciseLogEntry
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string ExerciseId { get; set; } = "";
    public DateOnly Date { get; set; }
    public decimal LoadKg { get; set; }
    public int FirstSetReps { get; set; }
    public int SecondSetReps { get; set; }
    public int SecondSetAssistedReps { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Ajustes de entrenamiento de una persona (uno por persona).</summary>
public class TrainingSettings
{
    public Guid UserId { get; set; }
    public int StagnationThreshold { get; set; } = Stagnation.DefaultThreshold;
}

/// <summary>Restricción de una persona (P3). La API para gestionarlas llega con su propia spec.</summary>
public class UserRestriction
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Zone { get; set; } = "";
    public string[] AvoidedMovements { get; set; } = [];
    public RestrictionLevel Level { get; set; }
    public DateOnly? ReviewOn { get; set; }
}
