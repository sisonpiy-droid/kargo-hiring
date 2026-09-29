// The AI steps. Inputs here are the redacted CV text and the rubric only;
// personal details are never passed in.
import { geminiJson } from "./gemini.js";

export const ROLE_NAMES = { PM: "Product Manager", SPM: "Senior Product Manager" };

// Risk flags come from this fixed list only (rubric.txt, scoring instruction 4); 30 points each.
export const RISK_FLAGS = ["No operations exposure", "Structure dependency", "Keyword-only claims", "No shipped outcomes"];
export const RISK_PER_FLAG = 30;

// --- Step 1: score against BOTH rubrics + risk flags -------------------------

const scoreList = {
  type: "array",
  items: {
    type: "object",
    properties: {
      criterion: { type: "integer" },
      score: { type: "integer" },
      evidence: { type: "string" },
    },
    required: ["criterion", "score", "evidence"],
  },
};
const SCORE_SCHEMA = {
  type: "object",
  properties: {
    PM: scoreList,
    SPM: scoreList,
    risk_flags: { type: "array", items: { type: "string", enum: RISK_FLAGS } },
  },
  required: ["PM", "SPM", "risk_flags"],
};

function rubricBlock(criteria, role) {
  return criteria
    .filter((c) => c.role === role)
    .sort((a, b) => a.position - b.position)
    .map((c) => `  Criterion ${c.position}: ${c.name} (weight ${c.weight}%)\n    Strong candidate: ${c.description}`)
    .join("\n");
}

export async function scoreCv(cvText, criteria) {
  const prompt = `You are scoring an anonymised CV for Kargo, a Series A logistics SaaS company in Mumbai.
The rubric below comes from the patterns of Kargo's best past hires. It is NOT a job-description match.

PM RUBRIC
${rubricBlock(criteria, "PM")}

SPM RUBRIC
${rubricBlock(criteria, "SPM")}

RULES
- Score the CV on EVERY PM criterion and EVERY SPM criterion, each an integer 1-5 (1 = no evidence, 3 = some real evidence, 5 = strong, specific, repeated evidence).
- "evidence": quote or closely paraphrase the exact CV lines behind the score (max 45 words). If there is none, say what is missing.
- Score only on evidence in the CV. Thin evidence scores low; do not infer.
- Do not reward years of experience, job titles, college brand, certifications or buzzwords.
- Use the criterion numbers exactly as listed. Do not add criteria.
- "risk_flags": every flag from this list that applies, or an empty list:
  - "No operations exposure": no hands-on operations or logistics work at all.
  - "Structure dependency": has only worked inside established PM structures (a manager above, defined roadmaps), with no evidence of operating alone.
  - "Keyword-only claims": relies on titles, frameworks, certifications or buzzwords with no concrete outcomes.
  - "No shipped outcomes": no evidence of anything shipped reaching real users.
- Personal details were removed and appear as [CANDIDATE], [EMAIL], [PHONE]. Ignore them.

CV
"""
${cvText}
"""`;

  return geminiJson({
    prompt,
    schema: SCORE_SCHEMA,
    label: "Scoring",
    validate: (out) => {
      const result = {};
      for (const role of ["PM", "SPM"]) {
        const expected = criteria.filter((c) => c.role === role);
        const got = Array.isArray(out[role]) ? out[role] : [];
        if (got.length !== expected.length) throw new Error(`${role}: expected ${expected.length} scores, got ${got.length}`);
        const rows = expected.map((c) => {
          const matches = got.filter((g) => g.criterion === c.position);
          if (matches.length !== 1) throw new Error(`${role} criterion ${c.position}: expected 1 score, got ${matches.length}`);
          const { score, evidence } = matches[0];
          if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error(`${role} criterion ${c.position}: bad score ${score}`);
          if (typeof evidence !== "string" || !evidence.trim()) throw new Error(`${role} criterion ${c.position}: missing evidence`);
          return { criterion_id: c.id, position: c.position, weight: c.weight, score, reason: evidence.trim().slice(0, 500) };
        });
        result[role] = { rows, total: matchPct(rows) };
      }
      const flags = [...new Set((out.risk_flags || []).filter((f) => RISK_FLAGS.includes(f)))];
      result.riskFlags = flags;
      result.risk = Math.min(100, flags.length * RISK_PER_FLAG);
      return result;
    },
  });
}

// Each criterion is 1-5 and the weights sum to 100, so this is the match %, 0-100.
export function matchPct(rows) {
  return Math.round(rows.reduce((sum, r) => sum + (r.score / 5) * r.weight, 0) * 10) / 10;
}

