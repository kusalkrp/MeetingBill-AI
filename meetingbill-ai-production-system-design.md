# 💸 MeetingBill AI — Production-Grade Multi-Tenant System Design

> **Version:** 2.0 — Production Multi-Tenant  
> **Date:** April 2026  
> **Stack:** TypeScript · PostgreSQL · Redis · BullMQ · Docker  
> **Target:** Slack Marketplace — All Company Sizes  
> **Scale Target:** 500+ concurrent workspaces

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Multi-Tenant Architecture](#2-multi-tenant-architecture)
3. [Database Design with Row-Level Security](#3-database-design-with-row-level-security)
4. [Job Queue Architecture (BullMQ)](#4-job-queue-architecture-bullmq)
5. [Connection Pooling (PgBouncer)](#5-connection-pooling-pgbouncer)
6. [Google Calendar Integration](#6-google-calendar-integration)
7. [Slack Bot Design](#7-slack-bot-design)
8. [Cost Calculation Engine](#8-cost-calculation-engine)
9. [Tenant Onboarding Pipeline](#9-tenant-onboarding-pipeline)
10. [API Design](#10-api-design)
11. [Monetization & Credit System](#11-monetization--credit-system)
12. [Security](#12-security)
13. [Observability (Sentry + Prometheus + Logging)](#13-observability-sentry--prometheus--logging)
14. [Docker & Deployment](#14-docker--deployment)
15. [Project Structure](#15-project-structure)
16. [Build Plan (2 Weeks)](#16-build-plan-2-weeks)
17. [Future Roadmap (v3)](#17-future-roadmap-v3)

---

## 1. Product Overview

### 1.1 What Is MeetingBill AI?

MeetingBill AI is a **Slack-native productivity intelligence app** that automatically calculates the real salary cost of every meeting in your organization. It connects to Google Calendar, monitors completed meetings, and delivers cost breakdowns directly in Slack — making meeting waste visible, measurable, and impossible to ignore.

No surveys. No employee action required. Fully passive — data flows automatically from Google Calendar into Slack.

### 1.2 Core Value Proposition

> A 60-minute sync with 8 senior engineers is not free. It costs over $1,000 in salary time. MeetingBill makes that number visible after every single meeting — automatically.

### 1.3 Target Users

| User | Benefit |
|------|---------|
| Meeting Organizers | See real cost of their meetings instantly after they end |
| Engineering Managers | Identify which recurring meetings drain team time most |
| CFOs / Finance | Quantify organization-wide meeting waste with hard numbers |
| HR / People Ops | Use cost data to build async-first culture policies |

### 1.4 Multi-Tenant Scope

This document covers a **production-grade multi-tenant SaaS** design supporting:

- 500+ concurrent Slack workspaces
- Isolated data per tenant with PostgreSQL Row-Level Security
- Per-tenant job queues with BullMQ + Redis
- Connection pooling via PgBouncer
- Full observability with Sentry, Prometheus, and structured logging

---

## 2. Multi-Tenant Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      SLACK MARKETPLACE                          │
│            Workspace installs app → Slack OAuth                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                         NGINX                                   │
│              SSL Termination · Rate Limiting · Routing          │
└──────────┬──────────────────────────────────────────────────────┘
           │
     ┌─────▼──────────────────────────────────────────┐
     │              NODE.JS APP (Slack Bolt)           │
     │                                                 │
     │  ┌────────────┐  ┌───────────┐  ┌───────────┐  │
     │  │ Slack Bolt │  │ REST API  │  │  OAuth    │  │
     │  │ (events,   │  │ (Express) │  │  Handler  │  │
     │  │  actions,  │  │           │  │  Slack +  │  │
     │  │  commands) │  │           │  │  Google   │  │
     │  └─────┬──────┘  └─────┬─────┘  └─────┬─────┘  │
     │        └───────────────┴───────────────┘         │
     │                        │                         │
     │              ┌─────────▼──────────┐              │
     │              │   Service Layer    │              │
     │              │  TenantService     │              │
     │              │  MeetingService    │              │
     │              │  CostEngine        │              │
     │              │  NotificationSvc   │              │
     │              │  UsageService      │              │
     │              └─────────┬──────────┘              │
     └────────────────────────┼────────────────────────-┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
┌─────────────────┐  ┌────────────────┐  ┌───────────────┐
│   PgBouncer     │  │     Redis      │  │   Sentry /    │
│   (pooling)     │  │  (BullMQ +     │  │  Prometheus   │
│        │        │  │   cache)       │  │  (observ.)    │
│        ▼        │  └────────┬───────┘  └───────────────┘
│   PostgreSQL    │           │
│   (RLS enabled) │           ▼
└─────────────────┘  ┌────────────────┐
                     │  BullMQ        │
                     │  Workers       │
                     │  (separate     │
                     │   process)     │
                     │                │
                     │  - MeetingJob  │
                     │  - DigestJob   │
                     │  - NotifyJob   │
                     └────────────────┘
                              │
                              ▼
                     ┌────────────────┐
                     │ Google Calendar│
                     │ API (per       │
                     │ workspace)     │
                     └────────────────┘
```

### 2.2 Multi-Tenancy Strategy

MeetingBill uses the **shared database, shared schema** multi-tenancy model with PostgreSQL Row-Level Security (RLS) as the enforcement layer.

| Strategy | Isolation | Cost | Our Choice |
|----------|-----------|------|------------|
| Separate DB per tenant | Strongest | Very High | ❌ |
| Separate schema per tenant | Strong | High | ❌ |
| Shared schema + RLS | Strong | Low | ✅ |
| Shared schema + app-level filters only | Weak | Lowest | ❌ |

**Why shared schema + RLS:**
- Cost-effective at 500+ tenants
- RLS enforced at DB level — app bugs cannot leak data between tenants
- Single migration path for schema changes
- Prisma supports RLS via connection-level `SET app.current_workspace_id`

### 2.3 Tenant Context Propagation

Every database connection sets the tenant context before executing any query:

```typescript
// middleware/tenantContext.ts
export async function withTenantContext<T>(
  workspaceId: string,
  fn: (prisma: PrismaClient) => Promise<T>
): Promise<T> {
  return await prisma.$transaction(async (tx) => {
    // Set RLS context for this transaction
    await tx.$executeRaw`SELECT set_config('app.current_workspace_id', ${workspaceId}, true)`;
    return await fn(tx as unknown as PrismaClient);
  });
}

// Usage in any service
const meetings = await withTenantContext(workspaceId, async (tx) => {
  return tx.meeting.findMany(); // RLS automatically filters by workspace
});
```

---

## 3. Database Design with Row-Level Security

### 3.1 Full Schema

```sql
-- ─────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────
-- WORKSPACES (tenant registry)
-- ─────────────────────────────────────────
CREATE TABLE workspaces (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slack_team_id     VARCHAR(64) UNIQUE NOT NULL,
  slack_team_name   VARCHAR(255) NOT NULL,
  slack_team_domain VARCHAR(255),
  bot_token         TEXT NOT NULL,          -- AES-256-GCM encrypted
  google_tokens     JSONB,                  -- AES-256-GCM encrypted
  google_connected  BOOLEAN DEFAULT FALSE,
  plan              VARCHAR(32) DEFAULT 'free',
  credits           INTEGER DEFAULT 20,
  timezone          VARCHAR(64) DEFAULT 'UTC',
  onboarding_state  VARCHAR(32) DEFAULT 'pending', -- pending|calendar|tiers|complete
  admin_slack_id    VARCHAR(64),
  is_active         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- SALARY TIERS (per tenant)
-- ─────────────────────────────────────────
CREATE TABLE salary_tiers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role_name       VARCHAR(128) NOT NULL,
  annual_salary   INTEGER NOT NULL,         -- USD
  hourly_rate     NUMERIC(10,4) GENERATED ALWAYS AS (annual_salary / 2080.0) STORED,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(workspace_id, role_name)
);

-- ─────────────────────────────────────────
-- WORKSPACE MEMBERS (per tenant)
-- ─────────────────────────────────────────
CREATE TABLE workspace_members (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slack_user_id   VARCHAR(64) NOT NULL,
  slack_email     VARCHAR(255),
  display_name    VARCHAR(255),
  role_name       VARCHAR(128),
  hourly_rate     NUMERIC(10,4),            -- resolved from salary_tiers
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(workspace_id, slack_user_id)
);

-- ─────────────────────────────────────────
-- MEETINGS (per tenant)
-- ─────────────────────────────────────────
CREATE TABLE meetings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  google_event_id     VARCHAR(255) NOT NULL,
  title               VARCHAR(500) NOT NULL,
  organizer_slack_id  VARCHAR(64),
  organizer_email     VARCHAR(255),
  start_time          TIMESTAMP NOT NULL,
  end_time            TIMESTAMP NOT NULL,
  duration_mins       INTEGER NOT NULL,
  attendee_count      INTEGER NOT NULL,
  estimated_cost      NUMERIC(10,2),
  cost_breakdown      JSONB,                -- [{slackUserId, email, hourlyRate, cost}]
  outcome_logged      TEXT,
  flagged_async       BOOLEAN DEFAULT FALSE,
  dm_sent             BOOLEAN DEFAULT FALSE,
  analyzed_at         TIMESTAMP DEFAULT NOW(),
  UNIQUE(workspace_id, google_event_id)
);

-- ─────────────────────────────────────────
-- WEEKLY DIGESTS (per tenant)
-- ─────────────────────────────────────────
CREATE TABLE weekly_digests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  week_start        DATE NOT NULL,
  total_meetings    INTEGER DEFAULT 0,
  total_cost        NUMERIC(10,2) DEFAULT 0,
  total_hours       NUMERIC(8,2) DEFAULT 0,
  most_expensive    JSONB,
  async_candidates  JSONB,
  digest_sent       BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMP DEFAULT NOW(),
  UNIQUE(workspace_id, week_start)
);

-- ─────────────────────────────────────────
-- USAGE LOGS (per tenant — billing audit trail)
-- ─────────────────────────────────────────
CREATE TABLE usage_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type      VARCHAR(64) NOT NULL,     -- meeting_analyzed | digest_sent | credit_purchased
  credits_used    INTEGER DEFAULT 1,
  metadata        JSONB,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────
CREATE INDEX idx_salary_tiers_workspace ON salary_tiers(workspace_id);
CREATE INDEX idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX idx_workspace_members_email ON workspace_members(workspace_id, slack_email);
CREATE INDEX idx_meetings_workspace ON meetings(workspace_id);
CREATE INDEX idx_meetings_end_time ON meetings(workspace_id, end_time DESC);
CREATE INDEX idx_meetings_organizer ON meetings(workspace_id, organizer_slack_id);
CREATE INDEX idx_usage_logs_workspace ON usage_logs(workspace_id, created_at DESC);
CREATE INDEX idx_weekly_digests_workspace ON weekly_digests(workspace_id, week_start DESC);
```

### 3.2 Row-Level Security Policies

```sql
-- ─────────────────────────────────────────
-- ENABLE RLS ON ALL TENANT TABLES
-- ─────────────────────────────────────────
ALTER TABLE salary_tiers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_digests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs         ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────
-- RLS POLICIES (app sets context before every query)
-- ─────────────────────────────────────────
CREATE POLICY tenant_isolation_salary_tiers ON salary_tiers
  USING (workspace_id::text = current_setting('app.current_workspace_id', true));

CREATE POLICY tenant_isolation_members ON workspace_members
  USING (workspace_id::text = current_setting('app.current_workspace_id', true));

CREATE POLICY tenant_isolation_meetings ON meetings
  USING (workspace_id::text = current_setting('app.current_workspace_id', true));

CREATE POLICY tenant_isolation_digests ON weekly_digests
  USING (workspace_id::text = current_setting('app.current_workspace_id', true));

CREATE POLICY tenant_isolation_usage ON usage_logs
  USING (workspace_id::text = current_setting('app.current_workspace_id', true));

-- ─────────────────────────────────────────
-- APP DB USER (limited permissions — no superuser)
-- ─────────────────────────────────────────
CREATE ROLE meetingbill_app LOGIN PASSWORD 'strong_password_here';
GRANT CONNECT ON DATABASE meetingbill TO meetingbill_app;
GRANT USAGE ON SCHEMA public TO meetingbill_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO meetingbill_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO meetingbill_app;

-- Admin role bypasses RLS for migrations and admin tasks only
CREATE ROLE meetingbill_admin LOGIN PASSWORD 'admin_password_here' BYPASSRLS;
```

---

## 4. Job Queue Architecture (BullMQ)

### 4.1 Why BullMQ

The meeting poller cannot run all workspaces sequentially in one cron loop at scale. At 500 workspaces with meetings ending simultaneously, a sequential loop will time out and miss meetings. BullMQ distributes work across multiple worker processes with retries, concurrency limits, and per-tenant throttling.

### 4.2 Queue Design

```
┌─────────────────────────────────────────────────────┐
│                     REDIS                           │
│                                                     │
│  ┌─────────────────┐   ┌─────────────────────────┐  │
│  │  meeting:poll   │   │   meeting:analyze       │  │
│  │  Queue          │   │   Queue                 │  │
│  │                 │   │                         │  │
│  │  Jobs:          │   │  Jobs:                  │  │
│  │  {workspaceId}  │──►│  {workspaceId,          │  │
│  │  every 5 min    │   │   googleEventId,        │  │
│  │  per workspace  │   │   eventData}            │  │
│  └─────────────────┘   └──────────┬──────────────┘  │
│                                   │                  │
│  ┌─────────────────────────────┐  │                  │
│  │   notification:send Queue   │◄─┘                  │
│  │                             │                     │
│  │  Jobs:                      │                     │
│  │  {workspaceId,              │                     │
│  │   slackUserId,              │                     │
│  │   meetingId,                │                     │
│  │   messageBlocks}            │                     │
│  └─────────────────────────────┘                     │
│                                                     │
│  ┌─────────────────────────────┐                    │
│  │   digest:weekly Queue       │                    │
│  │                             │                    │
│  │  Jobs:                      │                    │
│  │  {workspaceId}              │                    │
│  │  every Monday 9AM           │                    │
│  └─────────────────────────────┘                    │
└─────────────────────────────────────────────────────┘
```

### 4.3 Queue Configuration

```typescript
// queues/index.ts
import { Queue, Worker, QueueEvents } from 'bullmq';
import { redis } from '../config/redis';

const connection = redis;

export const pollQueue = new Queue('meeting:poll', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500
  }
});

export const analyzeQueue = new Queue('meeting:analyze', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 200,
    removeOnFail: 500
  }
});

export const notifyQueue = new Queue('notification:send', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'fixed', delay: 2000 },
    removeOnComplete: 500
  }
});

export const digestQueue = new Queue('digest:weekly', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 }
  }
});
```

### 4.4 Workers

```typescript
// workers/meetingAnalyzeWorker.ts
export const analyzeWorker = new Worker(
  'meeting:analyze',
  async (job) => {
    const { workspaceId, googleEventId, eventData } = job.data;

    // 1. Check credits
    const hasCredits = await UsageService.checkCredits(workspaceId);
    if (!hasCredits) {
      await NotificationService.sendUpgradeNudge(workspaceId);
      return;
    }

    // 2. Resolve attendees → hourly rates
    const attendees = await MeetingService.resolveAttendees(workspaceId, eventData.attendees);

    // 3. Calculate cost
    const costResult = CostEngine.calculate({
      durationMinutes: eventData.durationMinutes,
      attendees
    });

    // 4. Persist meeting record (inside RLS context)
    const meeting = await withTenantContext(workspaceId, async (tx) => {
      return tx.meeting.create({
        data: {
          workspaceId,
          googleEventId,
          title: eventData.title,
          organizerSlackId: eventData.organizerSlackId,
          startTime: eventData.startTime,
          endTime: eventData.endTime,
          durationMins: eventData.durationMinutes,
          attendeeCount: attendees.length,
          estimatedCost: costResult.totalCost,
          costBreakdown: costResult.breakdown,
          dmSent: false
        }
      });
    });

    // 5. Deduct credit
    await UsageService.deductCredit(workspaceId, meeting.id);

    // 6. Queue notification
    await notifyQueue.add('send-dm', {
      workspaceId,
      meetingId: meeting.id,
      slackUserId: eventData.organizerSlackId,
      costResult
    });
  },
  {
    connection,
    concurrency: 20,          // 20 meetings analyzed in parallel
    limiter: {
      max: 50,                // max 50 jobs per 10 seconds globally
      duration: 10000
    }
  }
);
```

### 4.5 Per-Workspace Poller Scheduling

Instead of one cron loop for all workspaces, each workspace gets its own repeatable job:

```typescript
// When a workspace connects Google Calendar:
export async function scheduleWorkspacePoller(workspaceId: string) {
  await pollQueue.add(
    `poll-${workspaceId}`,
    { workspaceId },
    {
      repeat: { every: 5 * 60 * 1000 }, // every 5 minutes
      jobId: `poll-${workspaceId}`       // deduplicated by workspaceId
    }
  );
}

// Poll worker
export const pollWorker = new Worker(
  'meeting:poll',
  async (job) => {
    const { workspaceId } = job.data;
    const events = await GoogleCalendarService.fetchRecentlyEndedMeetings(workspaceId);

    for (const event of events) {
      await analyzeQueue.add('analyze', {
        workspaceId,
        googleEventId: event.id,
        eventData: event
      });
    }
  },
  { connection, concurrency: 50 }  // 50 workspaces polled in parallel
);
```

---

## 5. Connection Pooling (PgBouncer)

### 5.1 Why PgBouncer

PostgreSQL has a hard limit on concurrent connections (typically 100–200). At 500 workspaces with multiple workers each opening connections, the DB will exhaust connections without a pool.

PgBouncer sits between the app and PostgreSQL, multiplexing thousands of app connections into a small number of real DB connections.

### 5.2 PgBouncer Configuration

```ini
; pgbouncer.ini
[databases]
meetingbill = host=db port=5432 dbname=meetingbill

[pgbouncer]
listen_port = 6432
listen_addr = 0.0.0.0
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt

; Transaction pooling — required for RLS with SET LOCAL
pool_mode = transaction

max_client_conn = 2000      ; max app connections
default_pool_size = 40      ; real DB connections per user/db pair
reserve_pool_size = 10
reserve_pool_timeout = 3

; Timeouts
server_idle_timeout = 600
client_idle_timeout = 0
query_timeout = 30

log_connections = 1
log_disconnections = 1
```

> **Important:** PgBouncer must use `pool_mode = transaction` (not session) so that `SET LOCAL` for RLS context is correctly scoped to each transaction and not leaked between clients sharing a connection.

---

## 6. Google Calendar Integration

### 6.1 OAuth Flow

```
Admin clicks "Connect Google Calendar" in Slack App Home
      │
      ▼
Backend generates Google OAuth URL
Scopes: calendar.readonly
State param: workspaceId (signed JWT to prevent CSRF)
      │
      ▼
Admin authorizes on Google consent screen
      │
      ▼
Google redirects to /auth/google/callback?code=...&state=...
      │
      ▼
Backend verifies state JWT signature
Exchanges code for { access_token, refresh_token, expiry_date }
Encrypts token bundle with AES-256-GCM
Stores in workspaces.google_tokens
Sets workspaces.google_connected = true
      │
      ▼
scheduleWorkspacePoller(workspaceId)  ← BullMQ repeatable job created
      │
      ▼
Sends Slack DM to admin: "✅ Google Calendar connected. MeetingBill is now active."
```

### 6.2 Token Refresh Strategy

```typescript
// google/auth.ts
export async function getCalendarClient(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const tokens = decrypt(workspace.googleTokens);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials(tokens);

  // Auto-refresh: Google client handles token refresh automatically
  // when access_token is expired using the refresh_token
  oauth2Client.on('tokens', async (newTokens) => {
    // Persist refreshed tokens back to DB
    const merged = { ...tokens, ...newTokens };
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { googleTokens: encrypt(JSON.stringify(merged)) }
    });
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}
```

### 6.3 Meeting Event Fetcher

```typescript
// google/calendar.ts
export async function fetchRecentlyEndedMeetings(workspaceId: string) {
  const calendar = await getCalendarClient(workspaceId);
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: fiveMinutesAgo.toISOString(),
    timeMax: now.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    fields: 'items(id,summary,start,end,attendees,organizer)'
    // NOTE: description and attachments are explicitly excluded for privacy
  });

  return (response.data.items || [])
    .filter(event => event.attendees && event.attendees.length > 1)
    .map(event => parseCalendarEvent(workspaceId, event));
}
```

---

## 7. Slack Bot Design

### 7.1 Post-Meeting DM (Block Kit)

```typescript
// slack/blocks/meetingCostDM.ts
export function buildMeetingCostDM(meeting: Meeting, avgCost: number): Block[] {
  const overAvg = meeting.estimatedCost > avgCost;
  const pctDiff = Math.round(((meeting.estimatedCost - avgCost) / avgCost) * 100);

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `✅  ${meeting.title}  —  just ended` }
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*👥 Attendees:*\n${meeting.attendeeCount}` },
        { type: 'mrkdwn', text: `*⏱️ Duration:*\n${meeting.durationMins} minutes` },
        { type: 'mrkdwn', text: `*💸 Estimated Cost:*\n$${meeting.estimatedCost.toFixed(2)}` },
        { type: 'mrkdwn', text: `*📊 Your Avg Meeting:*\n$${avgCost.toFixed(2)}` }
      ]
    },
    overAvg ? {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `⚠️ This ran *${Math.abs(pctDiff)}% ${pctDiff > 0 ? 'above' : 'below'}* your average meeting cost`
      }]
    } : null,
    { type: 'divider' },
    {
      type: 'actions',
      block_id: `meeting_actions_${meeting.id}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Worth it' },
          style: 'primary',
          action_id: 'meeting_worth_it',
          value: meeting.id
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔄 Should be async' },
          action_id: 'meeting_flag_async',
          value: meeting.id
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '📝 Log outcome' },
          action_id: 'meeting_log_outcome',
          value: meeting.id
        }
      ]
    }
  ].filter(Boolean) as Block[];
}
```

### 7.2 Weekly Digest DM

```
┌──────────────────────────────────────────────────────┐
│ 📊  Your Meeting Cost Report — Week of Apr 7         │
│                                                      │
│ Total Meetings:     12                               │
│ Total Cost:         $3,240                           │
│ Time in Meetings:   9.4 hours                        │
│ Cost vs Last Week:  ▲ 12% ($346 more)               │
│                                                      │
│ 🔴  Most Expensive                                   │
│     All-Hands Sync      →  $1,100  (14 people)      │
│     Product Review      →  $740   (9 people)        │
│                                                      │
│ 💡  Async Candidates (low outcome rate)              │
│     Status Update       →  $280   (flagged 3x)      │
│     Weekly Sync         →  $420   (0 outcomes)      │
│                                                      │
│ [📈 View Full Report]                                │
└──────────────────────────────────────────────────────┘
```

### 7.3 Slash Commands

| Command | Description |
|---------|-------------|
| `/meetingbill report` | Get your weekly cost digest on demand |
| `/meetingbill setup` | Open the admin setup wizard |
| `/meetingbill credits` | Check remaining analysis credits |
| `/meetingbill connect` | Connect Google Calendar |
| `/meetingbill help` | Show all available commands |

### 7.4 App Home Tab Sections

- Google Calendar connection status + connect button
- Onboarding progress bar (3 steps: Install → Connect Calendar → Set Tiers)
- Salary tier configuration table (add / edit / delete roles)
- Credits remaining + upgrade prompt
- Last 5 meetings analyzed with costs
- Link to full weekly report

---

## 8. Cost Calculation Engine

### 8.1 Formula

```
Meeting Cost = Σ (attendee_hourly_rate × duration_hours)

