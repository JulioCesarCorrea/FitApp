using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FitnessApp.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Nutricion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "foods",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Brand = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    Barcode = table.Column<string>(type: "character varying(14)", maxLength: 14, nullable: true),
                    KcalPer100g = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: false),
                    ProteinPer100g = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: false),
                    FatPer100g = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: false),
                    CarbsPer100g = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: false),
                    Source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_foods", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "food_entries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Meal = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    FoodId = table.Column<Guid>(type: "uuid", nullable: true),
                    Grams = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Kcal = table.Column<int>(type: "integer", nullable: false),
                    ProteinG = table.Column<decimal>(type: "numeric(8,1)", precision: 8, scale: 1, nullable: false),
                    FatG = table.Column<decimal>(type: "numeric(8,1)", precision: 8, scale: 1, nullable: false),
                    CarbsG = table.Column<decimal>(type: "numeric(8,1)", precision: 8, scale: 1, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_food_entries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_food_entries_foods_FoodId",
                        column: x => x.FoodId,
                        principalTable: "foods",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_food_entries_FoodId",
                table: "food_entries",
                column: "FoodId");

            migrationBuilder.CreateIndex(
                name: "IX_food_entries_UserId_Date",
                table: "food_entries",
                columns: new[] { "UserId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_foods_UserId_Barcode",
                table: "foods",
                columns: new[] { "UserId", "Barcode" },
                unique: true,
                filter: "\"Barcode\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "food_entries");

            migrationBuilder.DropTable(
                name: "foods");
        }
    }
}
