using System.Runtime.CompilerServices;
using FitnessApp.Api.Domain.Ai;

namespace FitnessApp.Api.Tests;

/// <summary>Proveedor de IA falso de las pruebas: nunca se llama al proveedor real (SPEC-ai-001).</summary>
public sealed class FakeAiProvider : IAiProvider
{
    public List<AiRequest> Calls { get; } = [];

    /// <summary>Vuelve al comportamiento por defecto (los tests comparten el proveedor y se ejecutan uno tras otro).</summary>
    public void Reset()
    {
        Throw = null;
        Handler = _ => new AiCompletion("Respuesta de prueba.", 100, 20);
    }

    /// <summary>Qué responde; por defecto un texto fijo con 100 tokens de entrada y 20 de salida.</summary>
    public Func<AiRequest, AiCompletion> Handler { get; set; } = _ => new AiCompletion("Respuesta de prueba.", 100, 20);

    /// <summary>Si no es nulo, se lanza en cada llamada.</summary>
    public Exception? Throw { get; set; }

    public Task<AiCompletion> CompleteAsync(AiRequest request, CancellationToken ct)
    {
        Calls.Add(request);
        if (Throw is not null) throw Throw;
        return Task.FromResult(Handler(request));
    }

    public async IAsyncEnumerable<AiChunk> StreamAsync(AiRequest request, [EnumeratorCancellation] CancellationToken ct)
    {
        Calls.Add(request);
        if (Throw is not null) throw Throw;
        var completion = Handler(request);
        foreach (var word in completion.Text.Split(' ')) yield return new AiChunk(word + " ");
        yield return new AiChunk(null, completion.PromptTokens, completion.CompletionTokens);
        await Task.CompletedTask;
    }
}
