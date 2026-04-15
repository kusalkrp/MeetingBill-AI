import { google } from 'googleapis';
import { prisma } from '../db/prisma';
import { decrypt, encrypt } from '../utils/encryption';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export async function getCalendarClient(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId }
  });

  if (!workspace || !workspace.googleTokens) {
    throw new Error('Workspace not found or Google Calendar not connected');
  }

  // Tokens are stored encrypted, we must decrypt them to pass into the API Client
  const tokensStr = decrypt(workspace.googleTokens as string);
  const tokens = JSON.parse(tokensStr);

  const oauth2Client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials(tokens);

  // Auto-refresh: Google client triggers 'tokens' hook automatically when access_token is renewed via refresh_token
  oauth2Client.on('tokens', async (newTokens) => {
    logger.info({ workspaceId, event: 'google_token_refresh' }, 'Google Calendar tokens automatically refreshed by API client');
    
    const merged = { ...tokens, ...newTokens };
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { googleTokens: encrypt(JSON.stringify(merged)) }
    });
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}
