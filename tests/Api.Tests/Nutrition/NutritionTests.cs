using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FitnessApp.Api.Domain.Nutrition;
using FitnessApp.Api.Features.Nutrition;
using FitnessApp.Api.Features.Profile;
using FitnessApp.Api.Features.Progress.Weights;

namespace FitnessApp.Api.Tests.Nutrition;

/// <summary>Reglas puras de SPEC-nutrition-001 contra los vectores compartidos (ADR-0004).</summary>
public sealed class NutritionVectorsTests
{
    private sealed record TargetExpected(int Calories, int ProteinG, int FatG, int CarbsG, int BasalKcal);
    private sealed record TargetCase(
        string Name, string Sex, DateOnly BirthDate, DateOnly Today, int HeightCm, string ActivityLevel, string Goal, decimal WeightKg,
        TargetExpected Expected);
    private sealed record FloorCase(string Name, decimal Expenditure, decimal GoalFactor, decimal Basal, int Expected);
    private sealed record PortionExpected(int Kcal, decimal ProteinG, decimal FatG, decimal CarbsG);
    private sealed record PortionCase(
        string Name, decimal KcalPer100g, decimal ProteinPer100g, decimal FatPer100g, decimal CarbsPer100g, int Grams, PortionExpected Expected);
    private sealed record OverrideExpected(int ProteinG, int FatG, int CarbsG);
    private sealed record OverrideCase(string Name, int Calories, decimal WeightKg, string Goal, OverrideExpected Expected);
    private sealed record MicroExpected(decimal? FiberG, decimal? SugarsG, int? SodiumMg);
    private sealed record MicroCase(string Name, decimal? FiberPer100g, decimal? SugarsPer100g, int? SodiumMgPer100g, int Grams, MicroExpected Expected);
    private sealed record RecipeCase(
        string Name, int Servings, IngredientValues[] Ingredients, RecipeValues ExpectedTotal, decimal EatenServings, RecipeValues ExpectedEntry,
        RecipeValues ExpectedPerServing);
    private sealed record WeeklyCase(string Name, int? TargetKcal, DayIntake[] Days, WeekIntake[] Expected);
    private sealed record Vectors(
        TargetCase[] Targets, FloorCase[] Floor, PortionCase[] Portions, OverrideCase[] Override, MicroCase[] Micros, RecipeCase[] Recipes,
        WeeklyCase[] Weekly);

    private static readonly Vectors All = JsonSerializer.Deserialize<Vectors>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Nutrition", "nutrition-vectors.json")),
        new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    public static TheoryData<string> TargetNames() => [.. All.Targets.Select(t => t.Name)];
    public static TheoryData<string> FloorNames() => [.. All.Floor.Select(t => t.Name)];
    public static TheoryData<string> PortionNames() => [.. All.Portions.Select(t => t.Name)];
    public static TheoryData<string> OverrideNames() => [.. All.Override.Select(t => t.Name)];
    public static TheoryData<string> MicroNames() => [.. All.Micros.Select(t => t.Name)];
    public static TheoryData<string> RecipeNames() => [.. All.Recipes.Select(t => t.Name)];
    public static TheoryData<string> WeeklyNames() => [.. All.Weekly.Select(t => t.Name)];

    // SPEC-nutrition-006, AC-03
    [Theory]
    [MemberData(nameof(WeeklyNames))]
    public void AC_nutrition_006_03_vectores_de_los_promedios_semanales_y_la_adherencia(string name)
    {
        var c = All.Weekly.Single(w => w.Name == name);

        Assert.Equal(c.Expected, NutritionHistory.Weekly(c.Days, c.TargetKcal));
    }

    // SPEC-nutrition-005, AC-03
    [Theory]
    [MemberData(nameof(RecipeNames))]
    public void AC_nutrition_005_03_vectores_del_total_por_racion_y_por_cantidad_de_una_receta(string name)
    {
        var c = All.Recipes.Single(r => r.Name == name);

        var total = NutritionRules.RecipeTotal(c.Ingredients);

        Assert.Equal(c.ExpectedTotal, total);
        Assert.Equal(c.ExpectedEntry, NutritionRules.ScaleRecipe(total, c.Servings, c.EatenServings));
        Assert.Equal(c.ExpectedPerServing, NutritionRules.ScaleRecipe(total, c.Servings, 1m));
    }

    // SPEC-nutrition-004, AC-04
    [Theory]
    [MemberData(nameof(MicroNames))]
    public void AC_nutrition_004_04_vectores_del_calculo_de_micronutrientes_por_cantidad(string name)
    {
        var c = All.Micros.Single(m => m.Name == name);

        var m = NutritionRules.MicrosOf(c.FiberPer100g, c.SugarsPer100g, c.SodiumMgPer100g, c.Grams);

        Assert.Equal(c.Expected, new MicroExpected(m.FiberG, m.SugarsG, m.SodiumMg));
    }

    // SPEC-nutrition-002, AC-03
    [Theory]
    [MemberData(nameof(OverrideNames))]
    public void AC_nutrition_002_03_vectores_del_reparto_de_macros_con_calorias_ajustadas(string name)
    {
        var c = All.Override.Single(o => o.Name == name);

        var m = NutritionRules.MacrosFor(c.Calories, c.WeightKg, c.Goal);

        Assert.Equal(c.Expected, new OverrideExpected(m.ProteinG, m.FatG, m.CarbsG));
    }

    // AC-02
    [Theory]
    [MemberData(nameof(TargetNames))]
    public void AC_nutrition_001_02_vectores_del_objetivo_diario(string name)
    {
        var c = All.Targets.Single(t => t.Name == name);

        var t = NutritionRules.Target(c.Sex, c.BirthDate, c.HeightCm, c.ActivityLevel, c.Goal, c.WeightKg, c.Today);

        Assert.Equal(c.Expected, new TargetExpected(t.Calories, t.ProteinG, t.FatG, t.CarbsG, t.BasalKcal));
    }

    [Theory]
    [MemberData(nameof(PortionNames))]
    public void AC_nutrition_001_02_vectores_del_redondeo_por_cantidad(string name)
    {
        var c = All.Portions.Single(p => p.Name == name);

        var p = NutritionRules.PortionOf(c.KcalPer100g, c.ProteinPer100g, c.FatPer100g, c.CarbsPer100g, c.Grams);

        Assert.Equal(c.Expected, new PortionExpected(p.Kcal, p.ProteinG, p.FatG, p.CarbsG));
    }

    // AC-03
    [Theory]
    [MemberData(nameof(FloorNames))]
    public void AC_nutrition_001_03_las_calorias_nunca_bajan_del_metabolismo_basal(string name)
    {
        var c = All.Floor.Single(f => f.Name == name);

        var calories = NutritionRules.Calories(c.Expenditure, c.GoalFactor, c.Basal);

        Assert.Equal(c.Expected, calories);
        Assert.True(calories >= (int)Math.Floor(c.Basal));
        Assert.Equal(0, calories % 5);
    }
}

