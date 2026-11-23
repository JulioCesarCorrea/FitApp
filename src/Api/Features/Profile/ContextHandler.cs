using FitnessApp.Api.Domain.Profile;
using FitnessApp.Api.Infrastructure;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Profile;

public sealed record ContextItemRequest(
    string? Type, string? Name, string? Brand, string? Dose, string? Frequency, DateOnly? StartedOn, DateOnly? EndedOn, string? Note, bool ShareWithAi);

public sealed record ContextItemDto(
    Guid Id, string Type, string Name, string? Brand, string? Dose, string? Frequency, DateOnly? StartedOn, DateOnly? EndedOn, string? Note,
    bool ShareWithAi);

/// <summary>AC-01 a 04: reglas de una entrada de contexto.</summary>
public sealed class ContextItemRequestValidator : AbstractValidator<ContextItemRequest>
{
    private static readonly DateOnly Earliest = new(1900, 1, 1);

    public ContextItemRequestValidator()
    {
        RuleFor(x => x.Type).Must(t => t is not null && ContextRules.Types.Contains(t)).WithMessage("El tipo no es válido.");
        RuleFor(x => x.Name).NotEmpty().WithMessage("El nombre es obligatorio.")
            .MaximumLength(ContextRules.MaxName).WithMessage($"El nombre admite hasta {ContextRules.MaxName} caracteres.");
        RuleFor(x => x.Brand).MaximumLength(ContextRules.MaxBrand).WithMessage($"La marca admite hasta {ContextRules.MaxBrand} caracteres.");
        RuleFor(x => x.Dose).MaximumLength(ContextRules.MaxDose).WithMessage($"La dosis admite hasta {ContextRules.MaxDose} caracteres.");
        RuleFor(x => x.Note).MaximumLength(ContextRules.MaxNote).WithMessage($"La nota admite hasta {ContextRules.MaxNote} caracteres.");
        RuleFor(x => x.Frequency).Must(f => string.IsNullOrEmpty(f) || ContextRules.Frequencies.Contains(f)).WithMessage("La frecuencia no es válida.");
        RuleFor(x => x.StartedOn).Must(d => d is null || d >= Earliest).WithMessage("La fecha de inicio no es válida.");
        RuleFor(x => x.EndedOn).Must(d => d is null || d >= Earliest).WithMessage("La fecha de baja no es válida.");
        RuleFor(x => x).Must(x => x.StartedOn is null || x.EndedOn is null || x.EndedOn >= x.StartedOn)
            .WithName("EndedOn").WithMessage("La baja no puede ser anterior al inicio.");

        // AC-03 (P5): la medicación es clase A, nunca se comparte.
        RuleFor(x => x.ShareWithAi).Must(s => !s).When(x => x.Type == ContextRules.Medication)
            .WithMessage("La medicación nunca se comparte con la IA.");

        // AC-04: una nota es texto corto, sin dosis ni frecuencia y sin datos personales evidentes.
        When(x => x.Type == ContextRules.NoteType, () =>
        {
            RuleFor(x => x.Dose).Must(string.IsNullOrWhiteSpace).WithMessage("Una nota no lleva dosis.");
            RuleFor(x => x.Frequency).Must(string.IsNullOrWhiteSpace).WithMessage("Una nota no lleva frecuencia.");
            RuleFor(x => x.Name).Must(n => !ContextRules.LooksPersonal(n)).WithMessage("No escribas correos, teléfonos ni enlaces en una nota.");
            RuleFor(x => x.Note).Must(n => !ContextRules.LooksPersonal(n)).WithMessage("No escribas correos, teléfonos ni enlaces en una nota.");
        });
    }
}

public abstract record PutContextResult
{
    public sealed record Saved(ContextItemDto Item, bool Created) : PutContextResult;
    public sealed record NotFound : PutContextResult;
    public sealed record LimitReached : PutContextResult;
}

