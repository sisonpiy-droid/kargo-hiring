// Runs both AI steps on redacted CV text and returns what to store.
// Shared by the upload route and scripts/rescore.mjs.
import { scoreCv, draftCommunications } from "./pipeline.js";

export async function evaluateCv(cvText, role, criteria) {
  const scoring = await scoreCv(cvText, criteria);
  const drafts = await draftCommunications(cvText, role, scoring, criteria);
  return {
    fields: {
      pm_score: scoring.PM.total,
      spm_score: scoring.SPM.total,
      risk_score: scoring.risk,
      eval: drafts.eval,
      brief: drafts.eval.brief.join("\n\n"),
      invite_subject: drafts.inviteSubject,
      invite_draft: drafts.invite,
      rejection_draft: drafts.rejection,
    },
    scoreRows: [...scoring.PM.rows, ...scoring.SPM.rows].map((r) => ({
      criterion_id: r.criterion_id, score: r.score, reason: r.reason,
    })),
    match: scoring[role].total,
    risk: scoring.risk,
  };
}
