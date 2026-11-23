namespace FitnessApp.Api.Domain.Ai;

/// <summary>Imagen ya validada y sin metadatos, lista para enviar (SPEC-ai-003, AC-03 y AC-04).</summary>
public sealed record CleanImage(string MimeType, byte[] Bytes)
{
    public string ToDataUrl() => $"data:{MimeType};base64,{Convert.ToBase64String(Bytes)}";
}

/// <summary>
/// Valida una foto (JPEG o PNG) y le quita los metadatos antes de enviarla a la IA (P5): EXIF con la ubicación y la fecha, XMP, comentarios,
/// perfiles y textos. No re-codifica la imagen: solo descarta los bloques que no hacen falta para verla, así que no necesita librerías de
/// imagen. Lo que no sea una imagen JPEG o PNG bien formada se rechaza.
/// </summary>
public static class ImageSanitizer
{
    public const int MaxBytes = 5 * 1024 * 1024;

    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    /// <summary>Chunks de PNG que se conservan: los críticos y la transparencia. Todo lo demás (eXIf, tEXt, iTXt, zTXt, tIME, pHYs…) se descarta.</summary>
    private static readonly HashSet<string> KeptPngChunks = ["IHDR", "PLTE", "IDAT", "IEND", "tRNS"];

    public static CleanImage? Sanitize(byte[]? data)
    {
        if (data is null || data.Length < 12 || data.Length > MaxBytes) return null;
        if (data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF) return Jpeg(data);
        if (data.AsSpan(0, 8).SequenceEqual(PngSignature)) return Png(data);
        return null;
    }

    /// <summary>
    /// JPEG: se copian los segmentos que hacen falta (cabecera JFIF, tablas, marcos y datos) y se descartan los de aplicación (EXIF, XMP, ICC…)
    /// y los comentarios. Tras el inicio del escaneo (SOS) los datos se copian tal cual hasta el final.
    /// </summary>
    private static CleanImage? Jpeg(byte[] data)
    {
        var output = new List<byte> { 0xFF, 0xD8 };
        var i = 2;
        while (i + 3 < data.Length)
        {
            if (data[i] != 0xFF) return null;
            var marker = data[i + 1];
            if (marker == 0xFF) { i++; continue; } // relleno

            var length = (data[i + 2] << 8) | data[i + 3];
            if (length < 2 || i + 2 + length > data.Length) return null;

            if (marker == 0xDA) // inicio del escaneo: lo que sigue son datos hasta el final
            {
                output.AddRange(data.AsSpan(i).ToArray());
                var result = output.ToArray();
                return result.Length >= 4 && result[^2] == 0xFF && result[^1] == 0xD9 ? new CleanImage("image/jpeg", result) : null;
            }

            // APP0 (JFIF) y APP14 (Adobe, necesaria para algunos colores) se conservan; EXIF/XMP/ICC (APP1..APP13, APP15) y COM, no.
            var dropped = (marker is >= 0xE1 and <= 0xEF and not 0xEE) || marker == 0xFE;
            if (!dropped) output.AddRange(data.AsSpan(i, 2 + length).ToArray());
            i += 2 + length;
        }

        return null;
    }

    private static CleanImage? Png(byte[] data)
    {
        var output = new List<byte>(PngSignature);
        var i = 8;
        var sawHeader = false;
        var sawData = false;
        while (i + 12 <= data.Length)
        {
            var length = (data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3];
            if (length < 0 || i + 12 + (long)length > data.Length) return null;
            var type = System.Text.Encoding.ASCII.GetString(data, i + 4, 4);

            if (!sawHeader && type != "IHDR") return null;
            sawHeader = true;
            sawData |= type == "IDAT";
            if (KeptPngChunks.Contains(type)) output.AddRange(data.AsSpan(i, 12 + length).ToArray());
            i += 12 + length;

            if (type == "IEND") return sawData ? new CleanImage("image/png", output.ToArray()) : null;
        }

        return null;
    }
}
