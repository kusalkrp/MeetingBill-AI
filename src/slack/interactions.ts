import { slackApp } from '../app';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// When the user clicks the "Connect Calendar" button from Welcome
slackApp.action('connect_google_calendar', async ({ ack, body, client }) => {
  await ack();
  
  if (body.type !== 'block_actions') return;

  const teamId = body.team?.id;
  if (!teamId) return;
  
  const workspace = await prisma.workspace.findUnique({
    where: { slackTeamId: teamId }
  });

  if (!workspace) {
    logger.error('Could not map teamId to internal workspace payload while opening calendar link.');
    return;
  }

  // Shoot ephemeral ephemeral authorization link direct to the action-triggering user
  await client.chat.postEphemeral({
    channel: body.channel?.id as string,
    user: body.user.id,
    text: `Please tap this highly secure specific link to authorize your instance:\n\n${env.APP_URL}/auth/google?workspaceId=${workspace.id}`
  });
});

// Cost Summary DM interaction callback (Basic Modal Stub - Extended in Phase 8)
slackApp.action('view_meeting_details', async ({ ack, body, client }) => {
  await ack();

  if (body.type !== 'block_actions') return;

  await client.views.open({
    trigger_id: (body as any).trigger_id, // required to open modal on Slack API
    view: {
      type: 'modal',
      title: { type: 'plain_text', text: 'Financial Breakdown' },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "Retrieving explicit role-mapped data (Coming completely online in Phase 8)..." }
        }
      ]
    }
  });
});
