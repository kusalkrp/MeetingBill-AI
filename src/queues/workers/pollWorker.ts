import { Worker } from 'bullmq';
import { redis } from '../../config/redis';
import { logger } from '../../utils/logger';
import { fetchRecentlyEndedMeetings } from '../../google/calendar';
import { analyzeQueue } from '../index';

export const pollWorker = new Worker(
  'meeting:poll',
  async (job) => {
    const { workspaceId } = job.data;
    
    // Attempt to fetch 5 min ago calendar events
    const events = await fetchRecentlyEndedMeetings(workspaceId);

    logger.info({ workspaceId, eventCount: events.length }, 'Polled calendar events automatically');

    for (const event of events) {
      // Dedup check natively via jobId. analyzeQueue enforces uniqueness based on event.id 
      await analyzeQueue.add(`analyze-${event.id}`, {
        workspaceId,
        googleEventId: event.id,
        eventData: event
      }, {
        jobId: `analyze-${workspaceId}-${event.id}` 
      });
    }
  },
  {
    connection: redis,
    concurrency: 50 // Handles 50 simultaneous workspaces being polled
  }
);
