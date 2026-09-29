// POST multipart { file, role, [name], [email] } -> extract PII, score on both rubrics,
// draft brief + emails, save. name/email override what was extracted (single-CV uploads).
import { checkPasscode } from "@/lib/auth";
import { cvFileToText, MAX_FILE_BYTES } from "@/lib/cv-text";
import { extractPii } from "@/lib/pii";
import { evaluateCv } from "@/lib/evaluate";
import { tierOf } from "@/lib/tier";
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
    const nameOverride = String(form.get("name") || "").trim();
    const emailOverride = String(form.get("email") || "").trim();
    if (nameOverride) pii.name = nameOverride.slice(0, 120);
    if (emailOverride) pii.email = emailOverride.slice(0, 200);

    // 2-3. AI steps, before anything is written, so a failure leaves no half-saved candidate.
    const criteria = await loadCriteria();
    const result = await evaluateCv(cvText, role, criteria);

    // 4. Save: anonymised content, PII (separate table), per-criterion scores.
    const [candidate] = await q(
      db().from("candidates").insert({ applied_role: role, file_name: file.name, cv_text: cvText, ...result.fields }).select("id")
    );
    candidateId = candidate.id;
    await q(db().from("candidate_pii").insert({ candidate_id: candidateId, ...pii }));
    await q(db().from("scores").insert(result.scoreRows.map((r) => ({ candidate_id: candidateId, ...r }))));

    return Response.json({
      id: candidateId, match: result.match, risk: result.risk, tier: tierOf(result.match, result.risk),
      name_found: !!pii.name, email_found: !!pii.email,
    });
  } catch (err) {
    if (candidateId) await db().from("candidates").delete().eq("id", candidateId); // cascades to pii + scores
    console.error("upload failed:", err.message); // message only; never the CV or PII
    return Response.json({ error: err.message }, { status: 500 });
  }
}
