# MeetingBill AI — Implementation Plan

> **Stack:** TypeScript · Slack Bolt · PostgreSQL (RLS) · Redis · BullMQ · PgBouncer · Docker
> **Reference:** `meetingbill-ai-production-system-design.md`

---

## Architecture Data Flow

```
Slack OAuth Install
  └─► TenantService.provisionWorkspace → DB row + welcome DM
        └─► Admin connects Google Calendar (OAuth2)
              └─► scheduleWorkspacePoller (BullMQ repeatable job, every 5 min)
                    └─► pollWorker → fetchRecentlyEndedMeetings
                          └─► analyzeWorker → CostEngine → DB write → deduct credit
                                └─► notifyWorker → DM to organizer
```

Isolation: Shared DB + shared schema + PostgreSQL RLS.
Every DB call sets `app.current_workspace_id` via `withTenantContext()` before executing.

---

## Phase 1 — Project Scaffold (Day 1)

### T1.1 — Initialize TypeScript Project
- tsconfig: target ES2022, strict: true, outDir: dist
- Scripts: build, start, dev (ts-node-dev), worker
- .gitignore: node_modules, dist, .env
- **Done when:** `npm run build` exits 0

### T1.2 — Docker Compose Full Stack
- Services: app, worker, db (postgres:15-alpine), pgbouncer (bitnami), redis (redis:7-alpine), nginx
- db healthcheck: pg_isready; redis: redis-cli ping
- app + worker depend_on db + redis healthy
- Named volumes: postgres_data, redis_data
- **Done when:** `docker-compose up` → all green

### T1.3 — Env Validation with Zod
**File:** `src/config/env.ts`
- Zod schema for all 16 env vars (design doc §14.3)
- Export typed `env` — consumers never use process.env directly
- On failure: log missing vars + process.exit(1)
- **Done when:** Remove SLACK_CLIENT_ID → app exits with clear error

### T1.4 — Prisma Schema + First Migration
**Files:** `prisma/schema.prisma`, `prisma/migrations/`
- Models: Workspace, SalaryTier, WorkspaceMember, Meeting, WeeklyDigest, UsageLog
- All FK: onDelete Cascade
- hourly_rate on SalaryTier: dbgenerated (annual_salary / 2080)
- UNIQUE: workspace+role_name, workspace+slackUserId, workspace+googleEventId, workspace+weekStart
- **Done when:** psql shows all 6 tables with correct schema

### T1.5 — AES-256-GCM Encryption
**File:** `src/utils/encryption.ts`
- encrypt(plaintext): string → iv:tag:ciphertext (hex-encoded)
- decrypt(payload): string → reverses above
- Key: env.ENCRYPTION_KEY (64-char hex = 32 bytes)
- **Done when:** unit test encrypt→decrypt returns original

### T1.6 — Pino Structured Logger
**File:** `src/utils/logger.ts`
- level from env.LOG_LEVEL
- redact: googleTokens, botToken, password, email, accessToken, refreshToken
- All calls include workspaceId when available
- **Done when:** log line is JSON with redacted fields showing [Redacted]

---

## Phase 2 — Database Security Layer (Day 2)

### T2.1 — DB Init SQL (RLS + Roles)
**File:** `db/init.sql`
- Enable RLS on: salary_tiers, workspace_members, meetings, weekly_digests, usage_logs
- Policy: USING (workspace_id::text = current_setting('app.current_workspace_id', true))
- meetingbill_app: SELECT/INSERT/UPDATE/DELETE only — no BYPASSRLS, no DDL
- meetingbill_admin: BYPASSRLS (migrations only)
- All indexes from design doc §3.1
- **Done when:** query as meetingbill_app without context → 0 rows

### T2.2 — Tenant Context Middleware
**File:** `src/middleware/tenantContext.ts`
- withTenantContext<T>(workspaceId, fn): Promise<T>
- Opens Prisma tx → SET LOCAL app.current_workspace_id → calls fn
- LOCAL required for PgBouncer transaction-pooling mode
- Used in every service method touching tenant tables
- **Done when:** query inside withTenantContext(workspaceA) returns only workspace A rows

