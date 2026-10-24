using FitnessApp.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace FitnessApp.Api.Infrastructure;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<WeightEntry> Weights => Set<WeightEntry>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<WeightEntry>(e =>
        {
            e.ToTable("weight_entries");
            e.HasKey(x => x.Id);
            e.Property(x => x.WeightKg).HasPrecision(5, 2);
            e.HasIndex(x => new { x.UserId, x.MeasuredAt });
        });
    }
}
