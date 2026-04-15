import { prisma } from '../db/prisma';
import { notifyQueue } from '../queues';
import { logger } from '../utils/logger';

export class UsageService {
  static async checkCredits(workspaceId: string): Promise<boolean> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { credits: true, plan: true }
    });
    
    if (!workspace) return false;
    if (workspace.plan === 'pro') return true; 

    return (workspace.credits || 0) > 0;
  }

  static async deductCredit(workspaceId: string, meetingId: string): Promise<void> {
    await prisma.$transaction([
      prisma.workspace.updateMany({
        where: { id: workspaceId, plan: { not: 'pro' } },
        data: { credits: { decrement: 1 } }
      }),
      prisma.usageLog.create({
        data: {
          workspaceId,
          eventType: 'meeting_analyzed',
          creditsUsed: 1,
          metadata: { meetingId }
        }
      })
    ]);

    // Warn admin at low credit thresholds
    const updated = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { credits: true }
    });
    
    if (updated && (updated.credits === 5 || updated.credits === 0)) {
      await notifyQueue.add('low-credits', { workspaceId, creditsLeft: updated.credits });
      logger.info({ workspaceId }, `Low credit warning triggered at ${updated.credits}`);
    }
  }
  
  static async resetMonthlyCredits() {
    await prisma.workspace.updateMany({
      where: { plan: 'starter' },
      data: { credits: 200 }
    });
    await prisma.workspace.updateMany({
      where: { plan: 'growth' },
      data: { credits: 1000 }
    });
    logger.info({ event: 'system_credit_cycle' }, 'Monthly credit resets processed');
  }
}
