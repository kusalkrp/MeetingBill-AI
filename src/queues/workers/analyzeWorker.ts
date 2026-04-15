import { Worker } from 'bullmq';
import { redis } from '../../config/redis';
import { NotificationService } from '../../services/NotificationService';
import { UsageService } from '../../services/UsageService';
import { MeetingService } from '../../services/MeetingService';
import { CostEngine } from '../../services/CostEngine';
import { withTenantContext } from '../../middleware/tenantContext';
import { notifyQueue } from '../index';
import { logger } from '../../utils/logger';

export const analyzeWorker = new Worker(
  'meeting:analyze',
  async (job) => {
    const { workspaceId, googleEventId, eventData } = job.data;

    // 1. Enforce Quota Usage Boundaries
    const hasCredits = await UsageService.checkCredits(workspaceId);
    if (!hasCredits) {
      await NotificationService.sendUpgradeNudge(workspaceId);
      logger.info({ workspaceId, googleEventId }, 'Analysis skipped — Zero credits remaining pipeline blocked');
      return;
    }

    // 2. Safely resolve attendee emails back to Slack accounts + Rates
    const attendees = await MeetingService.resolveAttendees(workspaceId, eventData.attendees);

    // 3. Compute pure cost mathematicals
    const costResult = CostEngine.calculate(eventData.durationMinutes, attendees);

    // 4. Secure Insert under RLS
    const meeting = await withTenantContext(workspaceId, async (tx) => {
      // Dedup protection natively via RLS context
      const existing = await tx.meeting.findUnique({
        where: { workspaceId_googleEventId: { workspaceId, googleEventId } }
      });

      if (existing) {
         return tx.meeting.update({
            where: { id: existing.id },
            data: {
              estimatedCost: costResult.totalCost,
              costBreakdown: costResult.breakdown as any, // Cast breakdown for Prisma Json output
            }
         });
      }

      return tx.meeting.create({
        data: {
          workspaceId,
          googleEventId,
          title: eventData.title,
          organizerSlackId: eventData.organizerEmail || 'unknown',
          startTime: new Date(eventData.startTime),
          endTime: new Date(eventData.endTime),
          durationMins: eventData.durationMinutes,
          attendeeCount: attendees.length,
          estimatedCost: costResult.totalCost,
          costBreakdown: costResult.breakdown as any,
          dmSent: false
        }
      });
    });

    // 5. Debit the workspace account explicitly 
    await UsageService.deductCredit(workspaceId, meeting.id);

    // 6. Chain up standard DM reporting hook
    await notifyQueue.add('send-dm', {
      workspaceId,
      meetingId: meeting.id,
      slackUserId: meeting.organizerSlackId, // Points strictly to the organizer
      costResult
    });
  },
  {
    connection: redis,
    concurrency: 20, 
    limiter: {
      max: 50,                // Hard throttle: Absolute max 50 jobs
      duration: 10000         // Per 10 seconds globally 
    }
  }
);
