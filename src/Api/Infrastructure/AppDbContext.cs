using FitnessApp.Api.Domain;
using FitnessApp.Api.Domain.Ai;
using FitnessApp.Api.Domain.Auth;
using FitnessApp.Api.Domain.Nutrition;
using FitnessApp.Api.Domain.Profile;
using FitnessApp.Api.Domain.Training;
using FitnessApp.Api.Infrastructure.Seed;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Infrastructure;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<WeightEntry> Weights => Set<WeightEntry>();
    public DbSet<CatalogExercise> Exercises => Set<CatalogExercise>();
    public DbSet<PlanEntry> PlanEntries => Set<PlanEntry>();
    public DbSet<EquipmentSettings> Equipment => Set<EquipmentSettings>();
    public DbSet<UserRestriction> Restrictions => Set<UserRestriction>();
    public DbSet<ExerciseLogEntry> ExerciseLogs => Set<ExerciseLogEntry>();
    public DbSet<TrainingSettings> TrainingSettings => Set<TrainingSettings>();
    public DbSet<UserProfile> Profiles => Set<UserProfile>();
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<SuggestionDismissal> SuggestionDismissals => Set<SuggestionDismissal>();
    public DbSet<Food> Foods => Set<Food>();
    public DbSet<FoodEntry> FoodEntries => Set<FoodEntry>();
    public DbSet<TargetOverride> TargetOverrides => Set<TargetOverride>();
    public DbSet<WaterEntry> WaterEntries => Set<WaterEntry>();
    public DbSet<ContextItem> ContextItems => Set<ContextItem>();
    public DbSet<AiConsent> AiConsents => Set<AiConsent>();
    public DbSet<AiAudit> AiAudits => Set<AiAudit>();
    public DbSet<AiProposal> AiProposals => Set<AiProposal>();
    public DbSet<Recipe> Recipes => Set<Recipe>();
    public DbSet<RecipeIngredient> RecipeIngredients => Set<RecipeIngredient>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<WeightEntry>(e =>
        {
            e.ToTable("weight_entries");
            e.HasKey(x => x.Id);
            e.Property(x => x.WeightKg).HasPrecision(5, 2);
            e.HasIndex(x => new { x.UserId, x.MeasuredAt });
        });

        modelBuilder.Entity<CatalogExercise>(e =>
        {
            e.ToTable("exercises");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(120);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Equipment).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Bar).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.SortOrder);
            e.HasData(CatalogSeed.Load());
        });

        modelBuilder.Entity<PlanEntry>(e =>
        {
            e.ToTable("plan_entries");
            e.HasKey(x => x.Id);
            e.Property(x => x.ExerciseId).HasMaxLength(120);
            e.Property(x => x.MachineStepKg).HasPrecision(6, 2);
            e.HasIndex(x => new { x.UserId, x.Day, x.Order });
            e.HasOne<CatalogExercise>().WithMany().HasForeignKey(x => x.ExerciseId);
        });

        modelBuilder.Entity<EquipmentSettings>(e =>
        {
            e.ToTable("equipment_settings");
            e.HasKey(x => x.UserId);
            e.Property(x => x.RectaBarKg).HasPrecision(6, 2);
            e.Property(x => x.ZBarKg).HasPrecision(6, 2);
            e.Property(x => x.SmithBarKg).HasPrecision(6, 2);
            e.Property(x => x.RemoEnTBarKg).HasPrecision(6, 2);
            e.Property(x => x.MachineStepKg).HasPrecision(6, 2);
            e.Property(x => x.MachineBaseKg).HasPrecision(6, 2);
        });

        modelBuilder.Entity<ExerciseLogEntry>(e =>
        {
            e.ToTable("exercise_logs");
            e.HasKey(x => x.Id);
            e.Property(x => x.ExerciseId).HasMaxLength(120);
            e.Property(x => x.LoadKg).HasPrecision(7, 2);
            e.Property(x => x.Methodology).HasMaxLength(40).HasDefaultValue("heavy_duty_personalizado");
            // Una fila por persona, ejercicio y fecha (SPEC-training-003, AC-06).
            e.HasIndex(x => new { x.UserId, x.ExerciseId, x.Date }).IsUnique();
            e.HasOne<CatalogExercise>().WithMany().HasForeignKey(x => x.ExerciseId);
        });

        modelBuilder.Entity<TrainingSettings>(e =>
        {
            e.ToTable("training_settings");
            e.HasKey(x => x.UserId);
        });

        modelBuilder.Entity<UserProfile>(e =>
        {
            e.ToTable("profiles");
            e.HasKey(x => x.UserId);
            e.Property(x => x.DisplayName).HasMaxLength(ProfileRules.MaxNameLength);
            e.Property(x => x.Sex).HasMaxLength(20);
            e.Property(x => x.Goal).HasMaxLength(20);
            e.Property(x => x.ActivityLevel).HasMaxLength(20);
            e.Property(x => x.ExperienceLevel).HasMaxLength(20);
            e.Property(x => x.Methodology).HasMaxLength(40);
        });

        modelBuilder.Entity<AppUser>(e =>
        {
            e.ToTable("users");
            e.HasKey(x => x.Id);
            e.Property(x => x.Username).HasMaxLength(30);
            e.Property(x => x.PasswordHash).HasMaxLength(256);
            e.HasIndex(x => x.Username).IsUnique();
        });

        modelBuilder.Entity<RefreshToken>(e =>
        {
            e.ToTable("refresh_tokens");
            e.HasKey(x => x.Id);
            e.Property(x => x.TokenHash).HasMaxLength(64);
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.UserId);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Food>(e =>
        {
            e.ToTable("foods");
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.Brand).HasMaxLength(60);
            e.Property(x => x.Barcode).HasMaxLength(14);
            e.Property(x => x.Source).HasMaxLength(20);
            e.Property(x => x.Allergens).HasDefaultValueSql("'{}'");
            e.Property(x => x.FiberPer100g).HasPrecision(7, 1);
            e.Property(x => x.SugarsPer100g).HasPrecision(7, 1);
            e.Property(x => x.KcalPer100g).HasPrecision(7, 1);
            e.Property(x => x.ProteinPer100g).HasPrecision(7, 1);
            e.Property(x => x.FatPer100g).HasPrecision(7, 1);
            e.Property(x => x.CarbsPer100g).HasPrecision(7, 1);
            // Un código de barras por persona (SPEC-nutrition-001, AC-07); los alimentos sin código no chocan entre sí.
            e.HasIndex(x => new { x.UserId, x.Barcode }).IsUnique().HasFilter("\"Barcode\" IS NOT NULL");
        });

        modelBuilder.Entity<FoodEntry>(e =>
        {
            e.ToTable("food_entries");
            e.HasKey(x => x.Id);
            e.Property(x => x.Meal).HasMaxLength(30);
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.ProteinG).HasPrecision(8, 1);
            e.Property(x => x.FatG).HasPrecision(8, 1);
            e.Property(x => x.CarbsG).HasPrecision(8, 1);
            e.Property(x => x.FiberG).HasPrecision(8, 1);
            e.Property(x => x.Servings).HasPrecision(6, 2);
            // Borrar una receta no borra lo ya comido (SPEC-nutrition-005).
            e.HasOne<Recipe>().WithMany().HasForeignKey(x => x.RecipeId).OnDelete(DeleteBehavior.SetNull);
            e.Property(x => x.SugarsG).HasPrecision(8, 1);
            e.HasIndex(x => new { x.UserId, x.Date });
            // Borrar un alimento no borra lo ya comido: la entrada conserva su copia (AC-09).
            e.HasOne<Food>().WithMany().HasForeignKey(x => x.FoodId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<AiConsent>(e =>
        {
            e.ToTable("ai_consents");
            e.HasKey(x => new { x.UserId, x.Feature });
            e.Property(x => x.Feature).HasMaxLength(30);
        });

        modelBuilder.Entity<AiProposal>(e =>
        {
            e.ToTable("ai_proposals");
            e.HasKey(x => x.Id);
            e.Property(x => x.Scope).HasMaxLength(20);
            e.Property(x => x.Summary).HasMaxLength(500);
            e.Property(x => x.Status).HasMaxLength(10);
            e.HasIndex(x => new { x.UserId, x.CreatedAt });
        });

        modelBuilder.Entity<AiAudit>(e =>
        {
            e.ToTable("ai_audit");
            e.HasKey(x => x.Id);
            e.Property(x => x.Feature).HasMaxLength(30);
            e.Property(x => x.Model).HasMaxLength(80);
            e.Property(x => x.Status).HasMaxLength(10);
            e.Property(x => x.Error).HasMaxLength(500);
            e.Property(x => x.PromptVersion).HasMaxLength(60);
            e.Property(x => x.CostUsd).HasPrecision(12, 6);
            e.HasIndex(x => new { x.UserId, x.CreatedAt });
            e.HasIndex(x => new { x.Model, x.CreatedAt });
        });

        modelBuilder.Entity<Recipe>(e =>
        {
            e.ToTable("recipes");
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(80);
            e.HasIndex(x => x.UserId);
            e.HasMany(x => x.Ingredients).WithOne().HasForeignKey(x => x.RecipeId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RecipeIngredient>(e =>
        {
            e.ToTable("recipe_ingredients");
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.KcalPer100g).HasPrecision(7, 1);
            e.Property(x => x.ProteinPer100g).HasPrecision(7, 1);
            e.Property(x => x.FatPer100g).HasPrecision(7, 1);
            e.Property(x => x.CarbsPer100g).HasPrecision(7, 1);
            e.Property(x => x.FiberPer100g).HasPrecision(7, 1);
            e.Property(x => x.SugarsPer100g).HasPrecision(7, 1);
            // Borrar un alimento no borra la receta: el ingrediente conserva su copia (AC-05).
            e.HasOne<Food>().WithMany().HasForeignKey(x => x.FoodId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<ContextItem>(e =>
        {
            e.ToTable("context_items");
            e.HasKey(x => x.Id);
            e.Property(x => x.Type).HasMaxLength(20);
            e.Property(x => x.Name).HasMaxLength(ContextRules.MaxName);
            e.Property(x => x.Brand).HasMaxLength(ContextRules.MaxBrand);
            e.Property(x => x.Dose).HasMaxLength(ContextRules.MaxDose);
            e.Property(x => x.Frequency).HasMaxLength(20);
            e.Property(x => x.Note).HasMaxLength(ContextRules.MaxNote);
            e.HasIndex(x => x.UserId);
        });

        modelBuilder.Entity<WaterEntry>(e =>
        {
            e.ToTable("water_entries");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.UserId, x.Date });
        });

        modelBuilder.Entity<TargetOverride>(e =>
        {
            e.ToTable("nutrition_target_overrides");
            e.HasKey(x => x.UserId);
        });

        modelBuilder.Entity<SuggestionDismissal>(e =>
        {
            e.ToTable("suggestion_dismissals");
            e.HasKey(x => new { x.UserId, x.Key });
            e.Property(x => x.Key).HasMaxLength(200);
        });

        modelBuilder.Entity<UserRestriction>(e =>
        {
            e.ToTable("restrictions");
            e.HasKey(x => x.Id);
            e.Property(x => x.Zone).HasMaxLength(60);
            e.Property(x => x.Level).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.UserId);
        });
    }
}
