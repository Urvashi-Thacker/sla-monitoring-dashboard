create table if not exists uploads (
    id              bigserial primary key,
    filename        text        not null,
    file_hash       text        unique,
    uploaded_at     timestamptz not null default now(),
    total_rows      int         not null,
    accepted_rows   int         not null,
    rejected_rows   int         not null,
    period_start    timestamptz,
    period_end      timestamptz,
    issues          jsonb       not null default '{}'::jsonb
);

create table if not exists checks (
    id            bigserial primary key,
    upload_id     bigint      not null references uploads(id) on delete cascade,
    service_id    text        not null,
    service_name  text        not null,
    ts            timestamptz not null,
    status_code   smallint    not null,
    is_up         boolean     not null,
    latency_ms    real,
    agent         text        not null,
    region        text,
    flags         text[]      not null default '{}',
    source_line   int         not null,
    unique (upload_id, service_id, ts, agent)
);
create index if not exists checks_upload_ts on checks (upload_id, ts);

create table if not exists rejected_rows (
    id          bigserial primary key,
    upload_id   bigint not null references uploads(id) on delete cascade,
    line        int    not null,
    raw         text   not null,
    reason      text   not null
);
create index if not exists rejected_upload on rejected_rows (upload_id);

alter table uploads       enable row level security;
alter table checks        enable row level security;
alter table rejected_rows enable row level security;
