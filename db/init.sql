-- ─────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────
-- WORKSPACES (tenant registry)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
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
CREATE TABLE IF NOT EXISTS salary_tiers (
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
CREATE TABLE IF NOT EXISTS workspace_members (
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
CREATE TABLE IF NOT EXISTS meetings (
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
CREATE TABLE IF NOT EXISTS weekly_digests (
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
CREATE TABLE IF NOT EXISTS usage_logs (
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
CREATE INDEX IF NOT EXISTS idx_salary_tiers_workspace ON salary_tiers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_email ON workspace_members(workspace_id, slack_email);
CREATE INDEX IF NOT EXISTS idx_meetings_workspace ON meetings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meetings_end_time ON meetings(workspace_id, end_time DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_organizer ON meetings(workspace_id, organizer_slack_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_workspace ON usage_logs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_digests_workspace ON weekly_digests(workspace_id, week_start DESC);

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
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'meetingbill_app') THEN
    CREATE ROLE meetingbill_app LOGIN PASSWORD 'your_db_password_here';
  END IF;
  
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'meetingbill_admin') THEN
    CREATE ROLE meetingbill_admin LOGIN PASSWORD 'your_db_password_here' BYPASSRLS;
  END IF;
END $$;

GRANT CONNECT ON DATABASE meetingbill TO meetingbill_app;
GRANT USAGE ON SCHEMA public TO meetingbill_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO meetingbill_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO meetingbill_app;
