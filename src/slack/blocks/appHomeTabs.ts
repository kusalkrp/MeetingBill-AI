import { View } from '@slack/web-api';
import { Workspace, SalaryTier, Meeting } from '@prisma/client';

export function buildAppHome(
  workspace: Workspace, 
  tiers: SalaryTier[], 
  recentMeetings: Meeting[]
): View {
  
  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "⚙️ MeetingBill Executive Configuration" }
    }
  ];

  if (workspace.onboardingState === 'pending') {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*(1/3) Almost there!* Please explicitly bind your calendar to continuously sync and evaluate costs." }
    });
    blocks.push({
      type: "actions",
      elements: [{
        type: "button", text: { type: "plain_text", text: "Authorize Google Calendar" }, value: "connect_google_calendar", action_id: "connect_google_calendar", style: "primary"
      }]
    });
  } else if (workspace.onboardingState === 'calendar_connected') {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*(2/3) System Armed!* Now, rigidly declare your Organizational Salary Tiers for dynamic rate approximation." }
    });
    blocks.push({
       type: "actions",
       elements: [{
         type: "button", text: { type: "plain_text", text: "Add Salary Tier" }, value: "add_salary_tier", action_id: "add_salary_tier"
       }]
    });
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*(Complete)* Active polling is humming perfectly! Core Credits Remaining: *${workspace.credits}*` }
    });
    blocks.push({
       type: "actions",
       elements: [{
         type: "button", text: { type: "plain_text", text: "Append New Salary Tier" }, value: "add_salary_tier", action_id: "add_salary_tier"
       }]
    });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "📈 *Explicitly Documented Salary Tiers*" }
  });

  if (tiers.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No tiers configured. Assuming baseline fallback of $50/hr across the organization._" }
    });
  } else {
    tiers.forEach(tier => {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*${tier.roleName}*\nAnnualized Commitment: \`$${tier.annualSalary}\` | Derived: \`$${Number(tier.hourlyRate).toFixed(2)}/hr\`` },
        accessory: {
           type: "button",
           text: { type: "plain_text", text: "Delete" },
           style: "danger",
           value: tier.id,
           action_id: "delete_salary_tier"
        }
      });
    });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "⏱️ *Last 5 Captured Meetings Evaluated*" }
  });

  if (recentMeetings.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_Awaiting baseline calendar events..._" }
    });
  } else {
    recentMeetings.forEach(m => {
       blocks.push({
         type: "section",
         text: { type: "mrkdwn", text: `• *${m.title}* – \`$${Number(m.estimatedCost).toFixed(2)}\` (${m.durationMins}m sustained burn)` }
       });
    });
  }

  return {
    type: "home",
    blocks
  };
}
