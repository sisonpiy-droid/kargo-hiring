// POST multipart { file, role } -> extract PII, score on both rubrics, draft brief + emails, save.
import { checkPasscode } from "@/lib/auth";
import { cvFileToText, MAX_FILE_BYTES } from "@/lib/cv-text";
import { extractPii } from "@/lib/pii";
import { scoreCv, draftCommunications } from "@/lib/pipeline";
import { db, q, loadCriteria } from "@/lib/db";

export const maxDuration = 120;

export async function POST(request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  const form = await request.formData();
  const file = form.get("file");
  const role = form.get("role");
  if (!["PM", "SPM"].includes(role)) return Response.json({ error: "role must be PM or SPM" }, { status: 400 });
  if (!file || typeof file === "string") return Response.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return Response.json({ error: "File is over 5 MB" }, { status: 400 });

  let candidateId;
  try {
    const raw = await cvFileToText(file);

    // 1. Split personal details off. Only `cvText` (redacted) goes any further toward the AI.
    const { pii, cvText } = extractPii(raw);

    // 2-3. AI steps, before anything is written, so a failure leaves no half-saved candidate.
    const criteria = await loadCriteria();
    const scoring = await scoreCv(cvText, criteria);
    const drafts = await draftCommunications(cvText, role, scoring, criteria);

    // 4. Save: anonymised content, PII (separate table), per-criterion scores.
    const [candidate] = await q(
      db().from("candidates").insert({
        applied_role: role,
        file_name: file.name,
        cv_text: cvText,
        pm_score: scoring.PM.total,
        spm_score: scoring.SPM.total,
        brief: drafts.brief,
        invite_draft: drafts.invite,
        rejection_draft: drafts.rejection,
      }).select("id")
    );
    candidateId = candidate.id;
    await q(db().from("candidate_pii").insert({ candidate_id: candidateId, ...pii }));
    await q(
      db().from("scores").insert(
        [...scoring.PM.rows, ...scoring.SPM.rows].map((r) => ({
          candidate_id: candidateId, criterion_id: r.criterion_id, score: r.score, reason: r.reason,
        }))
      )
    );

    return Response.json({ id: candidateId, pm_score: scoring.PM.total, spm_score: scoring.SPM.total, name_found: !!pii.name, email_found: !!pii.email });
  } catch (err) {
    if (candidateId) await db().from("candidates").delete().eq("id", candidateId); // cascades to pii + scores
    console.error("upload failed:", err.message); // message only; never the CV or PII
    return Response.json({ error: err.message }, { status: 500 });
  }
}
