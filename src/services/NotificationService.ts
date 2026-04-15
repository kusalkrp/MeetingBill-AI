import { logger } from '../utils/logger';

export class NotificationService {
  static async sendWelcomeDM(workspaceId: string, adminSlackId: string) {
    logger.info({ workspaceId, adminSlackId, event: 'send_welcome_dm' }, 'Stub: Sending welcome DM');
    // To be implemented in Phase 7
  }

  static async sendCalendarConnectedDM(workspaceId: string) {
    logger.info({ workspaceId, event: 'send_calendar_connected_dm' }, 'Stub: Sending calendar connected DM');
    // To be implemented in Phase 7
  }

  static async sendOnboardingCompleteDM(workspaceId: string) {
    logger.info({ workspaceId, event: 'send_onboarding_complete_dm' }, 'Stub: Sending onboarding complete DM');
    // To be implemented in Phase 7
  }

  static async sendUpgradeNudge(workspaceId: string) {
    logger.info({ workspaceId, event: 'send_upgrade_nudge' }, 'Stub: Sending upgrade nudge');
  }
}
