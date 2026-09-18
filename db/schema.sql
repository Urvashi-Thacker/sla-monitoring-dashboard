-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run

create table if not exists uploads (
    id              bigserial primary key,
    filename        text        not null,
    uploaded_at     timestamptz not null default now(),
    total_rows      int         not null,
    accepted_rows   int         not null,
    rejected_rows   int         not null,
    period_start    timestamptz,
    period_end      timestamptz,          -- exclusive (last slot + 15 min)
    issues          jsonb       not null default '{}'::jsonb  -- issue -> count
);

-- One row per accepted check (per agent). Slot-level merging happens at query time.
create table if not exists checks (
    id            bigserial primary key,
    upload_id     bigint      not null references uploads(id) on delete cascade,
    service_id    text        not null,
    service_name  text        not null,
    ts            timestamptz not null,   -- always UTC
    status_code   smallint    not null,
    is_up         boolean     not null,   -- 2xx
    latency_ms    real,                   -- null when missing/invalid in source
    agent         text        not null,
    region        text,
    flags         text[]      not null default '{}',  -- what cleaning changed
    source_line   int         not null,
    unique (upload_id, service_id, ts, agent)
);
create index if not exists checks_upload_ts on checks (upload_id, ts);

-- Rows we refused, kept for auditability (never silently dropped)
create table if not exists rejected_rows (
    id          bigserial primary key,
    upload_id   bigint not null references uploads(id) on delete cascade,
    line        int    not null,
    raw         text   not null,
    reason      text   not null
);
create index if not exists rejected_upload on rejected_rows (upload_id);

-- The API connects with the Postgres connection string (server side only);
-- the browser never talks to the database, so Row Level Security is enabled
-- with no policies = Supabase's public REST API cannot read these tables.
alter table uploads       enable row level security;
alter table checks        enable row level security;
alter table rejected_rows enable row level security;
