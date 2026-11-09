using FitnessApp.Api.Common;
using FitnessApp.Api.Features.Auth;
using Microsoft.AspNetCore.Mvc;

namespace FitnessApp.Api.Features.Account;

public static class AccountEndpoints
{
    public static void MapAccountEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/account");

        group.MapGet("/export", async (
            ICurrentUser user, AccountHandler handler, HttpContext http, TimeProvider clock, CancellationToken ct) =>
        {
            if (user.Id is not { } userId) return Results.Unauthorized();
            if (await handler.ExportAsync(userId, ct) is not { } export) return Results.Unauthorized();

            var date = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime).ToString("yyyy-MM-dd");
            http.Response.Headers.ContentDisposition = $"attachment; filename=\"fitness-export-{date}.json\"";
            return Results.Ok(export);
        });

        // Mismo límite por origen que /auth/*: confirmar con la contraseña no debe servir para adivinarla.
        group.MapDelete("/", async (
                [FromBody] DeleteAccountRequest? request, ICurrentUser user, AccountHandler handler, CancellationToken ct) =>
            {
                if (user.Id is not { } userId) return Results.Unauthorized();

                return await handler.DeleteAsync(userId, request?.Password, ct) switch
                {
                    DeleteAccountResult.Deleted => Results.NoContent(),
                    _ => Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: "La contraseña no es correcta."),
                };
            })
            .RequireRateLimiting(AuthEndpoints.RateLimitPolicy);
    }
}
