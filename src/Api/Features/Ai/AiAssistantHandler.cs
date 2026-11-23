using System.Text.Json;
using FitnessApp.Api.Domain.Ai;
using FitnessApp.Api.Domain.Nutrition;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Features.Nutrition;
using FitnessApp.Api.Features.Training;
using FitnessApp.Api.Features.Training.Sessions;
using FitnessApp.Api.Features.Profile;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Ai;

public sealed record AnalysisRequest(string Scope);

public sealed record PlanRequest(string Scope);

/// <param name="Kind">Siempre «proposal»: es una propuesta, no un dato ni una orden (P4).</param>
public sealed record AnalysisDto(string Scope, string Kind, List<AnalysisSection> Sections, string Disclaimer);

public sealed record ProposalDto(Guid Id, string Scope, string Kind, string Summary, List<ProposedChange> Changes, string Status, DateTimeOffset CreatedAt);

public sealed record ProposalResultDto(Guid Id, string Status, int Applied, int Skipped);

public abstract record AssistantResult<T>
{
    public sealed record Done(T Value) : AssistantResult<T>;
    public sealed record Denied(AiDenial Reason, TimeSpan? RetryAfter) : AssistantResult<T>;
    public sealed record Failed(string Message) : AssistantResult<T>;
    public sealed record BadRequest(string Message) : AssistantResult<T>;
    public sealed record RateLimited(TimeSpan RetryAfter) : AssistantResult<T>;
}

