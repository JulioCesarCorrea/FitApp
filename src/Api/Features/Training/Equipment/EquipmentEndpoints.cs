using FitnessApp.Api.Common;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Infrastructure;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Training.Equipment;

/// <param name="BarsKg">Claves admitidas: recta, z, smith, remo_en_t.</param>
public sealed record EquipmentRequest(
    decimal[] DumbbellsKg,
    Dictionary<string, decimal> BarsKg,
    decimal[] DiscsKg,
    decimal MachineStepKg,
    decimal MachineBaseKg);

public sealed record EquipmentDto(
    decimal[] DumbbellsKg,
    Dictionary<string, decimal> BarsKg,
    decimal[] DiscsKg,
    decimal MachineStepKg,
    decimal MachineBaseKg,
    bool Configured);

public sealed class EquipmentRequestValidator : AbstractValidator<EquipmentRequest>
{
    private static readonly string[] BarKeys = ["recta", "z", "smith", "remo_en_t"];

    public EquipmentRequestValidator()
    {
        RuleFor(x => x.DumbbellsKg).NotNull().Must(d => d is { Length: <= 60 }).WithMessage("Se admiten como máximo 60 mancuernas.");
        RuleForEach(x => x.DumbbellsKg).GreaterThan(0m).WithMessage("El peso de cada mancuerna debe ser mayor que cero.");

        RuleFor(x => x.DiscsKg).NotNull()
            .Must(d => d is { Length: <= EquipmentProfile.MaxDiscPairs })
            .WithMessage($"Se admiten como máximo {EquipmentProfile.MaxDiscPairs} pares de discos.");
        RuleForEach(x => x.DiscsKg).GreaterThan(0m).WithMessage("El peso de cada disco debe ser mayor que cero.");

        RuleFor(x => x.BarsKg).NotNull();
        RuleForEach(x => x.BarsKg).Must(b => BarKeys.Contains(b.Key) && b.Value > 0m)
            .WithMessage("Cada barra debe ser recta, z, smith o remo_en_t, con un peso mayor que cero.");

        RuleFor(x => x.MachineStepKg).GreaterThan(0m).WithMessage("El escalón de las máquinas debe ser mayor que cero.");
        RuleFor(x => x.MachineBaseKg).GreaterThanOrEqualTo(0m).WithMessage("La carga base de las máquinas no puede ser negativa.");
    }
}

/// <summary>Perfil de equipamiento de la persona (SPEC-training-002, AC-04).</summary>
public sealed class EquipmentHandler(AppDbContext db)
{
    public async Task<EquipmentDto> GetAsync(Guid userId, CancellationToken ct)
    {
        var row = await db.Equipment.AsNoTracking().FirstOrDefaultAsync(e => e.UserId == userId, ct);
        return row is null ? new EquipmentDto([], [], [], 0m, 0m, Configured: false) : ToDto(row);
    }

    public async Task<EquipmentDto> SaveAsync(Guid userId, EquipmentRequest request, CancellationToken ct)
    {
        var row = await db.Equipment.FirstOrDefaultAsync(e => e.UserId == userId, ct);
        if (row is null)
        {
            row = new EquipmentSettings { UserId = userId };
            db.Equipment.Add(row);
        }

        row.DumbbellsKg = request.DumbbellsKg;
        row.DiscsKg = request.DiscsKg;
        row.RectaBarKg = request.BarsKg.GetValueOrDefault("recta");
        row.ZBarKg = request.BarsKg.GetValueOrDefault("z");
        row.SmithBarKg = request.BarsKg.GetValueOrDefault("smith");
        row.RemoEnTBarKg = request.BarsKg.GetValueOrDefault("remo_en_t");
        row.RectaBarKg = row.RectaBarKg == 0m ? null : row.RectaBarKg;
        row.ZBarKg = row.ZBarKg == 0m ? null : row.ZBarKg;
        row.SmithBarKg = row.SmithBarKg == 0m ? null : row.SmithBarKg;
        row.RemoEnTBarKg = row.RemoEnTBarKg == 0m ? null : row.RemoEnTBarKg;
        row.MachineStepKg = request.MachineStepKg;
        row.MachineBaseKg = request.MachineBaseKg;

        await db.SaveChangesAsync(ct);
        return ToDto(row);
    }

    private static EquipmentDto ToDto(EquipmentSettings e)
    {
        var bars = new Dictionary<string, decimal>();
        if (e.RectaBarKg is { } recta) bars["recta"] = recta;
        if (e.ZBarKg is { } z) bars["z"] = z;
        if (e.SmithBarKg is { } smith) bars["smith"] = smith;
        if (e.RemoEnTBarKg is { } remo) bars["remo_en_t"] = remo;
        return new EquipmentDto(e.DumbbellsKg, bars, e.DiscsKg, e.MachineStepKg, e.MachineBaseKg, Configured: true);
    }
}

public static class EquipmentEndpoints
{
    public static void MapEquipmentEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/equipment");

        group.MapGet("/", async (ICurrentUser user, EquipmentHandler handler, CancellationToken ct) =>
            user.Id is not { } userId ? Results.Unauthorized() : Results.Ok(await handler.GetAsync(userId, ct)));

        group.MapPut("/", async (EquipmentRequest request, ICurrentUser user, EquipmentHandler handler, CancellationToken ct) =>
                user.Id is not { } userId ? Results.Unauthorized() : Results.Ok(await handler.SaveAsync(userId, request, ct)))
            .AddEndpointFilter<ValidationFilter<EquipmentRequest>>();
    }
}
