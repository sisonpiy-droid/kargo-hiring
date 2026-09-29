// POST { key, id } -> score one existing candidate against one job's rubric (the
// "Score existing CVs" button calls this once per CV). Only the redacted CV text is sent.
import { checkPasscode } from "@/lib/auth";
import { db, q } from "@/lib/db";
import { scoreCv } from "@/lib/pipeline";

export const maxDuration = 60;

export async function POST(request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  const { key, id } = await request.json().catch(() => ({}));
  try {
    const [job] = await q(db().from("jobs").select("key, title").eq("key", String(key || "")));
    if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
    const [c] = await q(db().from("candidates").select("id, cv_text, job_scores").eq("id", String(id || "")));
    if (!c) return Response.json({ error: "Candidate not found" }, { status: 404 });
    if (c.job_scores?.[key] != null) return Response.json({ ok: true, match: c.job_scores[key], skipped: true });

    const criteria = await q(db().from("rubric_criteria").select("*").eq("role", key));
    const scoring = await scoreCv(c.cv_text, criteria, [job]);
    const result = scoring.byJob[key];
    await q(db().from("scores").delete().eq("candidate_id", c.id).in("criterion_id", criteria.map((k) => k.id)));
    await q(db().from("scores").insert(result.rows.map((r) => ({ candidate_id: c.id, criterion_id: r.criterion_id, score: r.score, reason: r.reason }))));
    await q(db().from("candidates").update({ job_scores: { ...(c.job_scores || {}), [key]: result.total } }).eq("id", c.id));
    return Response.json({ ok: true, match: result.total });
  } catch (err) {
    console.error("score for job failed:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