Where:
  attendee_hourly_rate = annual_salary / 2080   (2080 working hours/year)
  duration_hours       = duration_minutes / 60
```

### 8.2 Attendee Rate Resolution Priority

```
1. workspace_members.hourly_rate         (exact match by Slack user ID)
   ↓ not found
2. salary_tiers matched by role_name     (if member has role assigned)
   ↓ not found
3. workspace default_hourly_rate         (admin-configured fallback)
   ↓ not set
4. Global platform default: $50/hr       (last resort)
```

### 8.3 TypeScript Implementation

```typescript
// services/CostEngine.ts
export interface AttendeeInput {
  slackUserId: string;
  hourlyRate: number;
}

export interface CostResult {
  totalCost: number;
  costPerMinute: number;
  breakdown: { slackUserId: string; cost: number; hourlyRate: number }[];
}

export class CostEngine {
  static calculate(durationMinutes: number, attendees: AttendeeInput[]): CostResult {
    const durationHours = durationMinutes / 60;
    const breakdown = attendees.map(a => ({
      slackUserId: a.slackUserId,
      hourlyRate: a.hourlyRate,
      cost: parseFloat((a.hourlyRate * durationHours).toFixed(2))
    }));
    const totalCost = parseFloat(breakdown.reduce((sum, a) => sum + a.cost, 0).toFixed(2));
    return {
      totalCost,
      costPerMinute: parseFloat((totalCost / durationMinutes).toFixed(4)),
      breakdown
    };
  }
}
```

---

## 9. Tenant Onboarding Pipeline

### 9.1 Onboarding State Machine

```
PENDING ──► CALENDAR_CONNECTED ──► TIERS_SET ──► COMPLETE
   │                │                   │
   │                │                   └── BullMQ poller scheduled
   │                │                       Welcome DM sent to admin
   │                └── Google OAuth done
   │                    Poller job created (paused until tiers set)
   └── Slack OAuth done
       Bot added to workspace
       Welcome DM sent to admin
       App Home tab shown
