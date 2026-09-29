// POST   { title, jd, criteria }  -> create a new job with its rubric.
// DELETE { key }                  -> delete a job you created, its rubric, and the CVs filed
//                                    under it. The preset PM / SPM jobs cannot be deleted.
import { randomBytes } from "node:crypto";
import { checkPasscode } from "@/lib/auth";
import { db, q } from "@/lib/db";
import { validateRubric } from "@/lib/pipeline";

export async function POST(request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  const { title, jd, criteria } = await request.json().catch(() => ({}));
  const name = String(title || "").trim().slice(0, 80);
  if (!name) return Response.json({ error: "Give the job a title" }, { status: 400 });
  let rubric;
  try { rubric = validateRubric(criteria); } catch (err) { return Response.json({ error: err.message }, { status: 400 }); }

  const key = `J${randomBytes(3).toString("hex")}`;
  try {
    await q(db().from("jobs").insert({ key, title: name, jd_text: String(jd || "").slice(0, 20000), preset: false }));
    await q(db().from("rubric_criteria").insert(rubric.map((c, i) => ({ role: key, position: i + 1, ...c }))));
    return Response.json({ ok: true, key });
  } catch (err) {
    await db().from("jobs").delete().eq("key", key); // cascades to any rubric rows written
    console.error("create job failed:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  const { key } = await request.json().catch(() => ({}));
  try {
    const [job] = await q(db().from("jobs").select("key, preset").eq("key", String(key || "")));
    if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
    if (job.preset) return Response.json({ error: "The preset PM and SPM jobs can't be deleted" }, { status: 400 });

    // CVs filed under this job go with it (their PII and scores cascade).
    const removed = await q(db().from("candidates").delete().eq("applied_role", key).select("id"));
    // Drop this job's match % from everyone else; its rubric (and those scores) cascade with the job.
    const others = await q(db().from("candidates").select("id, job_scores"));
    for (const c of others.filter((c) => c.job_scores && key in c.job_scores)) {
      const { [key]: _, ...rest } = c.job_scores;
      await q(db().from("candidates").update({ job_scores: rest }).eq("id", c.id));
    }
    await q(db().from("jobs").delete().eq("key", key));
    return Response.json({ ok: true, candidatesDeleted: removed.length });
  } catch (err) {
    console.error("delete job failed:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