### T2.3 — Prisma Client Singleton
**File:** `src/db/prisma.ts`
- Singleton pointing to PgBouncer (DATABASE_URL)
- Log queries >500ms at warn level
- **Done when:** same instance from any import; slow query triggers warn

---

## Phase 3 — Slack OAuth & Tenant Provisioning (Day 3)

### T3.1 — Slack Bolt App Setup
**File:** `src/app.ts`
- HTTP mode (not Socket Mode — production requirement)
- Bolt verifies signingSecret automatically on every request
- Express middleware: Helmet, rate limiters, Sentry request handler
- Bolt + Express share port 3000
- **Done when:** wrong signing secret → 401

### T3.2 — Slack OAuth Install Flow
**File:** `src/slack/oauth.ts`
- GET /slack/install → redirect to Slack OAuth URL
- Scopes: chat:write, commands, app_mentions:read, im:write, users:read, users:read.email, app_home:read, app_home:write
- GET /slack/oauth_redirect → exchange code → TenantService.provisionWorkspace
- Handle reinstall (upsert) + app_uninstalled event → deprovision
- **Done when:** install in browser → workspace row in DB with encrypted bot token

### T3.3 — TenantService
**File:** `src/services/TenantService.ts`

| Method | Action |
|--------|--------|
| provisionWorkspace(slackTeamId, botToken, adminSlackId) | Upsert workspace (plan: free, credits: 20, state: pending) → encrypt token → sendWelcomeDM |
| onCalendarConnected(workspaceId) | googleConnected: true, state: calendar_connected → schedulePoller → sendCalendarConnectedDM |
| onTiersSet(workspaceId) | state: complete → sendOnboardingCompleteDM |
| deprovisionWorkspace(workspaceId) | Remove BullMQ job → soft-delete (isActive: false, clear tokens) |

**Done when:** unit tests pass for all 4 methods

---

## Phase 4 — Google Calendar OAuth (Day 4)

### T4.1 — Google OAuth URL Generator
**File:** `src/routes/auth.ts`
- GET /auth/google?workspaceId=... → sign JWT {workspaceId} 10-min expiry → build OAuth URL → redirect
- Scope: https://www.googleapis.com/auth/calendar.readonly
- state = signed JWT (CSRF prevention)
- authLimiter: 20 req / 15 min
- **Done when:** URL → Google consent screen with correct scope

### T4.2 — Google OAuth Callback
**File:** `src/routes/auth.ts`
- GET /auth/google/callback?code=...&state=...
- Verify JWT signature + expiry (reject if invalid)
- Exchange code for {access_token, refresh_token, expiry_date}
- encrypt(JSON.stringify(tokens)) → workspace.googleTokens
- TenantService.onCalendarConnected(workspaceId)
- **Done when:** google_connected = true in DB with encrypted tokens

### T4.3 — Calendar Client Factory (Auto-Refresh)
**File:** `src/google/auth.ts`
- getCalendarClient(workspaceId) → decrypt tokens → OAuth2 client → register tokens event (re-encrypt + persist on refresh)
- Never log token values
- **Done when:** expired token → next poll auto-refreshes + persists

### T4.4 — Calendar Event Fetcher
**File:** `src/google/calendar.ts`
- fetchRecentlyEndedMeetings(workspaceId): timeMin = 5 min ago, timeMax = now
- fields = 'items(id,summary,start,end,attendees,organizer)' — NO description/attachments (privacy)
- Filter: attendees.length > 1 only
- Map to CalendarEvent {id, title, startTime, endTime, durationMinutes, attendees[], organizerEmail}
- On API error: log + rethrow (BullMQ retries)
- **Done when:** unit test with mocked API returns correctly filtered events

---

## Phase 5 — BullMQ Infrastructure (Day 5)

### T5.1 — Redis Singleton
**File:** `src/config/redis.ts`
- ioredis with maxRetriesPerRequest: null (BullMQ requirement)
- Auth: env.REDIS_PASSWORD
- **Done when:** redis.ping() returns PONG in startup log

### T5.2 — Queue Definitions
**File:** `src/queues/index.ts`

