-- v2: reference-dashboard format. Run once in Supabase > SQL Editor, after schema.sql.
-- Safe to re-run.

alter table candidates add column if not exists ref            serial;           -- shown as KARGO-2026-NNN
alter table candidates add column if not exists risk_score     int not null default 0;
alter table candidates add column if not exists eval           jsonb;            -- summary, brief[], strengths[], risks[], probes[], reasoning, risk_flags[]
alter table candidates add column if not exists invite_subject text;
alter table candidates add column if not exists decision       text;             -- null | 'reconsidered' | 'passed'
alter table candidates add column if not exists scheduled_for  timestamptz;      -- when a scheduled rejection will arrive

alter table candidates drop constraint if exists candidates_decision_check;
alter table candidates add constraint candidates_decision_check check (decision in ('reconsidered', 'passed'));
