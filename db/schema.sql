-- Kargo hiring dashboard schema. Paste into Supabase > SQL Editor and run once.
-- RLS is enabled with no policies: only the server (service role key) can read
-- or write. The browser never talks to Supabase directly.

create table if not exists rubric_criteria (
  id          serial primary key,
  role        text not null check (role in ('PM', 'SPM')),
  position    int  not null,
  name        text not null,
  description text not null,
  weight      int  not null check (weight between 0 and 100),
  unique (role, position)
);

-- Anonymised CV content + pipeline output + email status. No name/email/phone here.
create table if not exists candidates (
  id              uuid primary key default gen_random_uuid(),
  applied_role    text not null check (applied_role in ('PM', 'SPM')),
  file_name       text,
  cv_text         text not null,          -- PII-redacted; this is all the AI ever sees
  pm_score        numeric(5,1),           -- weighted total, 0-100
  spm_score       numeric(5,1),
  brief           text,                   -- 3-sentence interview brief
  invite_draft    text,                   -- uses [NAME]; real name substituted at send time
  rejection_draft text,
  status          text not null default 'scored' check (status in ('scored', 'sent')),
  sent_email_type text check (sent_email_type in ('invite', 'rejection')),
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

-- Personal details, stored separately and never passed to any AI step.
create table if not exists candidate_pii (
  candidate_id uuid primary key references candidates(id) on delete cascade,
  name         text,
  email        text,
  phone        text
);

create table if not exists scores (
  id           serial primary key,
  candidate_id uuid not null references candidates(id) on delete cascade,
  criterion_id int  not null references rubric_criteria(id),
  score        int  not null check (score between 0 and 10),
  reason       text not null,
  unique (candidate_id, criterion_id)
);

alter table rubric_criteria enable row level security;
alter table candidates      enable row level security;
alter table candidate_pii   enable row level security;
alter table scores          enable row level security;