| Queue | Name | Attempts | Backoff | removeOnComplete |
|-------|------|----------|---------|-----------------|
| pollQueue | meeting:poll | 3 | exponential 5s | 100 |
| analyzeQueue | meeting:analyze | 3 | exponential 3s | 200 |
| notifyQueue | notification:send | 5 | fixed 2s | 500 |
| digestQueue | digest:weekly | 3 | exponential 10s | — |

**Done when:** all 4 queues visible via getJobCounts()

### T5.3 — scheduleWorkspacePoller
**File:** `src/queues/index.ts`
- scheduleWorkspacePoller(workspaceId): repeat every 300,000ms; jobId: poll-${workspaceId}
- removeWorkspacePoller(workspaceId): removes repeatable job
- **Done when:** add workspace → Redis has repeatable job; remove → gone

### T5.4 — Poll Worker
**File:** `src/queues/workers/pollWorker.ts`
- Concurrency: 50
- Per workspace: fetchRecentlyEndedMeetings → dedup check → add to analyzeQueue
- On API error: log + throw (BullMQ retries)
- Increment meetingbill_poll_runs_total counter
- **Done when:** meeting ends → analyze job appears within 5 min

---

## Phase 6 — Cost Engine & Analyze Worker (Day 6)

### T6.1 — CostEngine
**File:** `src/services/CostEngine.ts`
- CostEngine.calculate(durationMinutes, attendees[]): CostResult — pure function, no side effects
- Formula: cost = hourlyRate × (durationMinutes / 60) per attendee; totalCost = sum
- Types: AttendeeInput {slackUserId, hourlyRate}, CostResult {totalCost, costPerMinute, breakdown[]}
- Unit tests: 0 attendees, 1 attendee, mixed rates, fractional duration
- **Done when:** all unit tests pass

### T6.2 — MeetingService (Rate Resolution)
**File:** `src/services/MeetingService.ts`
- resolveAttendees(workspaceId, calendarAttendees[]): AttendeeInput[]
- 4-level priority:
  1. workspace_members.hourly_rate (email match)
  2. salary_tiers.hourly_rate (by role_name)
  3. workspace.default_hourly_rate
  4. $50/hr global fallback
- All DB lookups inside withTenantContext
- **Done when:** integration test with seeded tiers → correct rate at each level

### T6.3 — Analyze Worker
**File:** `src/queues/workers/analyzeWorker.ts`
- Concurrency: 20; rate limit: 50 jobs / 10 seconds
- Pipeline:
  1. checkCredits → if false: upgrade nudge → return
  2. resolveAttendees
  3. CostEngine.calculate
  4. persist Meeting (withTenantContext, upsert on workspaceId+googleEventId)
  5. deductCredit
  6. notifyQueue.add('send-dm', {workspaceId, meetingId, slackUserId})
- **Done when:** end-to-end → meeting in DB, credit decremented, notify enqueued

### T6.4 — UsageService
**File:** `src/services/UsageService.ts`
- checkCredits(workspaceId): true if plan === 'pro' OR credits > 0
- deductCredit(workspaceId, meetingId): tx: decrement + insert usage_log; warn at 5 and 0 credits
- resetMonthlyCredits(): starter → 200, growth → 1000
- **Done when:** 0 credits → checkCredits false → upgrade nudge sent

---

## Phase 7 — Slack Notifications (Day 7)

### T7.1 — Post-Meeting DM Block Kit Builder
**File:** `src/slack/blocks/meetingCostDM.ts`
- buildMeetingCostDM(meeting, avgCost): Block[]
- header → divider → fields (attendees, duration, cost, avg) → optional % context → 3 action buttons
- Actions: meeting_worth_it, meeting_flag_async, meeting_log_outcome
- block_id: meeting_actions_${meeting.id}
- **Done when:** visual check in Block Kit Builder matches design doc §7.1

### T7.2 — NotificationService
**File:** `src/services/NotificationService.ts`
- KEY RULE: every DM uses workspace's own decrypted botToken — never a shared global token
- sendMeetingCostDM: load meeting → calc avgCost (last 30 for organizer) → build blocks → post DM → dmSent = true
- sendWelcomeDM, sendCalendarConnectedDM, sendOnboardingCompleteDM, sendUpgradeNudge, sendLowCreditWarning
- **Done when:** meeting analyzed → DM received in Slack within 5 min

