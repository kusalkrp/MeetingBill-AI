import { Block, KnownBlock } from '@slack/web-api';

export const buildWeeklyDigestMessage = (
  digest: any, 
  costDeltaPercent: number
): (Block | KnownBlock)[] => {
  const deltaSymbol = costDeltaPercent > 0 ? '▲' : '▼';
  const deltaText = costDeltaPercent === 0 
    ? "Stable — No change from last week" 
    : `${deltaSymbol} ${Math.abs(costDeltaPercent).toFixed(1)}% vs last week`;

  const topExpensive = (digest.mostExpensive || []).map((m: any, i: number) => 
    `*${i + 1}.* ${m.title} ($${Number(m.cost).toFixed(2)})`
  ).join('\n') || 'None recorded.';

  const topAsync = (digest.asyncCandidates || []).map((m: any, i: number) => 
    `*${i + 1}.* ${m.title} (Est. Target Savings: *$${Number(m.savings).toFixed(2)}*)`
  ).join('\n') || 'None recommended.';

  return [
    {
      type: "header",
      text: { type: "plain_text", text: "📊 Weekly Meeting Expense Digest" }
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Total Meetings:*\n${digest.totalMeetings}` },
        { type: "mrkdwn", text: `*Total Time Burned:*\n${Number(digest.totalHours).toFixed(1)} hours` }
      ]
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Total Cash Distributed:* $${Number(digest.totalCost).toFixed(2)}\n_${deltaText}_`
      }
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🔥 *Top 3 Most Expensive Priorities:*\n${topExpensive}`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🔄 *Automated Targets for Async Execution:*\n${topAsync}`
      }
    }
  ];
};
