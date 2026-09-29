// GET -> every candidate with match, risk, tier, list, rubric evidence, brief and drafts,
// plus which server settings are missing (for the warning banner).
import { checkPasscode } from "@/lib/auth";
import { db, q, loadCriteria } from "@/lib/db";
import { tierOf, listOf, matchOf } from "@/lib/tier";
import { loadJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";

const RISK_FLAG_INFO = [
  { name: "No operations exposure", description: "No hands-on operations or logistics work at all." },
  { name: "Structure dependency", description: "Has only worked inside established PM structures (a manager above, defined roadmaps), with no evidence of operating alone." },
  { name: "Keyword-only claims", description: "Relies on titles, frameworks, certifications or buzzwords with no concrete outcomes." },
  { name: "No shipped outcomes", description: "No evidence of anything shipped reaching real users." },
];

const REQUIRED_ENV = ["GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"];

export async function GET(request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  try {
    const [criteria, jobs, candidates, pii, scores] = await Promise.all([
      loadCriteria(),
      loadJobs(),
      q(db().from("candidates").select("id, ref, applied_role, file_name, job_scores, pm_score, spm_score, risk_score, eval, invite_subject, invite_draft, rejection_draft, decision, status, sent_email_type, sent_at, scheduled_for, created_at")),
      q(db().from("candidate_pii").select("candidate_id, name, email")),
      q(db().from("scores").select("candidate_id, criterion_id, score, reason")),
    ]);

    const piiById = new Map(pii.map((p) => [p.candidate_id, p]));
    const out = candidates.map((c) => {
      const person = piiById.get(c.id) || {};
      const firstName = person.name?.split(" ")[0] || "there";
      const match = matchOf(c);
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
        job_scores: Object.keys(c.job_scores || {}).length ? c.job_scores : { PM: c.pm_score, SPM: c.spm_score },
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
      jobs: jobs.map(({ key, title, jd_text, preset, created_at }) => ({ key, title, jd_text, preset, created_at })),
      rubric: criteria.map(({ id, role, position, name, description, weight }) => ({ id, role, position, name, description, weight })),
      riskFlags: RISK_FLAG_INFO,
      thresholds: {
        high: Number(process.env.HIGH_MATCH || 80),
        medium: Number(process.env.MEDIUM_MATCH || 70),
        maxRisk: Number(process.env.MAX_RISK || 30),
      },
    });
  } catch (err) {
    console.error("candidates failed:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
