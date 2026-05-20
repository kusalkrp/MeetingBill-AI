import { Worker } from 'bullmq';
import { WebClient } from '@slack/web-api';
import { redis } from '../../config/redis';
import { prisma } from '../../db/prisma';
import { decrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { 
  buildMeetingCostMessage, 
  buildWelcomeMessage, 
  buildUpgradeNudge 
} from '../../slack/messages';

export const notifyWorker = new Worker(
  'meeting_notify',
  async (job) => {
    const { workspaceId, slackUserId, meetingId, costResult } = job.data;
    
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId }
    });

    if (!workspace || !workspace.botToken) {
      throw new Error('Fatal error: strictly requires Workspace initialization with a Slack botToken.');
    }

    const botToken = decrypt(workspace.botToken);
    const client = new WebClient(botToken);
    
    const targetUserId = slackUserId || workspace.adminSlackId;

    if (!targetUserId || targetUserId === 'unknown') {
      logger.warn({ workspaceId, meetingId }, 'No determinable target Slack ID available to receive the payload');
      return;
    }

    switch (job.name) {
      case 'send-welcome-dm':
        await client.chat.postMessage({
          channel: targetUserId,
          text: 'Welcome to MeetingBill AI! Please authorize Google Calendar.',
          blocks: buildWelcomeMessage()
        });
        break;

      case 'send-upgrade-nudge':
        await client.chat.postMessage({
          channel: targetUserId,
          text: "MeetingBill requires an immediate credit refill to operate.",
          blocks: buildUpgradeNudge()
        });
        break;

      case 'send-calendar-connected':
        await client.chat.postMessage({
           channel: targetUserId,
           text: 'MeetingBill verified: Google Calendar is active!' 
        });
        break;

      case 'send-onboarding-complete':
        await client.chat.postMessage({
           channel: targetUserId,
           text: 'MeetingBill AI configuration process resolved.' 
        });
        break;

      case 'send-dm':
        const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
        if (!meeting) throw new Error('Meeting entity failed to manifest in DB prior to DB call.');
        
        await client.chat.postMessage({
          channel: targetUserId,
          text: `Your meeting cost $${costResult.totalCost}`, 
          blocks: buildMeetingCostMessage(meeting.id, meeting.title, costResult, meeting.durationMins)
        });
        break;
        
      default:
        logger.warn({ jobName: job.name }, 'Unknown routing notification job skipped entirely.');
    }
    
  },
  { 
    connection: redis, 
    concurrency: 10 
  }
);
