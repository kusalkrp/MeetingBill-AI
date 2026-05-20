import { slackApp } from '../../app';
import { prisma } from '../../db/prisma';
import { logger } from '../../utils/logger';

// Action: Mark Meeting as Worth It
slackApp.action('meeting_worth_it', async ({ ack, body, client }) => {
  await ack();
  if (body.type !== 'block_actions') return;

  const actionBody = body as any;
  const meetingId = actionBody.actions[0].value;
  const teamId = body.team?.id;

  const workspace = await prisma.workspace.findUnique({ where: { slackTeamId: teamId } });
  if (!workspace) return;

  await prisma.meeting.updateMany({
    where: { id: meetingId, workspaceId: workspace.id }, // Protect against IDOR
    data: { outcomeLogged: 'worth_it' }
  });

  await client.chat.postEphemeral({
    channel: actionBody.channel?.id as string,
    user: actionBody.user.id,
    text: "Noted! ✅"
  });
});

// Action: Flag for Async candidate
slackApp.action('meeting_flag_async', async ({ ack, body, client }) => {
  await ack();
  if (body.type !== 'block_actions') return;

  const actionBody = body as any;
  const meetingId = actionBody.actions[0].value;
  const teamId = body.team?.id;

  const workspace = await prisma.workspace.findUnique({ where: { slackTeamId: teamId } });
  if (!workspace) return;

  await prisma.meeting.updateMany({
    where: { id: meetingId, workspaceId: workspace.id },
    data: { flaggedAsync: true }
  });

  await client.chat.postEphemeral({
    channel: actionBody.channel?.id as string,
    user: actionBody.user.id,
    text: "Flagged 🔄"
  });
});

// Action: Open Modal to Log Outcome
slackApp.action('meeting_log_outcome', async ({ ack, body, client }) => {
  await ack();
  if (body.type !== 'block_actions') return;

  const actionBody = body as any;
  const meetingId = actionBody.actions[0].value;

  await client.views.open({
    trigger_id: actionBody.trigger_id, // Important for Slack API confirmation
    view: {
      type: 'modal',
      callback_id: 'log_outcome_modal',
      private_metadata: meetingId, // Carrier reference 
      title: { type: 'plain_text', text: 'Meeting Outcome' },
      blocks: [
        {
          type: "input",
          block_id: "outcome_block",
          element: {
            type: "plain_text_input",
            action_id: "outcome_input",
            multiline: true,
            max_length: 500
          },
          label: { type: "plain_text", text: "What was the result of this meeting?" }
        }
      ],
      submit: { type: 'plain_text', text: 'Submit' }
    }
  });
});

// Action: Trigger Salary Tier add modal
slackApp.action('add_salary_tier', async ({ ack, body, client }) => {
  await ack();
  const actionBody = body as any;
  await client.views.open({
    trigger_id: actionBody.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'add_tier_modal',
      title: { type: 'plain_text', text: 'Structure Salary Tier' },
      blocks: [
        {
          type: "input",
          block_id: "role_block",
          element: { type: "plain_text_input", action_id: "role_input", max_length: 128 },
          label: { type: "plain_text", text: "Role Nomenclature (i.e. 'Senior Dev')" }
        },
        {
          type: "input",
          block_id: "salary_block",
          element: { type: "plain_text_input", action_id: "salary_input" },
          label: { type: "plain_text", text: "Mathematical Default Annual Salary Base (USD)" }
        }
      ],
      submit: { type: 'plain_text', text: 'Commit Configuration' }
    }
  });
});

// View Payload: Parse out explicitly typed math from submitted tier and enforce onboarding state
slackApp.view('add_tier_modal', async ({ ack, body, view }) => {
  const roleName = view.state.values.role_block.role_input.value;
  const salaryStr = view.state.values.salary_block.salary_input.value;
  const annualSalary = parseInt(salaryStr || '0', 10);

  if (isNaN(annualSalary) || annualSalary < 1 || annualSalary > 9999999) {
    await ack({
      response_action: 'errors',
      errors: { salary_block: 'Please input a strict mathematical positive integer bounds format.' }
    });
    return;
  }
  
  await ack({ response_action: 'clear' });

  const teamId = body.team?.id;
  const workspace = await prisma.workspace.findUnique({ where: { slackTeamId: teamId } });
  if (!workspace) return;

  await prisma.salaryTier.create({
    data: {
      workspaceId: workspace.id,
      roleName: roleName as string,
      annualSalary
    }
  });

  if (workspace.onboardingState === 'calendar_connected') {
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { onboardingState: 'complete' }
    });
    const { TenantService } = require('../../services/TenantService');
    await TenantService.onTiersSet(workspace.id);
  }
});

// Remove mathematically mapped tier from explicit Postgres DB
slackApp.action('delete_salary_tier', async ({ ack, body, client }) => {
  await ack(); // Usually ephemeral confirm here, skipping for brevity
  const actionBody = body as any;
  const tierId = actionBody.actions[0].value;
  
  const teamId = body.team?.id;
  const workspace = await prisma.workspace.findUnique({ where: { slackTeamId: teamId } });
  if (!workspace) return;

  await prisma.salaryTier.deleteMany({
    where: { id: tierId, workspaceId: workspace.id }
  });
});

// View Submission: Modal Log Outcome
slackApp.view('log_outcome_modal', async ({ ack, body, view }) => {
  await ack({ response_action: 'clear' }); // Clear closes the modal immediately
  
  const meetingId = view.private_metadata;
  const outcomeText = view.state.values.outcome_block.outcome_input.value;
  const teamId = body.team?.id;

  const workspace = await prisma.workspace.findUnique({ where: { slackTeamId: teamId } });
  if (!workspace) return;

  await prisma.meeting.updateMany({
    where: { id: meetingId, workspaceId: workspace.id },
    data: { outcomeLogged: outcomeText?.slice(0, 500) }
  });
});
