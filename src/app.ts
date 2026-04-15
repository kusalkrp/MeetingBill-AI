import express from 'express';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { App, ExpressReceiver } from '@slack/bolt';
import { env } from './config/env';
import { logger } from './utils/logger';
import { slackOAuthRouter } from './slack/oauth';
import { googleAuthRouter } from './routes/auth';
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
receiver.router.use(helmet());

// Apply Webhook Limiters (Phase 12 explicit setup early)
receiver.router.use('/slack/events', slackWebhookLimiter);
receiver.router.use('/slack/interactions', slackWebhookLimiter);

// 3. Initialize Bolt App (HTTP Mode automatically handled by receiver)
export const slackApp = new App({
  receiver,
  // We mock authorize temporarily until Phase 11 where advanced multi-tenant mapping occurs
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

// 4. Mount OAuth routes
receiver.router.use(slackOAuthRouter);
receiver.router.use(googleAuthRouter);

// Health Endpoint
receiver.router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

(async () => {
  // Start Bolt App
  await slackApp.start(3000);
  logger.info({ event: 'server_start', port: 3000 }, 'MeetingBill Bolt server running tightly bound with Express on port 3000');
})();
