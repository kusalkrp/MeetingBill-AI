import rateLimit from 'express-rate-limit';

export const slackWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,             // Slack can send many events per minute
  keyGenerator: (req) => {
    const val = req.headers['x-slack-team-id'];
    return (Array.isArray(val) ? val[0] : val) || req.ip || 'unknown';
  }
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => {
    const val = req.params.workspaceId;
    return (Array.isArray(val) ? val[0] : val) || req.ip || 'unknown';
  }
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20               // Strict limit for OAuth paths
});
