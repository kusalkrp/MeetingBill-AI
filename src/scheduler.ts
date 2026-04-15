import cron from 'node-cron';
import { prisma } from './db/prisma';
import { digestQueue } from './queues';
import { UsageService } from './services/UsageService';
import { logger } from './utils/logger';

export function startSchedulers() {
  // 1. Weekly Digest Loop (Runs automatically every absolute Monday at precisely 8:00 AM UTC/Server)
  cron.schedule('0 8 * * 1', async () => {
    logger.info({ event: 'cron_weekly_digest' }, 'Cron triggered: Executing global Weekly Digest loop sequence against all Active Workspaces');
    
    const workspaces = await prisma.workspace.findMany({
      where: { isActive: true }
    });
    
    // Mathematically offset back exactly down to Previous Monday 00:00:00 boundary mapping
    const today = new Date();
    const day = today.getDay(); 
    const diff = (day === 0 ? -6 : 1) - day;
    const weekStart = new Date(today.setDate(today.getDate() + diff));
    weekStart.setHours(0,0,0,0);
    const lastWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);

    for (const w of workspaces) {
      // Deduplicating via explicitly scoped JobID targeting timeframe + UUID
      await digestQueue.add(`digest-${w.id}`, {
        workspaceId: w.id,
        weekStartString: lastWeekStart.toISOString()
      }, {
        jobId: `digest-${w.id}-${lastWeekStart.toISOString()}`
      });
    }
  });

  // 2. Billing/Credits Quota Pipeline Refill (Automatic exact month swap execution mapping)
  cron.schedule('0 0 1 * *', async () => {
    logger.info({ event: 'cron_credit_reset' }, 'Cron triggered: Firing UsageService Credit Restoration loops');
    await UsageService.resetMonthlyCredits();
  });
  
  logger.info({ event: 'scheduler_started' }, 'MeetingBill Central System Cron Schedulers are successfully bound and actively monitoring background flows.');
}
