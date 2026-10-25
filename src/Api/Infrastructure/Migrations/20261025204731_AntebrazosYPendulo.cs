using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace FitnessApp.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AntebrazosYPendulo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "abdominales-en-banco-declinado",
                column: "SortOrder",
                value: 114);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "abduccion-de-cadera-en-maquina",
                column: "SortOrder",
                value: 50);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "buenos-dias-con-barra",
                column: "SortOrder",
                value: 60);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "crunch-en-maquina",
                column: "SortOrder",
                value: 104);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "crunch-en-polea-alta-de-rodillas",
                column: "SortOrder",
                value: 105);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "crunch-en-suelo",
                column: "SortOrder",
                value: 103);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-bayesian-en-polea",
                column: "SortOrder",
                value: 74);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-con-barra-recta",
                column: "SortOrder",
                value: 63);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-con-barra-z",
                column: "SortOrder",
                value: 64);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-con-mancuernas-alternado",
                column: "SortOrder",
                value: 65);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-concentrado",
                column: "SortOrder",
                value: 71);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-en-polea-alta-doble-biceps",
                column: "SortOrder",
                value: 73);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-en-polea-baja",
                column: "SortOrder",
                value: 72);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-femoral-acostado-en-maquina",
                column: "SortOrder",
                value: 55);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-femoral-de-pie-en-maquina",
                column: "SortOrder",
                value: 57);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-femoral-sentado-en-maquina",
                column: "SortOrder",
                value: 56);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-inclinado-con-mancuernas",
                column: "SortOrder",
                value: 68);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-martillo-con-mancuernas",
                column: "SortOrder",
                value: 66);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-martillo-en-banco-inclinado",
                column: "SortOrder",
                value: 67);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-nordico",
                column: "SortOrder",
                value: 61);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-predicador-banco-scott-con-barra-z",
                column: "SortOrder",
                value: 69);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-predicador-en-maquina",
                column: "SortOrder",
                value: 70);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-piernas-colgado",
                column: "SortOrder",
                value: 106);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-piernas-en-banco",
                column: "SortOrder",
                value: 108);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-rodillas-en-silla-romana",
                column: "SortOrder",
                value: 107);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-talones-a-una-pierna",
                column: "SortOrder",
                value: 102);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-talones-de-pie-con-mancuerna",
                column: "SortOrder",
                value: 100);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-talones-de-pie-en-maquina",
                column: "SortOrder",
                value: 97);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-talones-en-maquina-smith",
                column: "SortOrder",
                value: 101);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-talones-en-prensa-de-piernas",
                column: "SortOrder",
                value: 99);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-talones-sentado-en-maquina",
                column: "SortOrder",
                value: 98);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-cadera-en-maquina",
                column: "SortOrder",
                value: 54);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-cuadriceps-en-maquina",
                column: "SortOrder",
                value: 41);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-triceps-en-maquina",
                column: "SortOrder",
                value: 85);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-triceps-en-polea-a-una-mano",
                column: "SortOrder",
                value: 77);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-triceps-en-polea-con-cuerda",
                column: "SortOrder",
                value: 76);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-triceps-en-polea-hacia-abajo-barra-recta",
                column: "SortOrder",
                value: 75);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-triceps-sobre-la-cabeza-con-mancuerna",
                column: "SortOrder",
                value: 80);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-triceps-sobre-la-cabeza-en-polea",
                column: "SortOrder",
                value: 81);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "fondos-en-banco",
                column: "SortOrder",
                value: 83);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "fondos-en-paralelas-para-triceps",
                column: "SortOrder",
                value: 82);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "giros-rusos-con-mancuerna-o-disco",
                column: "SortOrder",
                value: 112);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "hip-thrust-con-barra",
                column: "SortOrder",
                value: 45);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "hip-thrust-en-maquina",
                column: "SortOrder",
                value: 46);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "hiperextension-inversa-en-maquina",
                column: "SortOrder",
                value: 62);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "lenador-en-polea-rotacion",
                column: "SortOrder",
                value: 113);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "patada-de-gluteo-en-maquina",
                column: "SortOrder",
                value: 49);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "patada-de-gluteo-en-polea",
                column: "SortOrder",
                value: 48);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "patada-de-triceps-con-mancuerna",
                column: "SortOrder",
                value: 86);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "peso-muerto-con-piernas-rigidas",
                column: "SortOrder",
                value: 59);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "peso-muerto-rumano-con-barra",
                column: "SortOrder",
                value: 51);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "peso-muerto-rumano-con-mancuernas",
                column: "SortOrder",
                value: 58);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "plancha",
                column: "SortOrder",
                value: 109);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "plancha-lateral",
                column: "SortOrder",
                value: 110);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "prensa-de-piernas-45",
                column: "SortOrder",
                value: 39);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "prensa-de-piernas-90",
                column: "SortOrder",
                value: 40);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "press-cerrado-con-barra",
                column: "SortOrder",
                value: 84);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "press-frances-con-barra-z",
                column: "SortOrder",
                value: 78);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "press-frances-con-mancuernas",
                column: "SortOrder",
                value: 79);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "puente-de-gluteo-con-barra",
                column: "SortOrder",
                value: 47);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "rueda-abdominal",
                column: "SortOrder",
                value: 111);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "sentadilla-bulgara-con-mancuernas",
                column: "SortOrder",
                value: 43);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "sentadilla-sumo-con-mancuerna",
                column: "SortOrder",
                value: 52);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "sissy-squat",
                column: "SortOrder",
                value: 44);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "zancada-caminando-con-mancuernas",
                column: "SortOrder",
                value: 53);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "zancadas-con-mancuernas",
                column: "SortOrder",
                value: 42);

            migrationBuilder.InsertData(
                table: "exercises",
                columns: new[] { "Id", "Bar", "Equipment", "Movements", "Name", "PrimaryZone", "SecondaryZones", "Section", "SortOrder" },
                values: new object[,]
                {
                    { "agarre-de-discos-plate-pinch", null, "PesoCorporal", new[] { "agarre_de_pellizco" }, "Agarre de discos (plate pinch)", "antebrazos", new string[0], "Antebrazos", 95 },
                    { "colgarse-de-la-barra", null, "PesoCorporal", new[] { "suspension" }, "Colgarse de la barra", "antebrazos", new[] { "espalda" }, "Antebrazos", 96 },
                    { "curl-de-muneca-con-barra-palmas-arriba", "Recta", "Barra", new[] { "flexion_de_muneca" }, "Curl de muñeca con barra (palmas arriba)", "antebrazos", new string[0], "Antebrazos", 87 },
                    { "curl-de-muneca-con-mancuerna", null, "Mancuernas", new[] { "flexion_de_muneca" }, "Curl de muñeca con mancuerna", "antebrazos", new string[0], "Antebrazos", 89 },
                    { "curl-de-muneca-en-polea-baja", null, "Maquina", new[] { "flexion_de_muneca" }, "Curl de muñeca en polea baja", "antebrazos", new string[0], "Antebrazos", 94 },
                    { "curl-de-muneca-inverso-con-barra-palmas-abajo", "Recta", "Barra", new[] { "extension_de_muneca" }, "Curl de muñeca inverso con barra (palmas abajo)", "antebrazos", new string[0], "Antebrazos", 88 },
                    { "curl-inverso-con-barra", "Recta", "Barra", new[] { "flexion_de_codo" }, "Curl inverso con barra", "antebrazos", new[] { "biceps" }, "Antebrazos", 90 },
                    { "curl-zottman", null, "Mancuernas", new[] { "flexion_de_codo" }, "Curl Zottman", "antebrazos", new[] { "biceps" }, "Antebrazos", 91 },
                    { "paseo-del-granjero", null, "Mancuernas", new[] { "acarreo" }, "Paseo del granjero", "antebrazos", new[] { "trapecio", "espalda_baja" }, "Antebrazos", 92 },
                    { "rodillo-de-muneca", null, "PesoCorporal", new[] { "flexion_de_muneca", "extension_de_muneca" }, "Rodillo de muñeca", "antebrazos", new[] { "hombro_frontal" }, "Antebrazos", 93 },
                    { "sentadilla-pendulo-en-maquina", null, "Maquina", new[] { "flexion_profunda_de_rodilla", "flexion_profunda_de_cadera" }, "Sentadilla péndulo en máquina", "cuadriceps", new[] { "gluteo" }, "Cuádriceps", 38 }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "agarre-de-discos-plate-pinch");

            migrationBuilder.DeleteData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "colgarse-de-la-barra");

            migrationBuilder.DeleteData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-de-muneca-con-barra-palmas-arriba");

            migrationBuilder.DeleteData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-de-muneca-con-mancuerna");

            migrationBuilder.DeleteData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-de-muneca-en-polea-baja");

            migrationBuilder.DeleteData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-de-muneca-inverso-con-barra-palmas-abajo");

            migrationBuilder.DeleteData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-inverso-con-barra");

            migrationBuilder.DeleteData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-zottman");

            migrationBuilder.DeleteData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "paseo-del-granjero");

            migrationBuilder.DeleteData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "rodillo-de-muneca");

            migrationBuilder.DeleteData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "sentadilla-pendulo-en-maquina");

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "abdominales-en-banco-declinado",
                column: "SortOrder",
                value: 103);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "abduccion-de-cadera-en-maquina",
                column: "SortOrder",
                value: 49);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "buenos-dias-con-barra",
                column: "SortOrder",
                value: 59);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "crunch-en-maquina",
                column: "SortOrder",
                value: 93);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "crunch-en-polea-alta-de-rodillas",
                column: "SortOrder",
                value: 94);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "crunch-en-suelo",
                column: "SortOrder",
                value: 92);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-bayesian-en-polea",
                column: "SortOrder",
                value: 73);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-con-barra-recta",
                column: "SortOrder",
                value: 62);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-con-barra-z",
                column: "SortOrder",
                value: 63);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-con-mancuernas-alternado",
                column: "SortOrder",
                value: 64);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-concentrado",
                column: "SortOrder",
                value: 70);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-en-polea-alta-doble-biceps",
                column: "SortOrder",
                value: 72);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-en-polea-baja",
                column: "SortOrder",
                value: 71);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-femoral-acostado-en-maquina",
                column: "SortOrder",
                value: 54);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-femoral-de-pie-en-maquina",
                column: "SortOrder",
                value: 56);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-femoral-sentado-en-maquina",
                column: "SortOrder",
                value: 55);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-inclinado-con-mancuernas",
                column: "SortOrder",
                value: 67);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-martillo-con-mancuernas",
                column: "SortOrder",
                value: 65);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-martillo-en-banco-inclinado",
                column: "SortOrder",
                value: 66);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-nordico",
                column: "SortOrder",
                value: 60);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-predicador-banco-scott-con-barra-z",
                column: "SortOrder",
                value: 68);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "curl-predicador-en-maquina",
                column: "SortOrder",
                value: 69);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-piernas-colgado",
                column: "SortOrder",
                value: 95);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-piernas-en-banco",
                column: "SortOrder",
                value: 97);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-rodillas-en-silla-romana",
                column: "SortOrder",
                value: 96);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-talones-a-una-pierna",
                column: "SortOrder",
                value: 91);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-talones-de-pie-con-mancuerna",
                column: "SortOrder",
                value: 89);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-talones-de-pie-en-maquina",
                column: "SortOrder",
                value: 86);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-talones-en-maquina-smith",
                column: "SortOrder",
                value: 90);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-talones-en-prensa-de-piernas",
                column: "SortOrder",
                value: 88);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "elevacion-de-talones-sentado-en-maquina",
                column: "SortOrder",
                value: 87);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-cadera-en-maquina",
                column: "SortOrder",
                value: 53);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-cuadriceps-en-maquina",
                column: "SortOrder",
                value: 40);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-triceps-en-maquina",
                column: "SortOrder",
                value: 84);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-triceps-en-polea-a-una-mano",
                column: "SortOrder",
                value: 76);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-triceps-en-polea-con-cuerda",
                column: "SortOrder",
                value: 75);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-triceps-en-polea-hacia-abajo-barra-recta",
                column: "SortOrder",
                value: 74);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-triceps-sobre-la-cabeza-con-mancuerna",
                column: "SortOrder",
                value: 79);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "extension-de-triceps-sobre-la-cabeza-en-polea",
                column: "SortOrder",
                value: 80);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "fondos-en-banco",
                column: "SortOrder",
                value: 82);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "fondos-en-paralelas-para-triceps",
                column: "SortOrder",
                value: 81);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "giros-rusos-con-mancuerna-o-disco",
                column: "SortOrder",
                value: 101);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "hip-thrust-con-barra",
                column: "SortOrder",
                value: 44);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "hip-thrust-en-maquina",
                column: "SortOrder",
                value: 45);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "hiperextension-inversa-en-maquina",
                column: "SortOrder",
                value: 61);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "lenador-en-polea-rotacion",
                column: "SortOrder",
                value: 102);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "patada-de-gluteo-en-maquina",
                column: "SortOrder",
                value: 48);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "patada-de-gluteo-en-polea",
                column: "SortOrder",
                value: 47);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "patada-de-triceps-con-mancuerna",
                column: "SortOrder",
                value: 85);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "peso-muerto-con-piernas-rigidas",
                column: "SortOrder",
                value: 58);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "peso-muerto-rumano-con-barra",
                column: "SortOrder",
                value: 50);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "peso-muerto-rumano-con-mancuernas",
                column: "SortOrder",
                value: 57);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "plancha",
                column: "SortOrder",
                value: 98);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "plancha-lateral",
                column: "SortOrder",
                value: 99);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "prensa-de-piernas-45",
                column: "SortOrder",
                value: 38);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "prensa-de-piernas-90",
                column: "SortOrder",
                value: 39);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "press-cerrado-con-barra",
                column: "SortOrder",
                value: 83);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "press-frances-con-barra-z",
                column: "SortOrder",
                value: 77);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "press-frances-con-mancuernas",
                column: "SortOrder",
                value: 78);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "puente-de-gluteo-con-barra",
                column: "SortOrder",
                value: 46);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "rueda-abdominal",
                column: "SortOrder",
                value: 100);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "sentadilla-bulgara-con-mancuernas",
                column: "SortOrder",
                value: 42);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "sentadilla-sumo-con-mancuerna",
                column: "SortOrder",
                value: 51);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "sissy-squat",
                column: "SortOrder",
                value: 43);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "zancada-caminando-con-mancuernas",
                column: "SortOrder",
                value: 52);

            migrationBuilder.UpdateData(
                table: "exercises",
                keyColumn: "Id",
                keyValue: "zancadas-con-mancuernas",
                column: "SortOrder",
                value: 41);
        }
    }
}
