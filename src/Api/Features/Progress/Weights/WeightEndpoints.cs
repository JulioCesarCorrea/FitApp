using FitnessApp.Api.Common;

namespace FitnessApp.Api.Features.Progress.Weights;

public static class WeightEndpoints
{
    public static void MapWeightEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/weights");

        group.MapPost("/", async (
                CreateWeightRequest request,
                ICurrentUser user,
                CreateWeightHandler handler,
                CancellationToken ct) =>
            {
                if (user.Id is not { } userId) return Results.Unauthorized();

                var (outcome, entry) = await handler.HandleAsync(userId, request, ct);
                return outcome switch
                {
                    CreateWeightHandler.Outcome.Created => Results.Created($"/weights/{entry.Id}", entry),
                    CreateWeightHandler.Outcome.AlreadyExists => Results.Ok(entry),
                    _ => Results.Problem(
                        statusCode: StatusCodes.Status409Conflict,
                        title: "El identificador ya está en uso."),
                };
            })
            .AddEndpointFilter<ValidationFilter<CreateWeightRequest>>();

        group.MapGet("/", async (ICurrentUser user, ListWeightsHandler handler, CancellationToken ct) =>
            user.Id is not { } userId
                ? Results.Unauthorized()
                : Results.Ok(await handler.HandleAsync(userId, ct)));
    }
}
