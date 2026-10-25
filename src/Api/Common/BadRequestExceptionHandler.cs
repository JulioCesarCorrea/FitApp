using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace FitnessApp.Api.Common;

/// <summary>Convierte un cuerpo JSON ilegible (BadHttpRequestException) en 400 en lugar de 500.</summary>
public sealed class BadRequestExceptionHandler(IProblemDetailsService problems) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        if (exception is not BadHttpRequestException bad) return false;

        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return await problems.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            Exception = exception,
            ProblemDetails = new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "La petición no es válida.",
                Detail = bad.InnerException is null ? bad.Message : "El cuerpo no es un JSON válido.",
            },
        });
    }
}
