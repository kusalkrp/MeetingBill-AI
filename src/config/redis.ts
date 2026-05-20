import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

// ioredis with maxRetriesPerRequest: null (BullMQ requirement)
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  password: env.REDIS_PASSWORD || undefined,
});

redis.on('ready', () => {
  logger.info({ event: 'redis_connected' }, 'Redis connection established via ioredis');
});

redis.on('error', (err) => {
  logger.error({ event: 'redis_error', error: err.message }, 'Redis connection error');
});
