using FluentValidation;

namespace FitnessApp.Api.Common;

/// <summary>Valida el argumento de tipo T del endpoint y responde 400 ProblemDetails si falla.</summary>
public sealed class ValidationFilter<T> : IEndpointFilter where T : class
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var validator = context.HttpContext.RequestServices.GetRequiredService<IValidator<T>>();
        var arg = context.Arguments.OfType<T>().FirstOrDefault();
        if (arg is null)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["body"] = ["El cuerpo es obligatorio."] });

        var result = await validator.ValidateAsync(arg, context.HttpContext.RequestAborted);
        if (!result.IsValid)
            return Results.ValidationProblem(result.ToDictionary());

        return await next(context);
    }
}
