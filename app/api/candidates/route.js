// GET -> every candidate with match, risk, tier, list, rubric evidence, brief and drafts,
// plus which server settings are missing (for the warning banner).
import { checkPasscode } from "@/lib/auth";
import { db, q, loadCriteria } from "@/lib/db";
import { tierOf, listOf } from "@/lib/tier";

export const dynamic = "force-dynamic";

const REQUIRED_ENV = ["GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"];

export async function GET(request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  try {
    const [criteria, candidates, pii, scores] = await Promise.all([
      loadCriteria(),
      q(db().from("candidates").select("id, ref, applied_role, file_name, pm_score, spm_score, risk_score, eval, invite_subject, invite_draft, rejection_draft, decision, status, sent_email_type, sent_at, scheduled_for, created_at")),
      q(db().from("candidate_pii").select("candidate_id, name, email")),
      q(db().from("scores").select("candidate_id, criterion_id, score, reason")),
    ]);

    const piiById = new Map(pii.map((p) => [p.candidate_id, p]));
    const out = candidates.map((c) => {
      const person = piiById.get(c.id) || {};
      const firstName = person.name?.split(" ")[0] || "there";
      const match = Number(c.applied_role === "PM" ? c.pm_score : c.spm_score);
      const risk = c.risk_score ?? 0;
      const tier = tierOf(match, risk);
      const rubric = (role) =>
        criteria.filter((k) => k.role === role).map((k) => {
          const s = scores.find((x) => x.candidate_id === c.id && x.criterion_id === k.id);
          return { name: k.name, weight: k.weight, score: s?.score ?? null, evidence: s?.reason ?? "" };
        });
      return {
        id: c.id,
        ref: `KARGO-2026-${String(c.ref ?? 0).padStart(3, "0")}`,
        name: person.name || "(name not found)",
        email: person.email || null,
        applied_role: c.applied_role,
        file_name: c.file_name,
        match,
        pm_score: Number(c.pm_score),
        spm_score: Number(c.spm_score),
        risk,
        tier,
        decision: c.decision,
        list: listOf(tier, c.decision),
        eval: c.eval || { summary: "", brief: [], strengths: [], risks: [], probes: [], reasoning: "", risk_flags: [] },
        rubric: rubric(c.applied_role),
        invite_subject: c.invite_subject || "Interview invitation from Kargo",
        invite_draft: c.invite_draft.replaceAll("[NAME]", firstName),
        rejection_draft: c.rejection_draft.replaceAll("[NAME]", firstName),
        status: c.status,
        sent_email_type: c.sent_email_type,
        sent_at: c.sent_at,
        scheduled_for: c.scheduled_for,
      };
    });
    out.sort((a, b) => b.match - a.match || a.risk - b.risk);

    return Response.json({
      candidates: out,
      missing: REQUIRED_ENV.filter((k) => !process.env[k]),
      testRecipient: process.env.TEST_RECIPIENT || null,
    });
  } catch (err) {
    console.error("candidates failed:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
