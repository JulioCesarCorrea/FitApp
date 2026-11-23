using FitnessApp.Api.Common;

namespace FitnessApp.Api.Features.Profile;

public static class ProfileEndpoints
{
    public static void MapProfileEndpoints(this IEndpointRouteBuilder app)
    {
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
