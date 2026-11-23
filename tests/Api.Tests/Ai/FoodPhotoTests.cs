using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using FitnessApp.Api.Domain.Ai;
using FitnessApp.Api.Features.Ai;
using FitnessApp.Api.Features.Nutrition;
using FitnessApp.Api.Features.Profile;
using FitnessApp.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace FitnessApp.Api.Tests.Ai;

/// <summary>Imágenes mínimas de prueba con metadatos que deben desaparecer.</summary>
public static class TestImages
{
    public const string Secret = "GPS-SECRETO-40.4168N";

    private static byte[] Segment(byte marker, byte[] payload) =>
        [0xFF, marker, (byte)((payload.Length + 2) >> 8), (byte)((payload.Length + 2) & 0xFF), .. payload];

    /// <summary>JPEG con JFIF, un EXIF con «ubicación», un comentario, una tabla y un escaneo.</summary>
    public static byte[] JpegWithExif() =>
    [
        0xFF, 0xD8,
        .. Segment(0xE0, [.. "JFIF\0"u8, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
        .. Segment(0xE1, [.. "Exif\0\0"u8, .. Encoding.ASCII.GetBytes(Secret)]),
        .. Segment(0xFE, "comentario-privado"u8.ToArray()),
        .. Segment(0xDB, [0, 1, 2, 3, 4, 5, 6, 7]),
        .. Segment(0xDA, [1, 1, 0, 0, 63, 0]),
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
        0xFF, 0xD9,
    ];

    private static byte[] PngChunk(string type, byte[] data) =>
        [(byte)(data.Length >> 24), (byte)(data.Length >> 16), (byte)(data.Length >> 8), (byte)data.Length, .. Encoding.ASCII.GetBytes(type), .. data, 0, 0, 0, 0];

    public static byte[] PngWithText() =>
    [
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        .. PngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
        .. PngChunk("tEXt", Encoding.ASCII.GetBytes("Location\0" + Secret)),
        .. PngChunk("eXIf", Encoding.ASCII.GetBytes(Secret)),
        .. PngChunk("IDAT", [1, 2, 3, 4]),
        .. PngChunk("IEND", []),
    ];
}

/// <summary>Validación y limpieza de la foto antes de enviarla (SPEC-ai-003, AC-03 y AC-04).</summary>
public sealed class ImageSanitizerTests
{
    [Fact]
    public void AC_ai_003_04_el_jpeg_pierde_el_exif_y_el_comentario_y_sigue_siendo_un_jpeg_completo()
    {
        var clean = ImageSanitizer.Sanitize(TestImages.JpegWithExif())!;

        Assert.Equal("image/jpeg", clean.MimeType);
        var text = Encoding.Latin1.GetString(clean.Bytes);
        Assert.DoesNotContain("GPS", text);
        Assert.DoesNotContain("comentario", text);
        Assert.DoesNotContain("Exif", text);
        Assert.Contains("JFIF", text);
        Assert.Equal(new byte[] { 0xFF, 0xD8, 0xFF }, clean.Bytes[..3]);
        Assert.Equal(new byte[] { 0xFF, 0xD9 }, clean.Bytes[^2..]);
        Assert.True(clean.Bytes.Length < TestImages.JpegWithExif().Length);
    }

    [Fact]
    public void AC_ai_003_04_el_png_pierde_los_textos_y_el_exif_pero_conserva_la_imagen()
    {
        var clean = ImageSanitizer.Sanitize(TestImages.PngWithText())!;

        Assert.Equal("image/png", clean.MimeType);
        var text = Encoding.Latin1.GetString(clean.Bytes);
        Assert.DoesNotContain("GPS", text);
        Assert.DoesNotContain("tEXt", text);
        Assert.DoesNotContain("eXIf", text);
        foreach (var chunk in new[] { "IHDR", "IDAT", "IEND" }) Assert.Contains(chunk, text);
    }

    [Fact]
    public void AC_ai_003_04_los_datos_enviados_llevan_la_imagen_como_data_url_sin_metadatos()
    {
        var clean = ImageSanitizer.Sanitize(TestImages.JpegWithExif())!;

        var dataUrl = clean.ToDataUrl();

        Assert.StartsWith("data:image/jpeg;base64,", dataUrl);
        Assert.DoesNotContain(TestImages.Secret, Encoding.Latin1.GetString(Convert.FromBase64String(dataUrl["data:image/jpeg;base64,".Length..])));
    }

    [Fact]
    public void AC_ai_003_03_lo_que_no_es_una_imagen_jpeg_o_png_bien_formada_se_rechaza()
    {
        var truncatedJpeg = TestImages.JpegWithExif()[..^2]; // sin el final de la imagen
        var pngWithoutData = TestImages.PngWithText().Take(8).Concat(new byte[] { 0, 0, 0, 0, (byte)'I', (byte)'E', (byte)'N', (byte)'D', 0, 0, 0, 0 }).ToArray();

        Assert.Null(ImageSanitizer.Sanitize(null));
        Assert.Null(ImageSanitizer.Sanitize([]));
        Assert.Null(ImageSanitizer.Sanitize(Encoding.ASCII.GetBytes("GIF89a esto no es jpeg ni png")));
        Assert.Null(ImageSanitizer.Sanitize(Encoding.ASCII.GetBytes("<html>no soy una imagen</html>")));
        Assert.Null(ImageSanitizer.Sanitize(truncatedJpeg));
        Assert.Null(ImageSanitizer.Sanitize(pngWithoutData));
        Assert.Null(ImageSanitizer.Sanitize([.. TestImages.JpegWithExif(), .. new byte[ImageSanitizer.MaxBytes]])); // más de 5 MB
    }
}

/// <summary>Verifica SPEC-ai-003 (fotos de comida con IA) contra la API y Postgres reales con un proveedor falso.</summary>
[Collection("api")]
public sealed class FoodPhotoTests : IDisposable
{
    private readonly ApiFixture api;

    public FoodPhotoTests(ApiFixture api)
    {
        this.api = api;
        api.Ai.Reset();
    }

    public void Dispose() => api.Ai.Reset();

    private static string Photo() => Convert.ToBase64String(TestImages.JpegWithExif());

    private static AiCompletion Items(params object[] items) => new(JsonSerializer.Serialize(new { items }), 2600, 120);

    private async Task<(HttpClient Client, Guid UserId)> NewPersonAsync(bool consent = true, string[]? allergies = null)
    {
        var userId = Guid.NewGuid();
        var client = api.ClientFor(userId);
        (await client.PutAsJsonAsync("/profile", new ProfileRequest(
            "Julio César", "masculino", new DateOnly(1995, 5, 20), 178, "mantener", null, null, null, null, allergies ?? []))).EnsureSuccessStatusCode();
        if (consent) (await client.PutAsync($"/ai/consents/{AiFeatures.FoodPhoto}", null)).EnsureSuccessStatusCode();
        return (client, userId);
    }

    private static Task<HttpResponseMessage> Send(HttpClient client, string base64) => client.PostAsJsonAsync("/ai/food-photo", new FoodPhotoRequest(base64));

    private static object Rice(int grams = 150, string confidence = "media") =>
        new { name = "Arroz blanco", grams, kcalPer100g = 130, proteinPer100g = 2.7, fatPer100g = 0.3, carbsPer100g = 28, confidence };

    // AC-ai-003-01
    [Fact]
    public async Task AC_ai_003_01_devuelve_alimentos_con_gramos_calorias_y_macros_marcados_como_estimacion_con_su_confianza()
    {
        var (client, _) = await NewPersonAsync();
        api.Ai.Handler = _ => Items(Rice(), new { name = "Pollo a la plancha", grams = 120, kcalPer100g = 165, proteinPer100g = 31, fatPer100g = 3.6, carbsPer100g = 0, confidence = "alta" });

        var response = await Send(client, Photo());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var photo = (await response.Content.ReadFromJsonAsync<FoodPhotoDto>())!;
        Assert.Equal("proposal", photo.Kind);
        Assert.Equal(2, photo.Items.Count);
        var rice = photo.Items[0];
        Assert.Equal(("Arroz blanco", 150, "media", true), (rice.Name, rice.Grams, rice.Confidence, rice.Estimate));
        Assert.Equal((195, 4.1m, 0.5m, 42m), (rice.Kcal, rice.ProteinG, rice.FatG, rice.CarbsG)); // con las reglas de la spec14: 130 × 150 g
        Assert.Equal("alta", photo.Items[1].Confidence);
        Assert.Contains("sustituye a un profesional de la salud", photo.Disclaimer);
    }

    [Fact]
    public async Task AC_ai_003_01_una_confianza_desconocida_pasa_a_baja_y_los_elementos_fuera_de_rango_se_descartan()
    {
        var (client, _) = await NewPersonAsync();
        api.Ai.Handler = _ => Items(
            Rice(confidence: "segurísima"),
            new { name = "Demasiados gramos", grams = 99999, kcalPer100g = 100, proteinPer100g = 1, fatPer100g = 1, carbsPer100g = 1, confidence = "alta" },
            new { name = "Macros imposibles", grams = 100, kcalPer100g = 100, proteinPer100g = 60, fatPer100g = 60, carbsPer100g = 60, confidence = "alta" },
            new { grams = 100, kcalPer100g = 100, proteinPer100g = 1, fatPer100g = 1, carbsPer100g = 1, confidence = "alta" });

        var photo = (await (await Send(client, Photo())).Content.ReadFromJsonAsync<FoodPhotoDto>())!;

        var item = Assert.Single(photo.Items);
        Assert.Equal(("Arroz blanco", "baja"), (item.Name, item.Confidence));
    }

    [Fact]
    public async Task AC_ai_003_01_una_foto_sin_comida_devuelve_una_lista_vacia_y_una_respuesta_sin_la_forma_pedida_502()
    {
        var (client, _) = await NewPersonAsync();
        api.Ai.Handler = _ => Items();
        Assert.Empty((await (await Send(client, Photo())).Content.ReadFromJsonAsync<FoodPhotoDto>())!.Items);

        api.Ai.Handler = _ => new AiCompletion("no es json", 100, 10);
        Assert.Equal(HttpStatusCode.BadGateway, (await Send(client, Photo())).StatusCode);
    }

    // AC-ai-003-02
    [Fact]
    public async Task AC_ai_003_02_sin_consentimiento_responde_403_y_la_imagen_no_sale_de_la_api()
    {
        var (client, _) = await NewPersonAsync(consent: false);
        var calls = api.Ai.Calls.Count;

        var response = await Send(client, Photo());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("consent_required", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        Assert.Equal(calls, api.Ai.Calls.Count);
    }

    // AC-ai-003-03
    [Fact]
    public async Task AC_ai_003_03_una_imagen_invalida_responde_400_y_no_llama_al_proveedor()
    {
        var (client, _) = await NewPersonAsync();
        var calls = api.Ai.Calls.Count;

        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, "esto no es base64 válido!!")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, "")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, Convert.ToBase64String(Encoding.ASCII.GetBytes("GIF89a no es una foto jpeg")))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, Convert.ToBase64String([.. TestImages.JpegWithExif(), .. new byte[ImageSanitizer.MaxBytes]]))).StatusCode);
        Assert.Equal(calls, api.Ai.Calls.Count);
    }

    // AC-ai-003-04 (P5)
    [Fact]
    public async Task AC_ai_003_04_el_proveedor_recibe_la_imagen_sin_metadatos_y_la_auditoria_guarda_el_tamano_no_la_imagen()
    {
        var (client, userId) = await NewPersonAsync();

        await Send(client, Photo());

        var sent = api.Ai.Calls[^1].Messages[0];
        Assert.StartsWith("data:image/jpeg;base64,", sent.ImageDataUrl);
        Assert.DoesNotContain(TestImages.Secret, Encoding.Latin1.GetString(Convert.FromBase64String(sent.ImageDataUrl![(sent.ImageDataUrl.IndexOf(',') + 1)..])));
        Assert.DoesNotContain("Julio", api.Ai.Calls[^1].System + sent.Text); // sin identificadores de la persona
        using var scope = api.Services.CreateScope();
        var row = await scope.ServiceProvider.GetRequiredService<AppDbContext>().AiAudits.AsNoTracking().SingleAsync(a => a.UserId == userId);
        Assert.Equal(("food-photo-v1", AiFeatures.FoodPhoto), (row.PromptVersion, row.Feature));
        Assert.Matches(@"\d+ bytes", row.SentText);
        Assert.DoesNotContain("base64", row.SentText);
        Assert.DoesNotContain("/9j/", row.SentText);
    }

    // AC-ai-003-05 y 06
    [Fact]
    public async Task AC_ai_003_05_analizar_una_foto_no_crea_alimentos_ni_entradas_y_el_alimento_con_origen_ia_se_guarda_con_las_reglas_normales()
    {
        var (client, _) = await NewPersonAsync();
        await Send(client, Photo());
        Assert.Empty((await client.GetFromJsonAsync<List<FoodDto>>("/foods"))!);

        var id = Guid.NewGuid();
        var saved = await client.PutAsJsonAsync($"/foods/{id}", new FoodRequest("Arroz blanco", null, null, 130, 2.7m, 0.3m, 28m, "ia"));

        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);
        Assert.Equal("ia", Assert.Single((await client.GetFromJsonAsync<List<FoodDto>>("/foods"))!).Source);
    }

    // AC-ai-003-07
    [Fact]
    public async Task AC_ai_003_07_avisa_de_los_alergenos_que_sugiere_el_nombre_si_chocan_con_las_alergias_del_perfil()
    {
        var (client, _) = await NewPersonAsync(allergies: ["lactosa"]);
        api.Ai.Handler = _ => Items(
            new { name = "Yogur con leche", grams = 125, kcalPer100g = 60, proteinPer100g = 4, fatPer100g = 3, carbsPer100g = 5, confidence = "media" }, Rice());

        var photo = (await (await Send(client, Photo())).Content.ReadFromJsonAsync<FoodPhotoDto>())!;

        Assert.Equal(["leche"], photo.Items[0].PossibleAllergens);
        Assert.Empty(photo.Items[1].PossibleAllergens);
    }

    // AC-ai-003-08
    [Fact]
    public async Task AC_ai_003_08_pasadas_las_fotos_del_dia_responde_429_rate_limited_sin_llamar_al_proveedor()
    {
        using var factory = api.WithAuth(("Ai:FoodPhotosPerDay", "2"));
        var userId = Guid.NewGuid();
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-User-Id", userId.ToString());
        await client.PutAsync($"/ai/consents/{AiFeatures.FoodPhoto}", null);
        factory.Services.GetRequiredService<FakeAiProvider>().Handler = _ => Items();
        Assert.Equal(HttpStatusCode.OK, (await Send(client, Photo())).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(client, Photo())).StatusCode);
        var calls = factory.Services.GetRequiredService<FakeAiProvider>().Calls.Count;

        var response = await Send(client, Photo());

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Equal("rate_limited", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        Assert.Equal(calls, factory.Services.GetRequiredService<FakeAiProvider>().Calls.Count);
    }

    [Fact]
    public async Task AC_ai_003_08_sin_modelo_sin_clave_o_con_el_proveedor_caido_responde_como_la_base_de_ia()
    {
        using var noModel = api.WithAuth(("Ai:Models:food_photo", ""));
        var one = noModel.CreateClient();
        one.DefaultRequestHeaders.Add("X-User-Id", Guid.NewGuid().ToString());
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await Send(one, Photo())).StatusCode);

        using var noKey = api.WithAuth(("Ai:ApiKey", ""));
        var two = noKey.CreateClient();
        two.DefaultRequestHeaders.Add("X-User-Id", Guid.NewGuid().ToString());
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await Send(two, Photo())).StatusCode);

        var (client, _) = await NewPersonAsync();
        api.Ai.Throw = new AiProviderException(AiFailureKind.Failure, "caído");
        Assert.Equal(HttpStatusCode.BadGateway, (await Send(client, Photo())).StatusCode);
        api.Ai.Throw = new AiProviderException(AiFailureKind.Quota, "429", TimeSpan.FromSeconds(30));
        var quota = await Send(client, Photo());
        Assert.Equal(HttpStatusCode.TooManyRequests, quota.StatusCode);
        Assert.Equal("provider_quota", (await quota.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }

    [Fact]
    public async Task AC_ai_003_01_sin_sesion_responde_401_y_el_listado_marca_la_funcion_disponible_con_el_modelo_de_vision()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(api.CreateClient(), Photo())).StatusCode);
        var (client, _) = await NewPersonAsync();
        var features = (await client.GetFromJsonAsync<AiConsentsDto>("/ai/consents"))!.Features.ToDictionary(f => f.Feature);
        Assert.True(features[AiFeatures.FoodPhoto].Available);
        Assert.True(features[AiFeatures.FoodPhoto].Consented);
    }
}
