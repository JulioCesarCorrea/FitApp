using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FitnessApp.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Metodologia4x15 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Methodology",
                table: "exercise_logs",
                type: "character varying(40)",
                maxLength: 40,
                nullable: false,
                defaultValue: "heavy_duty_personalizado");

            migrationBuilder.AddColumn<int[]>(
                name: "RepsPerSet",
                table: "exercise_logs",
                type: "integer[]",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Methodology",
                table: "exercise_logs");

            migrationBuilder.DropColumn(
                name: "RepsPerSet",
                table: "exercise_logs");
        }
    }
}