```

### 9.2 Onboarding Service

```typescript
// services/TenantService.ts
export class TenantService {

  static async provisionWorkspace(slackTeamId: string, botToken: string, adminSlackId: string) {
    const workspace = await prisma.workspace.upsert({
      where: { slackTeamId },
      create: {
        slackTeamId,
        botToken: encrypt(botToken),
        adminSlackId,
        plan: 'free',
        credits: 20,
        onboardingState: 'pending'
      },
      update: { botToken: encrypt(botToken), adminSlackId }
    });

    await NotificationService.sendWelcomeDM(workspace);
    logger.info({ workspaceId: workspace.id, event: 'workspace_provisioned' });
    return workspace;
  }

  static async onCalendarConnected(workspaceId: string) {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { googleConnected: true, onboardingState: 'calendar_connected' }
    });
    await scheduleWorkspacePoller(workspaceId);
    await NotificationService.sendCalendarConnectedDM(workspaceId);
  }

  static async onTiersSet(workspaceId: string) {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { onboardingState: 'complete' }
    });
    await NotificationService.sendOnboardingCompleteDM(workspaceId);
  }

  static async deprovisionWorkspace(workspaceId: string) {
    // Remove BullMQ repeatable poller job
    await pollQueue.removeRepeatable(`poll-${workspaceId}`, { every: 5 * 60 * 1000 });
    // Soft delete workspace
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { isActive: false, googleTokens: null, botToken: '' }
    });
    logger.info({ workspaceId, event: 'workspace_deprovisioned' });
  }
}
```

---

## 10. API Design

### 10.1 Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check + DB ping |
| GET | `/metrics` | Internal | Prometheus metrics endpoint |
| GET | `/slack/install` | None | Slack OAuth install redirect |
| GET | `/slack/oauth_redirect` | None | Slack OAuth callback |
| GET | `/auth/google` | Slack token | Google OAuth redirect |
| GET | `/auth/google/callback` | State JWT | Google OAuth callback |
| POST | `/slack/events` | Signing secret | Slack Events API webhook |
| POST | `/slack/interactions` | Signing secret | Slack Block Kit interactions |
| GET | `/api/workspaces/:id/report` | Bot token | Weekly report data |
| POST | `/api/workspaces/:id/salary-tiers` | Bot token | Set/update salary tiers |
| GET | `/api/workspaces/:id/salary-tiers` | Bot token | List salary tiers |
| DELETE | `/api/workspaces/:id/salary-tiers/:tierId` | Bot token | Delete salary tier |
| GET | `/api/workspaces/:id/credits` | Bot token | Get credit balance |
| GET | `/api/workspaces/:id/meetings` | Bot token | List recent meetings |

### 10.2 Rate Limiting

```typescript
// middleware/rateLimiter.ts
import rateLimit from 'express-rate-limit';

