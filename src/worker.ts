import { logger } from './utils/logger';
import { pollWorker } from './queues/workers/pollWorker';
import { analyzeWorker } from './queues/workers/analyzeWorker';

logger.info({ event: 'worker_start' }, 'Worker container process booted globally');

pollWorker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, workspaceId: job?.data?.workspaceId, err: err.message }, 
    'PollWorker Job encountered a fatal delay/error and will retry'
  );
});

analyzeWorker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, workspaceId: job?.data?.workspaceId, err: err.message }, 
    'AnalyzeWorker Job effectively failed and will retry'
  );
});
