using FitnessApp.Api.Common;

namespace FitnessApp.Api.Features.Profile;

public static class ProfileEndpoints
{
    public static void MapProfileEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/context-items", async (bool? active, ICurrentUser user, ContextHandler handler, CancellationToken ct) =>
            user.Id is not { } userId ? Results.Unauthorized() : Results.Ok(await handler.ListAsync(userId, active == true, ct)));

        app.MapPut("/context-items/{id:guid}", async (Guid id, ContextItemRequest request, ICurrentUser user, ContextHandler handler, CancellationToken ct) =>
            {
                if (user.Id is not { } userId) return Results.Unauthorized();

                return await handler.PutAsync(userId, id, request, ct) switch
                {
                    PutContextResult.Saved { Created: true } saved => Results.Created($"/context-items/{id}", saved.Item),
                    PutContextResult.Saved saved => Results.Ok(saved.Item),
                    PutContextResult.LimitReached => Results.Problem(
                        statusCode: StatusCodes.Status409Conflict, title: $"Tienes el máximo de {Domain.Profile.ContextRules.MaxActive} entradas activas. Da de baja alguna."),
                    _ => Results.NotFound(),
                };
            })
            .AddEndpointFilter<ValidationFilter<ContextItemRequest>>();

        app.MapDelete("/context-items/{id:guid}", async (Guid id, ICurrentUser user, ContextHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();

            await handler.DeleteAsync(userId, id, ct);
            return Results.NoContent();
        });

        app.MapGet("/profile", async (ICurrentUser user, ProfileHandler handler, CancellationToken ct) =>
            user.Id is not { } userId ? Results.Unauthorized() : Results.Ok(await handler.GetAsync(userId, ct)));

        app.MapPut("/profile/methodology", async (MethodologyRequest request, ICurrentUser user, ProfileHandler handler, CancellationToken ct) =>
            {
                if (user.Id is not { } userId) return Results.Unauthorized();

                return await handler.SetMethodologyAsync(userId, request.Methodology!, ct) is { } saved
                    ? Results.Ok(saved)
                    : Results.Problem(
                        statusCode: StatusCodes.Status422UnprocessableEntity, title: "Falta completar tu perfil.",
                        extensions: new Dictionary<string, object?> { ["missing"] = "perfil" });
            })
            .AddEndpointFilter<ValidationFilter<MethodologyRequest>>();

        app.MapPut("/profile", async (ProfileRequest request, ICurrentUser user, ProfileHandler handler, CancellationToken ct) =>
            {
                if (user.Id is not { } userId) return Results.Unauthorized();

                var (created, profile) = await handler.SaveAsync(userId, request, ct);
                return created ? Results.Created("/profile", profile) : Results.Ok(profile);
            })
            .AddEndpointFilter<ValidationFilter<ProfileRequest>>();
    }
}
