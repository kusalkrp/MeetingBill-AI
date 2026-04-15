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

import { notifyWorker } from './queues/workers/notifyWorker';
import { digestWorker } from './queues/workers/digestWorker';
import { startSchedulers } from './scheduler';
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.2
  });
}

notifyWorker.on('failed', (job, err) => {
  Sentry.captureException(err, { tags: { workspaceId: job?.data?.workspaceId } });
  logger.error(
    { jobId: job?.id, workspaceId: job?.data?.workspaceId, err: err.message }, 
    'NotifyWorker Job failed to securely emit Slack Message layout'
  );
});

digestWorker.on('failed', (job, err) => {
  Sentry.captureException(err, { tags: { workspaceId: job?.data?.workspaceId } });
  logger.error(
    { jobId: job?.id, workspaceId: job?.data?.workspaceId, err: err.message }, 
    'DigestWorker failed its extremely tight computational boundaries'
  );
});

pollWorker.on('failed', (job, err) => {
  Sentry.captureException(err, { tags: { workspaceId: job?.data?.workspaceId } });
});

analyzeWorker.on('failed', (job, err) => {
  Sentry.captureException(err, { tags: { workspaceId: job?.data?.workspaceId } });
});

// Boot Background Cron Schedulers
startSchedulers();
