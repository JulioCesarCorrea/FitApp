using FitnessApp.Api.Common;

namespace FitnessApp.Api.Features.Auth;

public static class AuthEndpoints
{
    public const string RateLimitPolicy = "auth";

    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/auth").RequireRateLimiting(RateLimitPolicy);

        group.MapPost("/register", async (RegisterRequest request, AuthHandler handler, CancellationToken ct) =>
                await handler.RegisterAsync(request, ct) switch
                {
                    RegisterResult.Created created => Results.Created("/auth/me", created.Response),
                    RegisterResult.InvalidInvite => Results.Problem(
                        statusCode: StatusCodes.Status403Forbidden, title: "El código de invitación no es válido."),
                    _ => Results.Problem(
                        statusCode: StatusCodes.Status409Conflict, title: "Ese nombre de usuario ya está en uso."),
                })
            .AddEndpointFilter<ValidationFilter<RegisterRequest>>();

        group.MapPost("/login", async (LoginRequest request, AuthHandler handler, HttpContext http, CancellationToken ct) =>
            {
                switch (await handler.LoginAsync(request, ct))
                {
                    case LoginResult.Ok ok:
                        return Results.Ok(ok.Response);
                    case LoginResult.Locked locked:
                        http.Response.Headers.RetryAfter = locked.RetryAfterSeconds.ToString();
                        return Results.Problem(
                            statusCode: StatusCodes.Status429TooManyRequests,
                            title: "Demasiados intentos. Espera unos minutos antes de volver a probar.");
                    default:
                        return Results.Problem(
                            statusCode: StatusCodes.Status401Unauthorized, title: "Usuario o contraseña incorrectos.");
                }
            })
            .AddEndpointFilter<ValidationFilter<LoginRequest>>();

        group.MapPost("/refresh", async (RefreshRequest request, AuthHandler handler, CancellationToken ct) =>
                await handler.RefreshAsync(request.RefreshToken, ct) is { } response
                    ? Results.Ok(response)
                    : Results.Problem(
                        statusCode: StatusCodes.Status401Unauthorized, title: "La sesión ya no es válida. Entra de nuevo."))
            .AddEndpointFilter<ValidationFilter<RefreshRequest>>();

        group.MapPost("/logout", async (LogoutRequest request, AuthHandler handler, CancellationToken ct) =>
            {
                await handler.LogoutAsync(request.RefreshToken, ct);
                return Results.NoContent();
            })
            .AddEndpointFilter<ValidationFilter<LogoutRequest>>();

        group.MapPost("/change-password", async (
                ChangePasswordRequest request, ICurrentUser user, AuthHandler handler, CancellationToken ct) =>
            {
                if (user.Id is not { } userId) return Results.Unauthorized();

                return await handler.ChangePasswordAsync(userId, request, ct) switch
                {
                    ChangePasswordResult.Ok ok => Results.Ok(ok.Response),
                    ChangePasswordResult.WrongCurrent => Results.ValidationProblem(
                        new Dictionary<string, string[]> { ["currentPassword"] = ["La contraseña actual no es correcta."] }),
                    ChangePasswordResult.InvalidNew invalid => Results.ValidationProblem(
                        new Dictionary<string, string[]> { ["newPassword"] = [invalid.Message] }),
                    _ => Results.Unauthorized(),
                };
            })
            .AddEndpointFilter<ValidationFilter<ChangePasswordRequest>>();

        group.MapGet("/me", async (ICurrentUser user, AuthHandler handler, CancellationToken ct) =>
            user.Id is not { } userId
                ? Results.Unauthorized()
                : await handler.MeAsync(userId, ct) is { } me ? Results.Ok(me) : Results.Unauthorized());
    }
}
