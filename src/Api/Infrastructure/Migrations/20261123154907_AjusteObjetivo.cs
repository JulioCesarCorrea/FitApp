using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FitnessApp.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AjusteObjetivo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "nutrition_target_overrides",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Calories = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_nutrition_target_overrides", x => x.UserId);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "nutrition_target_overrides");
        }
    }
}
