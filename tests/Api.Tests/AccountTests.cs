using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FitnessApp.Api.Domain;
using FitnessApp.Api.Domain.Auth;
using FitnessApp.Api.Domain.Profile;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Features.Account;
using FitnessApp.Api.Features.Auth;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace FitnessApp.Api.Tests;

/// <summary>Verifica SPEC-account-001 (exportar y borrar la cuenta) contra la API y Postgres reales.</summary>
[Collection("api")]
public sealed class AccountTests(ApiFixture api)
{
    private const string Password = "contraseña-segura-1";

    private static string NewName() => "a" + Guid.NewGuid().ToString("N")[..12];

    private async Task<AuthResponse> Registered(string? username = null)
    {
        var response = await api.CreateClient().PostAsJsonAsync(
            "/auth/register", new RegisterRequest(username ?? NewName(), Password, ApiFixture.InviteCode));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AuthResponse>())!;
    }

    private async Task<T> InDb<T>(Func<AppDbContext, Task<T>> action)
    {
        using var scope = api.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    /// <summary>Una fila en cada categoría de datos personales de la persona.</summary>
    private Task<int> Seed(Guid userId) => InDb(async db =>
    {
        var exerciseId = (await db.Exercises.OrderBy(e => e.SortOrder).FirstAsync()).Id;
        var now = DateTimeOffset.UtcNow;
        db.Profiles.Add(new UserProfile
        {
            UserId = userId, DisplayName = "Persona", Sex = "masculino", BirthDate = new DateOnly(1995, 5, 20), HeightCm = 178,
            Goal = "mantener", Allergies = ["nueces"], UpdatedAt = now,
        });
        db.Restrictions.Add(new UserRestriction
        {
            Id = Guid.NewGuid(), UserId = userId, Zone = "abdomen", Level = RestrictionLevel.Aviso, AvoidedMovements = [],
        });
        db.Weights.Add(new WeightEntry { Id = Guid.NewGuid(), UserId = userId, WeightKg = 80.5m, MeasuredAt = now, CreatedAt = now });
        db.PlanEntries.Add(new PlanEntry { Id = Guid.NewGuid(), UserId = userId, Day = DayOfWeek.Tuesday, ExerciseId = exerciseId, Order = 0 });
        db.Equipment.Add(new EquipmentSettings { UserId = userId, DumbbellsKg = [10m, 12m], DiscsKg = [5m], MachineStepKg = 5m });
        db.TrainingSettings.Add(new TrainingSettings { UserId = userId, StagnationThreshold = 5 });
        db.SuggestionDismissals.Add(new SuggestionDismissal { UserId = userId, Key = "metodo:ejemplo:2026-11-01", DismissedAt = now });
        db.ExerciseLogs.Add(new ExerciseLogEntry
        {
            Id = Guid.NewGuid(), UserId = userId, ExerciseId = exerciseId, Date = DateOnly.FromDateTime(DateTime.UtcNow), LoadKg = 40m,
            FirstSetReps = 9, SecondSetReps = 8, SecondSetAssistedReps = 5, CreatedAt = now,
        });
        return await db.SaveChangesAsync();
    });

    private Task<int> RowsOf(Guid userId) => InDb(async db =>
        await db.Users.CountAsync(x => x.Id == userId) + await db.RefreshTokens.CountAsync(x => x.UserId == userId)
        + await db.Profiles.CountAsync(x => x.UserId == userId) + await db.Restrictions.CountAsync(x => x.UserId == userId)
        + await db.Weights.CountAsync(x => x.UserId == userId) + await db.PlanEntries.CountAsync(x => x.UserId == userId)
        + await db.Equipment.CountAsync(x => x.UserId == userId) + await db.TrainingSettings.CountAsync(x => x.UserId == userId)
        + await db.ExerciseLogs.CountAsync(x => x.UserId == userId) + await db.SuggestionDismissals.CountAsync(x => x.UserId == userId));

    private HttpClient Bearer(string token) => api.ClientWithToken(token);

    private static HttpRequestMessage DeleteRequest(string? password) =>
        new(HttpMethod.Delete, "/account") { Content = JsonContent.Create(new DeleteAccountRequest(password)) };

    // AC-01
    [Fact]
    public async Task AC_account_001_01_la_exportacion_trae_todas_las_categorias_como_descarga()
    {
        var auth = await Registered();
        await Seed(auth.User.Id);

        var response = await Bearer(auth.AccessToken).GetAsync("/account/export");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("attachment", response.Content.Headers.ContentDisposition?.DispositionType);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;
        Assert.Equal("Persona", root.GetProperty("profile").GetProperty("displayName").GetString());
        Assert.Equal(1, root.GetProperty("restrictions").GetArrayLength());
        Assert.Equal(1, root.GetProperty("weights").GetArrayLength());
        Assert.Equal(1, root.GetProperty("plan").GetArrayLength());
        Assert.Equal(2, root.GetProperty("equipment").GetProperty("dumbbellsKg").GetArrayLength());
        Assert.Equal(5, root.GetProperty("stagnationThreshold").GetInt32());
        Assert.Equal(1, root.GetProperty("exerciseLogs").GetArrayLength());
        Assert.Equal("metodo:ejemplo:2026-11-01", root.GetProperty("dismissedSuggestions")[0].GetString()); // SPEC-training-005
    }

    // AC-02
    [Fact]
    public async Task AC_account_001_02_la_exportacion_lleva_version_y_usuario_pero_ningun_secreto()
    {
        var name = NewName();
        var auth = await Registered(name);
        await Seed(auth.User.Id);

        var text = await Bearer(auth.AccessToken).GetStringAsync("/account/export");

        using var json = JsonDocument.Parse(text);
        Assert.Equal(1, json.RootElement.GetProperty("version").GetInt32());
        Assert.True(json.RootElement.TryGetProperty("exportedAt", out _));
        Assert.Equal(name, json.RootElement.GetProperty("user").GetProperty("username").GetString());
        Assert.DoesNotContain("passwordHash", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("tokenHash", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(auth.RefreshToken, text);
    }

    // AC-03
    [Fact]
    public async Task AC_account_001_03_una_cuenta_sin_datos_exporta_listas_vacias_y_opcionales_nulos()
    {
        var auth = await Registered();

        var response = await Bearer(auth.AccessToken).GetAsync("/account/export");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;
        Assert.Equal(JsonValueKind.Null, root.GetProperty("profile").ValueKind);
        Assert.Equal(JsonValueKind.Null, root.GetProperty("equipment").ValueKind);
        Assert.Equal(JsonValueKind.Null, root.GetProperty("stagnationThreshold").ValueKind);
        foreach (var list in new[] { "restrictions", "weights", "plan", "exerciseLogs" })
            Assert.Equal(0, root.GetProperty(list).GetArrayLength());
    }

    // AC-04
    [Fact]
    public async Task AC_account_001_04_sin_sesion_o_con_token_invalido_responde_401()
    {
        var anonymous = api.CreateClient();
        var forged = Bearer(ApiFixture.CreateToken(Guid.NewGuid(), key: "otra-clave-distinta-con-al-menos-32-bytes-99"));

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/account/export")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.SendAsync(DeleteRequest(Password))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await forged.GetAsync("/account/export")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await forged.SendAsync(DeleteRequest(Password))).StatusCode);
    }

    [Fact]
    public async Task AC_account_001_04_con_el_cambio_de_contrasena_pendiente_responde_403()
    {
        var name = NewName();
        string temporary;
        await using (var scope = api.Services.CreateAsyncScope())
        {
            var created = await scope.ServiceProvider.GetRequiredService<AdminCommands>().CreateUserAsync(name, null, CancellationToken.None);
            temporary = Assert.IsType<CreateUserResult.Created>(created).TemporaryPassword;
        }
        var login = await api.CreateClient().PostAsJsonAsync("/auth/login", new LoginRequest(name, temporary));
        var client = Bearer((await login.Content.ReadFromJsonAsync<AuthResponse>())!.AccessToken);

        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/account/export")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(DeleteRequest(temporary))).StatusCode);
    }

    // AC-05
    [Fact]
    public async Task AC_account_001_05_borrar_con_la_contrasena_correcta_elimina_la_cuenta_y_todos_sus_datos()
    {
        var auth = await Registered();
        await Seed(auth.User.Id);
        Assert.True(await RowsOf(auth.User.Id) >= 10);

        var response = await Bearer(auth.AccessToken).SendAsync(DeleteRequest(Password));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(0, await RowsOf(auth.User.Id));
    }

    // AC-06
    [Theory]
    [InlineData("contraseña-equivocada-9")]
    [InlineData("")]
    [InlineData(null)]
    public async Task AC_account_001_06_con_una_contrasena_incorrecta_o_ausente_responde_400_y_no_borra_nada(string? password)
    {
        var auth = await Registered();
        await Seed(auth.User.Id);
        var before = await RowsOf(auth.User.Id);

        var response = await Bearer(auth.AccessToken).SendAsync(DeleteRequest(password));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(before, await RowsOf(auth.User.Id));
    }

    [Fact]
    public async Task AC_account_001_06_sin_cuerpo_responde_400_y_no_borra_nada()
    {
        var auth = await Registered();
        var before = await RowsOf(auth.User.Id);

        var response = await Bearer(auth.AccessToken).SendAsync(new HttpRequestMessage(HttpMethod.Delete, "/account"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(before, await RowsOf(auth.User.Id));
    }

    // AC-07 (P7)
    [Fact]
    public async Task AC_account_001_07_borrar_una_cuenta_no_toca_los_datos_de_otra_persona()
    {
        var one = await Registered();
        var two = await Registered();
        await Seed(one.User.Id);
        await Seed(two.User.Id);
        var twoRows = await RowsOf(two.User.Id);

        await Bearer(one.AccessToken).SendAsync(DeleteRequest(Password));

        Assert.Equal(twoRows, await RowsOf(two.User.Id));
        var export = await Bearer(two.AccessToken).GetAsync("/account/export");
        Assert.Equal(HttpStatusCode.OK, export.StatusCode);
        using var json = JsonDocument.Parse(await export.Content.ReadAsStringAsync());
        Assert.Equal(1, json.RootElement.GetProperty("weights").GetArrayLength());
        Assert.Equal(HttpStatusCode.OK, (await Bearer(two.AccessToken).GetAsync("/auth/me")).StatusCode);
    }

    // AC-08
    [Fact]
    public async Task AC_account_001_08_tras_borrar_los_tokens_y_la_contrasena_dejan_de_servir_y_el_usuario_se_puede_registrar()
    {
        var name = NewName();
        var auth = await Registered(name);
        await Bearer(auth.AccessToken).SendAsync(DeleteRequest(Password));

        Assert.Equal(HttpStatusCode.Unauthorized, (await Bearer(auth.AccessToken).GetAsync("/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Bearer(auth.AccessToken).GetAsync("/weights")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await api.CreateClient().PostAsJsonAsync("/auth/refresh", new RefreshRequest(auth.RefreshToken))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await api.CreateClient().PostAsJsonAsync("/auth/login", new LoginRequest(name, Password))).StatusCode);

        var again = await Registered(name);
        await Seed(again.User.Id);
        Assert.NotEqual(auth.User.Id, again.User.Id);
        var export = await Bearer(again.AccessToken).GetStringAsync("/account/export");
        using var json = JsonDocument.Parse(export);
        Assert.Equal(1, json.RootElement.GetProperty("weights").GetArrayLength());
    }

    // AC-09
    [Fact]
    public async Task AC_account_001_09_un_fallo_a_mitad_del_borrado_no_deja_nada_borrado()
    {
        var auth = await Registered();
        await Seed(auth.User.Id);
        var before = await RowsOf(auth.User.Id);
        await InDb(db => db.Database.ExecuteSqlRawAsync(
            "CREATE OR REPLACE FUNCTION test_fail_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'fallo de prueba'; END; $$ LANGUAGE plpgsql;"
            + " CREATE TRIGGER test_fail_delete BEFORE DELETE ON exercise_logs FOR EACH ROW EXECUTE FUNCTION test_fail_delete();"));
        try
        {
            var response = await Bearer(auth.AccessToken).SendAsync(DeleteRequest(Password));

            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
            Assert.Equal(before, await RowsOf(auth.User.Id)); // los pesos se borran antes que los registros y debieron deshacerse
        }
        finally
        {
            await InDb(db => db.Database.ExecuteSqlRawAsync("DROP TRIGGER IF EXISTS test_fail_delete ON exercise_logs; DROP FUNCTION IF EXISTS test_fail_delete();"));
        }
    }

    // AC-10
    [Fact]
    public void AC_account_001_10_toda_entidad_con_datos_personales_esta_en_la_exportacion_y_el_borrado()
    {
        using var scope = api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var covered = AccountData.PersonalEntities.ToHashSet();

        var personal = db.Model.GetEntityTypes()
            .Where(t => t.FindProperty("UserId") is not null || t.ClrType == typeof(AppUser))
            .Select(t => t.ClrType).ToList();

        Assert.NotEmpty(personal);
        Assert.All(personal, type => Assert.True(covered.Contains(type), $"{type.Name} tiene datos personales y no está en AccountData."));
        Assert.All(covered, type => Assert.Contains(type, db.Model.GetEntityTypes().Select(t => t.ClrType)));
    }

    // AC-11
    [Fact]
    public async Task AC_account_001_11_el_borrado_comparte_el_limite_de_peticiones_de_auth()
    {
        var auth = await Registered();
        await using var limited = api.WithAuth(("Auth:RateLimitPerMinute", "2"));
        var client = api.ClientWithToken(auth.AccessToken, limited);

        var first = await client.SendAsync(DeleteRequest("mal-1-contraseña"));
        var second = await client.SendAsync(DeleteRequest("mal-2-contraseña"));
        var third = await client.SendAsync(DeleteRequest(Password));

        Assert.Equal(HttpStatusCode.BadRequest, first.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, second.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, third.StatusCode);
        Assert.Equal(1, await InDb(db => db.Users.CountAsync(u => u.Id == auth.User.Id)));
    }
}