/// <summary>Casos de uso de SPEC-profile-002. Todo filtra por la persona que llama (P7).</summary>
public sealed class ContextHandler(AppDbContext db, TimeProvider clock)
{
    private DateOnly Today => DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);

    private static ContextItemDto ToDto(ContextItem i) =>
        new(i.Id, i.Type, i.Name, i.Brand, i.Dose, i.Frequency, i.StartedOn, i.EndedOn, i.Note, i.ShareWithAi);

    /// <summary>AC-05: las de la persona, ordenadas por tipo y nombre; con <paramref name="activeOnly"/> solo las activas.</summary>
    public async Task<List<ContextItemDto>> ListAsync(Guid userId, bool activeOnly, CancellationToken ct)
    {
        var today = Today;
        var query = db.ContextItems.AsNoTracking().Where(i => i.UserId == userId);
        if (activeOnly) query = query.Where(i => i.EndedOn == null || i.EndedOn > today);
        var rows = await query.ToListAsync(ct);
        return rows.OrderBy(i => Array.IndexOf(ContextRules.Types, i.Type)).ThenBy(i => i.Name, StringComparer.Ordinal).Select(ToDto).ToList();
    }

    /// <summary>AC-01, 07 y 08: crea o reemplaza; un id de otra persona es 404; la entrada 51 activa es 409.</summary>
    public async Task<PutContextResult> PutAsync(Guid userId, Guid id, ContextItemRequest request, CancellationToken ct, bool retryOnConflict = true)
    {
        var existing = await db.ContextItems.FirstOrDefaultAsync(i => i.Id == id, ct);
        if (existing is not null && existing.UserId != userId) return new PutContextResult.NotFound();

        var created = existing is null;
        var today = Today;
        // El tope cuenta solo las activas: dar de baja libera espacio y editar una existente nunca lo supera.
        if (created && IsActive(request.EndedOn, today)
            && await db.ContextItems.CountAsync(i => i.UserId == userId && (i.EndedOn == null || i.EndedOn > today), ct) >= ContextRules.MaxActive)
            return new PutContextResult.LimitReached();

        if (existing is null)
        {
            existing = new ContextItem { Id = id, UserId = userId, CreatedAt = clock.GetUtcNow() };
            db.ContextItems.Add(existing);
        }

        existing.Type = request.Type!;
        existing.Name = request.Name!.Trim();
        existing.Brand = Clean(request.Brand);
        existing.Dose = Clean(request.Dose);
        existing.Frequency = Clean(request.Frequency);
        existing.StartedOn = request.StartedOn;
        existing.EndedOn = request.EndedOn;
        existing.Note = Clean(request.Note);
        existing.ShareWithAi = request.ShareWithAi && request.Type != ContextRules.Medication;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException) when (retryOnConflict)
        {
            // Carrera: otra petición guardó el mismo id entre la lectura y la escritura; se resuelve como reemplazo.
            db.ChangeTracker.Clear();
            return await PutAsync(userId, id, request, ct, retryOnConflict: false);
        }

        return new PutContextResult.Saved(ToDto(existing), created);
    }

    private static bool IsActive(DateOnly? endedOn, DateOnly today) => ContextRules.IsActive(endedOn, today);

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>AC-06: uno ajeno o inexistente no hace nada.</summary>
    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct) =>
        await db.ContextItems.Where(i => i.Id == id && i.UserId == userId).ExecuteDeleteAsync(ct);

    /// <summary>AC-09, 10 y 11: el resumen para la IA; vacío si no hay nada que compartir.</summary>
    public async Task<string?> SummaryAsync(Guid userId, CancellationToken ct)
    {
        var items = await db.ContextItems.AsNoTracking().Where(i => i.UserId == userId && i.ShareWithAi).ToListAsync(ct);
        var summary = ContextRules.Summary(items, Today);
        return summary.Length == 0 ? null : summary;
    }
}
