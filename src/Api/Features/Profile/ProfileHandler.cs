using FitnessApp.Api.Domain.Profile;
using FitnessApp.Api.Infrastructure;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Profile;

public sealed record ProfileRequest(
    string DisplayName,
    string Sex,
    DateOnly BirthDate,
    int HeightCm,
    string Goal,
    string? ActivityLevel,
    string? ExperienceLevel,
    int? DaysPerWeek,
    string? Methodology,
    string[]? Allergies);

public sealed record ProfileDto(
    bool Configured,
    string? DisplayName,
    string? Sex,
    DateOnly? BirthDate,
    int? HeightCm,
    string? Goal,
    string? ActivityLevel,
    string? ExperienceLevel,
    int? DaysPerWeek,
    string? Methodology,
    string[] Allergies);

public sealed class ProfileRequestValidator : AbstractValidator<ProfileRequest>
{
    public ProfileRequestValidator(TimeProvider clock)
    {
        RuleFor(x => x.DisplayName).Must(n => !string.IsNullOrWhiteSpace(n) && n.Trim().Length <= ProfileRules.MaxNameLength)
            .WithMessage($"El nombre debe tener de 1 a {ProfileRules.MaxNameLength} caracteres.");
        RuleFor(x => x.Sex).Must(v => v is not null && ProfileRules.Sexes.Contains(v))
            .WithMessage("El sexo debe ser masculino o femenino.");
        RuleFor(x => x.BirthDate).Must(d =>
            {
                var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
                return d <= today && ProfileRules.AgeOn(d, today) is >= ProfileRules.MinAge and <= ProfileRules.MaxAge;
            })
            .WithMessage($"La fecha de nacimiento debe corresponder a una edad de {ProfileRules.MinAge} a {ProfileRules.MaxAge} años.");
        RuleFor(x => x.HeightCm).InclusiveBetween(ProfileRules.MinHeightCm, ProfileRules.MaxHeightCm)
            .WithMessage($"La estatura debe estar entre {ProfileRules.MinHeightCm} y {ProfileRules.MaxHeightCm} cm.");
        RuleFor(x => x.Goal).Must(v => v is not null && ProfileRules.Goals.Contains(v))
            .WithMessage("El objetivo debe ser bajar_grasa, ganar_musculo o mantener.");
        RuleFor(x => x.ActivityLevel).Must(v => ProfileRules.ActivityLevels.Contains(v!)).When(x => x.ActivityLevel is not null)
            .WithMessage("El nivel de actividad no es válido.");
        RuleFor(x => x.ExperienceLevel).Must(v => ProfileRules.ExperienceLevels.Contains(v!)).When(x => x.ExperienceLevel is not null)
            .WithMessage("La experiencia no es válida.");
        RuleFor(x => x.Methodology).Must(v => ProfileRules.Methodologies.Contains(v!)).When(x => x.Methodology is not null)
            .WithMessage("La metodología no es válida.");
        RuleFor(x => x.DaysPerWeek).InclusiveBetween(1, 7).When(x => x.DaysPerWeek is not null)
            .WithMessage("Los días por semana deben estar entre 1 y 7.");
        RuleFor(x => x.Allergies).Must(a => a is null || a.Length <= ProfileRules.MaxAllergies)
            .WithMessage($"Se admiten como máximo {ProfileRules.MaxAllergies} alergias o preferencias.");
        RuleForEach(x => x.Allergies).Must(a => !string.IsNullOrWhiteSpace(a) && a.Trim().Length <= ProfileRules.MaxAllergyLength)
            .WithMessage($"Cada alergia o preferencia debe tener de 1 a {ProfileRules.MaxAllergyLength} caracteres.");
    }
}

/// <summary>Perfil de la persona (SPEC-profile-001, AC-01 a 05). Todo se filtra por el `user_id` de quien llama (P7).</summary>
public sealed class ProfileHandler(AppDbContext db, TimeProvider clock)
{
    public async Task<ProfileDto> GetAsync(Guid userId, CancellationToken ct)
    {
        var row = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == userId, ct);
        return row is null ? new ProfileDto(false, null, null, null, null, null, null, null, null, null, []) : ToDto(row);
    }

    /// <summary>Reemplaza el perfil entero. Devuelve si se creó (true) o se reemplazó (false).</summary>
    public async Task<(bool Created, ProfileDto Profile)> SaveAsync(Guid userId, ProfileRequest request, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            var row = await db.Profiles.FirstOrDefaultAsync(p => p.UserId == userId, ct);
            var created = row is null;
            if (row is null)
            {
                row = new UserProfile { UserId = userId };
                db.Profiles.Add(row);
            }

            row.DisplayName = request.DisplayName.Trim();
            row.Sex = request.Sex;
            row.BirthDate = request.BirthDate;
            row.HeightCm = request.HeightCm;
            row.Goal = request.Goal;
            row.ActivityLevel = request.ActivityLevel ?? ProfileRules.DefaultActivityLevel;
            row.ExperienceLevel = request.ExperienceLevel;
            row.DaysPerWeek = request.DaysPerWeek;
            row.Methodology = request.Methodology ?? ProfileRules.DefaultMethodology;
            row.Allergies = (request.Allergies ?? []).Select(a => a.Trim()).ToArray();
            row.UpdatedAt = clock.GetUtcNow();

            try
            {
                await db.SaveChangesAsync(ct);
                return (created, ToDto(row));
            }
            catch (DbUpdateException) when (attempt == 0)
            {
                // Carrera: otro envío de la misma persona creó el perfil entre la lectura y la escritura.
                db.ChangeTracker.Clear();
            }
        }
    }

    private static ProfileDto ToDto(UserProfile p) => new(
        true, p.DisplayName, p.Sex, p.BirthDate, p.HeightCm, p.Goal, p.ActivityLevel,
        p.ExperienceLevel, p.DaysPerWeek, p.Methodology, p.Allergies);
}
