// The AI steps. Inputs here are the redacted CV text and the rubric only;
// personal details are never passed in.
import { geminiJson } from "./gemini.js";

const ROLE_NAMES = { PM: "Product Manager", SPM: "Senior Product Manager" };

// --- Step 1: score against BOTH rubrics ------------------------------------

const scoreList = {
  type: "array",
  items: {
    type: "object",
    properties: {
      criterion: { type: "integer" },
      score: { type: "integer" },
      reason: { type: "string" },
    },
    required: ["criterion", "score", "reason"],
  },
};
const SCORE_SCHEMA = {
  type: "object",
  properties: { PM: scoreList, SPM: scoreList },
  required: ["PM", "SPM"],
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
The rubric below was derived from Kargo's historically successful hires. It is NOT a job-description match.

PM RUBRIC
${rubricBlock(criteria, "PM")}

SPM RUBRIC
${rubricBlock(criteria, "SPM")}

RULES
- Score the CV against EVERY PM criterion and EVERY SPM criterion, each an integer 0-10.
- Give one concise, evidence-based reason per criterion (one sentence, max 30 words), citing what the CV actually says.
- Score only on evidence present in the CV. If evidence is thin or missing, score conservatively; do not infer.
- Do not reward years of experience, job titles, college brand, or generic skill keywords. Claims like "proactive" or "ownership" without concrete actions are not evidence.
- The SPM bar is higher: it expects repeated examples and independent judgment.
- Do not add criteria. Use the criterion numbers exactly as listed.
- The candidate's personal details were removed and appear as [CANDIDATE], [EMAIL], [PHONE]. Ignore these.

Return JSON: {"PM": [{"criterion": 1, "score": 0-10, "reason": "..."}...], "SPM": [...]}

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
        const rows = expected.map((c) => {
          const matches = got.filter((g) => g.criterion === c.position);
          if (matches.length !== 1) throw new Error(`${role} criterion ${c.position}: expected 1 score, got ${matches.length}`);
          const { score, reason } = matches[0];
          if (!Number.isInteger(score) || score < 0 || score > 10) throw new Error(`${role} criterion ${c.position}: bad score ${score}`);
          if (typeof reason !== "string" || !reason.trim()) throw new Error(`${role} criterion ${c.position}: missing reason`);
          return { criterion_id: c.id, position: c.position, weight: c.weight, score, reason: reason.trim().slice(0, 400) };
        });
        if (got.length !== expected.length) throw new Error(`${role}: expected ${expected.length} scores, got ${got.length}`);
        result[role] = { rows, total: weightedTotal(rows) };
      }
      return result;
    },
  });
}

// Each criterion is 0-10; weights sum to 100, so this lands on 0-100.
export function weightedTotal(rows) {
  return Math.round(rows.reduce((sum, r) => sum + (r.score / 10) * r.weight, 0) * 10) / 10;
}

// --- Step 2: interview brief + both email drafts ----------------------------

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    brief: { type: "string" },
    invite_email: { type: "string" },
    rejection_email: { type: "string" },
  },
  required: ["brief", "invite_email", "rejection_email"],
};

export async function draftCommunications(cvText, appliedRole, scoring, criteria) {
  const role = ROLE_NAMES[appliedRole];
  const nameOf = (id) => criteria.find((c) => c.id === id)?.name;
  const evidence = scoring[appliedRole].rows
    .map((r) => `- ${nameOf(r.criterion_id)}: ${r.score}/10. ${r.reason}`)
    .join("\n");

  const prompt = `You support Arjun Mehta, founder of Kargo (Series A logistics SaaS, Mumbai), who is hiring a ${role}.
Below is an anonymised CV and how it scored (${scoring[appliedRole].total}/100) on Kargo's rubric for the ${role} role.

SCORES FOR ${appliedRole}
${evidence}

Write three things:

1. "brief": an interview brief for Arjun, EXACTLY 3 sentences. Sentence 1: who this candidate is professionally, from the CV. Sentence 2: why they scored as they did, citing their strongest and weakest rubric evidence (you have not seen other candidates, so do not compare). Sentence 3: the single most important thing to probe in the interview. Refer to them as "the candidate".

2. "invite_email": a warm, personalised interview invitation (under 150 words, plain text). Start with "Hi [NAME]," on its own line. Reference one or two specific things from their CV. Invite them to a 45-minute conversation with Arjun for the ${role} role and ask for their availability over the next week. Sign off "Arjun Mehta\\nFounder, Kargo".

3. "rejection_email": a warm, respectful rejection (under 120 words, plain text). Start with "Hi [NAME]," on its own line. Thank them, name one specific genuine strength from their CV, say clearly that Kargo will not be moving forward for the ${role} role at this time, and wish them well. Do not mention scores, rubrics or ranking. Sign off "Arjun Mehta\\nFounder, Kargo".

Use the literal placeholder [NAME] for the candidate's name. Never write a name, and never write [CANDIDATE], [EMAIL] or [PHONE].

CV
"""
${cvText}
"""`;

  return geminiJson({
    prompt,
    schema: DRAFT_SCHEMA,
    label: "Brief/email drafting",
    validate: (out) => {
      for (const k of ["brief", "invite_email", "rejection_email"]) {
        if (typeof out[k] !== "string" || out[k].trim().length < 40) throw new Error(`${k} missing or too short`);
      }
      const fix = (email) => {
        let e = email.trim().replace(/\[CANDIDATE\]/g, "[NAME]");
        if (!e.includes("[NAME]")) e = `Hi [NAME],\n\n${e}`;
        return e;
      };
      return { brief: out.brief.trim(), invite: fix(out.invite_email), rejection: fix(out.rejection_email) };
    },
  });
}