// --- Step 2: summary, brief, strengths/risks, probes, both emails ------------

const strList = { type: "array", items: { type: "string" } };
const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    brief: strList,
    strengths: strList,
    risks: strList,
    probes: strList,
    reasoning: { type: "string" },
    invite_subject: { type: "string" },
    invite_email: { type: "string" },
    rejection_email: { type: "string" },
  },
  required: ["summary", "brief", "strengths", "risks", "probes", "reasoning", "invite_subject", "invite_email", "rejection_email"],
};

export async function draftCommunications(cvText, appliedRole, scoring, criteria) {
  const role = ROLE_NAMES[appliedRole];
  const nameOf = (id) => criteria.find((c) => c.id === id)?.name;
  const evidence = scoring[appliedRole].rows
    .map((r) => `- ${nameOf(r.criterion_id)} (${r.weight}%): ${r.score}/5. ${r.reason}`)
    .join("\n");

  const prompt = `You support Arjun Mehta, founder of Kargo (Series A logistics SaaS, Mumbai), who is hiring a ${role}.
Below is an anonymised CV and its rubric scores for the ${role} role: ${scoring[appliedRole].total}% match.
Risk flags: ${scoring.riskFlags.length ? scoring.riskFlags.join(", ") : "none"}.

SCORES FOR ${appliedRole}
${evidence}

Write, as JSON:
- "summary": 1-2 sentences, the headline verdict on this candidate against Kargo's pattern.
- "brief": the interview brief as EXACTLY 2 short paragraphs (an array of 2 strings). Paragraph 1: who the candidate is professionally, from the CV. Paragraph 2: why they fit Kargo's pattern or not, citing the rubric evidence.
- "strengths": 2-4 one-sentence strengths, each tied to specific CV evidence.
- "risks": 0-3 one-sentence risks or gaps to verify (empty if there are genuinely none).
- "probes": EXACTLY 3 interview questions that dig into the specific claims in this CV, especially the weakest or least-proven ones.
- "reasoning": one paragraph explaining the full evaluation: each criterion's score and why, and how the risk flags were decided.
- "invite_subject": a short email subject for an interview invite for the ${role} role at Kargo.
- "invite_email": a warm, personalised interview invitation (under 150 words, plain text). Start with "Hi [NAME]," on its own line. Reference one or two specific things from their CV. Invite them to a 45-minute conversation with Arjun and ask for their availability over the next week. Sign off "Arjun Mehta\\nFounder, Kargo".
- "rejection_email": a warm, respectful rejection (under 120 words, plain text). Start with "Hi [NAME]," on its own line. Thank them, name one specific genuine strength from their CV, say clearly that Kargo will not move forward for the ${role} role at this time, and wish them well. Do not mention scores, rubrics or ranking. Sign off "Arjun Mehta\\nFounder, Kargo".

Refer to the person as "the candidate" (or "they") everywhere except the emails; never guess their gender, and never mention college or university names. In the emails, use the literal placeholder [NAME] for their name. Never write a name, and never write [CANDIDATE], [EMAIL] or [PHONE].

CV
"""
${cvText}
"""`;

  return geminiJson({
    prompt,
    schema: DRAFT_SCHEMA,
    label: "Brief/email drafting",
    validate: (out) => {
      for (const k of ["summary", "reasoning", "invite_subject", "invite_email", "rejection_email"]) {
        if (typeof out[k] !== "string" || out[k].trim().length < 10) throw new Error(`${k} missing or too short`);
      }
      const list = (k, min, max) => {
        const v = (Array.isArray(out[k]) ? out[k] : []).map((s) => String(s).trim()).filter(Boolean).slice(0, max);
        if (v.length < min) throw new Error(`${k}: expected at least ${min}, got ${v.length}`);
        return v;
      };
      const fix = (email) => {
        let e = email.trim().replace(/\[CANDIDATE\]/g, "[NAME]");
        if (!e.includes("[NAME]")) e = `Hi [NAME],\n\n${e}`;
        return e;
      };
      return {
        eval: {
          summary: out.summary.trim(),
          brief: list("brief", 1, 2),
          strengths: list("strengths", 1, 4),
          risks: list("risks", 0, 3),
          probes: list("probes", 3, 3),
          reasoning: out.reasoning.trim(),
          risk_flags: scoring.riskFlags,
        },
        inviteSubject: out.invite_subject.trim(),
        invite: fix(out.invite_email),
        rejection: fix(out.rejection_email),
      };
    },
  });
}