### T7.3 — Notify Worker
**File:** `src/queues/workers/notifyWorker.ts`
- Concurrency: 10; route by job.name: send-dm, low-credits, upgrade-nudge
- **Done when:** dm_sent = true in DB + DM in Slack

---

## Phase 8 — Block Kit Interactions (Day 8)

### T8.1 — Action Handlers
**File:** `src/slack/handlers/actions.ts`

| Action ID | DB Update | Reply |
|-----------|-----------|-------|
| meeting_worth_it | outcome_logged = 'worth_it' | Ephemeral "Noted! ✅" |
| meeting_flag_async | flagged_async = true | Ephemeral "Flagged 🔄" |
| meeting_log_outcome | opens modal | — |

- Verify meetingId belongs to acting user's workspace (IDOR prevention)
- Always ack() immediately (Slack requires <3s)
- **Done when:** each button → correct DB update + ephemeral reply

### T8.2 — Log Outcome Modal
**File:** `src/slack/handlers/actions.ts`
- callback_id: log_outcome_modal; private_metadata carries meetingId
- On submit: save to meeting.outcome_logged; validate max 500 chars
- response_action: 'clear' on success
- **Done when:** submit → DB updated → modal closes cleanly

---

## Phase 9 — Weekly Digest (Day 9)

### T9.1 — DigestService
**File:** `src/services/DigestService.ts`
- buildWeeklyDigest(workspaceId, weekStart): totalMeetings, totalCost, totalHours, top 3 expensive, top 3 async candidates, cost delta % vs prior week
- Upserts WeeklyDigest; all queries inside withTenantContext
- **Done when:** unit test with seeded data → correct aggregation

### T9.2 — Weekly Digest Block Kit Builder
**File:** `src/slack/blocks/weeklyDigest.ts`
- Header, stats with ▲/▼ vs last week, top 3 expensive, top 3 async candidates
- **Done when:** visual check matches design doc §7.2

### T9.3 — Digest Worker + Schedulers
**Files:** `src/queues/workers/digestWorker.ts`, `src/scheduler.ts`

| Cron | Schedule | Action |
|------|----------|--------|
| Weekly digest | 0 8 * * 1 | Enqueue digest job per active workspace |
| Credit reset | 0 0 1 * * | UsageService.resetMonthlyCredits() |

**Done when:** manual trigger → correct digest DM received

---

## Phase 10 — App Home Tab (Day 10)

### T10.1 — App Home Builder
**File:** `src/slack/blocks/appHomeTabs.ts`
- Triggered by app_home_opened event (admin only)
- pending: progress (1/3) + Connect Google Calendar button
- calendar_connected: progress (2/3) + salary tier setup
- complete: credits, last 5 meetings with costs, digest link
- **Done when:** each state renders correctly in Slack

### T10.2 — Salary Tier CRUD
**Files:** `src/slack/handlers/actions.ts`, `src/routes/api.ts`
- Add tier modal: role_name (max 128 chars) + annual_salary (1–9,999,999)
- Delete with ephemeral confirm step
- REST: POST, GET, DELETE /api/workspaces/:id/salary-tiers
- All routes: bot token auth middleware; workspace must match URL param
- **Done when:** add → in App Home; delete → gone from DB

---

## Phase 11 — Slash Commands & Auth (Day 11)

### T11.1 + T11.2 — Slash Commands
**File:** `src/slack/handlers/commands.ts`

| Subcommand | Response |
|------------|---------|
| report | Current week digest blocks (ephemeral) |
| setup | Deep link to App Home |
| credits | "You have X credits (Plan: Y)" |
| connect | Google OAuth URL for this workspace |
| help | Formatted command list |

Always ack() immediately; unknown subcommand → help text.
**Done when:** each command tested manually in Slack

### T11.3 — Bot Token Auth Middleware
**File:** `src/middleware/auth.ts`
- Extract Authorization: Bearer <token>
- Decrypt stored token for workspaceId in URL → compare → 401 if mismatch
- Never log token value
- **Done when:** wrong token → 401; correct → passes through

---

## Phase 12 — Observability & Hardening (Day 12)