export const slackWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,             // Slack can send many events per minute
  keyGenerator: (req) => req.headers['x-slack-team-id'] as string || req.ip
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.params.workspaceId || req.ip
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20               // OAuth flows — strict limit
});
```

---

## 11. Monetization & Credit System

### 11.1 Pricing Tiers

| Tier | Price | Credits/Month | Best For |
|------|-------|---------------|----------|
| Free | $0 | 20 | Try it out — ~20 meetings |
| Starter | $9/mo | 200 | Small teams (10–30 people) |
| Growth | $29/mo | 1,000 | Mid-size teams (30–100 people) |
| Pro | $79/mo | Unlimited | Large orgs (100+ people) |

**1 credit = 1 meeting analyzed**

### 11.2 Credit Enforcement

```typescript
// services/UsageService.ts
export class UsageService {

  static async checkCredits(workspaceId: string): Promise<boolean> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { credits: true, plan: true }
    });
    if (workspace.plan === 'pro') return true;   // unlimited
    return workspace.credits > 0;
  }

  static async deductCredit(workspaceId: string, meetingId: string): Promise<void> {
    await prisma.$transaction([
      prisma.workspace.updateMany({
        where: { id: workspaceId, plan: { not: 'pro' } },
        data: { credits: { decrement: 1 } }
      }),
      prisma.usageLog.create({
        data: {
          workspaceId,
          eventType: 'meeting_analyzed',
          creditsUsed: 1,
          metadata: { meetingId }
        }
      })
    ]);

    // Warn admin at low credit thresholds
    const updated = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { credits: true }
    });
    if (updated.credits === 5 || updated.credits === 0) {
      await notifyQueue.add('low-credits', { workspaceId, creditsLeft: updated.credits });
    }
  }
}
```

### 11.3 Credit Reset (Monthly Cron)

```typescript
// Runs on the 1st of every month at midnight UTC
cron.schedule('0 0 1 * *', async () => {
  await prisma.workspace.updateMany({
    where: { plan: 'starter' },
    data: { credits: 200 }
  });
  await prisma.workspace.updateMany({
    where: { plan: 'growth' },
    data: { credits: 1000 }
  });
});
```

---

## 12. Security

### 12.1 Token Encryption (AES-256-GCM)

```typescript
// utils/encryption.ts
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'); // 32 bytes = 64 hex chars

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(b => b.toString('hex')).join(':');
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, encHex] = payload.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8');
}
```

### 12.2 Security Checklist

| Area | Control |
|------|---------|
| Slack webhooks | Verified via `signingSecret` on every request (Bolt handles automatically) |
| Google OAuth state | Signed JWT with 10-minute expiry — prevents CSRF |
| Token storage | AES-256-GCM encrypted before DB write |
| DB user | Limited role — no superuser, no DDL, no BYPASSRLS |
| RLS | Enforced at DB level — app bugs cannot leak tenant data |
| HTTP headers | Helmet.js — CSP, HSTS, X-Frame-Options, etc. |
| Rate limiting | Per-endpoint limits via express-rate-limit |
| Secrets | Environment variables only — never in code or git |
| Worker isolation | Workers run in separate process — cannot directly access HTTP layer |
| Privacy | Meeting descriptions and attachments never read or stored |
| DM privacy | Cost summaries sent only to organizer via private DM |
| Logging | No PII in logs — Slack user IDs only, no emails or names |

### 12.3 OWASP LLM / Injection Mitigations

Although this app does not use an LLM in the MVP, meeting titles from Google Calendar are treated as untrusted input:

- Meeting titles are sanitized before insertion into Slack Block Kit (prevent Slack mrkdwn injection)
- Meeting titles are parameterized in all SQL (Prisma handles this automatically)
- No meeting title is ever executed as code or passed to an LLM prompt

---

## 13. Observability (Sentry + Prometheus + Logging)

### 13.1 Structured Logging (Pino)

```typescript
// utils/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label })
  },
  redact: ['googleTokens', 'botToken', 'password', 'email']  // never log PII
});

