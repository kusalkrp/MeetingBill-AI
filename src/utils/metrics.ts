import client from 'prom-client';

// Globally register the default NodeJS resource consumption hooks dynamically under our customized namespace
client.collectDefaultMetrics({ prefix: 'meetingbill_' });

export const metrics = {
  meetingsAnalyzedTotal: new client.Counter({
    name: 'meetingbill_meetings_analyzed_total',
    help: 'Total aggregate sum tracking completely evaluated and mathematically billed calendar meetings natively closed out',
    labelNames: ['workspace_id', 'plan']
  }),
  pollRunsTotal: new client.Counter({
    name: 'meetingbill_poll_runs_total',
    help: 'Absolute total numerical sum across all Google Calendar global concurrent polling iterations executed per-minute'
  }),
  meetingCostUsd: new client.Histogram({
    name: 'meetingbill_meeting_cost_usd',
    help: 'Geometric statistical distribution density brackets categorizing precise execution costs explicitly in USD',
    buckets: [50, 100, 250, 500, 1000, 2500, 5000]
  }),
  activeWorkspaces: new client.Gauge({
    name: 'meetingbill_active_workspaces',
    help: 'Constant instantaneous tracker identifying explicitly active provisioned UUID instances bound in Postgres'
  }),
  queueDepth: new client.Gauge({
    name: 'meetingbill_queue_depth',
    help: 'Active current array length tracing BullMQ execution waitlists dynamically resolving real-time load',
    labelNames: ['queue_name']
  })
};

export const getMetricsRegistry = async () => {
  return await client.register.metrics();
};
