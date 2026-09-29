-- v3: jobs. PM and SPM become preset jobs; new jobs (each with its own JD and rubric)
-- can be added and deleted. Deleting CVs never touches jobs or rubrics.
-- Run once in Supabase > SQL Editor, after migrate-v2.sql. Safe to re-run.

create table if not exists jobs (
  key        text primary key,            -- 'PM', 'SPM', or 'J' + random for new jobs
  title      text not null,
  jd_text    text,
  preset     boolean not null default false,
  created_at timestamptz not null default now()
);
alter table jobs enable row level security;

insert into jobs (key, title, preset) values
  ('PM', 'Product Manager', true),
  ('SPM', 'Senior Product Manager', true)
on conflict (key) do nothing;

-- Roles are no longer limited to PM / SPM: they must be a job.
alter table rubric_criteria drop constraint if exists rubric_criteria_role_check;
alter table candidates      drop constraint if exists candidates_applied_role_check;
alter table rubric_criteria drop constraint if exists rubric_criteria_role_fkey;
alter table rubric_criteria add constraint rubric_criteria_role_fkey foreign key (role) references jobs(key) on delete cascade;
alter table candidates      drop constraint if exists candidates_applied_role_fkey;
alter table candidates      add constraint candidates_applied_role_fkey foreign key (applied_role) references jobs(key);

-- Scores for a deleted criterion (i.e. a deleted job) go with it.
alter table scores drop constraint if exists scores_criterion_id_fkey;
alter table scores add constraint scores_criterion_id_fkey foreign key (criterion_id) references rubric_criteria(id) on delete cascade;

-- Match % per job, e.g. {"PM": 72.5, "SPM": 40, "J3f9a": 81}. Replaces pm_score / spm_score.
alter table candidates add column if not exists job_scores jsonb not null default '{}'::jsonb;
update candidates
   set job_scores = jsonb_strip_nulls(jsonb_build_object('PM', pm_score, 'SPM', spm_score))
 where job_scores = '{}'::jsonb and (pm_score is not null or spm_score is not null);
