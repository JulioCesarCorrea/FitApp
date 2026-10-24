namespace FitnessApp.Api.Domain;

public class WeightEntry
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public decimal WeightKg { get; set; }
    public DateTimeOffset MeasuredAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
