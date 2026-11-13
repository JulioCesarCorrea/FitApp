using FitnessApp.Api.Common;

namespace FitnessApp.Api.Features.Nutrition;

public static class NutritionEndpoints
{
    public static void MapNutritionEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/nutrition/targets", async (ICurrentUser user, NutritionHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();

            return await handler.TargetsAsync(userId, ct) switch
            {
                TargetsResult.Ok ok => Results.Ok(ok.Target),
                TargetsResult.Missing missing => Results.Problem(
                    statusCode: StatusCodes.Status422UnprocessableEntity,
                    title: missing.What == "perfil" ? "Falta completar tu perfil." : "Falta registrar tu peso.",
                    extensions: new Dictionary<string, object?> { ["missing"] = missing.What }),
                _ => Results.NotFound(),
            };
        });

        app.MapGet("/nutrition/day", async (string? date, ICurrentUser user, NutritionHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();
            if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", out var day))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["date"] = ["La fecha debe tener el formato AAAA-MM-DD."] });

            return Results.Ok(await handler.DayAsync(userId, day, ct));
        });

        app.MapGet("/foods", async (string? query, ICurrentUser user, FoodHandler handler, CancellationToken ct) =>
            user.Id is not { } userId ? Results.Unauthorized() : Results.Ok(await handler.ListAsync(userId, query, ct)));

        app.MapPut("/foods/{id:guid}", async (Guid id, FoodRequest request, ICurrentUser user, FoodHandler handler, CancellationToken ct) =>
            {
                if (user.Id is not { } userId) return Results.Unauthorized();

                return await handler.PutAsync(userId, id, request, ct) switch
                {
                    PutFoodResult.Saved { Created: true } saved => Results.Created($"/foods/{id}", saved.Food),
                    PutFoodResult.Saved saved => Results.Ok(saved.Food),
                    PutFoodResult.BarcodeTaken => Results.Problem(
                        statusCode: StatusCodes.Status409Conflict, title: "Ya tienes un alimento con ese código de barras."),
                    _ => Results.NotFound(),
                };
            })
            .AddEndpointFilter<ValidationFilter<FoodRequest>>();

        app.MapDelete("/foods/{id:guid}", async (Guid id, ICurrentUser user, FoodHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();

            await handler.DeleteAsync(userId, id, ct);
            return Results.NoContent();
        });

        app.MapPut("/food-entries/{id:guid}", async (
                Guid id, FoodEntryRequest request, ICurrentUser user, FoodEntryHandler handler, CancellationToken ct) =>
            {
                if (user.Id is not { } userId) return Results.Unauthorized();

                return await handler.PutAsync(userId, id, request, ct) switch
                {
                    PutEntryResult.Saved { Created: true } saved => Results.Created($"/food-entries/{id}", saved.Entry),
                    PutEntryResult.Saved saved => Results.Ok(saved.Entry),
                    PutEntryResult.UnknownFood => Results.Problem(
                        statusCode: StatusCodes.Status422UnprocessableEntity, title: "El alimento no existe en tu lista."),
                    _ => Results.NotFound(),
                };
            })
            .AddEndpointFilter<ValidationFilter<FoodEntryRequest>>();

        app.MapDelete("/food-entries/{id:guid}", async (Guid id, ICurrentUser user, FoodEntryHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();

            await handler.DeleteAsync(userId, id, ct);
            return Results.NoContent();
        });
    }
}
