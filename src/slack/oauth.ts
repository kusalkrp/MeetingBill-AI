import { Router } from 'express';
import { WebClient } from '@slack/web-api';
import { env } from '../config/env';
import { TenantService } from '../services/TenantService';
import { logger } from '../utils/logger';
import { authLimiter } from '../middleware/rateLimiter';
import { prisma } from '../db/prisma';

export const slackOAuthRouter = Router();

slackOAuthRouter.get('/slack/install', authLimiter, (req, res) => {
  const scopes = [
    'chat:write', 'commands', 'app_mentions:read', 'im:write', 
    'users:read', 'users:read.email', 'app_home:read', 'app_home:write'
  ];
  const redirectUri = `${env.APP_URL}/slack/oauth_redirect`;
  const url = `https://slack.com/oauth/v2/authorize?client_id=${env.SLACK_CLIENT_ID}&scope=${scopes.join(',')}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(url);
});

slackOAuthRouter.get('/slack/oauth_redirect', authLimiter, async (req, res) => {
  const code = req.query.code as string;
  
  if (!code) {
    res.status(400).send('OAuth flow failed: no code provided');
    return;
  }

  try {
    const client = new WebClient();
    const result = await client.oauth.v2.access({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: `${env.APP_URL}/slack/oauth_redirect`
    });

    if (result.ok && result.team?.id && result.access_token && result.authed_user?.id) {
      await TenantService.provisionWorkspace(
        result.team.id,
        result.access_token,
        result.authed_user.id
      );

      // In production, we'd grab the team name too from result.team.name
      if (result.team.name) {
        await prisma.workspace.update({
          where: { slackTeamId: result.team.id },
          data: { slackTeamName: result.team.name }
        });
      }

      res.send(`
        <html><body>
          <h2>MeetingBill Installed!</h2>
          <p>Please return to Slack to view your App Home integration.</p>
        </body></html>
      `);
    } else {
      logger.error({ result }, 'Failed to exchange Slack token');
      res.status(500).send('OAuth exchange failed');
    }
  } catch (error: any) {
    logger.error({ err: error.message }, 'Error in Slack OAuth redirect');
    res.status(500).send('Internal Server Error during Slack OAuth');
  }
});
