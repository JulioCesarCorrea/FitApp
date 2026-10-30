using FitnessApp.Api.Domain;
using FitnessApp.Api.Domain.Auth;
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
