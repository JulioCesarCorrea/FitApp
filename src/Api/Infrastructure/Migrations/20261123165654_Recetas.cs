using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FitnessApp.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Recetas : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "RecipeId",
                table: "food_entries",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Servings",
                table: "food_entries",
                type: "numeric(6,2)",
                precision: 6,
                scale: 2,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "recipes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Servings = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_recipes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "recipe_ingredients",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipeId = table.Column<Guid>(type: "uuid", nullable: false),
                    FoodId = table.Column<Guid>(type: "uuid", nullable: true),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Grams = table.Column<int>(type: "integer", nullable: false),
                    KcalPer100g = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: false),
                    ProteinPer100g = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: false),
                    FatPer100g = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: false),
                    CarbsPer100g = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: false),
                    FiberPer100g = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: true),
                    SugarsPer100g = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: true),
                    SodiumMgPer100g = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_recipe_ingredients", x => x.Id);
                    table.ForeignKey(
                        name: "FK_recipe_ingredients_foods_FoodId",
                        column: x => x.FoodId,
                        principalTable: "foods",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_recipe_ingredients_recipes_RecipeId",
                        column: x => x.RecipeId,
                        principalTable: "recipes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_food_entries_RecipeId",
                table: "food_entries",
                column: "RecipeId");

            migrationBuilder.CreateIndex(
                name: "IX_recipe_ingredients_FoodId",
                table: "recipe_ingredients",
                column: "FoodId");

            migrationBuilder.CreateIndex(
                name: "IX_recipe_ingredients_RecipeId",
                table: "recipe_ingredients",
                column: "RecipeId");

            migrationBuilder.CreateIndex(
                name: "IX_recipes_UserId",
                table: "recipes",
                column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_food_entries_recipes_RecipeId",
                table: "food_entries",
                column: "RecipeId",
                principalTable: "recipes",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_food_entries_recipes_RecipeId",
                table: "food_entries");

            migrationBuilder.DropTable(
                name: "recipe_ingredients");

            migrationBuilder.DropTable(
                name: "recipes");

            migrationBuilder.DropIndex(
                name: "IX_food_entries_RecipeId",
                table: "food_entries");

            migrationBuilder.DropColumn(
                name: "RecipeId",
                table: "food_entries");

            migrationBuilder.DropColumn(
                name: "Servings",
                table: "food_entries");
        }
    }
}
