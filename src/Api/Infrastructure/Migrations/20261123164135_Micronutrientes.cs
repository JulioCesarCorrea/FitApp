using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FitnessApp.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Micronutrientes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "FiberPer100g",
                table: "foods",
                type: "numeric(7,1)",
                precision: 7,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SodiumMgPer100g",
                table: "foods",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "SugarsPer100g",
                table: "foods",
                type: "numeric(7,1)",
                precision: 7,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "FiberG",
                table: "food_entries",
                type: "numeric(8,1)",
                precision: 8,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SodiumMg",
                table: "food_entries",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "SugarsG",
                table: "food_entries",
                type: "numeric(8,1)",
                precision: 8,
                scale: 1,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "water_entries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Ml = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_water_entries", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_water_entries_UserId_Date",
                table: "water_entries",
                columns: new[] { "UserId", "Date" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "water_entries");

            migrationBuilder.DropColumn(
                name: "FiberPer100g",
                table: "foods");

            migrationBuilder.DropColumn(
                name: "SodiumMgPer100g",
                table: "foods");

            migrationBuilder.DropColumn(
                name: "SugarsPer100g",
                table: "foods");

            migrationBuilder.DropColumn(
                name: "FiberG",
                table: "food_entries");

            migrationBuilder.DropColumn(
                name: "SodiumMg",
                table: "food_entries");

            migrationBuilder.DropColumn(
                name: "SugarsG",
                table: "food_entries");
        }
    }
}
