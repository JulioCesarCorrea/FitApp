using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FitnessApp.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ContextoPersonal : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "context_items",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Brand = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    Dose = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    Frequency = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    StartedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    EndedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    Note = table.Column<string>(type: "character varying(280)", maxLength: 280, nullable: true),
                    ShareWithAi = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_context_items", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_context_items_UserId",
                table: "context_items",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "context_items");
        }
    }
}
