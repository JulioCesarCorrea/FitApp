namespace FitnessApp.Api.Domain.Ai;

/// <summary>Funciones de IA con consentimiento propio (SPEC-ai-001). «analysis» cubre también los planes de la spec26.</summary>
public static class AiFeatures
{
    public const string Chat = "chat";
    public const string Analysis = "analysis";
    public const string FoodPhoto = "food_photo";

    public static readonly string[] All = [Chat, Analysis, FoodPhoto];

    public static bool IsValid(string feature) => Array.IndexOf(All, feature) >= 0;
}

/// <summary>Clase de cada dato que puede salir a la IA (P5): la A (nombre, correo, ubicación, historial clínico) nunca sale.</summary>
public enum DataClass { A, B, C }

/// <summary>Marca la clase de cada campo de un contrato tipado hacia la IA (SPEC-ai-001, AC-03).</summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter)]
public sealed class AiFieldAttribute(DataClass dataClass) : Attribute
{
    public DataClass DataClass { get; } = dataClass;
}

/// <summary>Contrato tipado de lo que una función envía a la IA: solo campos marcados con <see cref="AiFieldAttribute"/> y nunca de clase A.</summary>
public interface IAiContract;

public static class AiContractGuard
{
    /// <summary>Campos de un contrato sin clase o de clase A: una prueba falla si aparece alguno (AC-ai-001-03).</summary>
    public static List<string> Violations(Type contract) =>
        contract.GetProperties()
            .Where(p => p.GetCustomAttributes(typeof(AiFieldAttribute), true).Cast<AiFieldAttribute>().FirstOrDefault()?.DataClass is null or DataClass.A)
            .Select(p => $"{contract.Name}.{p.Name}")
            .ToList();
}

public sealed record AiMessage(string Role, string Text);

public sealed record AiRequest(string Model, string System, IReadOnlyList<AiMessage> Messages, int MaxOutputTokens);

public sealed record AiCompletion(string Text, int PromptTokens, int CompletionTokens);

/// <summary>Un trozo de una respuesta en streaming: texto, o al final el uso de tokens.</summary>
public sealed record AiChunk(string? TextDelta, int? PromptTokens = null, int? CompletionTokens = null);

public enum AiFailureKind { Failure, Quota }

/// <summary>Error del proveedor: <see cref="AiFailureKind.Quota"/> cuando responde 429 (cuota agotada).</summary>
public sealed class AiProviderException(AiFailureKind kind, string message, TimeSpan? retryAfter = null) : Exception(message)
{
    public AiFailureKind Kind { get; } = kind;
    public TimeSpan? RetryAfter { get; } = retryAfter;
}

public interface IAiProvider
{
    Task<AiCompletion> CompleteAsync(AiRequest request, CancellationToken ct);

    IAsyncEnumerable<AiChunk> StreamAsync(AiRequest request, CancellationToken ct);
}

/// <summary>Consentimiento de una persona para una función de IA (SPEC-ai-001, AC-02). Sin fila no hay consentimiento.</summary>
public class AiConsent
{
    public Guid UserId { get; set; }
    public string Feature { get; set; } = "";
    public DateTimeOffset GrantedAt { get; set; }
}

/// <summary>
/// Auditoría de cada llamada al proveedor (SPEC-ai-001, AC-04, P5). El texto enviado y recibido se conserva el tiempo configurado
/// y luego se borra; los metadatos (modelo, tokens, coste, versiones) se conservan 12 meses.
/// </summary>
public class AiAudit
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Feature { get; set; } = "";
    public string Model { get; set; } = "";
    public string? SentText { get; set; }
    public string? ResponseText { get; set; }
    public int PromptTokens { get; set; }
    public int CompletionTokens { get; set; }
    public decimal CostUsd { get; set; }

    /// <summary>ok | error | quota.</summary>
    public string Status { get; set; } = "ok";

    public string? Error { get; set; }

    /// <summary>Versión de las instrucciones de la función y de las listas que usó (para reproducir la respuesta).</summary>
    public string? PromptVersion { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
