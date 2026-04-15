import { logger } from './utils/logger';

logger.info({ event: 'worker_start' }, 'Worker process started successfully');

// Keep the process running
setInterval(() => {
  // no-op
}, 1000 * 60 * 60);