/// <summary>
/// Análisis y propuestas de plan con IA (SPEC-ai-002). La IA solo recibe agregados y etiquetas (clase B); lo que devuelve se valida
/// con reglas deterministas (restricciones P3, alergias, mediciones que existan) y nada se aplica sin que la persona acepte.
/// </summary>
public sealed class AiAssistantHandler(
    AppDbContext db, AiGateway gateway, NutritionHandler nutrition, TrainingHistoryHandler training, FoodEntryHandler entries, ContextHandler context,
    TimeProvider clock)
{
    public const string Disclaimer = "Orientativo: la app no diagnostica ni sustituye a un profesional de la salud.";
    public const int ContextWeeks = 8;
    public const string AnalysisVersion = "analysis-v1";
    public const string PlanVersion = "plan-v1";
    private const int MaxChanges = 4;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static readonly string[] Scopes = ["training", "nutrition"];

    private async Task<(string[] Restrictions, string[] Allergies, List<Restriction> Rules, string[] RawAllergies)> ProfileLabelsAsync(Guid userId, CancellationToken ct)
    {
        var rows = await db.Restrictions.AsNoTracking().Where(r => r.UserId == userId).ToListAsync(ct);
        var raw = await db.Profiles.AsNoTracking().Where(p => p.UserId == userId).Select(p => p.Allergies).FirstOrDefaultAsync(ct) ?? [];
        // Las alergias del perfil son texto libre: a la IA solo salen las etiquetas del catálogo que coinciden, nunca lo escrito.
        var tags = Allergens.All.Where(t => Allergens.Conflicts(raw, [t]).Length > 0).ToArray();
        var labels = rows.Select(r => $"{r.Zone}:{r.Level.ToString().ToLowerInvariant()}" + (r.AvoidedMovements.Length > 0 ? $":{string.Join('+', r.AvoidedMovements)}" : "")).ToArray();
        var rules = rows.Select(r => new Restriction(r.Zone, r.AvoidedMovements.ToHashSet(), r.Level, r.ReviewOn)).ToList();
        return (labels, tags, rules, raw);
    }

    // ---------- análisis ----------

    /// <summary>AC-ai-002-01, 02, 07, 08: un análisis con cada afirmación etiquetada y con su fuente.</summary>
    public async Task<AssistantResult<AnalysisDto>> AnalyzeAsync(Guid userId, string scope, CancellationToken ct)
    {
        if (!Scopes.Contains(scope)) return new AssistantResult<AnalysisDto>.BadRequest("El ámbito es training o nutrition.");
        var (restrictionLabels, allergyTags, _, _) = await ProfileLabelsAsync(userId, ct);

        string aggregates;
        HashSet<string> sources;
        if (scope == "training")
        {
            var weeks = (await training.WeeklyAsync(userId, ContextWeeks, ct)).Weeks;
            var methodology = await db.Profiles.AsNoTracking().Where(p => p.UserId == userId).Select(p => p.Methodology).FirstOrDefaultAsync(ct) ?? "heavy_duty_personalizado";
            aggregates = JsonSerializer.Serialize(new
            {
                periodWeeks = ContextWeeks, methodology,
                entrenamiento_semanal = weeks.Select(w => new { semana = w.WeekStart.ToString("yyyy-MM-dd"), sesiones = w.Sessions, series = w.Sets, volumenKg = w.VolumeKg, enCurso = w.Partial }),
            }, Json);
            sources = ["entrenamiento_semanal", "restricciones"];
        }
        else
        {
            var weekly = await nutrition.WeeklyAsync(userId, ContextWeeks, ct);
            aggregates = JsonSerializer.Serialize(new
            {
                periodWeeks = ContextWeeks,
                nutricion_objetivo = weekly.Targets is { } t ? new { kcal = t.Calories, proteinaG = t.ProteinG, grasaG = t.FatG, carbohidratosG = t.CarbsG } : null,
                nutricion_semanal = weekly.Weeks.Select(w => new
                {
                    semana = w.WeekStart.ToString("yyyy-MM-dd"), diasRegistrados = w.DaysLogged, kcalMedias = w.AvgKcal, proteinaG = w.AvgProteinG,
                    grasaG = w.AvgFatG, carbohidratosG = w.AvgCarbsG, diasDentroDelMargen = w.DaysOnTarget,
                }),
            }, Json);
            sources = ["nutricion_semanal", "nutricion_objetivo", "restricciones"];
        }

        var contract = new AnalysisContract(scope, aggregates, restrictionLabels, allergyTags, await context.SummaryAsync(userId, ct));
        var outcome = await gateway.CompleteAsync(
            userId, AiFeatures.Analysis, Estimate(contract) + 600, (model, max) => new AiRequest(model, AnalysisSystem(sources), [new AiMessage("user", AnalysisUser(contract))], max),
            AnalysisVersion, ct);

        switch (outcome)
        {
            case AiOutcome.Denied d: return new AssistantResult<AnalysisDto>.Denied(d.Reason, d.RetryAfter);
            case AiOutcome.Failed f: return new AssistantResult<AnalysisDto>.Failed(f.Message);
            case AiOutcome.Ok ok:
                var parsed = AiOutputRules.ParseAnalysis(ok.Completion.Text, sources, AiOutputRules.Numbers(aggregates));
                return parsed is null
                    ? new AssistantResult<AnalysisDto>.Failed("La IA devolvió una respuesta que no se pudo usar. Inténtalo de nuevo.")
                    : new AssistantResult<AnalysisDto>.Done(new AnalysisDto(scope, "proposal", parsed, Disclaimer));
            default: return new AssistantResult<AnalysisDto>.Failed("Respuesta inesperada.");
        }
    }

    private static int Estimate(AnalysisContract c) => (c.Aggregates.Length + string.Join(' ', c.RestrictionLabels).Length + (c.PersonalContext?.Length ?? 0)) / 3 + 300;

    private static int Estimate(PlanContract c) => (c.Options.Length + string.Join(' ', c.RestrictionLabels).Length) / 3 + 300;

    private static string AnalysisSystem(IEnumerable<string> sources) =>
        "Eres un asistente de entrenamiento y nutrición. Analiza SOLO los datos que se te dan. Responde únicamente con JSON: " +
        "{\"sections\":[{\"title\":\"...\",\"claims\":[{\"text\":\"...\",\"kind\":\"registrado|estimacion|inferencia\",\"source\":\"...\"}]}]}. " +
        $"«registrado» solo para un dato que aparece tal cual en los datos, citando una fuente de esta lista: {string.Join(", ", sources)}. " +
        "«estimacion» para un cálculo tuyo a partir de ellos y «inferencia» para una interpretación. No inventes mediciones, no des diagnósticos ni " +
        "consejos médicos, respeta las restricciones y alergias indicadas y escribe en español, con frases cortas. Máximo 4 secciones.";

    private static string AnalysisUser(AnalysisContract c) =>
        $"Ámbito: {c.Scope}\nDatos: {c.Aggregates}\nRestricciones: {string.Join("; ", c.RestrictionLabels)}\nAlergias: {string.Join(", ", c.AllergyTags)}" +
        (c.PersonalContext is null ? "" : $"\nContexto compartido por la persona: {c.PersonalContext}");

    // ---------- propuestas de plan ----------

    /// <summary>AC-ai-002-03, 04, 05: propone cambios y descarta los que chocan con las restricciones o las alergias.</summary>
    public async Task<AssistantResult<ProposalDto>> PlanAsync(Guid userId, string scope, CancellationToken ct)
    {
        if (!Scopes.Contains(scope)) return new AssistantResult<ProposalDto>.BadRequest("El ámbito es training o nutrition.");
        var (restrictionLabels, allergyTags, rules, rawAllergies) = await ProfileLabelsAsync(userId, ct);

        // Opciones válidas que se ofrecen a la IA: lo que proponga fuera de ellas se descarta.
        var exerciseOptions = new Dictionary<string, (DayOfWeek Day, CatalogExercise Current, List<CatalogExercise> Alternatives)>();
        var foodAliases = new Dictionary<string, Food>();
        string options;
        if (scope == "training")
        {
            var catalog = await db.Exercises.AsNoTracking().ToListAsync(ct);
            var plan = await db.PlanEntries.AsNoTracking().Where(e => e.UserId == userId).ToListAsync(ct);
            foreach (var entry in plan.OrderBy(p => Days.OrderOf(p.Day)).ThenBy(p => p.Order))
            {
                var current = catalog.FirstOrDefault(c => c.Id == entry.ExerciseId);
                if (current is null) continue;
                var inDay = plan.Where(p => p.Day == entry.Day).Select(p => p.ExerciseId).ToHashSet();
                var alternatives = catalog.Where(c => c.PrimaryZone == current.PrimaryZone && c.Id != current.Id && !inDay.Contains(c.Id))
                    .Where(c => IsAllowed(c, rules)).Take(5).ToList();
                if (alternatives.Count > 0) exerciseOptions[$"{entry.Day}|{current.Id}"] = (entry.Day, current, alternatives);
            }

            options = JsonSerializer.Serialize(exerciseOptions.Values.Select(o => new
            {
                dia = o.Day.ToString(), ejercicioActual = new { id = o.Current.Id, nombre = o.Current.Name, zona = o.Current.PrimaryZone },
                alternativas = o.Alternatives.Select(a => new { id = a.Id, nombre = a.Name }),
            }), Json);
        }
        else
        {
            var foods = (await db.Foods.AsNoTracking().Where(f => f.UserId == userId).OrderBy(f => f.Name).Take(40).ToListAsync(ct))
                .Where(f => Allergens.Conflicts(rawAllergies, f.Allergens).Length == 0).ToList();
            // Alias sin nombre (P5): lo que se come es clase C y por defecto no sale; solo van los valores por 100 g.
            for (var i = 0; i < foods.Count; i++) foodAliases[$"F{i + 1}"] = foods[i];
            var target = await nutrition.TargetsAsync(userId, ct) is TargetsResult.Ok ok ? ok.Target : null;
            options = JsonSerializer.Serialize(new
            {
                objetivo = target is null ? null : new { kcal = target.Calories, proteinaG = target.ProteinG, grasaG = target.FatG, carbohidratosG = target.CarbsG },
                comidas = new[] { "desayuno", "almuerzo", "cena", "snack" },
                alimentos = foodAliases.Select(kv => new
                {
                    alias = kv.Key, kcal100 = kv.Value.KcalPer100g, proteina100 = kv.Value.ProteinPer100g, grasa100 = kv.Value.FatPer100g, carbohidratos100 = kv.Value.CarbsPer100g,
                }),
            }, Json);
        }

        if (scope == "training" ? exerciseOptions.Count == 0 : foodAliases.Count == 0)
            return new AssistantResult<ProposalDto>.BadRequest(scope == "training" ? "Aún no hay una rutina con alternativas que proponer." : "Aún no tienes alimentos propios (sin alergias que choquen) para proponer comidas.");

        var contract = new PlanContract(scope, options, restrictionLabels, allergyTags);
        var outcome = await gateway.CompleteAsync(
            userId, AiFeatures.Analysis, Estimate(contract) + 600,
            (model, max) => new AiRequest(model, PlanSystem(scope), [new AiMessage("user", $"Opciones: {contract.Options}\nRestricciones: {string.Join("; ", contract.RestrictionLabels)}\nAlergias: {string.Join(", ", contract.AllergyTags)}")], max),
            PlanVersion, ct);

        switch (outcome)
        {
            case AiOutcome.Denied d: return new AssistantResult<ProposalDto>.Denied(d.Reason, d.RetryAfter);
            case AiOutcome.Failed f: return new AssistantResult<ProposalDto>.Failed(f.Message);
            case AiOutcome.Ok ok:
                var (summary, changes) = ParsePlan(ok.Completion.Text, scope, exerciseOptions, foodAliases);
                if (changes.Count == 0) return new AssistantResult<ProposalDto>.Failed("La IA no propuso ningún cambio que se pueda aplicar. Inténtalo de nuevo.");

                var proposal = new AiProposal
                {
                    Id = Guid.NewGuid(), UserId = userId, Scope = scope, Summary = summary, ChangesJson = JsonSerializer.Serialize(changes, Json),
                    Status = "pending", CreatedAt = clock.GetUtcNow(),
                };
                db.AiProposals.Add(proposal);
                await db.SaveChangesAsync(ct);
                return new AssistantResult<ProposalDto>.Done(ToDto(proposal));
            default: return new AssistantResult<ProposalDto>.Failed("Respuesta inesperada.");
        }
    }

    private static string PlanSystem(string scope) =>
        scope == "training"
            ? "Eres un asistente de entrenamiento. Propón como máximo 3 sustituciones de ejercicios de la rutina usando SOLO los ids de las opciones dadas. " +
              "Responde únicamente con JSON: {\"summary\":\"...\",\"changes\":[{\"day\":\"Monday\",\"from\":\"id actual\",\"to\":\"id alternativa\",\"reason\":\"...\"}]}. " +
              "No des diagnósticos ni consejos médicos y respeta las restricciones. Escribe en español."
            : "Eres un asistente de nutrición. Propón como máximo 4 alimentos para registrar hoy usando SOLO los alias de las opciones dadas, con gramos razonables. " +
              "Responde únicamente con JSON: {\"summary\":\"...\",\"changes\":[{\"meal\":\"almuerzo\",\"food\":\"F1\",\"grams\":150,\"reason\":\"...\"}]}. " +
              "No des diagnósticos ni consejos médicos y respeta las alergias. Escribe en español.";

    private static bool IsAllowed(CatalogExercise e, IEnumerable<Restriction> rules) =>
        RestrictionRules.Check(new Exercise(e.Name, e.SecondaryZones.Append(e.PrimaryZone).ToHashSet(), e.Movements.ToHashSet()), rules).Outcome
            is RestrictionOutcome.Permitido or RestrictionOutcome.Contexto;

    /// <summary>
    /// AC-ai-002-03, 04, 07: solo se conservan los cambios que usan opciones que se ofrecieron (así nada incompatible con una restricción o una
    /// alergia puede colarse) y con valores válidos; lo demás se descarta.
    /// </summary>
    public static (string Summary, List<ProposedChange> Changes) ParsePlan(
        string text, string scope, IReadOnlyDictionary<string, (DayOfWeek Day, CatalogExercise Current, List<CatalogExercise> Alternatives)> exerciseOptions,
        IReadOnlyDictionary<string, Food> foodAliases)
    {
        var changes = new List<ProposedChange>();
        try
        {
            using var doc = JsonDocument.Parse(AiOutputRules.StripFence(text));
            var summary = AiOutputRules.Str(doc.RootElement, "summary") ?? "Propuesta de la IA.";
            if (!doc.RootElement.TryGetProperty("changes", out var list) || list.ValueKind != JsonValueKind.Array) return (summary, changes);

            foreach (var c in list.EnumerateArray().Take(MaxChanges))
            {
                var reason = AiOutputRules.Str(c, "reason") ?? "";
                if (scope == "training")
                {
                    var day = AiOutputRules.Str(c, "day");
                    var from = AiOutputRules.Str(c, "from");
                    var to = AiOutputRules.Str(c, "to");
                    if (day is null || from is null || to is null || !Enum.TryParse<DayOfWeek>(day, out var dow)) continue;
                    if (!exerciseOptions.TryGetValue($"{dow}|{from}", out var option) || option.Alternatives.FirstOrDefault(a => a.Id == to) is not { } target) continue;
                    if (changes.Any(x => x.Day == dow.ToString() && x.FromExerciseId == from)) continue;
                    changes.Add(new ProposedChange(ProposedChange.ReplaceExercise, reason, dow.ToString(), from, target.Id, target.Name));
                }
                else
                {
                    var meal = AiOutputRules.Str(c, "meal");
                    var alias = AiOutputRules.Str(c, "food");
                    if (meal is null || alias is null || !foodAliases.TryGetValue(alias, out var food)) continue;
                    if (c.TryGetProperty("grams", out var g) is false || g.ValueKind != JsonValueKind.Number || !g.TryGetInt32(out var grams) || grams is < 1 or > 5000) continue;
                    if (Meals.Normalize(meal).Length is < 1 or > Meals.MaxLength) continue;
                    changes.Add(new ProposedChange(ProposedChange.AddEntry, reason, Meal: Meals.Normalize(meal), FoodId: food.Id, FoodName: food.Name, Grams: grams));
                }
            }

            return (summary, changes);
        }
        catch (JsonException)
        {
            return ("", []);
        }
    }

    // ---------- aceptar y rechazar ----------

    public async Task<List<ProposalDto>> ListAsync(Guid userId, CancellationToken ct) =>
        (await db.AiProposals.AsNoTracking().Where(p => p.UserId == userId).OrderByDescending(p => p.CreatedAt).Take(30).ToListAsync(ct))
        .Select(ToDto).ToList();

    /// <summary>AC-ai-002-05: aplica solo lo que las reglas siguen permitiendo ahora; rechazarla no cambia nada. Null si no existe o no es suya.</summary>
    public async Task<ProposalResultDto?> AcceptAsync(Guid userId, Guid id, CancellationToken ct)
    {
        var proposal = await db.AiProposals.FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId, ct);
        if (proposal is null) return null;
        if (proposal.Status != "pending") return new ProposalResultDto(id, proposal.Status, 0, 0);

        var changes = JsonSerializer.Deserialize<List<ProposedChange>>(proposal.ChangesJson, Json) ?? [];
        var (_, _, rules, rawAllergies) = await ProfileLabelsAsync(userId, ct);
        int applied = 0, skipped = 0;
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);

        foreach (var change in changes)
        {
            if (change.Kind == ProposedChange.ReplaceExercise && Enum.TryParse<DayOfWeek>(change.Day, out var day))
            {
                var entry = await db.PlanEntries.FirstOrDefaultAsync(e => e.UserId == userId && e.Day == day && e.ExerciseId == change.FromExerciseId, ct);
                var target = await db.Exercises.AsNoTracking().FirstOrDefaultAsync(e => e.Id == change.ToExerciseId, ct);
                var alreadyThere = await db.PlanEntries.AnyAsync(e => e.UserId == userId && e.Day == day && e.ExerciseId == change.ToExerciseId, ct);
                if (entry is null || target is null || alreadyThere || !IsAllowed(target, rules)) { skipped++; continue; }

                entry.ExerciseId = target.Id;
                entry.MachineStepKg = null; // el escalón propio era de la máquina anterior
                await db.SaveChangesAsync(ct);
                applied++;
            }
            else if (change.Kind == ProposedChange.AddEntry && change.FoodId is { } foodId && change.Meal is { } meal && change.Grams is { } grams)
            {
                var food = await db.Foods.AsNoTracking().FirstOrDefaultAsync(f => f.Id == foodId && f.UserId == userId, ct);
                if (food is null || Allergens.Conflicts(rawAllergies, food.Allergens).Length > 0) { skipped++; continue; }

                var saved = await entries.PutAsync(userId, Guid.NewGuid(), new FoodEntryRequest(today, meal, foodId, grams), ct);
                if (saved is PutEntryResult.Saved) applied++; else skipped++;
            }
            else skipped++;
        }

        proposal.Status = "accepted";
        proposal.ResolvedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return new ProposalResultDto(id, proposal.Status, applied, skipped);
    }

    public async Task<ProposalResultDto?> RejectAsync(Guid userId, Guid id, CancellationToken ct)
    {
        var proposal = await db.AiProposals.FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId, ct);
        if (proposal is null) return null;
        if (proposal.Status == "pending")
        {
            proposal.Status = "rejected";
            proposal.ResolvedAt = clock.GetUtcNow();
            await db.SaveChangesAsync(ct);
        }

        return new ProposalResultDto(id, proposal.Status, 0, 0);
    }

    private static ProposalDto ToDto(AiProposal p) => new(
        p.Id, p.Scope, "proposal", p.Summary, JsonSerializer.Deserialize<List<ProposedChange>>(p.ChangesJson, Json) ?? [], p.Status, p.CreatedAt);
}
