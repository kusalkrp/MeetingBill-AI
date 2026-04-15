import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '../utils/logger';

// Prevent multiple instances of Prisma Client in development
declare global {
  var prisma: PrismaClient<Prisma.PrismaClientOptions, 'query' | 'info' | 'warn' | 'error'> | undefined;
}

export const prisma = global.prisma || new PrismaClient<Prisma.PrismaClientOptions, 'query' | 'info' | 'warn' | 'error'>({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'stdout', level: 'error' },
    { emit: 'stdout', level: 'info' },
    { emit: 'stdout', level: 'warn' },
  ],
});

if (process.env.NODE_ENV !== 'production') global.prisma = prisma;

prisma.$on('query', (e) => {
  if (e.duration >= 500) {
    logger.warn({ query: e.query, params: e.params, duration: e.duration }, 'Slow Query Detected (>500ms)');
  }
});
