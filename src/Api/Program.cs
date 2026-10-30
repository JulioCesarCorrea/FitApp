using System.Threading.RateLimiting;
using FitnessApp.Api.Common;
using FitnessApp.Api.Features.Auth;
using FitnessApp.Api.Features.Profile;
using FitnessApp.Api.Features.Progress.Weights;
using FitnessApp.Api.Features.Training.Catalog;
using FitnessApp.Api.Features.Training.Equipment;
using FitnessApp.Api.Features.Training.Plan;
using FitnessApp.Api.Features.Training.Restrictions;
using FitnessApp.Api.Features.Training.Sessions;
using FitnessApp.Api.Infrastructure;
using FluentValidation;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// Ajustes propios de cada equipo (rutas, etc.); el archivo está en .gitignore.
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);

builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<BadRequestExceptionHandler>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddValidatorsFromAssemblyContaining<Program>();

builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

// Las opciones de «Auth» se leen al usarse (no al arrancar) para que los tests puedan sobrescribirlas.
builder.Services.AddOptions<AuthOptions>().BindConfiguration("Auth");
builder.Services.AddSingleton<PasswordService>();
builder.Services.AddSingleton<JwtKeyProvider>();
builder.Services.AddSingleton<TokenService>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    .Configure<JwtKeyProvider>((o, keys) =>
    {
        o.MapInboundClaims = false; // «sub» se queda como «sub»
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = AuthOptions.Issuer,
            ValidateAudience = true,
            ValidAudience = AuthOptions.Audience,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.Zero,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = keys.SigningKey,
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
        };
    });

// Límite de peticiones solo para /auth/* (AC-auth-001-08). Detrás de un proxy habrá que configurar los encabezados reenviados.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy(AuthEndpoints.RateLimitPolicy, http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "desconocido",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = http.RequestServices.GetRequiredService<IOptions<AuthOptions>>().Value.RateLimitPerMinute,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));
});

// Un token válido manda; el encabezado X-User-Id solo sirve con Auth:DevHeader (desarrollo y pruebas).
builder.Services.AddScoped<ICurrentUser>(sp =>
{
    var accessor = sp.GetRequiredService<IHttpContextAccessor>();
    var fromToken = new JwtCurrentUser(accessor);
    if (fromToken.Id is not null) return fromToken;
    return sp.GetRequiredService<IOptions<AuthOptions>>().Value.DevHeader
        ? new DevHeaderCurrentUser(accessor)
        : new AnonymousCurrentUser();
});

builder.Services.AddScoped<CreateWeightHandler>();
builder.Services.AddScoped<ListWeightsHandler>();
builder.Services.AddScoped<ListCatalogHandler>();
builder.Services.AddScoped<PlanHandler>();
builder.Services.AddScoped<EquipmentHandler>();
builder.Services.AddScoped<ExerciseLogHandler>();
builder.Services.AddScoped<AdviceHandler>();
builder.Services.AddScoped<TrainingSettingsHandler>();
builder.Services.AddScoped<ProfileHandler>();
builder.Services.AddScoped<RestrictionHandler>();
builder.Services.AddScoped<AuthHandler>();
builder.Services.AddScoped<AdminCommands>();

var app = builder.Build();

// Sin clave de firma propia la API no arranca fuera de desarrollo y pruebas.
_ = app.Services.GetRequiredService<JwtKeyProvider>().SigningKey;

// Comandos del administrador (SPEC-auth-001): dotnet run --project src/Api -- admin ...
if (args is ["admin", ..])
{
    await using var scope = app.Services.CreateAsyncScope();
    return await AdminCli.RunAsync(scope.ServiceProvider, args[1..]);
}

app.UseExceptionHandler();
app.UseRateLimiter();
app.UseAuthentication();

// Con el cambio de contraseña pendiente solo sirven /auth/* y /health (AC-auth-001-15).
app.Use(async (context, next) =>
{
    var path = context.Request.Path;
    if (context.User.FindFirst("mcp")?.Value == "1"
        && !path.StartsWithSegments("/auth") && !path.StartsWithSegments("/health"))
    {
        await Results.Problem(
            statusCode: StatusCodes.Status403Forbidden,
            title: "Debes cambiar tu contraseña antes de continuar.",
            extensions: new Dictionary<string, object?> { ["code"] = "must_change_password" }).ExecuteAsync(context);
        return;
    }

    await next();
});

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapWeightEndpoints();
app.MapCatalogEndpoints();
app.MapPlanEndpoints();
app.MapEquipmentEndpoints();
app.MapSessionEndpoints();
app.MapAuthEndpoints();
app.MapProfileEndpoints();
app.MapRestrictionEndpoints();

app.Run();
return 0;

public partial class Program;