### T12.1 — Sentry
- Sentry.init in app + all workers; beforeSend strips PII
- Worker .on('failed') → Sentry.captureException with workspaceId tag
- **Done when:** test error → appears in Sentry with workspaceId

### T12.2 — Prometheus Metrics
**File:** `src/utils/metrics.ts`

| Type | Name | Labels / Buckets |
|------|------|-----------------|
| Counter | meetingbill_meetings_analyzed_total | workspace_id, plan |
| Counter | meetingbill_poll_runs_total | — |
| Histogram | meetingbill_meeting_cost_usd | 50,100,250,500,1000,2500,5000 |
| Gauge | meetingbill_active_workspaces | — |
| Gauge | meetingbill_queue_depth | queue_name |

**Done when:** curl /metrics → all metrics in Prometheus text format

### T12.3 — /health + /metrics Endpoints
**File:** `src/routes/health.ts`
- GET /health: ping DB + Redis → {status, db, redis, uptime, timestamp} → 200 or 503
- GET /metrics: Prometheus output; Nginx restricts to internal IPs

### T12.4 — Rate Limiters
**File:** `src/middleware/rateLimiter.ts`

| Limiter | Limit | Key |
|---------|-------|-----|
| slackWebhookLimiter | 500 req/min | x-slack-team-id |
| apiLimiter | 100 req/min | workspaceId |
| authLimiter | 20 req / 15 min | IP |

**Done when:** exceed limit → 429 with Retry-After header

### T12.5 — Nginx Config
**File:** `nginx/nginx.conf`
- HTTP → HTTPS (301); SSL; upstream app:3000
- /metrics: allow 10.0.0.0/8; deny all
- client_max_body_size 10m

### T12.6 — Multi-Stage Dockerfile
- builder: node:20-alpine, npm ci, npm run build
- production: npm ci --only=production, copy dist/ + prisma/, USER node
- CMD: npx prisma migrate deploy && node dist/app.js

### T12.7 — .env.example
All 16 vars with placeholders + generation commands inline.

---

## Dependency Order (Critical Path)

```
T1.3 (env) ← BLOCKS EVERYTHING — do first
T1.4 → T2.1 → T2.2  (RLS chain — before any DB calls)
T1.5 → T3.3          (encryption needed in TenantService)
T2.2 + T3.3 → T3.2   (Slack OAuth needs both)
T3.2 → T4.1 → T4.2 → T4.3 → T4.4
T5.1 → T5.2 → T5.3 → T5.4
T5.4 + T6.1 + T6.2 + T6.4 → T6.3
T6.3 + T7.1 → T7.2 → T7.3
T7.2 + T9.1 + T9.2 → T9.3
T10.1 + T10.2 + T11.1 → T11.2
All → T12.1-T12.7
```

---

## MVP Scope

| In Scope | Out of Scope |
|----------|-------------|
| Google Calendar (primary only) | Stripe payments |
| Post-meeting DM to organizer | Outlook / Microsoft Calendar |
| Weekly digest DM to admin | Channel-level public reporting |
| Salary tier config via App Home | AI ROI scoring |
| Credit system (free/starter/growth/pro) | HRIS integration |
| BullMQ queues with retries | Multi-calendar per workspace |
| RLS tenant isolation (DB-level) | PDF / CSV export |
| PgBouncer connection pooling | SSO / SAML |
| Sentry + Prometheus + Pino | — |
| Docker Compose + Nginx | — |

---

## Pre-Coding Checklist

```bash
# 1. Slack App — api.slack.com/apps
#    Get: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET
#    Add slash command: /meetingbill
#    Events: app_home_opened, app_uninstalled
#    OAuth redirect: https://yourdomain.com/slack/oauth_redirect

# 2. Google Cloud — console.cloud.google.com
#    Scope: https://www.googleapis.com/auth/calendar.readonly
#    Redirect URI: https://yourdomain.com/auth/google/callback
#    Get: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

# 3. Sentry — Node.js project → SENTRY_DSN

# 4. Generate secrets
openssl rand -hex 32     # ENCRYPTION_KEY
openssl rand -base64 48  # JWT_SECRET, DB_PASSWORD, REDIS_PASSWORD, DB_ROOT_PASSWORD
```

---

*MeetingBill AI — Implementation Plan v1.0*
