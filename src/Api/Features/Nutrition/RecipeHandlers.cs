using System.Globalization;
using System.Text;
using FitnessApp.Api.Domain.Nutrition;
using FitnessApp.Api.Infrastructure;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Features.Nutrition;

public sealed record IngredientRequest(Guid FoodId, int Grams);

public sealed record RecipeRequest(string Name, int Servings, List<IngredientRequest> Ingredients);

/// <param name="Deleted">El alimento se borró: el ingrediente conserva su copia de valores (AC-05).</param>
public sealed record IngredientDto(
    Guid? FoodId, string Name, int Grams, bool Deleted, decimal KcalPer100g, decimal ProteinPer100g, decimal FatPer100g, decimal CarbsPer100g,
    decimal? FiberPer100g, decimal? SugarsPer100g, int? SodiumMgPer100g);

public sealed record RecipeDto(Guid Id, string Name, int Servings, List<IngredientDto> Ingredients, RecipeValues Total, RecipeValues PerServing);

public sealed class RecipeRequestValidator : AbstractValidator<RecipeRequest>
{
    public RecipeRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().Must(n => n.Trim().Length is >= 1 and <= 80).WithMessage("El nombre lleva entre 1 y 80 caracteres.");
        RuleFor(x => x.Servings).InclusiveBetween(1, 50).WithMessage("Las raciones van de 1 a 50.");
        RuleFor(x => x.Ingredients).NotNull().Must(i => i is { Count: >= 1 and <= 40 }).WithMessage("Una receta lleva entre 1 y 40 ingredientes.");
        RuleFor(x => x.Ingredients).Must(i => i is null || i.Select(x => x.FoodId).Distinct().Count() == i.Count)
            .WithMessage("Un alimento no puede repetirse en la receta.");
        RuleForEach(x => x.Ingredients).ChildRules(i =>
        {
            i.RuleFor(x => x.FoodId).NotEmpty().WithMessage("Falta el alimento.");
            i.RuleFor(x => x.Grams).InclusiveBetween(1, 5000).WithMessage("Los gramos van de 1 a 5000.");
        });
    }
}

public abstract record PutRecipeResult
{
    public sealed record Saved(RecipeDto Recipe, bool Created) : PutRecipeResult;
    public sealed record NotFound : PutRecipeResult;
    public sealed record UnknownFood : PutRecipeResult;
}

/// <summary>Casos de uso de SPEC-nutrition-005: recetas propias. Todo filtra por la persona que llama (P7).</summary>
public sealed class RecipeHandler(AppDbContext db, TimeProvider clock)
{
    /// <summary>AC-01, 02: crea la receta o reemplaza la que tiene ese id, copiando los valores actuales de sus alimentos.</summary>
    public async Task<PutRecipeResult> PutAsync(Guid userId, Guid id, RecipeRequest request, CancellationToken ct, bool retryOnConflict = true)
    {
        var existing = await db.Recipes.Include(r => r.Ingredients).FirstOrDefaultAsync(r => r.Id == id, ct);
        if (existing is not null && existing.UserId != userId) return new PutRecipeResult.NotFound();

        var foodIds = request.Ingredients.Select(i => i.FoodId).ToList();
        var foods = await db.Foods.AsNoTracking().Where(f => f.UserId == userId && foodIds.Contains(f.Id)).ToDictionaryAsync(f => f.Id, ct);
        if (foods.Count != foodIds.Count) return new PutRecipeResult.UnknownFood();

        var created = existing is null;
        var now = clock.GetUtcNow();
        if (existing is null)
        {
            existing = new Recipe { Id = id, UserId = userId, CreatedAt = now };
            db.Recipes.Add(existing);
        }
        else
        {
            db.RecipeIngredients.RemoveRange(existing.Ingredients);
            existing.Ingredients.Clear();
        }

        existing.Name = request.Name.Trim();
        existing.Servings = request.Servings;
        existing.UpdatedAt = now;
        var position = 0;
        foreach (var i in request.Ingredients)
        {
            var f = foods[i.FoodId];
            var ingredient = new RecipeIngredient
            {
                Id = Guid.NewGuid(), RecipeId = id, FoodId = f.Id, Position = position++, Name = f.Name, Grams = i.Grams,
                KcalPer100g = f.KcalPer100g, ProteinPer100g = f.ProteinPer100g, FatPer100g = f.FatPer100g, CarbsPer100g = f.CarbsPer100g,
                FiberPer100g = f.FiberPer100g, SugarsPer100g = f.SugarsPer100g, SodiumMgPer100g = f.SodiumMgPer100g,
            };
            existing.Ingredients.Add(ingredient);
            db.RecipeIngredients.Add(ingredient); // con la clave puesta, EF lo daría por existente: se marca como nuevo
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException) when (retryOnConflict)
        {
            // Carrera: otra petición guardó el mismo id entre la lectura y la escritura; se resuelve como reemplazo (una sola vez).
            db.ChangeTracker.Clear();
            return await PutAsync(userId, id, request, ct, retryOnConflict: false);
        }

        return new PutRecipeResult.Saved(ToDto(existing), created);
    }

    /// <summary>AC-05: las entradas ya registradas conservan sus valores. Una receta ajena o inexistente no hace nada.</summary>
    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct) =>
        await db.Recipes.Where(r => r.Id == id && r.UserId == userId).ExecuteDeleteAsync(ct);

    /// <summary>AC-06: solo las recetas propias, por nombre, con sus valores por ración.</summary>
    public async Task<List<RecipeDto>> ListAsync(Guid userId, CancellationToken ct)
    {
        var all = await db.Recipes.AsNoTracking().Include(r => r.Ingredients).Where(r => r.UserId == userId).ToListAsync(ct);
        return all.OrderBy(r => Fold(r.Name), StringComparer.Ordinal).ThenBy(r => r.Id).Select(ToDto).ToList();
    }

    public static RecipeValues TotalOf(Recipe r) => NutritionRules.RecipeTotal(r.Ingredients.OrderBy(i => i.Position).Select(i => new IngredientValues(
        i.KcalPer100g, i.ProteinPer100g, i.FatPer100g, i.CarbsPer100g, i.FiberPer100g, i.SugarsPer100g, i.SodiumMgPer100g, i.Grams)));

    public static RecipeDto ToDto(Recipe r)
    {
        var total = TotalOf(r);
        return new RecipeDto(
            r.Id, r.Name, r.Servings,
            r.Ingredients.OrderBy(i => i.Position).Select(i => new IngredientDto(
                i.FoodId, i.Name, i.Grams, i.FoodId is null, i.KcalPer100g, i.ProteinPer100g, i.FatPer100g, i.CarbsPer100g,
                i.FiberPer100g, i.SugarsPer100g, i.SodiumMgPer100g)).ToList(),
            total, NutritionRules.ScaleRecipe(total, r.Servings, 1m));
    }

    private static string Fold(string text) =>
        new string(text.Normalize(NormalizationForm.FormD)
            .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).ToArray())
            .ToLowerInvariant().Trim();
}
