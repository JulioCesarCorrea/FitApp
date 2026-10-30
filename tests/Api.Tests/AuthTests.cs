using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FitnessApp.Api.Domain.Auth;
using FitnessApp.Api.Features.Auth;
using FitnessApp.Api.Features.Training.Equipment;
using FitnessApp.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace FitnessApp.Api.Tests;

/// <summary>Verifica SPEC-auth-001 contra la API y Postgres reales. Cada test cita su criterio de aceptación.</summary>
[Collection("api")]
public sealed class AuthTests(ApiFixture api)
{
    private const string Password = "contraseña-segura-1";

    private static string NewName() => "u" + Guid.NewGuid().ToString("N")[..12];

    private static RegisterRequest Register(string? username = null, string? password = null, string? code = null) =>
        new(username ?? NewName(), password ?? Password, code ?? ApiFixture.InviteCode);

    private Task<HttpResponseMessage> PostRegister(RegisterRequest body, HttpClient? client = null) =>
        (client ?? api.CreateClient()).PostAsJsonAsync("/auth/register", body);

    private async Task<AuthResponse> Registered(string? username = null, string? password = null)
    {
        var response = await PostRegister(Register(username, password));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AuthResponse>())!;
    }

    private Task<HttpResponseMessage> Login(string username, string password, HttpClient? client = null) =>
        (client ?? api.CreateClient()).PostAsJsonAsync("/auth/login", new LoginRequest(username, password));

    private async Task<T> InDb<T>(Func<AppDbContext, Task<T>> action)
    {
        using var scope = api.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    private static async Task<string> TextOf(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        string Read(string name) => root.TryGetProperty(name, out var v) ? v.ToString() : "";
        return Read("title") + "|" + Read("detail");
    }

    private HttpClient Bearer(string accessToken) => api.ClientWithToken(accessToken);

    // AC-01
    [Fact]
    public async Task AC_auth_001_01_registra_la_cuenta_y_devuelve_los_tokens()
    {
        var name = NewName();

        var response = await PostRegister(Register(name));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain(Password, body);
        Assert.DoesNotContain("passwordHash", body, StringComparison.OrdinalIgnoreCase);
        var auth = JsonSerializer.Deserialize<AuthResponse>(body, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.False(string.IsNullOrWhiteSpace(auth.AccessToken));
        Assert.False(string.IsNullOrWhiteSpace(auth.RefreshToken));
        Assert.True(auth.ExpiresIn > 0);
        Assert.Equal(name, auth.User.Username);
        Assert.False(auth.User.MustChangePassword);
    }

    [Fact]
    public async Task AC_auth_001_01_la_contrasena_se_guarda_solo_como_hash()
    {
        var name = NewName();
        await Registered(name);

        var user = await InDb(db => db.Users.SingleAsync(u => u.Username == name));

        Assert.NotEmpty(user.PasswordHash);
        Assert.DoesNotContain(Password, user.PasswordHash);
    }

    // AC-02
    [Theory]
    [InlineData("codigo-incorrecto")]
    [InlineData("")]
    public async Task AC_auth_001_02_un_codigo_incorrecto_o_vacio_responde_403_y_no_crea_la_cuenta(string code)
    {
        var name = NewName();

        var response = await PostRegister(Register(name, code: code));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.False(await InDb(db => db.Users.AnyAsync(u => u.Username == name)));
    }

    [Fact]
    public async Task AC_auth_001_02_sin_codigo_configurado_el_registro_esta_cerrado()
    {
        await using var closed = api.WithAuth(("Auth:InviteCode", ""));
        var name = NewName();

        var response = await PostRegister(Register(name, code: ""), closed.CreateClient());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.False(await InDb(db => db.Users.AnyAsync(u => u.Username == name)));
    }

    // AC-03
    [Theory]
    [InlineData("ab", Password)] // menos de 3 caracteres
    [InlineData("nombre-de-usuario-demasiado-largo-1", Password)] // más de 30
    [InlineData("con espacio", Password)]
    [InlineData("acentuación", Password)]
    [InlineData("usuario.valido", "corta123")] // menos de 10
    [InlineData("usuario.valido", "usuario.valido")] // igual al nombre de usuario
    public async Task AC_auth_001_03_rechaza_usuario_o_contrasena_invalidos_y_no_crea_la_cuenta(string username, string password)
    {
        var response = await PostRegister(Register(username, password));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.False(await InDb(db => db.Users.AnyAsync(u => u.Username == username.Trim().ToLower())));
    }

    [Fact]
    public async Task AC_auth_001_03_rechaza_una_contrasena_de_mas_de_128_caracteres()
    {
        var response = await PostRegister(Register(password: new string('a', 129)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // AC-04
    [Fact]
    public async Task AC_auth_001_04_un_usuario_repetido_responde_409_sin_distinguir_mayusculas_ni_espacios()
    {
        var name = NewName();
        await Registered(name);

        var response = await PostRegister(Register("  " + name.ToUpperInvariant() + " ", "otra-contraseña-9"));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Login(name, Password)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Login(name, "otra-contraseña-9")).StatusCode);
    }

    // AC-05
    [Fact]
    public async Task AC_auth_001_05_entra_con_usuario_y_contrasena_sin_distinguir_mayusculas_en_el_usuario()
    {
        var name = NewName();
        await Registered(name);

        var response = await Login(name.ToUpperInvariant(), Password);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>())!;
        Assert.Equal(name, auth.User.Username);
        Assert.False(auth.User.MustChangePassword);
        Assert.False(string.IsNullOrEmpty(auth.RefreshToken));
    }

    // AC-06
    [Fact]
    public async Task AC_auth_001_06_contrasena_incorrecta_y_usuario_inexistente_dan_el_mismo_401()
    {
        var name = NewName();
        await Registered(name);

        var wrongPassword = await Login(name, "contraseña-equivocada");
        var unknownUser = await Login(NewName(), Password);

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownUser.StatusCode);
        Assert.Equal(await TextOf(wrongPassword), await TextOf(unknownUser));
    }

    // AC-07
    [Fact]
    public async Task AC_auth_001_07_cinco_fallos_bloquean_la_cuenta_incluso_con_la_contrasena_correcta()
    {
        var name = NewName();
        await Registered(name);
        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await Login(name, "mal-" + i)).StatusCode);

        var locked = await Login(name, Password);

        Assert.Equal(HttpStatusCode.TooManyRequests, locked.StatusCode);
        var retry = Assert.Single(locked.Headers.GetValues("Retry-After"));
        Assert.InRange(int.Parse(retry), 1, 15 * 60);
    }

    [Fact]
    public async Task AC_auth_001_07_pasado_el_plazo_vuelve_a_funcionar_y_el_acierto_reinicia_el_contador()
    {
        var name = NewName();
        await Registered(name);
        for (var i = 0; i < 5; i++) await Login(name, "mal-" + i);
        await InDb(async db =>
        {
            var user = await db.Users.SingleAsync(u => u.Username == name);
            user.LockedUntil = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
            return 0;
        });

        Assert.Equal(HttpStatusCode.OK, (await Login(name, Password)).StatusCode);

        // Un acierto reinicia el contador: cuatro fallos más no bloquean.
        for (var i = 0; i < 4; i++) await Login(name, "mal-otra-vez-" + i);
        Assert.Equal(HttpStatusCode.OK, (await Login(name, Password)).StatusCode);
    }

    [Fact]
    public async Task AC_auth_001_07_tras_un_bloqueo_hacen_falta_otros_cinco_fallos_para_volver_a_bloquear()
    {
        var name = NewName();
        await Registered(name);
        for (var i = 0; i < 5; i++) await Login(name, "mal-" + i);
        await InDb(async db =>
        {
            (await db.Users.SingleAsync(u => u.Username == name)).LockedUntil = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
            return 0;
        });

        var firstAfterLock = await Login(name, "mal-despues");

        Assert.Equal(HttpStatusCode.Unauthorized, firstAfterLock.StatusCode);
    }

    // AC-08
    [Fact]
    public async Task AC_auth_001_08_el_exceso_de_peticiones_a_auth_responde_429()
    {
        await using var limited = api.WithAuth(("Auth:RateLimitPerMinute", "3"));
        var client = limited.CreateClient();

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 5; i++)
            statuses.Add((await client.PostAsJsonAsync("/auth/login", new LoginRequest(NewName(), Password))).StatusCode);

        Assert.Equal([HttpStatusCode.Unauthorized, HttpStatusCode.Unauthorized, HttpStatusCode.Unauthorized,
            HttpStatusCode.TooManyRequests, HttpStatusCode.TooManyRequests], statuses);
    }

    [Fact]
    public async Task AC_auth_001_08_el_limite_no_afecta_a_los_endpoints_de_datos()
    {
        await using var limited = api.WithAuth(("Auth:RateLimitPerMinute", "1"));
        var client = api.ClientWithToken(ApiFixture.CreateToken(Guid.NewGuid()), limited);

        for (var i = 0; i < 3; i++)
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/equipment")).StatusCode);
    }

    // AC-09
    [Theory]
    [InlineData("/weights")]
    [InlineData("/exercises")]
    [InlineData("/plan")]
    [InlineData("/equipment")]
    [InlineData("/training-settings")]
    public async Task AC_auth_001_09_sin_token_los_endpoints_de_datos_responden_401(string path)
    {
        var response = await api.CreateClient().GetAsync(path);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task AC_auth_001_09_un_token_mal_formado_con_firma_invalida_o_caducado_responde_401()
    {
        var id = Guid.NewGuid();
        var tokens = new[]
        {
            "esto-no-es-un-token",
            ApiFixture.CreateToken(id, key: "otra-clave-distinta-con-al-menos-32-bytes-99"),
            ApiFixture.CreateToken(id, expires: DateTime.UtcNow.AddMinutes(-5)),
        };

        foreach (var token in tokens)
            Assert.Equal(HttpStatusCode.Unauthorized, (await Bearer(token).GetAsync("/equipment")).StatusCode);
    }

    [Fact]
    public async Task AC_auth_001_09_con_un_token_valido_responde_con_los_datos_de_la_persona_del_token()
    {
        var auth = await Registered();
        var client = Bearer(auth.AccessToken);
        await client.PutAsJsonAsync("/equipment", new EquipmentRequest([20m, 22.5m], [], [], 5m, 0m));

        var equipment = await client.GetFromJsonAsync<EquipmentDto>("/equipment");

        Assert.True(equipment!.Configured);
        Assert.Equal([20m, 22.5m], equipment.DumbbellsKg);
    }

    [Fact]
    public async Task AC_auth_001_09_health_y_las_imagenes_del_catalogo_siguen_abiertos()
    {
        var client = api.CreateClient();

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/exercise-images/press-plano-con-barra-0.jpg")).StatusCode);
    }

    // AC-10
    [Fact]
    public async Task AC_auth_001_10_renovar_devuelve_un_par_nuevo_y_el_nuevo_sirve()
    {
        var first = await Registered();

        var refreshed = await api.CreateClient().PostAsJsonAsync("/auth/refresh", new RefreshRequest(first.RefreshToken));

        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
        var second = (await refreshed.Content.ReadFromJsonAsync<AuthResponse>())!;
        Assert.NotEqual(first.RefreshToken, second.RefreshToken);
        Assert.Equal(HttpStatusCode.OK, (await Bearer(second.AccessToken).GetAsync("/equipment")).StatusCode);
        var again = await api.CreateClient().PostAsJsonAsync("/auth/refresh", new RefreshRequest(second.RefreshToken));
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
    }

    // AC-11
    [Fact]
    public async Task AC_auth_001_11_reutilizar_una_renovacion_ya_usada_responde_401_y_revoca_las_vigentes()
    {
        var first = await Registered();
        var client = api.CreateClient();
        var second = (await (await client.PostAsJsonAsync("/auth/refresh", new RefreshRequest(first.RefreshToken)))
            .Content.ReadFromJsonAsync<AuthResponse>())!;

        var reuse = await client.PostAsJsonAsync("/auth/refresh", new RefreshRequest(first.RefreshToken));
        var latest = await client.PostAsJsonAsync("/auth/refresh", new RefreshRequest(second.RefreshToken));

        Assert.Equal(HttpStatusCode.Unauthorized, reuse.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, latest.StatusCode);
    }

    // AC-12
    [Fact]
    public async Task AC_auth_001_12_una_renovacion_desconocida_caducada_o_revocada_responde_401()
    {
        var client = api.CreateClient();
        var name = NewName();
        var auth = await Registered(name);
        await InDb(async db =>
        {
            var user = await db.Users.SingleAsync(u => u.Username == name);
            foreach (var t in db.RefreshTokens.Where(t => t.UserId == user.Id)) t.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
            return 0;
        });
        var other = await Registered();
        await client.PostAsJsonAsync("/auth/logout", new LogoutRequest(other.RefreshToken));

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/auth/refresh", new RefreshRequest("no-existe"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/auth/refresh", new RefreshRequest(auth.RefreshToken))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/auth/refresh", new RefreshRequest(other.RefreshToken))).StatusCode);
    }

    [Fact]
    public async Task AC_auth_001_12_en_la_base_solo_se_guarda_el_hash_de_la_renovacion()
    {
        var name = NewName();
        var auth = await Registered(name);

        var stored = await InDb(db => db.RefreshTokens.Where(t => t.User!.Username == name).Select(t => t.TokenHash).ToListAsync());

        Assert.NotEmpty(stored);
        Assert.DoesNotContain(auth.RefreshToken, stored);
    }

    // AC-13
    [Fact]
    public async Task AC_auth_001_13_cerrar_sesion_responde_204_revoca_la_renovacion_y_es_repetible()
    {
        var auth = await Registered();
        var client = api.CreateClient();

        var first = await client.PostAsJsonAsync("/auth/logout", new LogoutRequest(auth.RefreshToken));
        var again = await client.PostAsJsonAsync("/auth/logout", new LogoutRequest(auth.RefreshToken));
        var unknown = await client.PostAsJsonAsync("/auth/logout", new LogoutRequest("no-existe"));
        var refresh = await client.PostAsJsonAsync("/auth/refresh", new RefreshRequest(auth.RefreshToken));

        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
    }

    // AC-14
    [Fact]
    public async Task AC_auth_001_14_cambiar_la_contrasena_da_tokens_nuevos_y_revoca_las_demas_sesiones()
    {
        var name = NewName();
        var phone1 = await Registered(name);
        var phone2 = (await (await Login(name, Password)).Content.ReadFromJsonAsync<AuthResponse>())!;

        var response = await Bearer(phone1.AccessToken).PostAsJsonAsync(
            "/auth/change-password", new ChangePasswordRequest(Password, "contraseña-nueva-2"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var renewed = (await response.Content.ReadFromJsonAsync<AuthResponse>())!;
        Assert.Equal(HttpStatusCode.OK, (await api.CreateClient().PostAsJsonAsync("/auth/refresh", new RefreshRequest(renewed.RefreshToken))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.CreateClient().PostAsJsonAsync("/auth/refresh", new RefreshRequest(phone2.RefreshToken))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Login(name, Password)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Login(name, "contraseña-nueva-2")).StatusCode);
    }

    [Theory]
    [InlineData("contraseña-equivocada", "contraseña-nueva-2")] // la actual no coincide
    [InlineData(Password, "corta")] // la nueva es demasiado corta
    public async Task AC_auth_001_14_una_actual_incorrecta_o_una_nueva_invalida_responde_400_y_no_cambia_nada(string current, string next)
    {
        var name = NewName();
        var auth = await Registered(name);

        var response = await Bearer(auth.AccessToken).PostAsJsonAsync("/auth/change-password", new ChangePasswordRequest(current, next));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Login(name, Password)).StatusCode);
    }

    [Fact]
    public async Task AC_auth_001_14_la_nueva_contrasena_no_puede_ser_igual_al_usuario_y_exige_sesion()
    {
        var name = NewName();
        var auth = await Registered(name);

        var same = await Bearer(auth.AccessToken).PostAsJsonAsync("/auth/change-password", new ChangePasswordRequest(Password, name));
        var anonymous = await api.CreateClient().PostAsJsonAsync("/auth/change-password", new ChangePasswordRequest(Password, "contraseña-nueva-2"));

        Assert.Equal(HttpStatusCode.BadRequest, same.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Login(name, Password)).StatusCode);
    }

    // AC-15
    [Fact]
    public async Task AC_auth_001_15_con_cambio_obligatorio_los_datos_responden_403_hasta_cambiar_la_contrasena()
    {
        var name = NewName();
        string temporary = "";
        await using (var scope = api.Services.CreateAsyncScope())
        {
            var created = await scope.ServiceProvider.GetRequiredService<AdminCommands>().CreateUserAsync(name, null, CancellationToken.None);
            temporary = Assert.IsType<CreateUserResult.Created>(created).TemporaryPassword;
        }
        var login = await Login(name, temporary);
        var auth = (await login.Content.ReadFromJsonAsync<AuthResponse>())!;
        var client = Bearer(auth.AccessToken);

        Assert.True(auth.User.MustChangePassword);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/equipment")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/plan")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/auth/me")).StatusCode);

        var changed = await client.PostAsJsonAsync("/auth/change-password", new ChangePasswordRequest(temporary, "contraseña-definitiva-3"));
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var renewed = (await changed.Content.ReadFromJsonAsync<AuthResponse>())!;
        Assert.False(renewed.User.MustChangePassword);
        Assert.Equal(HttpStatusCode.OK, (await Bearer(renewed.AccessToken).GetAsync("/equipment")).StatusCode);
    }

    [Fact]
    public async Task AC_auth_001_15_con_cambio_obligatorio_siguen_disponibles_renovar_y_cerrar_sesion()
    {
        var name = NewName();
        string temporary;
        await using (var scope = api.Services.CreateAsyncScope())
        {
            temporary = ((CreateUserResult.Created)await scope.ServiceProvider.GetRequiredService<AdminCommands>()
                .CreateUserAsync(name, null, CancellationToken.None)).TemporaryPassword;
        }
        var auth = (await (await Login(name, temporary)).Content.ReadFromJsonAsync<AuthResponse>())!;

        var refreshed = await api.CreateClient().PostAsJsonAsync("/auth/refresh", new RefreshRequest(auth.RefreshToken));
        var loggedOut = await api.CreateClient().PostAsJsonAsync("/auth/logout", new LogoutRequest(auth.RefreshToken));

        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
        Assert.True((await refreshed.Content.ReadFromJsonAsync<AuthResponse>())!.User.MustChangePassword);
        Assert.Equal(HttpStatusCode.NoContent, loggedOut.StatusCode);
    }

    // AC-16
    [Fact]
    public async Task AC_auth_001_16_con_devheader_apagado_x_user_id_no_sirve()
    {
        await using var production = api.WithAuth(("Auth:DevHeader", "false"));
        var client = production.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Id", Guid.NewGuid().ToString());

        var response = await client.GetAsync("/equipment");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task AC_auth_001_16_con_devheader_apagado_un_token_valido_sigue_sirviendo()
    {
        await using var production = api.WithAuth(("Auth:DevHeader", "false"));
        var auth = (await (await PostRegister(Register(), production.CreateClient())).Content.ReadFromJsonAsync<AuthResponse>())!;

        var response = await api.ClientWithToken(auth.AccessToken, production).GetAsync("/equipment");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task AC_auth_001_16_con_devheader_encendido_el_encabezado_sirve_y_si_hay_token_manda_el_token()
    {
        var headerUser = Guid.NewGuid();
        var viaHeader = api.ClientFor(headerUser);
        await viaHeader.PutAsJsonAsync("/equipment", new EquipmentRequest([99m], [], [], 5m, 0m));
        Assert.Equal([99m], (await viaHeader.GetFromJsonAsync<EquipmentDto>("/equipment"))!.DumbbellsKg);

        var auth = await Registered();
        var both = api.ClientWithToken(auth.AccessToken);
        both.DefaultRequestHeaders.Add("X-User-Id", headerUser.ToString());

        var equipment = await both.GetFromJsonAsync<EquipmentDto>("/equipment");

        Assert.False(equipment!.Configured); // los datos son de la persona del token, no los del encabezado
    }

    // AC-17
    [Fact]
    public async Task AC_auth_001_17_cada_persona_solo_ve_y_cambia_lo_suyo()
    {
        var a = Bearer((await Registered()).AccessToken);
        var b = Bearer((await Registered()).AccessToken);
        await a.PutAsJsonAsync("/equipment", new EquipmentRequest([20m], [], [], 5m, 0m));
        await a.PostAsJsonAsync("/weights", new { Id = Guid.NewGuid(), WeightKg = 80m, MeasuredAt = DateTimeOffset.UtcNow.AddHours(-1) });

        var equipmentB = await b.GetFromJsonAsync<EquipmentDto>("/equipment");
        var weightsB = await b.GetFromJsonAsync<List<JsonElement>>("/weights");
        var weightsA = await a.GetFromJsonAsync<List<JsonElement>>("/weights");

        Assert.False(equipmentB!.Configured);
        Assert.Empty(weightsB!);
        Assert.Single(weightsA!);
    }

    // AC-18
    [Fact]
    public async Task AC_auth_001_18_create_user_crea_la_cuenta_con_contrasena_temporal_y_cambio_obligatorio()
    {
        var name = NewName();
        await using var scope = api.Services.CreateAsyncScope();
        var admin = scope.ServiceProvider.GetRequiredService<AdminCommands>();

        var result = await admin.CreateUserAsync(name, null, CancellationToken.None);

        var created = Assert.IsType<CreateUserResult.Created>(result);
        Assert.True(created.TemporaryPassword.Length >= 12);
        var login = await Login(name, created.TemporaryPassword);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.True((await login.Content.ReadFromJsonAsync<AuthResponse>())!.User.MustChangePassword);
    }

    [Fact]
    public async Task AC_auth_001_18_con_id_la_cuenta_hereda_los_datos_ya_guardados_con_ese_id()
    {
        var legacyId = Guid.NewGuid();
        await api.ClientFor(legacyId).PutAsJsonAsync("/equipment", new EquipmentRequest([42.5m], [], [], 5m, 0m));
        string temporary;
        await using (var scope = api.Services.CreateAsyncScope())
        {
            var created = await scope.ServiceProvider.GetRequiredService<AdminCommands>()
                .CreateUserAsync(NewName(), legacyId, CancellationToken.None);
            temporary = Assert.IsType<CreateUserResult.Created>(created).TemporaryPassword;
            Assert.Equal(legacyId, ((CreateUserResult.Created)created).UserId);
        }
        var name = await InDb(db => db.Users.Where(u => u.Id == legacyId).Select(u => u.Username).SingleAsync());
        var auth = (await (await Login(name, temporary)).Content.ReadFromJsonAsync<AuthResponse>())!;
        var change = await Bearer(auth.AccessToken).PostAsJsonAsync("/auth/change-password", new ChangePasswordRequest(temporary, "contraseña-definitiva-3"));
        var renewed = (await change.Content.ReadFromJsonAsync<AuthResponse>())!;

        var equipment = await Bearer(renewed.AccessToken).GetFromJsonAsync<EquipmentDto>("/equipment");

        Assert.Equal([42.5m], equipment!.DumbbellsKg);
    }

    [Fact]
    public async Task AC_auth_001_18_un_usuario_o_un_id_repetidos_o_un_usuario_invalido_no_crean_nada()
    {
        var name = NewName();
        var existing = await Registered(name);
        await using var scope = api.Services.CreateAsyncScope();
        var admin = scope.ServiceProvider.GetRequiredService<AdminCommands>();

        Assert.IsType<CreateUserResult.UsernameTaken>(await admin.CreateUserAsync(name.ToUpperInvariant(), null, CancellationToken.None));
        Assert.IsType<CreateUserResult.IdTaken>(await admin.CreateUserAsync(NewName(), existing.User.Id, CancellationToken.None));
        Assert.IsType<CreateUserResult.InvalidUsername>(await admin.CreateUserAsync("x", null, CancellationToken.None));
        Assert.Equal(HttpStatusCode.OK, (await Login(name, Password)).StatusCode); // la cuenta existente sigue igual
    }

    // AC-19
    [Fact]
    public async Task AC_auth_001_19_reset_password_cambia_la_contrasena_revoca_sesiones_quita_el_bloqueo_y_exige_el_cambio()
    {
        var name = NewName();
        var auth = await Registered(name);
        for (var i = 0; i < 5; i++) await Login(name, "mal-" + i);
        string temporary;
        await using (var scope = api.Services.CreateAsyncScope())
        {
            var reset = await scope.ServiceProvider.GetRequiredService<AdminCommands>().ResetPasswordAsync(name, CancellationToken.None);
            temporary = Assert.IsType<ResetPasswordResult.Reset>(reset).TemporaryPassword;
        }

        var oldPassword = await Login(name, Password);
        var withTemporary = await Login(name, temporary);
        var refresh = await api.CreateClient().PostAsJsonAsync("/auth/refresh", new RefreshRequest(auth.RefreshToken));

        Assert.Equal(HttpStatusCode.Unauthorized, oldPassword.StatusCode);
        Assert.Equal(HttpStatusCode.OK, withTemporary.StatusCode); // el bloqueo anterior ya no cuenta
        Assert.True((await withTemporary.Content.ReadFromJsonAsync<AuthResponse>())!.User.MustChangePassword);
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
    }

    [Fact]
    public async Task AC_auth_001_19_reset_password_de_un_usuario_inexistente_lo_indica()
    {
        await using var scope = api.Services.CreateAsyncScope();

        var result = await scope.ServiceProvider.GetRequiredService<AdminCommands>().ResetPasswordAsync(NewName(), CancellationToken.None);

        Assert.IsType<ResetPasswordResult.NotFound>(result);
    }

    // AC-20
    [Fact]
    public async Task AC_auth_001_20_me_devuelve_id_usuario_e_indicador_de_cambio_obligatorio()
    {
        var name = NewName();
        var auth = await Registered(name);

        var me = await Bearer(auth.AccessToken).GetFromJsonAsync<UserDto>("/auth/me");

        Assert.Equal(new UserDto(auth.User.Id, name, false), me);
    }

    [Fact]
    public async Task AC_auth_001_20_me_sin_sesion_responde_401()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.CreateClient().GetAsync("/auth/me")).StatusCode);
    }
}