// Usage — always log with workspaceId for tenant traceability
logger.info({ workspaceId, meetingId, cost: result.totalCost, event: 'meeting_analyzed' });
logger.error({ workspaceId, error: err.message, event: 'google_api_failure' });
```

### 13.2 Sentry Error Tracking

```typescript
// app.ts
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.2,      // 20% of requests traced
  beforeSend(event) {
    // Strip any PII before sending to Sentry
    if (event.user) delete event.user.email;
    return event;
  }
});

// In BullMQ workers — capture job failures
analyzeWorker.on('failed', (job, err) => {
  Sentry.captureException(err, {
    tags: { queue: 'meeting:analyze', workspaceId: job?.data?.workspaceId }
  });
  logger.error({ jobId: job?.id, workspaceId: job?.data?.workspaceId, error: err.message, event: 'job_failed' });
});
```

### 13.3 Prometheus Metrics

```typescript
// utils/metrics.ts
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const registry = new Registry();

export const meetingsAnalyzed = new Counter({
  name: 'meetingbill_meetings_analyzed_total',
  help: 'Total number of meetings analyzed',
  labelNames: ['workspace_id', 'plan'],
  registers: [registry]
});

export const meetingCostHistogram = new Histogram({
  name: 'meetingbill_meeting_cost_usd',
  help: 'Distribution of meeting costs in USD',
  buckets: [50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry]
});

