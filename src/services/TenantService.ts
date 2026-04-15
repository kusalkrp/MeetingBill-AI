import { prisma } from '../db/prisma';
import { Prisma } from '@prisma/client';
import { encrypt } from '../utils/encryption';
import { logger } from '../utils/logger';
import { NotificationService } from './NotificationService';
import { pollQueue, scheduleWorkspacePoller, removeWorkspacePoller } from '../queues';

export class TenantService {
  /**
   * Called after a successful Slack App installation
   */
  static async provisionWorkspace(slackTeamId: string, botToken: string, adminSlackId: string) {
    const workspace = await prisma.workspace.upsert({
      where: { slackTeamId },
      create: {
        slackTeamId,
        slackTeamName: 'Unknown', // Ideally fetched via Slack API
        botToken: encrypt(botToken),
        adminSlackId,
        plan: 'free',
        credits: 20,
        onboardingState: 'pending',
        isActive: true,
      },
      update: {
        botToken: encrypt(botToken),
        adminSlackId,
        isActive: true,
      }
    });

    await NotificationService.sendWelcomeDM(workspace.id, adminSlackId);
    logger.info({ workspaceId: workspace.id, event: 'workspace_provisioned' }, 'Workspace successfully provisioned');
    return workspace;
  }

  static async onCalendarConnected(workspaceId: string) {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { googleConnected: true, onboardingState: 'calendar_connected' }
    });
    
    await scheduleWorkspacePoller(workspaceId);
    await NotificationService.sendCalendarConnectedDM(workspaceId);
    logger.info({ workspaceId, event: 'calendar_connected' }, 'Google calendar connected');
  }

  static async onTiersSet(workspaceId: string) {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { onboardingState: 'complete' }
    });
    
    await NotificationService.sendOnboardingCompleteDM(workspaceId);
    logger.info({ workspaceId, event: 'tiers_set' }, 'Salary tiers configured');
  }

  /**
   * Called when the app_uninstalled webhook fires from Slack
   */
  static async deprovisionWorkspace(workspaceId: string) {
    // Remove BullMQ repeatable poller job securely
    await removeWorkspacePoller(workspaceId);
    
    // Soft delete workspace
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { 
        isActive: false, 
        googleTokens: Prisma.DbNull, 
        botToken: '' // Erase token just to be safe, or leave it encrypted but invalid
      }
    });
    
    logger.info({ workspaceId, event: 'workspace_deprovisioned' }, 'Workspace successfully deprovisioned');
  }
}
