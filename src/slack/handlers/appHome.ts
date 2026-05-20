import { slackApp } from '../../app';
import { prisma } from '../../db/prisma';
import { buildAppHome } from '../blocks/appHomeTabs';

slackApp.event('app_home_opened', async ({ event, client, body }) => {
  const teamId = body.team_id;
  if (!teamId) return;

  const workspace = await prisma.workspace.findUnique({
    where: { slackTeamId: teamId },
    include: {
      salaryTiers: { orderBy: { annualSalary: 'desc' } },
      meetings: { orderBy: { startTime: 'desc' }, take: 5 }
    }
  });

  if (!workspace) return;

  // Rigid security: Guarantee restricted exposure exclusively isolating internal Dashboard data just directly back onto the authenticated installer admin
  if (event.user !== workspace.adminSlackId) {
    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        blocks: [{
          type: "section", text: { type: "mrkdwn", text: "⚠️ You are completely restricted from this pane. The MeetingBill analytical configuration overlay requires direct explicit Organization Admin standing to visualize." }
        }]
      }
    });
    return;
  }

  await client.views.publish({
    user_id: event.user,
    view: buildAppHome(workspace, workspace.salaryTiers, workspace.meetings)
  });
});
