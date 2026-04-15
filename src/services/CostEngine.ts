export interface AttendeeInput {
  slackUserId: string;
  hourlyRate: number;
}

export interface CostResult {
  totalCost: number;
  costPerMinute: number;
  breakdown: { slackUserId: string; cost: number; hourlyRate: number }[];
}

export class CostEngine {
  /**
   * Pure function to calculate the dollar cost of a meeting block.
   */
  static calculate(durationMinutes: number, attendees: AttendeeInput[]): CostResult {
    const durationHours = durationMinutes / 60;
    
    const breakdown = attendees.map(a => ({
      slackUserId: a.slackUserId,
      hourlyRate: a.hourlyRate,
      cost: parseFloat((a.hourlyRate * durationHours).toFixed(2))
    }));
    
    const totalCost = parseFloat(breakdown.reduce((sum, a) => sum + a.cost, 0).toFixed(2));
    
    return {
      totalCost,
      costPerMinute: durationMinutes > 0 ? parseFloat((totalCost / durationMinutes).toFixed(4)) : 0,
      breakdown
    };
  }
}
