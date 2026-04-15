import { Worker } from 'bullmq';
import { WebClient } from '@slack/web-api';
import { redis } from '../../config/redis';
import { prisma } from '../../db/prisma';
import { decrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { DigestService } from '../../services/DigestService';
import { buildWeeklyDigestMessage } from '../../slack/blocks/weeklyDigest';

export const digestWorker = new Worker(
  'meeting_digest',
  async (job) => {
    const { workspaceId, weekStartString } = job.data;
    const weekStart = new Date(weekStartString);
    
    logger.info({ workspaceId }, 'Initiating exact weekly digest rollup logic for single Workspace...');

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId }
    });

    if (!workspace || !workspace.botToken || !workspace.adminSlackId) {
      throw new Error('Crucial missing environment workspace definitions for digesting context.');
    }

    // 1. Build & compute exact numbers securely inside RLS bounds
    const { digest, costDeltaPercent } = await DigestService.buildWeeklyDigest(workspaceId, weekStart);

    // 2. Transmit securely decrypted
    const botToken = decrypt(workspace.botToken);
    const client = new WebClient(botToken);

    await client.chat.postMessage({
      channel: workspace.adminSlackId, // Specifically bound back exclusively to the primary installation admin
      text: "MeetingBill Weekly Digest Generation is completely enclosed and dispatched.",
      blocks: buildWeeklyDigestMessage(digest, costDeltaPercent)
    });

    // 3. Document explicit status
    await prisma.weeklyDigest.update({
      where: { id: digest.id },
      data: { digestSent: true }
    });
  },
  { 
    connection: redis, 
    concurrency: 5 // Bound strictly tight to prevent cascading Slack API rate limit violations since Weekly hits all workspaces at Midnight
  }
);
