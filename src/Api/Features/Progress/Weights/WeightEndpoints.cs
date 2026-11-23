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

        group.MapGet("/summary", async (string? range, ICurrentUser user, WeightHistoryHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();
            if (!WeightHistoryHandler.IsValidRange(range))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["range"] = ["El rango es 30d, 90d, 1y o all."] });

            return Results.Ok(await handler.SummaryAsync(userId, range!, ct));
        });

        group.MapGet("/weekly", async (int? weeks, ICurrentUser user, WeightHistoryHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();
            var count = weeks ?? 12;
            if (count < 1 || count > WeightHistoryHandler.MaxWeeks)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["weeks"] = [$"Las semanas van de 1 a {WeightHistoryHandler.MaxWeeks}."] });

            return Results.Ok(await handler.WeeklyAsync(userId, count, ct));
        });

        group.MapGet("/", async (ICurrentUser user, ListWeightsHandler handler, CancellationToken ct) =>
            user.Id is not { } userId
                ? Results.Unauthorized()
                : Results.Ok(await handler.HandleAsync(userId, ct)));
    }
}
