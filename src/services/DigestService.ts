import { withTenantContext } from '../middleware/tenantContext';
import { Prisma } from '@prisma/client';

export class DigestService {
  static async buildWeeklyDigest(workspaceId: string, weekStart: Date) {
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const priorWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);

    return await withTenantContext(workspaceId, async (tx) => {
      // 1. Fetch this week's meetings strictly
      const meetings = await tx.meeting.findMany({
        where: {
          startTime: { gte: weekStart, lt: weekEnd },
        },
        orderBy: { estimatedCost: 'desc' },
      });

      // 2. Fetch last week's total cost for the exact delta calculation
      const lastWeekMeetings = await tx.meeting.findMany({
        where: {
          startTime: { gte: priorWeekStart, lt: weekStart },
        },
      });

      const totalMeetings = meetings.length;
      const totalCost = meetings.reduce((sum, m) => sum + Number(m.estimatedCost || 0), 0);
      const totalHours = meetings.reduce((sum, m) => sum + m.durationMins, 0) / 60;

      const lastWeekCost = lastWeekMeetings.reduce((sum, m) => sum + Number(m.estimatedCost || 0), 0);
      let costDeltaPercent = 0;
      if (lastWeekCost > 0) {
        costDeltaPercent = ((totalCost - lastWeekCost) / lastWeekCost) * 100;
      }

      // 3. Top 3 Expensive
      const mostExpensive = meetings.slice(0, 3).map(m => ({
        id: m.id,
        title: m.title,
        cost: Number(m.estimatedCost)
      }));

      // 4. Top 3 Async Candidates (Ranked via pure arbitrary burn multiplier logic)
      const asyncCandidates = [...meetings]
        .sort((a, b) => (Number(b.attendeeCount) * Number(b.estimatedCost)) - (Number(a.attendeeCount) * Number(a.estimatedCost)))
        .slice(0, 3)
        .map(m => ({
          id: m.id,
          title: m.title,
          savings: Number(m.estimatedCost)
        }));

      // 5. Upsert Weekly Digest record safely under isolation 
      const digest = await tx.weeklyDigest.upsert({
        where: { workspaceId_weekStart: { workspaceId, weekStart } },
        create: {
          workspaceId,
          weekStart,
          totalMeetings,
          totalCost,
          totalHours,
          mostExpensive: mostExpensive as Prisma.JsonArray,
          asyncCandidates: asyncCandidates as Prisma.JsonArray,
          digestSent: false
        },
        update: {
          totalMeetings,
          totalCost,
          totalHours,
          mostExpensive: mostExpensive as Prisma.JsonArray,
          asyncCandidates: asyncCandidates as Prisma.JsonArray,
        }
      });

      return { digest, costDeltaPercent };
    });
  }
}
