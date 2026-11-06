namespace FitnessApp.Api.Domain.Profile;

/// <summary>Perfil de una persona (SPEC-profile-001): uno por persona. Datos personales: clase A/B (P5).</summary>
public class UserProfile
{
    public Guid UserId { get; set; }
    public string DisplayName { get; set; } = "";
    public string Sex { get; set; } = "";
    public DateOnly BirthDate { get; set; }
    public int HeightCm { get; set; }
    public string Goal { get; set; } = "";
    public string ActivityLevel { get; set; } = ProfileRules.DefaultActivityLevel;
    public string? ExperienceLevel { get; set; }
    public int? DaysPerWeek { get; set; }
    public string Methodology { get; set; } = ProfileRules.DefaultMethodology;
    public string[] Allergies { get; set; } = [];
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>Valores admitidos del perfil (SPEC-profile-001).</summary>
public static class ProfileRules
{
    public const int MaxNameLength = 40;
    public const int MinAge = 14;
    public const int MaxAge = 100;
    public const int MinHeightCm = 100;
    public const int MaxHeightCm = 250;
    public const int MaxAllergies = 20;
    public const int MaxAllergyLength = 40;
    public const string DefaultActivityLevel = "ligero";
    public const string DefaultMethodology = "heavy_duty_personalizado";

    public static readonly string[] Sexes = ["masculino", "femenino"];
    public static readonly string[] Goals = ["bajar_grasa", "ganar_musculo", "mantener"];
    public static readonly string[] ActivityLevels = ["sedentario", "ligero", "moderado", "muy_activo"];
    public static readonly string[] ExperienceLevels = ["principiante", "intermedio", "avanzado"];
    public static readonly string[] Methodologies = [DefaultMethodology];

    /// <summary>Edad cumplida en <paramref name="today"/>.</summary>
    public static int AgeOn(DateOnly birth, DateOnly today)
    {
        var age = today.Year - birth.Year;
        if (birth > today.AddYears(-age)) age--;
        return age;
    }
}
