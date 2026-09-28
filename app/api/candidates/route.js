// GET -> every candidate with both scores, criterion breakdown, brief, drafts and a recommendation.
import { checkPasscode } from "@/lib/auth";
import { db, q, loadCriteria } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  try {
    const [criteria, candidates, pii, scores] = await Promise.all([
      loadCriteria(),
      q(db().from("candidates").select("id, applied_role, file_name, pm_score, spm_score, brief, invite_draft, rejection_draft, status, sent_email_type, sent_at, created_at")),
      q(db().from("candidate_pii").select("candidate_id, name, email")),
      q(db().from("scores").select("candidate_id, criterion_id, score, reason")),
    ]);

    // The invite line: top N applicants for each role who also clear the threshold.
    const topN = Number(process.env.TOP_N || 5);
    const threshold = Number(process.env.INVITE_THRESHOLD || 60);
    const scoreFor = (c, role) => Number(role === "PM" ? c.pm_score : c.spm_score);
    const rankInRole = new Map();
    for (const role of ["PM", "SPM"]) {
      candidates
        .filter((c) => c.applied_role === role)
        .sort((a, b) => scoreFor(b, role) - scoreFor(a, role))
        .forEach((c, i) => rankInRole.set(c.id, i + 1));
    }

    const piiById = new Map(pii.map((p) => [p.candidate_id, p]));
    const out = candidates.map((c) => {
      const person = piiById.get(c.id) || {};
      const firstName = person.name?.split(" ")[0] || "there";
      const rank = rankInRole.get(c.id);
      const shortlisted = rank <= topN && scoreFor(c, c.applied_role) >= threshold;
      const breakdown = (role) =>
        criteria.filter((k) => k.role === role).map((k) => {
          const s = scores.find((x) => x.candidate_id === c.id && x.criterion_id === k.id);
          return { name: k.name, weight: k.weight, score: s?.score ?? null, reason: s?.reason ?? "" };
        });
      return {
        ...c,
        name: person.name || "(name not found)",
        email: person.email || null,
        pm_score: Number(c.pm_score),
        spm_score: Number(c.spm_score),
        rank_in_applied_role: rank,
        recommendation: shortlisted ? "invite" : "rejection",
        invite_draft: c.invite_draft.replaceAll("[NAME]", firstName),
        rejection_draft: c.rejection_draft.replaceAll("[NAME]", firstName),
        breakdown: { PM: breakdown("PM"), SPM: breakdown("SPM") },
      };
    });

    return Response.json({ candidates: out, topN, threshold });
  } catch (err) {
    console.error("candidates failed:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
