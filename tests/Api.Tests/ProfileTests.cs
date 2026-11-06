using System.Net;
using System.Net.Http.Json;
using FitnessApp.Api.Features.Profile;

namespace FitnessApp.Api.Tests;

/// <summary>Verifica el perfil de SPEC-profile-001 (AC-01 a 05) contra la API y Postgres reales.</summary>
[Collection("api")]
public sealed class ProfileTests(ApiFixture api)
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static ProfileRequest Valid() =>
        new("Julio", "masculino", new DateOnly(1995, 5, 20), 178, "ganar_musculo", null, null, null, null, null);

    private static ProfileRequest Full() =>
        new("  Julio C  ", "masculino", new DateOnly(1995, 5, 20), 178, "bajar_grasa", "moderado", "intermedio", 4,
            "heavy_duty_personalizado", ["  nueces ", "lactosa"]);

    // AC-01
    [Fact]
    public async Task AC_profile_001_01_crea_el_perfil_y_lo_devuelve_con_los_valores_por_defecto()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.PutAsJsonAsync("/profile", Valid());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var profile = (await client.GetFromJsonAsync<ProfileDto>("/profile"))!;
        Assert.True(profile.Configured);
        Assert.Equal("Julio", profile.DisplayName);
        Assert.Equal("masculino", profile.Sex);
        Assert.Equal(new DateOnly(1995, 5, 20), profile.BirthDate);
        Assert.Equal(178, profile.HeightCm);
        Assert.Equal("ganar_musculo", profile.Goal);
        Assert.Equal("ligero", profile.ActivityLevel);
        Assert.Equal("heavy_duty_personalizado", profile.Methodology);
        Assert.Null(profile.ExperienceLevel);
        Assert.Null(profile.DaysPerWeek);
        Assert.Empty(profile.Allergies);
    }

    [Fact]
    public async Task AC_profile_001_01_guarda_los_opcionales_recortando_los_espacios()
    {
        var client = api.ClientFor(Guid.NewGuid());

        await client.PutAsJsonAsync("/profile", Full());

        var profile = (await client.GetFromJsonAsync<ProfileDto>("/profile"))!;
        Assert.Equal("Julio C", profile.DisplayName);
        Assert.Equal("bajar_grasa", profile.Goal);
        Assert.Equal("moderado", profile.ActivityLevel);
        Assert.Equal("intermedio", profile.ExperienceLevel);
        Assert.Equal(4, profile.DaysPerWeek);
        Assert.Equal(["nueces", "lactosa"], profile.Allergies);
    }

    // AC-02
    [Fact]
    public async Task AC_profile_001_02_un_segundo_envio_reemplaza_el_perfil_entero()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await client.PutAsJsonAsync("/profile", Full());

        var response = await client.PutAsJsonAsync("/profile", Valid() with { DisplayName = "Otro" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var profile = (await client.GetFromJsonAsync<ProfileDto>("/profile"))!;
        Assert.Equal("Otro", profile.DisplayName);
        Assert.Equal("ganar_musculo", profile.Goal);
        Assert.Null(profile.ExperienceLevel); // lo omitido se borra: es un reemplazo
        Assert.Null(profile.DaysPerWeek);
        Assert.Empty(profile.Allergies);
    }

    [Fact]
    public async Task AC_profile_001_02_repetir_el_mismo_envio_no_cambia_nada()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await client.PutAsJsonAsync("/profile", Full());
        var before = await client.GetStringAsync("/profile");

        var again = await client.PutAsJsonAsync("/profile", Full());

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(before, await client.GetStringAsync("/profile"));
    }

    // AC-03
    public static TheoryData<string, ProfileRequest> Invalid() => new()
    {
        { "nombre vacío", Valid() with { DisplayName = "   " } },
        { "nombre de más de 40", Valid() with { DisplayName = new string('a', 41) } },
        { "sexo desconocido", Valid() with { Sex = "otro" } },
        { "objetivo desconocido", Valid() with { Goal = "volar" } },
        { "actividad desconocida", Valid() with { ActivityLevel = "extrema" } },
        { "experiencia desconocida", Valid() with { ExperienceLevel = "dios" } },
        { "metodología desconocida", Valid() with { Methodology = "normal_4x15" } },
        { "nacimiento futuro", Valid() with { BirthDate = Today.AddDays(1) } },
        { "13 años", Valid() with { BirthDate = Today.AddYears(-14).AddDays(1) } },
        { "101 años", Valid() with { BirthDate = Today.AddYears(-101) } },
        { "estatura de 99", Valid() with { HeightCm = 99 } },
        { "estatura de 251", Valid() with { HeightCm = 251 } },
        { "0 días por semana", Valid() with { DaysPerWeek = 0 } },
        { "8 días por semana", Valid() with { DaysPerWeek = 8 } },
        { "21 etiquetas", Valid() with { Allergies = Enumerable.Range(0, 21).Select(i => $"alergia-{i}").ToArray() } },
        { "etiqueta vacía", Valid() with { Allergies = ["nueces", "  "] } },
        { "etiqueta de más de 40", Valid() with { Allergies = [new string('x', 41)] } },
    };

    [Theory]
    [MemberData(nameof(Invalid))]
    public async Task AC_profile_001_03_rechaza_valores_fuera_de_las_reglas_y_no_cambia_nada(string caso, ProfileRequest body)
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.PutAsJsonAsync("/profile", body);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.False((await client.GetFromJsonAsync<ProfileDto>("/profile"))!.Configured, caso);
    }

    [Theory]
    [InlineData(14)]
    [InlineData(100)]
    public async Task AC_profile_001_03_las_edades_limite_son_validas(int years)
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.PutAsJsonAsync("/profile", Valid() with { BirthDate = Today.AddYears(-years) });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task AC_profile_001_03_un_envio_invalido_no_pisa_el_perfil_que_ya_habia()
    {
        var client = api.ClientFor(Guid.NewGuid());
        await client.PutAsJsonAsync("/profile", Valid());

        var response = await client.PutAsJsonAsync("/profile", Valid() with { HeightCm = 10, DisplayName = "Cambiado" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Julio", (await client.GetFromJsonAsync<ProfileDto>("/profile"))!.DisplayName);
    }

    // AC-04
    [Fact]
    public async Task AC_profile_001_04_sin_perfil_responde_200_con_configured_falso()
    {
        var client = api.ClientFor(Guid.NewGuid());

        var response = await client.GetAsync("/profile");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var profile = (await response.Content.ReadFromJsonAsync<ProfileDto>())!;
        Assert.False(profile.Configured);
        Assert.Null(profile.DisplayName);
        Assert.Empty(profile.Allergies);
    }

    // AC-05
    [Fact]
    public async Task AC_profile_001_05_cada_persona_solo_ve_y_cambia_su_perfil()
    {
        var one = api.ClientFor(Guid.NewGuid());
        var two = api.ClientFor(Guid.NewGuid());
        await one.PutAsJsonAsync("/profile", Valid() with { DisplayName = "Uno" });
        await two.PutAsJsonAsync("/profile", Valid() with { DisplayName = "Dos" });

        await two.PutAsJsonAsync("/profile", Valid() with { DisplayName = "Dos otra vez" });

        Assert.Equal("Uno", (await one.GetFromJsonAsync<ProfileDto>("/profile"))!.DisplayName);
        Assert.Equal("Dos otra vez", (await two.GetFromJsonAsync<ProfileDto>("/profile"))!.DisplayName);
    }

    [Fact]
    public async Task AC_profile_001_05_otra_persona_sin_perfil_no_ve_el_de_otra()
    {
        await api.ClientFor(Guid.NewGuid()).PutAsJsonAsync("/profile", Valid());

        var stranger = await api.ClientFor(Guid.NewGuid()).GetFromJsonAsync<ProfileDto>("/profile");

        Assert.False(stranger!.Configured);
    }

    [Fact]
    public async Task AC_profile_001_05_sin_token_responde_401()
    {
        var anonymous = api.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/profile")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PutAsJsonAsync("/profile", Valid())).StatusCode);
    }

    [Fact]
    public async Task AC_profile_001_05_con_un_token_real_el_perfil_es_de_su_dueno()
    {
        var one = api.ClientWithToken(ApiFixture.CreateToken(Guid.NewGuid()));
        var two = api.ClientWithToken(ApiFixture.CreateToken(Guid.NewGuid()));

        await one.PutAsJsonAsync("/profile", Valid());

        Assert.True((await one.GetFromJsonAsync<ProfileDto>("/profile"))!.Configured);
        Assert.False((await two.GetFromJsonAsync<ProfileDto>("/profile"))!.Configured);
    }
}
