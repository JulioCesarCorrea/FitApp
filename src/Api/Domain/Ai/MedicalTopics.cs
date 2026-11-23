using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace FitnessApp.Api.Domain.Ai;

/// <summary>Resultado del clasificador médico: la categoría principal (null si no hay), todas las que coinciden y el aviso fijo.</summary>
public sealed record MedicalResult(string? Category, IReadOnlyList<string> Categories, string? Notice)
{
    public bool IsEmergency => Category == MedicalTopics.Emergency;
    public bool IsMedical => Category is not null;
}

/// <summary>
/// Clasificador determinista de temas médicos (SPEC-ai-004, P3 y P8), antes de llamar a la IA: la derivación a un profesional no
/// depende de que el modelo se acuerde. Frases sin acentos ni mayúsculas, por palabras completas. Es una primera red (el modelo y el
/// aviso permanente son las otras dos) y la lista la revisa el usuario: vectores en medical-topics-vectors.json. El texto de los avisos
/// es fijo y lo escribimos nosotros, no el modelo.
/// </summary>
public static class MedicalTopics
{
    public const string Version = "medical-topics-v1";
    public const string Emergency = "emergencia";

    private static readonly (string Category, string Notice, string[] Phrases)[] Catalog =
    [
        (Emergency,
            "Esto puede ser una urgencia. No esperes a que te responda una app: acude ya a los servicios de emergencia de tu país o a un centro médico. Si piensas en hacerte daño, habla ahora con alguien de confianza o con un servicio de ayuda de tu país.",
            ["no puedo respirar", "me falta el aire", "me desmaye", "me he desmayado", "perdi el conocimiento", "me quiero morir", "quiero morirme",
             "hacerme dano", "hacerme mal", "suicid", "quitarme la vida", "me estoy muriendo", "dolor intenso en el pecho", "sudor frio"]),
        ("trastornos_alimentarios",
            "Lo que cuentas puede relacionarse con tu salud alimentaria. Esta app no puede ayudarte con eso: habla con un profesional sanitario o de la nutrición. No estás solo y se puede tratar.",
            ["anorexia", "bulimia", "atracon", "atracones", "purgar", "purgarme", "vomitar despues de comer", "dejar de comer", "no comer nada", "ayuno extremo",
             "laxantes", "me da asco comer", "castigarme sin comer"]),
        ("medicacion",
            "No puedo hablar de medicación, suplementos con receta o sustancias ni de sus dosis. Consúltalo con tu médico o farmacéutico.",
            ["insulina", "metformina", "esteroide", "esteroides", "anabolizante", "anabolizantes", "clenbuterol", "testosterona", "antibiotico", "antidepresivo",
             "anticoagulante", "medicacion", "medicamento", "medicamentos", "dosis de", "inyectarme"]),
        ("dolor_lesion",
            "Si tienes dolor, una lesión o síntomas como mareos, consulta a un profesional sanitario antes de seguir entrenando. Esta app no diagnostica.",
            ["dolor agudo", "dolor punzante", "dolor en el pecho", "dolor de pecho", "me duele el pecho", "dolor en la rodilla", "dolor de rodilla", "me duele la rodilla",
             "dolor de hombro", "dolor en el hombro", "me duele el hombro", "dolor de espalda", "dolor lumbar", "me duele la espalda", "dolor de cuello", "lesion",
             "lesionado", "lesionada", "desgarro", "esguince", "hernia", "luxacion", "fractura", "tendinitis", "mareo", "mareos", "palpitaciones", "hormigueo", "entumecimiento"]),
        ("condiciones",
            "Con una condición médica conviene que tu entrenamiento y tu alimentación los revise un profesional sanitario. Esta app no sustituye su consejo.",
            ["diabetes", "diabetico", "hipertension", "embarazo", "embarazada", "lactancia", "problema cardiaco", "problemas cardiacos", "del corazon", "insuficiencia",
             "renal", "rinon", "rinones", "tiroides", "hipotiroidismo", "colesterol alto", "asma", "epilepsia", "cancer"]),
        ("perdida_peso_rapida",
            "Perder peso muy deprisa o con muy pocas calorías puede ser peligroso. Habla con un profesional sanitario o de la nutrición antes de intentarlo.",
            ["perder peso rapido", "bajar peso rapido", "bajar de peso rapido", "adelgazar rapido", "kilos en una semana", "kilos en 7 dias", "kilos en 10 dias",
             "600 calorias al dia", "800 calorias al dia", "1000 calorias al dia", "dieta de 800", "dieta de 600"]),
    ];

    /// <summary>Combinaciones que son una urgencia aunque cada frase suelta no lo sea: dolor de pecho con falta de aire.</summary>
    private static readonly string[] ChestPain = ["dolor de pecho", "dolor en el pecho", "me duele el pecho", "opresion en el pecho"];
    private static readonly string[] Breathing = ["falta de aire", "dificultad para respirar", "me ahogo", "no respiro"];

    public static string Fold(string text) =>
        new string(text.Normalize(NormalizationForm.FormD).Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).ToArray())
            .ToLowerInvariant();

    private static bool Has(string folded, string phrase) =>
        Regex.IsMatch(folded, $"(^|[^a-z0-9]){Regex.Escape(phrase)}([^a-z0-9]|$)", RegexOptions.CultureInvariant);

    public static string? NoticeOf(string category) => Catalog.FirstOrDefault(c => c.Category == category).Notice;

    /// <summary>La categoría principal es la primera que coincide por orden de gravedad (emergencia primero).</summary>
    public static MedicalResult Classify(string text)
    {
        var folded = Fold(text);
        var found = new List<string>();
        foreach (var (category, _, phrases) in Catalog)
        {
            var matches = phrases.Any(p => Has(folded, p))
                || (category == Emergency && ChestPain.Any(p => Has(folded, p)) && Breathing.Any(p => Has(folded, p)));
            if (matches) found.Add(category);
        }

        return found.Count == 0 ? new MedicalResult(null, [], null) : new MedicalResult(found[0], found, NoticeOf(found[0]));
    }
}
