import { slackApp } from '../../app';
import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { DigestService } from '../../services/DigestService';
import { buildWeeklyDigestMessage } from '../blocks/weeklyDigest';

slackApp.command('/meetingbill', async ({ command, ack, respond }) => {
  await ack(); // Immediate resolution explicit to Slack standards
  
  const text = command.text.trim().toLowerCase();
  const teamId = command.team_id;

  const workspace = await prisma.workspace.findUnique({ where: { slackTeamId: teamId } });
  if (!workspace) {
    await respond({ text: "Error: Unrecognized architecture footprint mapping against this team UUID." });
    return;
  }

  if (text === 'report') {
    const today = new Date();
    const day = today.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    const weekStart = new Date(today.setDate(today.getDate() + diff));
    weekStart.setHours(0,0,0,0);
    
    // Explicit dynamic computation mapping explicitly against exact current baseline trailing data
    const { digest, costDeltaPercent } = await DigestService.buildWeeklyDigest(workspace.id, weekStart);
    
    await respond({
      blocks: buildWeeklyDigestMessage(digest, costDeltaPercent),
      response_type: "ephemeral"
    });

  } else if (text === 'setup') {
    // Link structure natively directly mapping straight back directly to the local slack client App page
    await respond({
      text: `Access the natively bundled MeetingBill Executive Configuration interface here: slack://app?team=${teamId}&id=${env.SLACK_CLIENT_ID}&tab=home`,
      response_type: "ephemeral"
    });

  } else if (text === 'credits') {
    await respond({
      text: `💸 MeetingBill Analytical Credits Pipeline:\n\n*Credits Remaining:* ${workspace.credits}\n*Current Plan License Tier:* ${workspace.plan?.toUpperCase()}`,
      response_type: "ephemeral"
    });

  } else if (text === 'connect') {
    await respond({
      text: `Bind Google Organizational credentials dynamically against this node link layer here:\n\n${env.APP_URL}/auth/google?workspaceId=${workspace.id}`,
      response_type: "ephemeral"
    });

  } else {
    // Catch-All -> Render the Help Menu
    await respond({
      text: "⚡ *MeetingBill Executive Global Commands*\n\n• `/meetingbill report` - Process purely active trailing baseline snapshot Rollup.\n• `/meetingbill credits` - View mathematically explicitly accurate execution quotas remaining.\n• `/meetingbill setup` - Gain direct App Home administrative payload access.\n• `/meetingbill connect` - Open master proxy credentials pipeline connection.",
      response_type: "ephemeral"
    });
  }
});