export const activeWorkspaces = new Gauge({
  name: 'meetingbill_active_workspaces',
  help: 'Number of active workspaces',
  registers: [registry]
});

export const queueDepth = new Gauge({
  name: 'meetingbill_queue_depth',
  help: 'Number of jobs waiting in each queue',
  labelNames: ['queue_name'],
  registers: [registry]
});

export const creditBalance = new Histogram({
  name: 'meetingbill_workspace_credits',
  help: 'Distribution of credit balances across workspaces',
  buckets: [0, 1, 5, 10, 20, 50, 100, 500],
  registers: [registry]
});
```

### 13.4 Metrics Endpoint

```typescript
// Exposed at GET /metrics — accessible only from internal network
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});
```

### 13.5 Health Check

```typescript
app.get('/health', async (req, res) => {
  const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  const redisOk = await redis.ping().then(r => r === 'PONG').catch(() => false);

  const status = dbOk && redisOk ? 'ok' : 'degraded';
  res.status(dbOk && redisOk ? 200 : 503).json({
    status,
    db: dbOk,
    redis: redisOk,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
```

---

## 14. Docker & Deployment

### 14.1 docker-compose.yml

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    environment:
      DATABASE_URL: postgresql://meetingbill_app:${DB_PASSWORD}@pgbouncer:6432/meetingbill
      REDIS_URL: redis://redis:6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    build: .
    command: ["node", "dist/worker.js"]
    env_file: .env
    environment:
      DATABASE_URL: postgresql://meetingbill_app:${DB_PASSWORD}@pgbouncer:6432/meetingbill
      REDIS_URL: redis://redis:6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: meetingbill
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_ROOT_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  pgbouncer:
    image: bitnami/pgbouncer:latest
    environment:
      POSTGRESQL_HOST: db
      POSTGRESQL_PORT: 5432
      POSTGRESQL_DATABASE: meetingbill
      POSTGRESQL_USERNAME: meetingbill_app
      POSTGRESQL_PASSWORD: ${DB_PASSWORD}
      PGBOUNCER_POOL_MODE: transaction
      PGBOUNCER_MAX_CLIENT_CONN: 2000
      PGBOUNCER_DEFAULT_POOL_SIZE: 40
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/certs:/etc/nginx/certs:ro
    depends_on:
      - app
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### 14.2 Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
RUN npx prisma generate
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/app.js"]
```

### 14.3 Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PgBouncer connection string |
| `REDIS_URL` | Redis connection string |
| `REDIS_PASSWORD` | Redis auth password |
| `DB_PASSWORD` | App DB user password |
| `DB_ROOT_PASSWORD` | Postgres root password |
| `SLACK_CLIENT_ID` | From Slack app config |
| `SLACK_CLIENT_SECRET` | From Slack app config |
| `SLACK_SIGNING_SECRET` | From Slack app config |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | e.g. https://meetingbill.app/auth/google/callback |
| `ENCRYPTION_KEY` | 64-char hex string (32 bytes) for AES-256-GCM |
| `JWT_SECRET` | For signing OAuth state params |
| `APP_URL` | Public base URL |
| `SENTRY_DSN` | Sentry project DSN |
| `LOG_LEVEL` | info / debug / warn |
| `NODE_ENV` | production / development |

---

## 15. Project Structure

```
meetingbill/
├── src/
│   ├── app.ts                        # Express + Bolt entry point
│   ├── worker.ts                     # BullMQ worker entry point
│   ├── scheduler.ts                  # node-cron monthly credit reset
│   ├── config/
│   │   ├── env.ts                    # Env var validation (zod)
│   │   └── redis.ts                  # Redis client singleton
│   ├── db/
│   │   └── prisma.ts                 # Prisma client singleton
│   ├── middleware/
│   │   ├── tenantContext.ts          # RLS context setter
│   │   ├── rateLimiter.ts            # express-rate-limit configs
│   │   └── auth.ts                   # Bot token verification
│   ├── services/
│   │   ├── TenantService.ts          # Workspace provisioning + onboarding
│   │   ├── MeetingService.ts         # Meeting fetch + attendee resolution
│   │   ├── CostEngine.ts             # Cost calculation
│   │   ├── NotificationService.ts    # Slack DM composer + sender
│   │   ├── DigestService.ts          # Weekly digest builder
│   │   └── UsageService.ts           # Credit tracking + enforcement
│   ├── queues/
│   │   ├── index.ts                  # Queue definitions
│   │   └── workers/
│   │       ├── pollWorker.ts         # Google Calendar poller
│   │       ├── analyzeWorker.ts      # Meeting cost analyzer
│   │       ├── notifyWorker.ts       # Slack DM sender
│   │       └── digestWorker.ts       # Weekly digest sender
│   ├── slack/
│   │   ├── oauth.ts                  # Slack OAuth install handler
│   │   ├── handlers/
│   │   │   ├── appHome.ts            # App Home tab builder
│   │   │   ├── commands.ts           # Slash command handlers
│   │   │   └── actions.ts            # Block Kit button actions
│   │   └── blocks/
│   │       ├── meetingCostDM.ts      # Post-meeting DM blocks
│   │       ├── weeklyDigest.ts       # Weekly digest blocks
│   │       └── appHomeTabs.ts        # App Home tab blocks
│   ├── google/
│   │   ├── auth.ts                   # Google OAuth + token refresh
│   │   └── calendar.ts               # Calendar event fetcher
│   ├── routes/
│   │   ├── health.ts                 # /health + /metrics
│   │   ├── auth.ts                   # /auth/google/*
│   │   └── api.ts                    # /api/workspaces/* REST routes
│   └── utils/
│       ├── encryption.ts             # AES-256-GCM encrypt/decrypt
│       ├── formatter.ts              # Currency + duration formatters
│       ├── logger.ts                 # Pino structured logger
│       └── metrics.ts                # Prometheus metrics registry
├── prisma/
│   ├── schema.prisma                 # Prisma schema
│   └── migrations/                   # SQL migration files
├── db/
│   └── init.sql                      # RLS policies + DB roles
├── nginx/
│   └── nginx.conf                    # Nginx reverse proxy config
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 16. Build Plan (2 Weeks)

### Week 1 — Infrastructure & Core Engine

| Day | Task |
|-----|------|
| Day 1 | Project scaffold: TypeScript + Prisma + Docker Compose (app, worker, db, pgbouncer, redis) |
| Day 2 | PostgreSQL schema + RLS policies + DB roles + `withTenantContext` middleware |
| Day 3 | Slack OAuth install flow + workspace provisioning + TenantService |
| Day 4 | Google Calendar OAuth flow + token encryption + `scheduleWorkspacePoller` |
| Day 5 | BullMQ queue definitions + pollWorker + Calendar event fetcher |

### Week 2 — Slack UX, Workers & Observability

| Day | Task |
|-----|------|
| Day 6 | analyzeWorker + CostEngine + attendee rate resolution |
| Day 7 | notifyWorker + post-meeting DM Block Kit UI |
| Day 8 | Outcome logging button actions + async flag interactions |
| Day 9 | DigestService + digestWorker + weekly digest DM |
| Day 10 | App Home tab (onboarding flow + salary tier CRUD + credits) |
| Day 11 | Slash commands + UsageService credit enforcement + upgrade nudge |
| Day 12 | Sentry + Prometheus metrics + Pino logging + health check endpoint |

### MVP Scope Boundaries

**In scope:**
- Google Calendar (single primary calendar per workspace)
- Post-meeting cost DM to organizer
- Weekly digest DM
- Salary tier configuration
- Usage-based credit system
- BullMQ job queue with retries
- RLS tenant isolation
- PgBouncer connection pooling
- Sentry + Prometheus + structured logging
- Docker Compose full stack

**Out of scope for MVP:**
- Stripe payment integration
- Outlook / Microsoft calendar
- Channel-level public reporting
- AI meeting ROI scoring
- HRIS integration
- Multi-calendar support per workspace

---

## 17. Future Roadmap (v3)

| Feature | Description |
|---------|-------------|
| Stripe integration | Credit purchase flow with webhooks + automatic top-up |
| Outlook support | Microsoft Graph API calendar integration |
| AI ROI Scoring | LLM scores meeting value from logged outcomes (Gemini Flash) |
| Channel digest | Optional public weekly cost report to a team channel |
| HRIS sync | Pull roles + salaries directly from BambooHR / Workday |
| Anomaly alerts | Alert when team meeting cost spikes >30% week-over-week |
| Async suggestions | Auto-suggest converting low-ROI recurring meetings to async |
| PDF / CSV export | Download meeting cost reports for finance teams |
| SSO | SAML / SCIM for enterprise workspace management |
| Audit logs | Immutable per-tenant audit trail for enterprise compliance |
| Dedicated infra | Option for large enterprise tenants to get isolated DB schema |

---

*MeetingBill AI v2.0 — Production Multi-Tenant System Design*  
*Making the invisible cost of meetings visible, at scale.*
