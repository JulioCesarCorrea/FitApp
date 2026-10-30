using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace FitnessApp.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class CatalogoYRutina : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "equipment_settings",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    DumbbellsKg = table.Column<decimal[]>(type: "numeric[]", nullable: false),
                    DiscsKg = table.Column<decimal[]>(type: "numeric[]", nullable: false),
                    RectaBarKg = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: true),
                    ZBarKg = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: true),
                    SmithBarKg = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: true),
                    RemoEnTBarKg = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: true),
                    MachineStepKg = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    MachineBaseKg = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_equipment_settings", x => x.UserId);
                });

            migrationBuilder.CreateTable(
                name: "exercises",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Section = table.Column<string>(type: "text", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    PrimaryZone = table.Column<string>(type: "text", nullable: false),
                    SecondaryZones = table.Column<string[]>(type: "text[]", nullable: false),
                    Movements = table.Column<string[]>(type: "text[]", nullable: false),
                    Equipment = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Bar = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_exercises", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "restrictions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Zone = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    AvoidedMovements = table.Column<string[]>(type: "text[]", nullable: false),
                    Level = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ReviewOn = table.Column<DateOnly>(type: "date", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_restrictions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "plan_entries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Day = table.Column<int>(type: "integer", nullable: false),
                    ExerciseId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    MachineStepKg = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_plan_entries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_plan_entries_exercises_ExerciseId",
                        column: x => x.ExerciseId,
                        principalTable: "exercises",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "exercises",
                columns: new[] { "Id", "Bar", "Equipment", "Movements", "Name", "PrimaryZone", "SecondaryZones", "Section", "SortOrder" },
                values: new object[,]
                {
                    { "abdominales-en-banco-declinado", null, "PesoCorporal", new[] { "flexion_de_tronco" }, "Abdominales en banco declinado", "abdomen", new string[0], "Abdomen", 103 },
                    { "abduccion-de-cadera-en-maquina", null, "Maquina", new[] { "abduccion_de_cadera" }, "Abducción de cadera en máquina", "gluteo", new string[0], "Glúteo", 49 },
                    { "aperturas-con-mancuernas", null, "Mancuernas", new[] { "apertura_de_hombro" }, "Aperturas con mancuernas", "pecho", new[] { "hombro_frontal" }, "Pecho", 9 },
                    { "aperturas-en-maquina-contractora", null, "Maquina", new[] { "apertura_de_hombro" }, "Aperturas en máquina (contractora)", "pecho", new[] { "hombro_frontal" }, "Pecho", 10 },
                    { "aperturas-posteriores-en-maquina-contractora-inversa", null, "Maquina", new[] { "apertura_posterior" }, "Aperturas posteriores en máquina (contractora inversa)", "hombro_posterior", new[] { "espalda", "trapecio" }, "Hombros", 32 },
                    { "buenos-dias-con-barra", "Recta", "Barra", new[] { "extension_de_cadera", "tronco_inclinado", "carga_axial", "carga_con_barra_libre" }, "Buenos días con barra", "isquiotibiales", new[] { "gluteo", "espalda_baja" }, "Isquiotibiales", 59 },
                    { "cruce-de-poleas-polea-alta", null, "Maquina", new[] { "apertura_de_hombro" }, "Cruce de poleas, polea alta", "pecho", new[] { "hombro_frontal" }, "Pecho", 11 },
                    { "cruce-de-poleas-polea-baja", null, "Maquina", new[] { "apertura_de_hombro" }, "Cruce de poleas, polea baja", "pecho", new[] { "hombro_frontal" }, "Pecho", 12 },
                    { "crunch-en-maquina", null, "Maquina", new[] { "flexion_de_tronco" }, "Crunch en máquina", "abdomen", new string[0], "Abdomen", 93 },
                    { "crunch-en-polea-alta-de-rodillas", null, "Maquina", new[] { "flexion_de_tronco" }, "Crunch en polea alta (de rodillas)", "abdomen", new string[0], "Abdomen", 94 },
                    { "crunch-en-suelo", null, "PesoCorporal", new[] { "flexion_de_tronco" }, "Crunch en suelo", "abdomen", new string[0], "Abdomen", 92 },
                    { "curl-bayesian-en-polea", null, "Maquina", new[] { "flexion_de_codo", "extension_de_hombro" }, "Curl bayesian en polea", "biceps", new[] { "antebrazos" }, "Bíceps", 73 },
                    { "curl-con-barra-recta", "Recta", "Barra", new[] { "flexion_de_codo", "carga_con_barra_libre" }, "Curl con barra recta", "biceps", new[] { "antebrazos" }, "Bíceps", 62 },
                    { "curl-con-barra-z", "Z", "Barra", new[] { "flexion_de_codo", "carga_con_barra_libre" }, "Curl con barra Z", "biceps", new[] { "antebrazos" }, "Bíceps", 63 },
                    { "curl-con-mancuernas-alternado", null, "Mancuernas", new[] { "flexion_de_codo" }, "Curl con mancuernas alternado", "biceps", new[] { "antebrazos" }, "Bíceps", 64 },
                    { "curl-concentrado", null, "Mancuernas", new[] { "flexion_de_codo" }, "Curl concentrado", "biceps", new[] { "antebrazos" }, "Bíceps", 70 },
                    { "curl-en-polea-alta-doble-biceps", null, "Maquina", new[] { "flexion_de_codo" }, "Curl en polea alta (doble bíceps)", "biceps", new[] { "antebrazos" }, "Bíceps", 72 },
                    { "curl-en-polea-baja", null, "Maquina", new[] { "flexion_de_codo" }, "Curl en polea baja", "biceps", new[] { "antebrazos" }, "Bíceps", 71 },
                    { "curl-femoral-acostado-en-maquina", null, "Maquina", new[] { "flexion_de_rodilla" }, "Curl femoral acostado en máquina", "isquiotibiales", new[] { "pantorrillas" }, "Isquiotibiales", 54 },
                    { "curl-femoral-de-pie-en-maquina", null, "Maquina", new[] { "flexion_de_rodilla" }, "Curl femoral de pie en máquina", "isquiotibiales", new[] { "pantorrillas" }, "Isquiotibiales", 56 },
                    { "curl-femoral-sentado-en-maquina", null, "Maquina", new[] { "flexion_de_rodilla" }, "Curl femoral sentado en máquina", "isquiotibiales", new[] { "pantorrillas" }, "Isquiotibiales", 55 },
                    { "curl-inclinado-con-mancuernas", null, "Mancuernas", new[] { "flexion_de_codo", "extension_de_hombro" }, "Curl inclinado con mancuernas", "biceps", new[] { "antebrazos" }, "Bíceps", 67 },
                    { "curl-martillo-con-mancuernas", null, "Mancuernas", new[] { "flexion_de_codo" }, "Curl martillo con mancuernas", "biceps", new[] { "antebrazos" }, "Bíceps", 65 },
                    { "curl-martillo-en-banco-inclinado", null, "Mancuernas", new[] { "flexion_de_codo", "extension_de_hombro" }, "Curl martillo en banco inclinado", "biceps", new[] { "antebrazos" }, "Bíceps", 66 },
                    { "curl-nordico", null, "PesoCorporal", new[] { "flexion_de_rodilla" }, "Curl nórdico", "isquiotibiales", new[] { "gluteo", "pantorrillas" }, "Isquiotibiales", 60 },
                    { "curl-predicador-banco-scott-con-barra-z", "Z", "Barra", new[] { "flexion_de_codo", "carga_con_barra_libre" }, "Curl predicador (banco Scott) con barra Z", "biceps", new[] { "antebrazos" }, "Bíceps", 68 },
                    { "curl-predicador-en-maquina", null, "Maquina", new[] { "flexion_de_codo" }, "Curl predicador en máquina", "biceps", new[] { "antebrazos" }, "Bíceps", 69 },
                    { "dominadas-agarre-prono", null, "PesoCorporal", new[] { "traccion_vertical" }, "Dominadas (agarre prono)", "espalda", new[] { "biceps", "antebrazos" }, "Espalda", 14 },
                    { "elevacion-de-piernas-colgado", null, "PesoCorporal", new[] { "flexion_de_cadera" }, "Elevación de piernas colgado", "abdomen", new[] { "antebrazos" }, "Abdomen", 95 },
                    { "elevacion-de-piernas-en-banco", null, "PesoCorporal", new[] { "flexion_de_cadera" }, "Elevación de piernas en banco", "abdomen", new string[0], "Abdomen", 97 },
                    { "elevacion-de-rodillas-en-silla-romana", null, "PesoCorporal", new[] { "flexion_de_cadera" }, "Elevación de rodillas en silla romana", "abdomen", new[] { "antebrazos" }, "Abdomen", 96 },
                    { "elevacion-de-talones-a-una-pierna", null, "PesoCorporal", new[] { "flexion_plantar" }, "Elevación de talones a una pierna", "pantorrillas", new string[0], "Pantorrillas", 91 },
                    { "elevacion-de-talones-de-pie-con-mancuerna", null, "Mancuernas", new[] { "flexion_plantar" }, "Elevación de talones de pie con mancuerna", "pantorrillas", new string[0], "Pantorrillas", 89 },
                    { "elevacion-de-talones-de-pie-en-maquina", null, "Maquina", new[] { "flexion_plantar", "carga_axial" }, "Elevación de talones de pie en máquina", "pantorrillas", new string[0], "Pantorrillas", 86 },
                    { "elevacion-de-talones-en-maquina-smith", "Smith", "Barra", new[] { "flexion_plantar", "carga_axial" }, "Elevación de talones en máquina Smith", "pantorrillas", new string[0], "Pantorrillas", 90 },
                    { "elevacion-de-talones-en-prensa-de-piernas", null, "Maquina", new[] { "flexion_plantar" }, "Elevación de talones en prensa de piernas", "pantorrillas", new string[0], "Pantorrillas", 88 },
                    { "elevacion-de-talones-sentado-en-maquina", null, "Maquina", new[] { "flexion_plantar" }, "Elevación de talones sentado en máquina", "pantorrillas", new string[0], "Pantorrillas", 87 },
                    { "elevaciones-frontales-con-mancuernas", null, "Mancuernas", new[] { "elevacion_de_hombro" }, "Elevaciones frontales con mancuernas", "hombro_frontal", new[] { "pecho" }, "Hombros", 27 },
                    { "elevaciones-laterales-con-mancuernas", null, "Mancuernas", new[] { "elevacion_de_hombro" }, "Elevaciones laterales con mancuernas", "hombro_lateral", new[] { "trapecio" }, "Hombros", 28 },
                    { "elevaciones-laterales-en-maquina", null, "Maquina", new[] { "elevacion_de_hombro" }, "Elevaciones laterales en máquina", "hombro_lateral", new[] { "trapecio" }, "Hombros", 30 },
                    { "elevaciones-laterales-en-polea", null, "Maquina", new[] { "elevacion_de_hombro" }, "Elevaciones laterales en polea", "hombro_lateral", new[] { "trapecio" }, "Hombros", 29 },
                    { "encogimientos-para-trapecio", null, "Mancuernas", new[] { "carga_axial" }, "Encogimientos para trapecio", "trapecio", new[] { "antebrazos" }, "Espalda", 23 },
                    { "extension-de-cadera-en-maquina", null, "Maquina", new[] { "extension_de_cadera" }, "Extensión de cadera en máquina", "gluteo", new[] { "isquiotibiales", "espalda_baja" }, "Glúteo", 53 },
                    { "extension-de-cuadriceps-en-maquina", null, "Maquina", new[] { "extension_de_rodilla" }, "Extensión de cuádriceps en máquina", "cuadriceps", new string[0], "Cuádriceps", 40 },
                    { "extension-de-triceps-en-maquina", null, "Maquina", new[] { "extension_de_codo" }, "Extensión de tríceps en máquina", "triceps", new string[0], "Tríceps", 84 },
                    { "extension-de-triceps-en-polea-a-una-mano", null, "Maquina", new[] { "extension_de_codo" }, "Extensión de tríceps en polea a una mano", "triceps", new string[0], "Tríceps", 76 },
                    { "extension-de-triceps-en-polea-con-cuerda", null, "Maquina", new[] { "extension_de_codo" }, "Extensión de tríceps en polea con cuerda", "triceps", new string[0], "Tríceps", 75 },
                    { "extension-de-triceps-en-polea-hacia-abajo-barra-recta", null, "Maquina", new[] { "extension_de_codo" }, "Extensión de tríceps en polea hacia abajo (barra recta)", "triceps", new string[0], "Tríceps", 74 },
                    { "extension-de-triceps-sobre-la-cabeza-con-mancuerna", null, "Mancuernas", new[] { "extension_de_codo", "brazo_sobre_la_cabeza" }, "Extensión de tríceps sobre la cabeza con mancuerna", "triceps", new[] { "hombro_frontal" }, "Tríceps", 79 },
                    { "extension-de-triceps-sobre-la-cabeza-en-polea", null, "Maquina", new[] { "extension_de_codo", "brazo_sobre_la_cabeza" }, "Extensión de tríceps sobre la cabeza en polea", "triceps", new[] { "hombro_frontal" }, "Tríceps", 80 },
                    { "face-pull-en-polea", null, "Maquina", new[] { "apertura_posterior" }, "Face pull en polea", "hombro_posterior", new[] { "espalda", "trapecio" }, "Hombros", 33 },
                    { "fondos-en-banco", null, "PesoCorporal", new[] { "fondos", "extension_de_codo" }, "Fondos en banco", "triceps", new[] { "hombro_frontal" }, "Tríceps", 82 },
                    { "fondos-en-paralelas-para-pecho", null, "PesoCorporal", new[] { "fondos" }, "Fondos en paralelas para pecho", "pecho", new[] { "triceps", "hombro_frontal" }, "Pecho", 13 },
                    { "fondos-en-paralelas-para-triceps", null, "PesoCorporal", new[] { "fondos", "extension_de_codo" }, "Fondos en paralelas para tríceps", "triceps", new[] { "pecho", "hombro_frontal" }, "Tríceps", 81 },
                    { "giros-rusos-con-mancuerna-o-disco", null, "Mancuernas", new[] { "rotacion_de_tronco" }, "Giros rusos con mancuerna o disco", "abdomen", new string[0], "Abdomen", 101 },
                    { "hip-thrust-con-barra", "Recta", "Barra", new[] { "extension_de_cadera", "carga_con_barra_libre" }, "Hip thrust con barra", "gluteo", new[] { "isquiotibiales" }, "Glúteo", 44 },
                    { "hip-thrust-en-maquina", null, "Maquina", new[] { "extension_de_cadera" }, "Hip thrust en máquina", "gluteo", new[] { "isquiotibiales" }, "Glúteo", 45 },
                    { "hiperextension-inversa-en-maquina", null, "Maquina", new[] { "extension_de_cadera" }, "Hiperextensión inversa en máquina", "isquiotibiales", new[] { "gluteo", "espalda_baja" }, "Isquiotibiales", 61 },
                    { "jalon-al-pecho-con-agarre-cerrado-o-neutro", null, "Maquina", new[] { "traccion_vertical" }, "Jalón al pecho con agarre cerrado o neutro", "espalda", new[] { "biceps", "antebrazos" }, "Espalda", 16 },
                    { "jalon-al-pecho-polea-alta-agarre-ancho", null, "Maquina", new[] { "traccion_vertical" }, "Jalón al pecho (polea alta, agarre ancho)", "espalda", new[] { "biceps", "antebrazos" }, "Espalda", 15 },
                    { "lenador-en-polea-rotacion", null, "Maquina", new[] { "rotacion_de_tronco" }, "Leñador en polea (rotación)", "abdomen", new[] { "hombro_frontal" }, "Abdomen", 102 },
                    { "pajaros-con-mancuernas-vuelos-posteriores", null, "Mancuernas", new[] { "apertura_posterior", "tronco_inclinado" }, "Pájaros con mancuernas (vuelos posteriores)", "hombro_posterior", new[] { "espalda", "trapecio" }, "Hombros", 31 },
                    { "patada-de-gluteo-en-maquina", null, "Maquina", new[] { "extension_de_cadera" }, "Patada de glúteo en máquina", "gluteo", new[] { "isquiotibiales" }, "Glúteo", 48 },
                    { "patada-de-gluteo-en-polea", null, "Maquina", new[] { "extension_de_cadera" }, "Patada de glúteo en polea", "gluteo", new[] { "isquiotibiales" }, "Glúteo", 47 },
                    { "patada-de-triceps-con-mancuerna", null, "Mancuernas", new[] { "extension_de_codo", "tronco_inclinado" }, "Patada de tríceps con mancuerna", "triceps", new string[0], "Tríceps", 85 },
                    { "peso-muerto-con-piernas-rigidas", "Recta", "Barra", new[] { "extension_de_cadera", "tronco_inclinado", "carga_con_barra_libre" }, "Peso muerto con piernas rígidas", "isquiotibiales", new[] { "gluteo", "espalda_baja" }, "Isquiotibiales", 58 },
                    { "peso-muerto-rumano-con-barra", "Recta", "Barra", new[] { "extension_de_cadera", "tronco_inclinado", "carga_con_barra_libre" }, "Peso muerto rumano con barra", "gluteo", new[] { "isquiotibiales", "espalda_baja" }, "Glúteo", 50 },
                    { "peso-muerto-rumano-con-mancuernas", null, "Mancuernas", new[] { "extension_de_cadera", "tronco_inclinado" }, "Peso muerto rumano con mancuernas", "isquiotibiales", new[] { "gluteo", "espalda_baja" }, "Isquiotibiales", 57 },
                    { "plancha", null, "PesoCorporal", new[] { "isometrico_de_core" }, "Plancha", "abdomen", new[] { "hombro_frontal" }, "Abdomen", 98 },
                    { "plancha-lateral", null, "PesoCorporal", new[] { "isometrico_de_core" }, "Plancha lateral", "abdomen", new[] { "hombro_lateral" }, "Abdomen", 99 },
                    { "prensa-de-piernas-45", null, "Maquina", new[] { "flexion_profunda_de_rodilla", "flexion_profunda_de_cadera" }, "Prensa de piernas (45°)", "cuadriceps", new[] { "gluteo", "isquiotibiales" }, "Cuádriceps", 38 },
                    { "prensa-de-piernas-90", null, "Maquina", new[] { "flexion_profunda_de_rodilla", "flexion_profunda_de_cadera" }, "Prensa de piernas (90°)", "cuadriceps", new[] { "gluteo", "isquiotibiales" }, "Cuádriceps", 39 },
                    { "press-cerrado-con-barra", "Recta", "Barra", new[] { "empuje_horizontal", "extension_de_codo", "carga_con_barra_libre" }, "Press cerrado con barra", "triceps", new[] { "pecho", "hombro_frontal" }, "Tríceps", 83 },
                    { "press-de-hombros-con-mancuernas", null, "Mancuernas", new[] { "empuje_sobre_la_cabeza" }, "Press de hombros con mancuernas", "hombro_frontal", new[] { "triceps", "trapecio" }, "Hombros", 25 },
                    { "press-de-hombros-en-maquina", null, "Maquina", new[] { "empuje_sobre_la_cabeza" }, "Press de hombros en máquina", "hombro_frontal", new[] { "triceps" }, "Hombros", 26 },
                    { "press-de-pecho-en-maquina", null, "Maquina", new[] { "empuje_horizontal" }, "Press de pecho en máquina", "pecho", new[] { "hombro_frontal", "triceps" }, "Pecho", 8 },
                    { "press-declinado-con-barra", "Recta", "Barra", new[] { "empuje_declinado", "carga_con_barra_libre" }, "Press declinado con barra", "pecho", new[] { "triceps" }, "Pecho", 5 },
                    { "press-declinado-con-mancuernas", null, "Mancuernas", new[] { "empuje_declinado" }, "Press declinado con mancuernas", "pecho", new[] { "triceps" }, "Pecho", 6 },
                    { "press-frances-con-barra-z", "Z", "Barra", new[] { "extension_de_codo", "carga_con_barra_libre" }, "Press francés con barra Z", "triceps", new string[0], "Tríceps", 77 },
                    { "press-frances-con-mancuernas", null, "Mancuernas", new[] { "extension_de_codo" }, "Press francés con mancuernas", "triceps", new string[0], "Tríceps", 78 },
                    { "press-inclinado-con-barra", "Recta", "Barra", new[] { "empuje_inclinado", "carga_con_barra_libre" }, "Press inclinado con barra", "pecho", new[] { "hombro_frontal", "triceps" }, "Pecho", 3 },
                    { "press-inclinado-con-mancuernas", null, "Mancuernas", new[] { "empuje_inclinado" }, "Press inclinado con mancuernas", "pecho", new[] { "hombro_frontal", "triceps" }, "Pecho", 4 },
                    { "press-inclinado-en-maquina", null, "Maquina", new[] { "empuje_inclinado" }, "Press inclinado en máquina", "pecho", new[] { "hombro_frontal", "triceps" }, "Pecho", 7 },
                    { "press-militar-con-barra", "Recta", "Barra", new[] { "empuje_sobre_la_cabeza", "carga_axial", "carga_con_barra_libre" }, "Press militar con barra", "hombro_frontal", new[] { "triceps", "trapecio" }, "Hombros", 24 },
                    { "press-plano-con-barra", "Recta", "Barra", new[] { "empuje_horizontal", "carga_con_barra_libre" }, "Press plano con barra", "pecho", new[] { "hombro_frontal", "triceps" }, "Pecho", 1 },
                    { "press-plano-con-mancuernas", null, "Mancuernas", new[] { "empuje_horizontal" }, "Press plano con mancuernas", "pecho", new[] { "hombro_frontal", "triceps" }, "Pecho", 2 },
                    { "puente-de-gluteo-con-barra", "Recta", "Barra", new[] { "extension_de_cadera", "carga_con_barra_libre" }, "Puente de glúteo con barra", "gluteo", new[] { "isquiotibiales" }, "Glúteo", 46 },
                    { "pullover-en-polea-o-con-mancuerna", null, "Maquina", new[] { "extension_de_hombro" }, "Pullover en polea o con mancuerna", "espalda", new[] { "pecho", "triceps" }, "Espalda", 22 },
                    { "remo-con-barra", "Recta", "Barra", new[] { "traccion_horizontal", "tronco_inclinado", "carga_con_barra_libre" }, "Remo con barra", "espalda", new[] { "biceps", "espalda_baja" }, "Espalda", 17 },
                    { "remo-con-mancuerna-a-una-mano", null, "Mancuernas", new[] { "traccion_horizontal" }, "Remo con mancuerna a una mano", "espalda", new[] { "biceps" }, "Espalda", 18 },
                    { "remo-en-maquina", null, "Maquina", new[] { "traccion_horizontal" }, "Remo en máquina", "espalda", new[] { "biceps" }, "Espalda", 20 },
                    { "remo-en-polea-baja-sentado", null, "Maquina", new[] { "traccion_horizontal" }, "Remo en polea baja (sentado)", "espalda", new[] { "biceps" }, "Espalda", 19 },
                    { "remo-en-t", "RemoEnT", "Barra", new[] { "traccion_horizontal", "tronco_inclinado" }, "Remo en T", "espalda", new[] { "biceps", "espalda_baja" }, "Espalda", 21 },
                    { "rueda-abdominal", null, "PesoCorporal", new[] { "isometrico_de_core", "extension_de_hombro" }, "Rueda abdominal", "abdomen", new[] { "espalda_baja", "hombro_frontal" }, "Abdomen", 100 },
                    { "sentadilla-bulgara-con-mancuernas", null, "Mancuernas", new[] { "flexion_profunda_de_rodilla", "flexion_profunda_de_cadera" }, "Sentadilla búlgara con mancuernas", "cuadriceps", new[] { "gluteo" }, "Cuádriceps", 42 },
                    { "sentadilla-con-barra", "Recta", "Barra", new[] { "flexion_profunda_de_rodilla", "flexion_profunda_de_cadera", "carga_axial", "carga_con_barra_libre" }, "Sentadilla con barra", "cuadriceps", new[] { "gluteo", "isquiotibiales", "espalda_baja" }, "Cuádriceps", 34 },
                    { "sentadilla-en-maquina-smith", "Smith", "Barra", new[] { "flexion_profunda_de_rodilla", "flexion_profunda_de_cadera", "carga_axial" }, "Sentadilla en máquina Smith", "cuadriceps", new[] { "gluteo" }, "Cuádriceps", 36 },
                    { "sentadilla-frontal-con-barra", "Recta", "Barra", new[] { "flexion_profunda_de_rodilla", "flexion_profunda_de_cadera", "carga_axial", "carga_con_barra_libre" }, "Sentadilla frontal con barra", "cuadriceps", new[] { "gluteo", "abdomen" }, "Cuádriceps", 35 },
                    { "sentadilla-hack-en-maquina", null, "Maquina", new[] { "flexion_profunda_de_rodilla", "flexion_profunda_de_cadera" }, "Sentadilla hack en máquina", "cuadriceps", new[] { "gluteo" }, "Cuádriceps", 37 },
                    { "sentadilla-sumo-con-mancuerna", null, "Mancuernas", new[] { "flexion_profunda_de_cadera", "flexion_profunda_de_rodilla" }, "Sentadilla sumo con mancuerna", "gluteo", new[] { "cuadriceps", "aductores" }, "Glúteo", 51 },
                    { "sissy-squat", null, "PesoCorporal", new[] { "flexion_profunda_de_rodilla" }, "Sissy squat", "cuadriceps", new string[0], "Cuádriceps", 43 },
                    { "zancada-caminando-con-mancuernas", null, "Mancuernas", new[] { "flexion_profunda_de_cadera", "flexion_profunda_de_rodilla" }, "Zancada caminando con mancuernas", "gluteo", new[] { "cuadriceps", "isquiotibiales" }, "Glúteo", 52 },
                    { "zancadas-con-mancuernas", null, "Mancuernas", new[] { "flexion_profunda_de_rodilla", "flexion_profunda_de_cadera" }, "Zancadas con mancuernas", "cuadriceps", new[] { "gluteo", "isquiotibiales" }, "Cuádriceps", 41 }
                });

            migrationBuilder.CreateIndex(
                name: "IX_exercises_SortOrder",
                table: "exercises",
                column: "SortOrder");

            migrationBuilder.CreateIndex(
                name: "IX_plan_entries_ExerciseId",
                table: "plan_entries",
                column: "ExerciseId");

            migrationBuilder.CreateIndex(
                name: "IX_plan_entries_UserId_Day_Order",
                table: "plan_entries",
                columns: new[] { "UserId", "Day", "Order" });

            migrationBuilder.CreateIndex(
                name: "IX_restrictions_UserId",
                table: "restrictions",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "equipment_settings");

            migrationBuilder.DropTable(
                name: "plan_entries");

            migrationBuilder.DropTable(
                name: "restrictions");

            migrationBuilder.DropTable(
                name: "exercises");
        }
    }
}
