import { Block, KnownBlock } from '@slack/web-api';
import { CostResult } from '../services/CostEngine';

export const buildMeetingCostMessage = (meetingId: string, title: string, costResult: CostResult, durationMins: number): (Block | KnownBlock)[] => {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: `💸 ${title} ended` }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Total Cost:* $${costResult.totalCost.toFixed(2)}\n*Duration:* ${durationMins} minutes\n*Burn Rate:* $${costResult.costPerMinute.toFixed(2)}/min`
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Worth It 👍" },
          value: meetingId,
          action_id: "meeting_worth_it"
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Flag for Async 🔄" },
          value: meetingId,
          action_id: "meeting_flag_async"
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Log Outcome" },
          value: meetingId,
          action_id: "meeting_log_outcome"
        }
      ]
    }
  ];
};

export const buildWelcomeMessage = (): (Block | KnownBlock)[] => {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Welcome to MeetingBill AI ⚡" }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Please connect your Google Calendar so we can aggressively audit your meeting costs in real-time."
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Connect Calendar" },
          style: "primary",
          value: "connect_google_calendar",
          action_id: "connect_google_calendar"
        }
      ]
    }
  ];
};

export const buildUpgradeNudge = (): (Block | KnownBlock)[] => {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "⚠️ *You are out of meeting analysis credits!* Please upgrade your MeetingBill plan to continue tracking pipeline expenditures."
      }
    }
  ];
};
