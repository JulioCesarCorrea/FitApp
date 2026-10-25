using FitnessApp.Api.Common;
using FitnessApp.Api.Features.Progress.Weights;
using FitnessApp.Api.Infrastructure;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<BadRequestExceptionHandler>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddValidatorsFromAssemblyContaining<Program>();

builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

// La opción se lee al resolver el servicio (no al arrancar) para que los tests puedan sobrescribirla.
builder.Services.AddScoped<ICurrentUser>(sp =>
    sp.GetRequiredService<IConfiguration>().GetValue<bool>("Auth:DevHeader")
        ? new DevHeaderCurrentUser(sp.GetRequiredService<IHttpContextAccessor>())
        : new AnonymousCurrentUser());

builder.Services.AddScoped<CreateWeightHandler>();
builder.Services.AddScoped<ListWeightsHandler>();

var app = builder.Build();

app.UseExceptionHandler();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapWeightEndpoints();

app.Run();

public partial class Program;