/// <summary>Reglas puras de SPEC-nutrition-003 contra los vectores compartidos (ADR-0004).</summary>
public sealed class AllergenVectorsTests
{
    private sealed record MatchCase(string Name, string[] ProfileAllergies, string[] FoodAllergens, string[] Expected);
    private sealed record AllergenVectors(MatchCase[] Matches);

    private static readonly AllergenVectors All = JsonSerializer.Deserialize<AllergenVectors>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Nutrition", "allergen-vectors.json")),
        new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    public static TheoryData<string> MatchNames() => [.. All.Matches.Select(m => m.Name)];

    [Theory]
    [MemberData(nameof(MatchNames))]
    public void AC_nutrition_003_04_vectores_de_coincidencia_entre_alergias_y_alergenos(string name)
    {
        var c = All.Matches.Single(m => m.Name == name);

        Assert.Equal(c.Expected, Allergens.Conflicts(c.ProfileAllergies, c.FoodAllergens));
    }
}

/// <summary>Verifica SPEC-nutrition-001 contra la API y Postgres reales. Cada test cita su criterio de aceptación.</summary>
[Collection("api")]
public sealed class NutritionApiTests(ApiFixture api)
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static FoodRequest Food(
        string name = "Avena", string? barcode = null, decimal kcal = 389m, decimal protein = 16.9m, decimal fat = 6.9m, decimal carbs = 66.3m,
        string? brand = "Marca", string source = "manual") =>
        new(name, brand, barcode, kcal, protein, fat, carbs, source);

    private static async Task<Guid> PutFood(HttpClient c, FoodRequest food, Guid? id = null)
    {
        var foodId = id ?? Guid.NewGuid();
        (await c.PutAsJsonAsync($"/foods/{foodId}", food)).EnsureSuccessStatusCode();
        return foodId;
    }

    private static Task<HttpResponseMessage> PutEntry(HttpClient c, Guid id, Guid foodId, int grams = 50, string meal = "desayuno", DateOnly? date = null) =>
        c.PutAsJsonAsync($"/food-entries/{id}", new FoodEntryRequest(date ?? Today, meal, foodId, grams));

    private static Task<NutritionDayDto?> Day(HttpClient c, DateOnly? date = null) =>
        c.GetFromJsonAsync<NutritionDayDto>($"/nutrition/day?date={(date ?? Today):yyyy-MM-dd}");

    private static async Task Complete(HttpClient c, string goal = "mantener", string activity = "ligero")
    {
        (await c.PutAsJsonAsync("/profile", new ProfileRequest(
            "Julio", "masculino", new DateOnly(1995, 5, 20), 178, goal, activity, null, null, null, null))).EnsureSuccessStatusCode();
        (await c.PostAsJsonAsync("/weights", new CreateWeightRequest(Guid.NewGuid(), 80.5m, DateTimeOffset.UtcNow.AddDays(-1)))).EnsureSuccessStatusCode();
    }

    // AC-01
    [Fact]
    public async Task AC_nutrition_001_01_con_perfil_y_peso_responde_el_objetivo_con_las_entradas_usadas()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Complete(client);
        var expected = NutritionRules.Target("masculino", new DateOnly(1995, 5, 20), 178, "ligero", "mantener", 80.5m, Today);

        var target = (await client.GetFromJsonAsync<NutritionTargetDto>("/nutrition/targets"))!;

        Assert.Equal((expected.Calories, expected.ProteinG, expected.FatG, expected.CarbsG, expected.BasalKcal),
            (target.Calories, target.ProteinG, target.FatG, target.CarbsG, target.BasalKcal));
        Assert.Equal(80.5m, target.WeightKg);
        Assert.Equal(Today.AddDays(-1), target.WeightDate);
    }

    // AC-04
    [Fact]
    public async Task AC_nutrition_001_04_sin_perfil_o_sin_peso_responde_422_indicando_que_falta_y_los_cambios_se_reflejan()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var noProfile = await client.GetAsync("/nutrition/targets");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, noProfile.StatusCode);
        Assert.Equal("perfil", (await noProfile.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("missing").GetString());

        (await client.PutAsJsonAsync("/profile", new ProfileRequest(
            "Julio", "masculino", new DateOnly(1995, 5, 20), 178, "mantener", null, null, null, null, null))).EnsureSuccessStatusCode();
        var noWeight = await client.GetAsync("/nutrition/targets");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, noWeight.StatusCode);
        Assert.Equal("peso", (await noWeight.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("missing").GetString());

        (await client.PostAsJsonAsync("/weights", new CreateWeightRequest(Guid.NewGuid(), 80m, DateTimeOffset.UtcNow.AddDays(-2)))).EnsureSuccessStatusCode();
        var first = (await client.GetFromJsonAsync<NutritionTargetDto>("/nutrition/targets"))!;
        (await client.PostAsJsonAsync("/weights", new CreateWeightRequest(Guid.NewGuid(), 90m, DateTimeOffset.UtcNow.AddDays(-1)))).EnsureSuccessStatusCode();
        var second = (await client.GetFromJsonAsync<NutritionTargetDto>("/nutrition/targets"))!;

        Assert.Equal(80m, first.WeightKg);
        Assert.Equal(90m, second.WeightKg); // el último peso manda y no se guarda ningún objetivo
        Assert.True(second.Calories > first.Calories);
    }

    [Fact]
    public async Task AC_nutrition_001_04_sin_sesion_responde_401()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.CreateClient().GetAsync("/nutrition/targets")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.CreateClient().GetAsync("/foods")).StatusCode);
    }

    // AC-05
    [Fact]
    public async Task AC_nutrition_001_05_crea_el_alimento_y_reenviarlo_o_reemplazarlo_responde_200()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();

        var created = await client.PutAsJsonAsync($"/foods/{id}", Food());
        var again = await client.PutAsJsonAsync($"/foods/{id}", Food());
        var replaced = await client.PutAsJsonAsync($"/foods/{id}", Food(name: "Avena integral", kcal: 370m));

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replaced.StatusCode);
        var foods = (await client.GetFromJsonAsync<List<FoodDto>>("/foods"))!;
        var saved = Assert.Single(foods);
        Assert.Equal(("Avena integral", 370m, "Marca"), (saved.Name, saved.KcalPer100g, saved.Brand));
    }

    // AC-06
    [Theory]
    [InlineData("")]
    [InlineData("n")] // se prueba con el nombre largo abajo
    public async Task AC_nutrition_001_06_un_nombre_vacio_responde_400_y_no_guarda(string name)
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.PutAsJsonAsync($"/foods/{Guid.NewGuid()}", Food(name: name == "n" ? new string('x', 81) : name));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<FoodDto>>("/foods"))!);
    }

    [Theory]
    [MemberData(nameof(InvalidFoods))]
    public async Task AC_nutrition_001_06_valores_fuera_de_las_reglas_responden_400_y_no_guardan(FoodRequest food)
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.PutAsJsonAsync($"/foods/{Guid.NewGuid()}", food);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<FoodDto>>("/foods"))!);
    }

    public static TheoryData<FoodRequest> InvalidFoods() =>
    [
        Food(kcal: 901m), Food(kcal: -1m), Food(protein: 100.1m), Food(fat: -0.1m), Food(carbs: 101m),
        Food(protein: 50m, fat: 40m, carbs: 20m), // suman más de 100 g
        Food(kcal: 100.55m), // más de un decimal
        Food(barcode: "abc"), Food(barcode: "123"), Food(source: "otro"), Food(brand: new string('m', 61)),
    ];

    // AC-07
    [Fact]
    public async Task AC_nutrition_001_07_el_mismo_codigo_de_barras_choca_dentro_de_una_persona_pero_no_entre_personas()
    {
        var one = api.ClientFor(Guid.NewGuid());
        var two = api.ClientFor(Guid.NewGuid());
        var code = "3017624010701";
        var id = await PutFood(one, Food(barcode: code));

        var clash = await one.PutAsJsonAsync($"/foods/{Guid.NewGuid()}", Food(name: "Otro", barcode: code));
        var edit = await one.PutAsJsonAsync($"/foods/{id}", Food(name: "Mismo alimento", barcode: code)); // el propio puede conservar su código
        var other = await two.PutAsJsonAsync($"/foods/{Guid.NewGuid()}", Food(barcode: code));
        var noCode1 = await one.PutAsJsonAsync($"/foods/{Guid.NewGuid()}", Food(name: "Sin código 1"));
        var noCode2 = await one.PutAsJsonAsync($"/foods/{Guid.NewGuid()}", Food(name: "Sin código 2"));

        Assert.Equal(HttpStatusCode.Conflict, clash.StatusCode);
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
        Assert.Equal(HttpStatusCode.Created, other.StatusCode);
        Assert.Equal(HttpStatusCode.Created, noCode1.StatusCode);
        Assert.Equal(HttpStatusCode.Created, noCode2.StatusCode);
    }

    // AC-08
    [Fact]
    public async Task AC_nutrition_001_08_lista_solo_los_propios_ordenados_y_filtra_sin_mayusculas_ni_acentos()
    {
        var one = api.ClientFor(Guid.NewGuid());
        var two = api.ClientFor(Guid.NewGuid());
        await PutFood(one, Food(name: "Plátano", brand: null));
        await PutFood(one, Food(name: "Arroz blanco", brand: "Marca A"));
        await PutFood(one, Food(name: "Yogur natural", brand: null));
        await PutFood(two, Food(name: "Pizza"));

        var all = (await one.GetFromJsonAsync<List<FoodDto>>("/foods"))!.Select(f => f.Name).ToList();
        var byAccent = (await one.GetFromJsonAsync<List<FoodDto>>("/foods?query=PLATANO"))!.Select(f => f.Name).ToList();
        var byBrand = (await one.GetFromJsonAsync<List<FoodDto>>("/foods?query=marca"))!.Select(f => f.Name).ToList();

        Assert.Equal(["Arroz blanco", "Plátano", "Yogur natural"], all);
        Assert.Equal(["Plátano"], byAccent);
        Assert.Equal(["Arroz blanco"], byBrand);
        Assert.Empty((await one.GetFromJsonAsync<List<FoodDto>>("/foods?query=pizza"))!);
    }

    // AC-09
    [Fact]
    public async Task AC_nutrition_001_09_borrar_un_alimento_conserva_las_entradas_ya_registradas()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var foodId = await PutFood(client, Food(name: "Avena"));
        await PutEntry(client, Guid.NewGuid(), foodId, grams: 50);

        var deleted = await client.DeleteAsync($"/foods/{foodId}");
        var again = await client.DeleteAsync($"/foods/{foodId}");
        var unknown = await client.DeleteAsync($"/foods/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, unknown.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<FoodDto>>("/foods"))!);
        var entry = Assert.Single((await Day(client))!.Meals.Single().Entries);
        Assert.Equal(("Avena", 195, null), (entry.Name, entry.Kcal, entry.FoodId)); // 389 kcal por 100 g × 50 g
    }

    // AC-10
    [Fact]
    public async Task AC_nutrition_001_10_la_entrada_copia_nombre_y_valores_de_la_cantidad_y_cambiar_los_gramos_los_recalcula()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var foodId = await PutFood(client, Food(name: "Avena", kcal: 389m, protein: 16.9m, fat: 6.9m, carbs: 66.3m));
        var entryId = Guid.NewGuid();

        var created = await PutEntry(client, entryId, foodId, grams: 183);
        var entry = (await created.Content.ReadFromJsonAsync<FoodEntryDto>())!;
        var expected = NutritionRules.PortionOf(389m, 16.9m, 6.9m, 66.3m, 183);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal((expected.Kcal, expected.ProteinG, expected.FatG, expected.CarbsG, "Avena", 183),
            (entry.Kcal, entry.ProteinG, entry.FatG, entry.CarbsG, entry.Name, entry.Grams));

        var again = await PutEntry(client, entryId, foodId, grams: 183);
        var changed = await PutEntry(client, entryId, foodId, grams: 100);
        var recalculated = (await changed.Content.ReadFromJsonAsync<FoodEntryDto>())!;

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal((389, 16.9m, 6.9m, 66.3m), (recalculated.Kcal, recalculated.ProteinG, recalculated.FatG, recalculated.CarbsG));
        Assert.Single((await Day(client))!.Meals.Single().Entries); // sin duplicar
    }

    [Theory]
    [InlineData("Desayuno", "desayuno")]
    [InlineData("  CENA ", "cena")]
    [InlineData("Merienda de la tarde", "Merienda de la tarde")]
    public async Task AC_nutrition_001_10_las_comidas_fijas_se_normalizan_y_las_libres_se_conservan(string meal, string expected)
    {
        var client = api.ClientFor(Guid.NewGuid());
        var foodId = await PutFood(client, Food());

        var response = await PutEntry(client, Guid.NewGuid(), foodId, meal: meal);

        Assert.Equal(expected, (await response.Content.ReadFromJsonAsync<FoodEntryDto>())!.Meal);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(5001)]
    public async Task AC_nutrition_001_10_gramos_fuera_de_1_a_5000_responden_400(int grams)
    {
        var client = api.ClientFor(Guid.NewGuid());
        var foodId = await PutFood(client, Food());

        Assert.Equal(HttpStatusCode.BadRequest, (await PutEntry(client, Guid.NewGuid(), foodId, grams: grams)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PutEntry(client, Guid.NewGuid(), foodId, meal: new string('c', 31))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PutEntry(client, Guid.NewGuid(), foodId, meal: "  ")).StatusCode);
    }

    // AC-11
    [Fact]
    public async Task AC_nutrition_001_11_un_alimento_ajeno_o_inexistente_responde_422_y_una_fecha_futura_400()
    {
        var one = api.ClientFor(Guid.NewGuid());
        var two = api.ClientFor(Guid.NewGuid());
        var foreignFood = await PutFood(two, Food());
        var ownFood = await PutFood(one, Food());

        var foreign = await PutEntry(one, Guid.NewGuid(), foreignFood);
        var unknown = await PutEntry(one, Guid.NewGuid(), Guid.NewGuid());
        var future = await PutEntry(one, Guid.NewGuid(), ownFood, date: Today.AddDays(5));
        var tomorrow = await PutEntry(one, Guid.NewGuid(), ownFood, date: Today.AddDays(1)); // un día de margen por la zona horaria

        Assert.Equal(HttpStatusCode.UnprocessableEntity, foreign.StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);
        Assert.Equal(HttpStatusCode.Created, tomorrow.StatusCode);
        Assert.Empty((await Day(one))!.Meals);
    }

    // AC-12
    [Fact]
    public async Task AC_nutrition_001_12_borrar_una_entrada_deja_de_contar_y_repetir_el_borrado_responde_204()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var foodId = await PutFood(client, Food());
        var entryId = Guid.NewGuid();
        await PutEntry(client, entryId, foodId);

        var deleted = await client.DeleteAsync($"/food-entries/{entryId}");
        var again = await client.DeleteAsync($"/food-entries/{entryId}");
        var unknown = await client.DeleteAsync($"/food-entries/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, unknown.StatusCode);
        var day = (await Day(client))!;
        Assert.Empty(day.Meals);
        Assert.Equal(0, day.Totals.Kcal);
    }

    // AC-13
    [Fact]
    public async Task AC_nutrition_001_13_el_dia_agrupa_por_comida_con_las_fijas_primero_suma_y_compara_con_el_objetivo()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Complete(client);
        var oats = await PutFood(client, Food(name: "Avena", kcal: 389m, protein: 16.9m, fat: 6.9m, carbs: 66.3m));
        var egg = await PutFood(client, Food(name: "Huevo", kcal: 143m, protein: 12.6m, fat: 9.5m, carbs: 0.7m));
        await PutEntry(client, Guid.NewGuid(), oats, grams: 60, meal: "Merienda libre");
        await PutEntry(client, Guid.NewGuid(), egg, grams: 120, meal: "cena");
        await PutEntry(client, Guid.NewGuid(), oats, grams: 50, meal: "desayuno");
        await PutEntry(client, Guid.NewGuid(), egg, grams: 55, meal: "desayuno");
        await PutEntry(client, Guid.NewGuid(), oats, grams: 100, meal: "ayer", date: Today.AddDays(-1)); // otro día: no cuenta

        var day = (await Day(client))!;

        Assert.Equal(["desayuno", "cena", "Merienda libre"], day.Meals.Select(m => m.Name));
        Assert.Equal(2, day.Meals[0].Entries.Count);
        var all = day.Meals.SelectMany(m => m.Entries).ToList();
        Assert.Equal((all.Sum(e => e.Kcal), all.Sum(e => e.ProteinG), all.Sum(e => e.FatG), all.Sum(e => e.CarbsG)),
            (day.Totals.Kcal, day.Totals.ProteinG, day.Totals.FatG, day.Totals.CarbsG));
        Assert.NotNull(day.Targets);
        Assert.Equal(day.Targets!.Calories - day.Totals.Kcal, day.Remaining!.Kcal);
        Assert.Equal(day.Targets.ProteinG - day.Totals.ProteinG, day.Remaining.ProteinG);
    }

    [Fact]
    public async Task AC_nutrition_001_13_sin_objetivo_calculable_devuelve_los_totales_y_targets_nulo()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var foodId = await PutFood(client, Food());
        await PutEntry(client, Guid.NewGuid(), foodId, grams: 100);

        var day = (await Day(client))!;

        Assert.Null(day.Targets);
        Assert.Null(day.Remaining);
        Assert.Equal(389, day.Totals.Kcal);
    }

    [Fact]
    public async Task AC_nutrition_001_13_una_fecha_mal_escrita_responde_400()
    {
        var client = api.ClientFor(Guid.NewGuid());

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/nutrition/day?date=ayer")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/nutrition/day")).StatusCode);
    }

    // AC-14 (P7)
    [Fact]
    public async Task AC_nutrition_001_14_una_persona_no_ve_ni_cambia_los_alimentos_ni_las_entradas_de_otra()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        var foodId = await PutFood(owner, Food());
        var entryId = Guid.NewGuid();
        await PutEntry(owner, entryId, foodId);

        var editFood = await other.PutAsJsonAsync($"/foods/{foodId}", Food(name: "Robado"));
        var otherFood = await PutFood(other, Food(name: "Mío"));
        var editEntry = await PutEntry(other, entryId, otherFood, grams: 999);
        await other.DeleteAsync($"/foods/{foodId}");
        await other.DeleteAsync($"/food-entries/{entryId}");

        Assert.Equal(HttpStatusCode.NotFound, editFood.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, editEntry.StatusCode);
        Assert.Empty((await Day(other))!.Meals);
        Assert.Equal("Avena", Assert.Single((await owner.GetFromJsonAsync<List<FoodDto>>("/foods"))!).Name);
        Assert.Equal(50, Assert.Single((await Day(owner))!.Meals.Single().Entries).Grams);
    }

    // ---------- SPEC-nutrition-002: ajuste manual del objetivo ----------

    private static Task<HttpResponseMessage> PutOverride(HttpClient c, int calories) =>
        c.PutAsJsonAsync("/nutrition/targets/override", new TargetOverrideRequest(calories));

    private static Task<NutritionTargetDto?> Targets(HttpClient c) => c.GetFromJsonAsync<NutritionTargetDto>("/nutrition/targets");

    // AC-nutrition-002-01
    [Fact]
    public async Task AC_nutrition_002_01_fijar_las_calorias_responde_200_y_es_idempotente()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Complete(client);

        var first = await PutOverride(client, 2000);
        var again = await PutOverride(client, 2000);
        var changed = await PutOverride(client, 2200);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal(2200, (await Targets(client))!.Calories);
    }

    // AC-nutrition-002-02
    [Fact]
    public async Task AC_nutrition_002_02_el_objetivo_usa_las_calorias_ajustadas_y_recalcula_los_macros()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Complete(client, goal: "mantener");
        var calculated = (await Targets(client))!;

        await PutOverride(client, 2000);
        var target = (await Targets(client))!;

        Assert.Equal("calculated", calculated.Source);
        Assert.Equal("manual", target.Source);
        Assert.Equal((2000, 145, 56, 229), (target.Calories, target.ProteinG, target.FatG, target.CarbsG)); // vectores: mantener, 80,5 kg
        Assert.Equal(calculated.BasalKcal, target.BasalKcal);
        Assert.Equal(calculated.WeightKg, target.WeightKg);
        Assert.Equal(calculated.Calories, target.CalculatedCalories); // la app vuelve al calculado sin conexión con este valor
        Assert.Equal(calculated.Calories, calculated.CalculatedCalories);
    }

    // AC-nutrition-002-04
    [Theory]
    [InlineData(799)]
    [InlineData(6001)]
    [InlineData(0)]
    [InlineData(-100)]
    public async Task AC_nutrition_002_04_calorias_fuera_de_rango_responden_400_y_no_guardan_nada(int calories)
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Complete(client);
        var before = (await Targets(client))!;

        var response = await PutOverride(client, calories);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var after = (await Targets(client))!;
        Assert.Equal("calculated", after.Source);
        Assert.Equal(before.Calories, after.Calories);
    }

    // AC-nutrition-002-04 (bordes válidos)
    [Theory]
    [InlineData(800)]
    [InlineData(6000)]
    public async Task AC_nutrition_002_04_los_bordes_del_rango_se_aceptan(int calories)
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Complete(client);

        Assert.Equal(HttpStatusCode.OK, (await PutOverride(client, calories)).StatusCode);
        Assert.Equal(calories, (await Targets(client))!.Calories);
    }

    // AC-nutrition-002-05
    [Fact]
    public async Task AC_nutrition_002_05_borrar_el_ajuste_vuelve_al_calculado_y_repetirlo_responde_204()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Complete(client);
        var calculated = (await Targets(client))!;
        await PutOverride(client, 2000);

        var first = await client.DeleteAsync("/nutrition/targets/override");
        var again = await client.DeleteAsync("/nutrition/targets/override");

        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
        var target = (await Targets(client))!;
        Assert.Equal("calculated", target.Source);
        Assert.Equal(calculated.Calories, target.Calories);
    }

    // AC-nutrition-002-06
    [Fact]
    public async Task AC_nutrition_002_06_sin_perfil_o_sin_peso_ajustar_responde_422_indicando_que_falta()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var noProfile = await PutOverride(client, 2000);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, noProfile.StatusCode);
        Assert.Equal("perfil", (await noProfile.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("missing").GetString());

        (await client.PutAsJsonAsync("/profile", new ProfileRequest(
            "Julio", "masculino", new DateOnly(1995, 5, 20), 178, "mantener", null, null, null, null, null))).EnsureSuccessStatusCode();
        var noWeight = await PutOverride(client, 2000);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, noWeight.StatusCode);
        Assert.Equal("peso", (await noWeight.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("missing").GetString());
    }

    // AC-nutrition-002-07
    [Fact]
    public async Task AC_nutrition_002_07_un_peso_nuevo_mantiene_las_calorias_ajustadas_y_recalcula_los_macros()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Complete(client, goal: "mantener"); // 80,5 kg
        await PutOverride(client, 2000);
        var before = (await Targets(client))!;

        (await client.PostAsJsonAsync("/weights", new CreateWeightRequest(Guid.NewGuid(), 70m, DateTimeOffset.UtcNow))).EnsureSuccessStatusCode();
        var after = (await Targets(client))!;

        Assert.Equal(2000, after.Calories);
        Assert.Equal("manual", after.Source);
        Assert.Equal(70m, after.WeightKg);
        Assert.True(after.ProteinG < before.ProteinG);
        Assert.Equal(NutritionRules.MacrosFor(2000, 70m, "mantener").ProteinG, after.ProteinG);
    }

    // AC-nutrition-002-07: el día usa el objetivo vigente
    [Fact]
    public async Task AC_nutrition_002_07_el_dia_usa_el_objetivo_ajustado()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Complete(client);
        await PutOverride(client, 2000);

        var day = (await Day(client))!;

        Assert.Equal(2000, day.Targets!.Calories);
        Assert.Equal("manual", day.Targets.Source);
        Assert.Equal(2000, day.Remaining!.Kcal);
    }

    // AC-nutrition-002-08 (P7)
    [Fact]
    public async Task AC_nutrition_002_08_ajustar_o_borrar_el_objetivo_no_afecta_a_otra_persona()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        await Complete(owner);
        await Complete(other);
        var otherBefore = (await Targets(other))!;

        await PutOverride(owner, 3000);
        await other.DeleteAsync("/nutrition/targets/override");

        Assert.Equal(3000, (await Targets(owner))!.Calories);
        var otherAfter = (await Targets(other))!;
        Assert.Equal("calculated", otherAfter.Source);
        Assert.Equal(otherBefore.Calories, otherAfter.Calories);
    }

    [Fact]
    public async Task AC_nutrition_002_08_sin_sesion_responde_401()
    {
        var anonymous = api.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await PutOverride(anonymous, 2000)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.DeleteAsync("/nutrition/targets/override")).StatusCode);
    }

    // ---------- SPEC-nutrition-003: alergias aplicadas a los alimentos ----------

    private static FoodRequest WithAllergens(params string[] allergens) => Food() with { Allergens = allergens };

    // AC-nutrition-003-01
    [Fact]
    public async Task AC_nutrition_003_01_los_alergenos_se_guardan_ordenados_sin_repetir_y_se_devuelven_en_el_listado()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var id = await PutFood(client, WithAllergens("leche", "gluten", "leche"));
        var plain = await PutFood(client, Food(name: "Arroz")); // sin el campo: compatible hacia atrás

        var foods = (await client.GetFromJsonAsync<List<FoodDto>>("/foods"))!;
        Assert.Equal(["gluten", "leche"], foods.Single(f => f.Id == id).Allergens);
        Assert.Empty(foods.Single(f => f.Id == plain).Allergens);
    }

    // AC-nutrition-003-02
    [Fact]
    public async Task AC_nutrition_003_02_un_alergeno_desconocido_o_mas_de_14_responden_400_y_no_guardan_nada()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var unknown = await client.PutAsJsonAsync($"/foods/{Guid.NewGuid()}", WithAllergens("polen"));
        var tooMany = await client.PutAsJsonAsync($"/foods/{Guid.NewGuid()}", WithAllergens(Enumerable.Repeat("leche", 15).ToArray()));

        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<FoodDto>>("/foods"))!);
    }

    // AC-nutrition-003-04
    [Fact]
    public async Task AC_nutrition_003_04_los_conflictos_usan_las_alergias_del_perfil()
    {
        var client = api.ClientFor(Guid.NewGuid());
        (await client.PutAsJsonAsync("/profile", new ProfileRequest(
            "Julio", "masculino", new DateOnly(1995, 5, 20), 178, "mantener", null, null, null, null, ["Intolerancia a la lactosa", "nueces"]))).EnsureSuccessStatusCode();
        var milk = await PutFood(client, WithAllergens("leche", "gluten"));
        var safe = await PutFood(client, Food(name: "Arroz"));

        var withConflict = (await client.GetFromJsonAsync<FoodConflictsDto>($"/foods/{milk}/conflicts"))!;
        var without = (await client.GetFromJsonAsync<FoodConflictsDto>($"/foods/{safe}/conflicts"))!;

        Assert.Equal(["leche"], withConflict.Conflicts);
        Assert.Empty(without.Conflicts);
    }

    [Fact]
    public async Task AC_nutrition_003_04_sin_perfil_no_hay_conflictos_y_un_alimento_inexistente_responde_404()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var id = await PutFood(client, WithAllergens("leche"));

        Assert.Empty((await client.GetFromJsonAsync<FoodConflictsDto>($"/foods/{id}/conflicts"))!.Conflicts);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/foods/{Guid.NewGuid()}/conflicts")).StatusCode);
    }

    // AC-nutrition-003-08 (P7)
    [Fact]
    public async Task AC_nutrition_003_08_los_conflictos_solo_usan_las_alergias_y_los_alimentos_de_la_persona()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        (await owner.PutAsJsonAsync("/profile", new ProfileRequest(
            "Ana", "femenino", new DateOnly(1990, 1, 1), 165, "mantener", null, null, null, null, ["leche"]))).EnsureSuccessStatusCode();
        var foodId = await PutFood(owner, WithAllergens("leche"));

        var asOther = await other.GetAsync($"/foods/{foodId}/conflicts");
        var otherFood = await PutFood(other, WithAllergens("leche"));
        var otherOwn = (await other.GetFromJsonAsync<FoodConflictsDto>($"/foods/{otherFood}/conflicts"))!;

        Assert.Equal(HttpStatusCode.NotFound, asOther.StatusCode); // ni ve el alimento ajeno
        Assert.Empty(otherOwn.Conflicts); // las alergias de la otra persona no se le aplican
        Assert.Equal(["leche"], (await owner.GetFromJsonAsync<FoodConflictsDto>($"/foods/{foodId}/conflicts"))!.Conflicts);
    }

    // ---------- SPEC-nutrition-004: agua y micronutrientes ----------

    private static FoodRequest WithMicros(decimal? fiber, decimal? sugars, int? sodium) =>
        Food() with { FiberPer100g = fiber, SugarsPer100g = sugars, SodiumMgPer100g = sodium };

    // AC-nutrition-004-01
    [Fact]
    public async Task AC_nutrition_004_01_los_micronutrientes_se_guardan_y_sin_ellos_el_alimento_queda_sin_dato()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var full = await PutFood(client, WithMicros(5.5m, 2m, 300));
        var plain = await PutFood(client, Food(name: "Arroz"));

        var foods = (await client.GetFromJsonAsync<List<FoodDto>>("/foods"))!;
        var withData = foods.Single(f => f.Id == full);
        Assert.Equal((5.5m, 2m, 300), (withData.FiberPer100g, withData.SugarsPer100g, withData.SodiumMgPer100g));
        var without = foods.Single(f => f.Id == plain);
        Assert.Null(without.FiberPer100g);
        Assert.Null(without.SugarsPer100g);
        Assert.Null(without.SodiumMgPer100g);
    }

    // AC-nutrition-004-02
    [Theory]
    [InlineData(-1, 1, 1)]
    [InlineData(101, 1, 1)]
    [InlineData(1, -1, 1)]
    [InlineData(1, 70, 1)] // más azúcares que carbohidratos (el alimento de prueba lleva 66,3 g)
    [InlineData(1, 1, -1)]
    [InlineData(1, 1, 40001)]
    public async Task AC_nutrition_004_02_valores_fuera_de_rango_o_azucares_mayores_que_carbohidratos_responden_400(double fiber, double sugars, int sodium)
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.PutAsJsonAsync($"/foods/{Guid.NewGuid()}", WithMicros((decimal)fiber, (decimal)sugars, sodium));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<FoodDto>>("/foods"))!);
    }

    // AC-nutrition-004-03
    [Fact]
    public async Task AC_nutrition_004_03_la_entrada_copia_los_micronutrientes_de_esa_cantidad_y_sin_dato_queda_sin_dato()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var full = await PutFood(client, WithMicros(6.7m, 1.2m, 1250));
        var plain = await PutFood(client, Food(name: "Arroz"));
        var withData = Guid.NewGuid();
        var withoutData = Guid.NewGuid();

        await PutEntry(client, withData, full, grams: 50);
        await PutEntry(client, withoutData, plain, grams: 50);

        var entries = (await Day(client))!.Meals.Single().Entries;
        var a = entries.Single(e => e.Id == withData);
        Assert.Equal((3.4m, 0.6m, 625), (a.FiberG, a.SugarsG, a.SodiumMg)); // vectores: 6,7 g y 1,2 g por 100 g, 1250 mg por 100 g
        var b = entries.Single(e => e.Id == withoutData);
        Assert.Null(b.FiberG);
        Assert.Null(b.SugarsG);
        Assert.Null(b.SodiumMg);
    }

    // AC-nutrition-004-05
    [Fact]
    public async Task AC_nutrition_004_05_los_totales_del_dia_suman_lo_que_tiene_dato_y_avisan_de_lo_parcial()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var full = await PutFood(client, WithMicros(10m, 4m, 400));
        var plain = await PutFood(client, Food(name: "Arroz"));
        await PutEntry(client, Guid.NewGuid(), full, grams: 100);
        await PutEntry(client, Guid.NewGuid(), full, grams: 50);

        var complete = (await Day(client))!.Totals;
        await PutEntry(client, Guid.NewGuid(), plain, grams: 100);
        var partial = (await Day(client))!.Totals;

        Assert.Equal((15m, 6m, 600, false), (complete.FiberG, complete.SugarsG, complete.SodiumMg, complete.Partial));
        Assert.Equal((15m, 6m, 600, true), (partial.FiberG, partial.SugarsG, partial.SodiumMg, partial.Partial)); // lo sin dato no suma
    }

    private static Task<HttpResponseMessage> PutWater(HttpClient c, Guid id, int ml, DateOnly? date = null) =>
        c.PutAsJsonAsync($"/water-entries/{id}", new WaterRequest(date ?? Today, ml));

    // AC-nutrition-004-06
    [Fact]
    public async Task AC_nutrition_004_06_el_agua_se_guarda_idempotente_suma_en_el_dia_y_se_borra_incluso_si_es_ajena_o_no_existe()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var id = Guid.NewGuid();

        var created = await PutWater(client, id, 250);
        var again = await PutWater(client, id, 250);
        var changed = await PutWater(client, id, 300);
        await PutWater(client, Guid.NewGuid(), 500);

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var day = (await Day(client))!;
        Assert.Equal(800, day.Totals.WaterMl);
        Assert.Equal([300, 500], day.Water.Select(w => w.Ml).Order());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/water-entries/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/water-entries/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/water-entries/{Guid.NewGuid()}")).StatusCode);
        Assert.Equal(500, (await Day(client))!.Totals.WaterMl);
    }

    // AC-nutrition-004-07
    [Theory]
    [InlineData(0, 0)]
    [InlineData(5001, 0)]
    [InlineData(250, 3)] // fecha posterior a mañana
    public async Task AC_nutrition_004_07_ml_fuera_de_rango_o_fecha_futura_responden_400_y_no_guardan_nada(int ml, int daysAhead)
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await PutWater(client, Guid.NewGuid(), ml, Today.AddDays(daysAhead));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, (await Day(client, Today.AddDays(daysAhead)))!.Totals.WaterMl);
    }

    // AC-nutrition-004-08 (P7)
    [Fact]
    public async Task AC_nutrition_004_08_una_persona_no_ve_ni_cambia_el_agua_ni_los_micronutrientes_de_otra()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        var waterId = Guid.NewGuid();
        await PutWater(owner, waterId, 250);

        var edit = await PutWater(other, waterId, 999);
        await other.DeleteAsync($"/water-entries/{waterId}");

        Assert.Equal(HttpStatusCode.NotFound, edit.StatusCode);
        Assert.Equal(0, (await Day(other))!.Totals.WaterMl);
        Assert.Equal(250, (await Day(owner))!.Totals.WaterMl);
    }

    // ---------- SPEC-nutrition-005: recetas ----------

    private static RecipeRequest Recipe(string name = "Gachas", int servings = 2, params (Guid FoodId, int Grams)[] ingredients) =>
        new(name, servings, ingredients.Select(i => new IngredientRequest(i.FoodId, i.Grams)).ToList());

    private static Task<HttpResponseMessage> PutRecipe(HttpClient c, Guid id, RecipeRequest recipe) => c.PutAsJsonAsync($"/recipes/{id}", recipe);

    private static Task<List<RecipeDto>?> Recipes(HttpClient c) => c.GetFromJsonAsync<List<RecipeDto>>("/recipes");

    // AC-nutrition-005-01
    [Fact]
    public async Task AC_nutrition_005_01_una_receta_valida_se_guarda_con_201_y_reenviarla_o_cambiarla_responde_200()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var oats = await PutFood(client, Food());
        var milk = await PutFood(client, Food(name: "Leche", kcal: 64, protein: 3.3m, fat: 3.6m, carbs: 4.8m));
        var id = Guid.NewGuid();

        var created = await PutRecipe(client, id, Recipe(ingredients: [(oats, 80), (milk, 200)]));
        var again = await PutRecipe(client, id, Recipe(ingredients: [(oats, 80), (milk, 200)]));
        var changed = await PutRecipe(client, id, Recipe("Gachas con leche", 3, [(oats, 100)]));

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var saved = Assert.Single((await Recipes(client))!);
        Assert.Equal(("Gachas con leche", 3, 1), (saved.Name, saved.Servings, saved.Ingredients.Count));
    }

    // AC-nutrition-005-02
    [Fact]
    public async Task AC_nutrition_005_02_recetas_fuera_de_las_reglas_o_con_alimentos_ajenos_no_se_guardan()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        var oats = await PutFood(client, Food());
        var foreign = await PutFood(other, Food(name: "Ajeno"));

        var cases = new (RecipeRequest Request, HttpStatusCode Expected)[]
        {
            (Recipe("", 2, [(oats, 50)]), HttpStatusCode.BadRequest),
            (Recipe(new string('x', 81), 2, [(oats, 50)]), HttpStatusCode.BadRequest),
            (Recipe("Sin raciones", 0, [(oats, 50)]), HttpStatusCode.BadRequest),
            (Recipe("Demasiadas", 51, [(oats, 50)]), HttpStatusCode.BadRequest),
            (Recipe("Sin ingredientes", 2, []), HttpStatusCode.BadRequest),
            (Recipe("Gramos", 2, [(oats, 0)]), HttpStatusCode.BadRequest),
            (Recipe("Gramos", 2, [(oats, 5001)]), HttpStatusCode.BadRequest),
            (Recipe("Repetido", 2, [(oats, 50), (oats, 60)]), HttpStatusCode.BadRequest),
            (Recipe("Ajeno", 2, [(foreign, 50)]), HttpStatusCode.UnprocessableEntity),
            (Recipe("Inexistente", 2, [(Guid.NewGuid(), 50)]), HttpStatusCode.UnprocessableEntity),
        };
        foreach (var (request, expected) in cases)
            Assert.Equal(expected, (await PutRecipe(client, Guid.NewGuid(), request)).StatusCode);

        Assert.Empty((await Recipes(client))!);
    }

    // AC-nutrition-005-06
    [Fact]
    public async Task AC_nutrition_005_06_el_listado_trae_solo_las_propias_por_nombre_con_los_valores_por_racion()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var oats = await PutFood(client, Food()); // 389 kcal por 100 g
        await PutRecipe(client, Guid.NewGuid(), Recipe("Zumo", 1, [(oats, 100)]));
        await PutRecipe(client, Guid.NewGuid(), Recipe("Árbol de gachas", 2, [(oats, 100)]));
        await PutRecipe(api.ClientFor(Guid.NewGuid()), Guid.NewGuid(), Recipe("Ajena", 1, [(await PutFood(api.ClientFor(Guid.NewGuid()), Food(name: "X")), 10)]));

        var recipes = (await Recipes(client))!;

        Assert.Equal(["Árbol de gachas", "Zumo"], recipes.Select(r => r.Name));
        Assert.Equal(389, recipes[1].Total.Kcal);
        Assert.Equal(195, recipes[0].PerServing.Kcal); // 389 / 2 = 194,5 → 195
    }

    // AC-nutrition-005-04
    [Fact]
    public async Task AC_nutrition_005_04_registrar_una_receta_copia_los_valores_de_esas_raciones_y_no_se_reescribe_despues()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var oats = await PutFood(client, Food());
        var recipeId = Guid.NewGuid();
        await PutRecipe(client, recipeId, Recipe("Gachas", 2, [(oats, 200)])); // total 778 kcal
        var entryId = Guid.NewGuid();

        var created = await client.PutAsJsonAsync($"/food-entries/{entryId}", new FoodEntryRequest(Today, "desayuno", RecipeId: recipeId, Servings: 1.5m));
        var entry = (await Day(client))!.Meals.Single().Entries.Single();

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(("Gachas", 0, recipeId, 1.5m, 584), (entry.Name, entry.Grams, entry.RecipeId, entry.Servings, entry.Kcal)); // 778 × 1,5 / 2 = 583,5 → 584
        Assert.Null(entry.FoodId);

        await PutRecipe(client, recipeId, Recipe("Gachas ligeras", 2, [(oats, 50)]));
        await client.DeleteAsync($"/recipes/{recipeId}");
        var after = (await Day(client))!.Meals.Single().Entries.Single();
        Assert.Equal(("Gachas", 584, null), (after.Name, after.Kcal, after.RecipeId)); // la entrada conserva su copia; la receta ya no existe
    }

    // AC-nutrition-005-04 (validación)
    [Fact]
    public async Task AC_nutrition_005_04_las_raciones_fuera_de_rango_o_indicar_alimento_y_receta_a_la_vez_responden_400_y_una_receta_ajena_422()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var oats = await PutFood(client, Food());
        var recipeId = Guid.NewGuid();
        await PutRecipe(client, recipeId, Recipe("Gachas", 2, [(oats, 100)]));
        Task<HttpResponseMessage> Put(FoodEntryRequest r) => client.PutAsJsonAsync($"/food-entries/{Guid.NewGuid()}", r);

        Assert.Equal(HttpStatusCode.BadRequest, (await Put(new(Today, "cena", RecipeId: recipeId, Servings: 0.2m))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Put(new(Today, "cena", RecipeId: recipeId, Servings: 21m))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Put(new(Today, "cena", RecipeId: recipeId, Servings: 1.234m))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Put(new(Today, "cena", RecipeId: recipeId))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Put(new(Today, "cena", oats, 50, recipeId, 1m))).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Put(new(Today, "cena", RecipeId: Guid.NewGuid(), Servings: 1m))).StatusCode);
        Assert.Empty((await Day(client))!.Meals);
    }

    // AC-nutrition-005-05
    [Fact]
    public async Task AC_nutrition_005_05_si_se_borra_un_alimento_la_receta_conserva_sus_valores_y_marca_el_ingrediente_como_eliminado()
    {
        var client = api.ClientFor(Guid.NewGuid());
        var oats = await PutFood(client, Food());
        var recipeId = Guid.NewGuid();
        await PutRecipe(client, recipeId, Recipe("Gachas", 1, [(oats, 100)]));

        await client.DeleteAsync($"/foods/{oats}");

        var recipe = Assert.Single((await Recipes(client))!);
        var ingredient = Assert.Single(recipe.Ingredients);
        Assert.True(ingredient.Deleted);
        Assert.Null(ingredient.FoodId);
        Assert.Equal(("Avena", 389), (ingredient.Name, recipe.Total.Kcal));
    }

    // AC-nutrition-005-07 (P7)
    [Fact]
    public async Task AC_nutrition_005_07_una_persona_no_ve_ni_cambia_las_recetas_de_otra()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        var oats = await PutFood(owner, Food());
        var recipeId = Guid.NewGuid();
        await PutRecipe(owner, recipeId, Recipe("Gachas", 2, [(oats, 100)]));
        var otherOats = await PutFood(other, Food());

        var edit = await PutRecipe(other, recipeId, Recipe("Robada", 1, [(otherOats, 10)]));
        await other.DeleteAsync($"/recipes/{recipeId}");
        var register = await other.PutAsJsonAsync($"/food-entries/{Guid.NewGuid()}", new FoodEntryRequest(Today, "cena", RecipeId: recipeId, Servings: 1m));

        Assert.Equal(HttpStatusCode.NotFound, edit.StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, register.StatusCode);
        Assert.Empty((await Recipes(other))!);
        Assert.Equal("Gachas", Assert.Single((await Recipes(owner))!).Name);
    }

    // ---------- SPEC-nutrition-006: historial semanal de nutrición ----------

    private static Task<NutritionHistoryDto?> History(HttpClient c, DateOnly from, DateOnly to) =>
        c.GetFromJsonAsync<NutritionHistoryDto>($"/nutrition/history?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}");

    private static Task<NutritionWeeklyDto?> Weekly(HttpClient c, int weeks = 12) => c.GetFromJsonAsync<NutritionWeeklyDto>($"/nutrition/weekly?weeks={weeks}");

    // AC-nutrition-006-01 y 04
    [Fact]
    public async Task AC_nutrition_006_01_el_historial_trae_lo_consumido_cada_dia_y_los_dias_sin_entradas_van_sin_registro()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Complete(client);
        var oats = await PutFood(client, Food()); // 389 kcal por 100 g
        await PutEntry(client, Guid.NewGuid(), oats, grams: 100, date: Today.AddDays(-2));
        await PutEntry(client, Guid.NewGuid(), oats, grams: 50, date: Today.AddDays(-2));

        var history = (await History(client, Today.AddDays(-3), Today))!;

        Assert.Equal(4, history.Days.Count);
        Assert.Equal((true, 584), (history.Days[1].Logged, history.Days[1].Kcal)); // 389 + 195
        Assert.All(new[] { 0, 2, 3 }.Select(i => history.Days[i]), d => Assert.Equal((false, 0), (d.Logged, d.Kcal))); // sin registro: no es un cero registrado
        Assert.NotNull(history.Targets);
    }

    // AC-nutrition-006-05
    [Theory]
    [InlineData("/nutrition/history")]
    [InlineData("/nutrition/history?from=2026-11-10&to=2026-11-01")]
    [InlineData("/nutrition/history?from=2026-01-01&to=2026-06-01")] // más de 92 días
    [InlineData("/nutrition/history?from=ayer&to=hoy")]
    [InlineData("/nutrition/weekly?weeks=0")]
    [InlineData("/nutrition/weekly?weeks=53")]
    public async Task AC_nutrition_006_05_rangos_invalidos_responden_400(string url)
    {
        var client = api.ClientFor(Guid.NewGuid());

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(url)).StatusCode);
    }

    // AC-nutrition-006-02
    [Fact]
    public async Task AC_nutrition_006_02_el_resumen_semanal_promedia_solo_los_dias_con_registro_y_cuenta_los_dias_dentro_del_margen()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await Complete(client, goal: "mantener");
        var target = (await Targets(client))!.Calories;
        var food = await PutFood(client, Food(name: "Calorías", kcal: 100, protein: 0, fat: 0, carbs: 0));
        var lastMonday = Today.AddDays(-(((int)Today.DayOfWeek + 6) % 7) - 7);
        // Dos días de la semana pasada: uno justo en el objetivo y otro muy por debajo (100 kcal).
        await PutEntry(client, Guid.NewGuid(), food, grams: target, date: lastMonday);
        await PutEntry(client, Guid.NewGuid(), food, grams: 100, date: lastMonday.AddDays(1));

        var weekly = (await Weekly(client))!;

        var week = weekly.Weeks.Single(w => w.WeekStart == lastMonday);
        Assert.Equal((2, 1), (week.DaysLogged, week.DaysOnTarget));
        Assert.Equal((target + 100 + 1) / 2, week.AvgKcal); // promedio solo de los dos días con registro, la mitad hacia arriba
        Assert.Equal(target, weekly.Targets!.Calories);
    }

    // AC-nutrition-006-06
    [Fact]
    public async Task AC_nutrition_006_06_sin_objetivo_calculable_trae_el_consumo_sin_adherencia()
    {
        var client = api.ClientFor(Guid.NewGuid()); // sin perfil ni peso
        var food = await PutFood(client, Food());
        await PutEntry(client, Guid.NewGuid(), food, grams: 100);

        var weekly = (await Weekly(client))!;
        var history = (await History(client, Today.AddDays(-1), Today))!;

        Assert.Null(weekly.Targets);
        Assert.Null(Assert.Single(weekly.Weeks).DaysOnTarget);
        Assert.Null(history.Targets);
    }

    // AC-nutrition-006-07 (P7)
    [Fact]
    public async Task AC_nutrition_006_07_el_historial_solo_cuenta_las_entradas_de_la_persona()
    {
        var owner = api.ClientFor(Guid.NewGuid());
        var other = api.ClientFor(Guid.NewGuid());
        await PutEntry(owner, Guid.NewGuid(), await PutFood(owner, Food()), grams: 100);
        await PutEntry(other, Guid.NewGuid(), await PutFood(other, Food()), grams: 500);

        var history = (await History(owner, Today, Today))!;

        Assert.Equal(389, Assert.Single(history.Days).Kcal);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.CreateClient().GetAsync("/nutrition/weekly")).StatusCode);
    }
}
