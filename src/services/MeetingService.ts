import { withTenantContext } from '../middleware/tenantContext';

export class MeetingService {
  /**
   * Resolves calendar attendees (emails) to their internal mapped hourly rates.
   * Priority:
   * 1. workspace_members.hourly_rate (via email match)
   * 2. salary_tiers.hourly_rate (by role_name attached to member)
   * 3. $50/hr global fallback
   */
  static async resolveAttendees(workspaceId: string, calendarAttendees: { email: string }[]) {
    const emails = calendarAttendees.map(a => a.email).filter(Boolean);
    
    const members = await withTenantContext(workspaceId, async (tx) => {
      return tx.workspaceMember.findMany({
        where: { slackEmail: { in: emails } },
      });
    });

    const salaryTiers = await withTenantContext(workspaceId, async (tx) => {
      return tx.salaryTier.findMany();
    });

    return emails.map(email => {
      const member = members.find(m => m.slackEmail?.toLowerCase() === email.toLowerCase());
      const slackUserId = member ? member.slackUserId : email; // default to email identifier if unmapped

      let hourlyRate = 50; // Global fallback MVP

      if (member) {
        if (member.hourlyRate) {
          hourlyRate = Number(member.hourlyRate);
        } else if (member.roleName) {
           const tier = salaryTiers.find(t => t.roleName === member.roleName);
           if (tier && tier.hourlyRate) {
             hourlyRate = Number(tier.hourlyRate);
           }
        }
      }

      return {
        slackUserId,
        hourlyRate
      };
    });
  }
}
