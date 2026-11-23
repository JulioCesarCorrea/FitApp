using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using FitnessApp.Api.Domain.Ai;
using Microsoft.Extensions.Options;

namespace FitnessApp.Api.Features.Ai;

/// <summary>
/// Proveedor de IA por la API compatible con OpenAI de Groq (ADR-0008). La clave solo vive en la configuración del servidor
/// (<c>Ai:ApiKey</c>) y nunca se registra. Un 429 del proveedor se traduce a <see cref="AiFailureKind.Quota"/>.
/// </summary>
public sealed class GroqProvider(HttpClient http, IOptions<AiOptions> options) : IAiProvider
{
    private AiOptions Options => options.Value;

    private HttpRequestMessage Build(AiRequest request, bool stream)
    {
        var messages = new JsonArray { new JsonObject { ["role"] = "system", ["content"] = request.System } };
        foreach (var m in request.Messages) messages.Add(new JsonObject { ["role"] = m.Role, ["content"] = m.Text });
        var body = new JsonObject
        {
            ["model"] = request.Model, ["messages"] = messages, ["max_completion_tokens"] = request.MaxOutputTokens, ["stream"] = stream,
            // Los modelos que razonan gastan tokens de salida pensando: esfuerzo bajo, y el razonamiento no se pide ni se muestra.
            ["reasoning_effort"] = "low",
        };
        if (stream) body["stream_options"] = new JsonObject { ["include_usage"] = true };

        var message = new HttpRequestMessage(HttpMethod.Post, $"{Options.BaseUrl.TrimEnd('/')}/chat/completions") { Content = JsonContent.Create(body) };
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Options.ApiKey);
        return message;
    }

    private static void ThrowIfFailed(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;
        if (response.StatusCode == HttpStatusCode.TooManyRequests)
        {
            var wait = response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(60);
            throw new AiProviderException(AiFailureKind.Quota, "El proveedor de IA agotó su cuota.", wait);
        }

        throw new AiProviderException(AiFailureKind.Failure, $"El proveedor de IA respondió {(int)response.StatusCode}.");
    }

    public async Task<AiCompletion> CompleteAsync(AiRequest request, CancellationToken ct)
    {
        using var message = Build(request, stream: false);
        using var response = await http.SendAsync(message, ct);
        ThrowIfFailed(response);

        var json = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct))
            ?? throw new AiProviderException(AiFailureKind.Failure, "Respuesta vacía del proveedor de IA.");
        var text = json["choices"]?[0]?["message"]?["content"]?.GetValue<string>()
            ?? throw new AiProviderException(AiFailureKind.Failure, "Respuesta sin contenido del proveedor de IA.");
        return new AiCompletion(text, json["usage"]?["prompt_tokens"]?.GetValue<int>() ?? 0, json["usage"]?["completion_tokens"]?.GetValue<int>() ?? 0);
    }

    public async IAsyncEnumerable<AiChunk> StreamAsync(AiRequest request, [EnumeratorCancellation] CancellationToken ct)
    {
        using var message = Build(request, stream: true);
        using var response = await http.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, ct);
        ThrowIfFailed(response);

        await using var body = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(body);
        while (await reader.ReadLineAsync(ct) is { } line)
        {
            if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;
            var data = line[5..].Trim();
            if (data == "[DONE]") yield break;

            JsonNode? json;
            try { json = JsonNode.Parse(data); }
            catch (JsonException) { continue; }
            if (json is null) continue;

            if (json["choices"]?[0]?["delta"]?["content"]?.GetValue<string>() is { Length: > 0 } delta) yield return new AiChunk(delta);
            if (json["usage"] is { } usage)
                yield return new AiChunk(null, usage["prompt_tokens"]?.GetValue<int>() ?? 0, usage["completion_tokens"]?.GetValue<int>() ?? 0);
        }
    }
}
