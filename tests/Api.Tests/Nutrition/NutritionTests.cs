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
    private sealed record Vectors(TargetCase[] Targets, FloorCase[] Floor, PortionCase[] Portions);

    private static readonly Vectors All = JsonSerializer.Deserialize<Vectors>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Nutrition", "nutrition-vectors.json")),
        new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    public static TheoryData<string> TargetNames() => [.. All.Targets.Select(t => t.Name)];
    public static TheoryData<string> FloorNames() => [.. All.Floor.Select(t => t.Name)];
    public static TheoryData<string> PortionNames() => [.. All.Portions.Select(t => t.Name)];

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
}
