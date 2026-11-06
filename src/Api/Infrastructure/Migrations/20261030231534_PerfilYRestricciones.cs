using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FitnessApp.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class PerfilYRestricciones : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "profiles",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Sex = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    BirthDate = table.Column<DateOnly>(type: "date", nullable: false),
                    HeightCm = table.Column<int>(type: "integer", nullable: false),
                    Goal = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ActivityLevel = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ExperienceLevel = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    DaysPerWeek = table.Column<int>(type: "integer", nullable: true),
                    Methodology = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Allergies = table.Column<string[]>(type: "text[]", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_profiles", x => x.UserId);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "profiles");
        }
    }
}
