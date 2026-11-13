using FitnessApp.Api.Common;

namespace FitnessApp.Api.Features.Training.Suggestions;

public static class SuggestionsEndpoints
{
    public static void MapSuggestionsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/suggestions");

        group.MapGet("/", async (ICurrentUser user, SuggestionsHandler handler, CancellationToken ct) =>
            user.Id is not { } userId ? Results.Unauthorized() : Results.Ok(await handler.ListAsync(userId, ct)));

        group.MapPost("/{key}/accept", async (
            string key, AcceptSuggestionRequest request, ICurrentUser user, SuggestionsHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();

            return await handler.AcceptAsync(userId, key, request.ReplacementExerciseId, ct) switch
            {
                AcceptSuggestionResult.Accepted accepted => Results.Ok(accepted.Entry),
                AcceptSuggestionResult.NotAnAlternative => Results.Problem(
                    statusCode: StatusCodes.Status422UnprocessableEntity,
                    title: "Ese ejercicio no es una de las alternativas de la sugerencia."),
                _ => Results.NotFound(),
            };
        });

        group.MapPost("/{key}/dismiss", async (string key, ICurrentUser user, SuggestionsHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();

            await handler.DismissAsync(userId, key, ct);
            return Results.NoContent();
        });
    }
}
