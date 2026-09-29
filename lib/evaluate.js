// Runs both AI steps on redacted CV text and returns what to store.
// Shared by the upload route and the scripts.
import { scoreCv, draftCommunications } from "./pipeline.js";

// `role` is the key of the job applied for; every job with a rubric is scored.
export async function evaluateCv(cvText, role, criteria, jobs) {
  const job = jobs.find((j) => j.key === role);
  if (!job) throw new Error(`Unknown job ${role}`);
  const scoring = await scoreCv(cvText, criteria, jobs);
  if (!scoring.byJob[role]) throw new Error(`${job.title} has no rubric yet`);
  const drafts = await draftCommunications(cvText, job, scoring, criteria);
  const jobScores = Object.fromEntries(Object.entries(scoring.byJob).map(([k, v]) => [k, v.total]));
  return {
    fields: {
      job_scores: jobScores,
      pm_score: jobScores.PM ?? null,
      spm_score: jobScores.SPM ?? null,
      risk_score: scoring.risk,
      eval: drafts.eval,
      brief: drafts.eval.brief.join("\n\n"),
      invite_subject: drafts.inviteSubject,
      invite_draft: drafts.invite,
      rejection_draft: drafts.rejection,
    },
    scoreRows: Object.values(scoring.byJob).flatMap((v) => v.rows).map((r) => ({
      criterion_id: r.criterion_id, score: r.score, reason: r.reason,
    })),
    match: jobScores[role],
    risk: scoring.risk,
  };
}
