import { Queue } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';

export const pollQueue = new Queue('meeting_poll', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
  }
});

export const analyzeQueue = new Queue('meeting_analyze', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 200,
  }
});

export const notifyQueue = new Queue('meeting_notify', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'fixed', delay: 2000 },
    removeOnComplete: 500,
  }
});

export const digestQueue = new Queue('meeting_digest', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
  }
});

export async function scheduleWorkspacePoller(workspaceId: string) {
  const jobId = `poll-${workspaceId}`;
  await pollQueue.add(
    jobId,
    { workspaceId },
    {
      repeat: { every: 300_000 }, // Repeat every 5 minutes
      jobId, 
    }
  );
  logger.info({ workspaceId, event: 'poller_scheduled' }, 'Scheduled recurring 5-min poll job');
}

export async function removeWorkspacePoller(workspaceId: string) {
  const jobId = `poll-${workspaceId}`;
  await pollQueue.removeRepeatable(jobId, { every: 300_000 });
  logger.info({ workspaceId, event: 'poller_removed' }, 'Removed recurring poll job');
}
