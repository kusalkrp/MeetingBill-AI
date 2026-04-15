import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import { env } from '../config/env';
import { authLimiter } from '../middleware/rateLimiter';
import { encrypt } from '../utils/encryption';
import { TenantService } from '../services/TenantService';
import { prisma } from '../db/prisma';

export const googleAuthRouter = Router();

const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI
);

googleAuthRouter.get('/auth/google', authLimiter, (req, res) => {
  const workspaceId = req.query.workspaceId as string;
  if (!workspaceId) {
    res.status(400).send('workspaceId is required');
    return;
  }

  // Use JWT for state parameter to verify CSRF and compactly pass workspaceId state
  const state = jwt.sign({ workspaceId }, env.JWT_SECRET, { expiresIn: '10m' });

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    state,
  });

  res.redirect(authUrl);
});

googleAuthRouter.get('/auth/google/callback', authLimiter, async (req, res) => {
  const code = req.query.code as string;
  const state = req.query.state as string;

  if (!code || !state) {
    res.status(400).send('Invalid callback parameters. Both code and state are required.');
    return;
  }

  try {
    const decoded = jwt.verify(state, env.JWT_SECRET) as { workspaceId: string };
    const workspaceId = decoded.workspaceId;

    const { tokens } = await oauth2Client.getToken(code);
    
    // Store tokens securely via AES-256
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { googleTokens: encrypt(JSON.stringify(tokens)) }
    });

    // Fire off the Tenant Service hook (starts the polling job)
    await TenantService.onCalendarConnected(workspaceId);

    res.send(`
      <html><body>
        <h2>Google Calendar Connected!</h2>
        <p>MeetingBill AI will now passively monitor calendar events.</p>
      </body></html>
    `);
  } catch (err: any) {
    res.status(401).send('OAuth verification failed or state token expired');
  }
});
