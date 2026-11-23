using FitnessApp.Api.Common;

namespace FitnessApp.Api.Features.Training.Sessions;

public static class SessionEndpoints
{
    public static void MapSessionEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPut("/exercise-logs/{id:guid}", async (
                Guid id,
                ExerciseLogRequest request,
                ICurrentUser user,
                ExerciseLogHandler handler,
                CancellationToken ct) =>
            {
                if (user.Id is not { } userId) return Results.Unauthorized();

                return await handler.PutAsync(userId, id, request, ct) switch
                {
                    PutLogResult.Saved { Created: true } saved => Results.Created($"/exercise-logs/{id}", saved.Log),
                    PutLogResult.Saved saved => Results.Ok(saved.Log),
                    PutLogResult.UnknownExercise => Results.Problem(
                        statusCode: StatusCodes.Status422UnprocessableEntity,
                        title: "El ejercicio no existe en el catálogo."),
                    PutLogResult.InvalidLoad invalid => Results.ValidationProblem(
                        new Dictionary<string, string[]> { ["loadKg"] = [invalid.Message] }),
                    PutLogResult.DateConflict => Results.Problem(
                        statusCode: StatusCodes.Status409Conflict,
                        title: "Ya hay un registro de este ejercicio en esa fecha."),
                    _ => Results.NotFound(),
                };
            })
            .AddEndpointFilter<ValidationFilter<ExerciseLogRequest>>();

        app.MapDelete("/exercise-logs/{id:guid}", async (
            Guid id, ICurrentUser user, ExerciseLogHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();

            await handler.DeleteAsync(userId, id, ct);
            return Results.NoContent();
        });

        app.MapGet("/training/weekly", async (int? weeks, ICurrentUser user, TrainingHistoryHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();
            var count = weeks ?? 12;
            if (count < 1 || count > TrainingHistoryHandler.MaxWeeks)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["weeks"] = [$"Las semanas van de 1 a {TrainingHistoryHandler.MaxWeeks}."] });

            return Results.Ok(await handler.WeeklyAsync(userId, count, ct));
        });

        app.MapGet("/training/exercises/{id}/history", async (
            string id, string? range, ICurrentUser user, TrainingHistoryHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();
            range ??= "all";
            if (!TrainingHistoryHandler.IsValidRange(range))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["range"] = ["El rango es 30d, 90d, 1y o all."] });

            return await handler.ExerciseAsync(userId, id, range, ct) is { } progress ? Results.Ok(progress) : Results.NotFound();
        });

        app.MapGet("/exercises/{id}/history", async (
            string id, ICurrentUser user, ExerciseLogHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();

            return await handler.HistoryAsync(userId, id, ct) is { } history ? Results.Ok(history) : Results.NotFound();
        });

        app.MapGet("/exercises/{id}/advice", async (
            string id, ICurrentUser user, AdviceHandler handler, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();

            return await handler.GetAsync(userId, id, ct) switch
            {
                AdviceResult.Advice advice => Results.Ok(advice.Dto),
                AdviceResult.NoRecords => Results.NoContent(),
                _ => Results.NotFound(),
            };
        });

        app.MapGet("/training-settings", async (ICurrentUser user, TrainingSettingsHandler handler, CancellationToken ct) =>
            user.Id is not { } userId ? Results.Unauthorized() : Results.Ok(await handler.GetAsync(userId, ct)));

        app.MapPut("/training-settings", async (
                TrainingSettingsDto request, ICurrentUser user, TrainingSettingsHandler handler, CancellationToken ct) =>
                user.Id is not { } userId ? Results.Unauthorized() : Results.Ok(await handler.SaveAsync(userId, request, ct)))
            .AddEndpointFilter<ValidationFilter<TrainingSettingsDto>>();
    }
}
