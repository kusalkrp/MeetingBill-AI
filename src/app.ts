import express from 'express';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { App, ExpressReceiver } from '@slack/bolt';
import { env } from './config/env';
import { logger } from './utils/logger';
import { slackOAuthRouter } from './slack/oauth';
import { googleAuthRouter } from './routes/auth';
import { apiRouter } from './routes/api';
import { slackWebhookLimiter } from './middleware/rateLimiter';
import { TenantService } from './services/TenantService';
import { prisma } from './db/prisma';

// 1. Initialize Sentry (Basic setup as part of Phase 3/12)
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0.2,
    beforeSend(event) {
      if (event.user) delete event.user.email;
      return event;
    }
  });
}

// 2. Initialize ExpressReceiver for Bolt mapped to custom routes
const receiver = new ExpressReceiver({
  signingSecret: env.SLACK_SIGNING_SECRET,
  endpoints: {
    events: '/slack/events',
    actions: '/slack/interactions',
    commands: '/slack/commands'
  }
});

// Middleware attachments
receiver.router.use(express.json()); // Required explicitly for the REST backend API routes
receiver.router.use(helmet());

// Apply Webhook Limiters (Phase 12 explicit setup early)
receiver.router.use('/slack/events', slackWebhookLimiter);
receiver.router.use('/slack/interactions', slackWebhookLimiter);

// 3. Initialize Bolt App (HTTP Mode automatically handled by receiver)
export const slackApp = new App({
  receiver,
  authorize: async ({ teamId }) => {
    return { botToken: 'mock', botId: 'mock' };
  }
});

// Event hook for when app is deleted from a workspace
slackApp.event('app_uninstalled', async ({ body }) => {
  const teamId = body.team_id;
  if (!teamId) return;
  
  const workspace = await prisma.workspace.findUnique({
    where: { slackTeamId: teamId }
  });
  
  if (workspace) {
    await TenantService.deprovisionWorkspace(workspace.id);
  }
});

// 4. Mount Custom Handlers
import './slack/handlers/appHome';
import './slack/interactions';
import './slack/handlers/actions';
import './slack/handlers/commands';

// 5. Mount API Routes
receiver.router.use(slackOAuthRouter);
receiver.router.use(googleAuthRouter);
receiver.router.use(apiRouter);

import { getMetricsRegistry } from './utils/metrics';

// 6. Hardened Telemetry and Health Endpoints
receiver.router.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'verified_active', uptime: process.uptime(), timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'failure', target: 'db_connection_refused' });
  }
});

receiver.router.get('/metrics', async (req, res) => {
  res.set('Content-Type', 'text/plain');
  const payload = await getMetricsRegistry();
  res.send(payload);
});

(async () => {
  // Start Bolt App
  await slackApp.start(3000);
  logger.info({ event: 'server_start', port: 3000 }, 'MeetingBill Bolt server running tightly bound with Express on port 3000');
})();
