import { notifyQueue } from '../queues';
import { logger } from '../utils/logger';

export class NotificationService {
  static async sendWelcomeDM(workspaceId: string, adminSlackId: string) {
    await notifyQueue.add('send-welcome-dm', { workspaceId, slackUserId: adminSlackId });
    logger.info({ workspaceId, adminSlackId }, 'Queued welcome DM successfully');
  }

  static async sendCalendarConnectedDM(workspaceId: string) {
    await notifyQueue.add('send-calendar-connected', { workspaceId });
  }

  static async sendOnboardingCompleteDM(workspaceId: string) {
    await notifyQueue.add('send-onboarding-complete', { workspaceId });
  }

  static async sendUpgradeNudge(workspaceId: string) {
    await notifyQueue.add('send-upgrade-nudge', { workspaceId });
  }
}
