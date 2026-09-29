// The AI steps. Inputs here are the redacted CV text and the rubric only;
// personal details are never passed in.
import { geminiJson } from "./gemini.js";

// Risk flags come from this fixed list only (rubric.txt, scoring instruction 4); 30 points each.
export const RISK_FLAGS = ["No operations exposure", "Structure dependency", "Keyword-only claims", "No shipped outcomes"];
export const RISK_PER_FLAG = 30;

// --- Step 1: score against EVERY job's rubric + risk flags --------------------
// `jobs` is [{ key, title }]; `criteria` are rubric_criteria rows whose `role` is a job key.

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

function rubricBlock(criteria, key) {
  return criteria
    .filter((c) => c.role === key)
    .sort((a, b) => a.position - b.position)
    .map((c) => `  Criterion ${c.position}: ${c.name} (weight ${c.weight}%)\n    Strong candidate: ${c.description}`)
    .join("\n");
}

export async function scoreCv(cvText, criteria, jobs) {
  jobs = jobs.filter((j) => criteria.some((c) => c.role === j.key));
  if (!jobs.length) throw new Error("No job has a rubric to score against");
  const schema = {
    type: "object",
    properties: {
      ...Object.fromEntries(jobs.map((j) => [j.key, scoreList])),
      risk_flags: { type: "array", items: { type: "string", enum: RISK_FLAGS } },
    },
    required: [...jobs.map((j) => j.key), "risk_flags"],
  };
  const prompt = `You are scoring an anonymised CV for Kargo, a Series A logistics SaaS company in Mumbai.
Each rubric below says what a strong candidate looks like for one job. Score the CV against every one.

${jobs.map((j) => `RUBRIC "${j.key}": ${j.title}\n${rubricBlock(criteria, j.key)}`).join("\n\n")}

RULES
- For EVERY rubric key (${jobs.map((j) => j.key).join(", ")}), score EVERY criterion as an integer 1-5 (1 = no evidence, 3 = some real evidence, 5 = strong, specific, repeated evidence).
- "evidence": quote or closely paraphrase the exact CV lines behind the score (max 45 words). If there is none, say what is missing.
- Score only on evidence in the CV. Thin evidence scores low; do not infer.
- Do not reward years of experience, job titles, college brand, certifications or buzzwords.
- Use the criterion numbers exactly as listed. Do not add criteria.
- "risk_flags": every flag from this list that applies, or an empty list:
  - "No operations exposure": no hands-on operations or logistics work at all.
  - "Structure dependency": has only worked inside established structures (a manager above, defined roadmaps), with no evidence of operating alone.
  - "Keyword-only claims": relies on titles, frameworks, certifications or buzzwords with no concrete outcomes.
  - "No shipped outcomes": no evidence of anything shipped or delivered reaching real users.
- Personal details were removed and appear as [CANDIDATE], [EMAIL], [PHONE]. Ignore them.

CV
"""
${cvText}
"""`;

  return geminiJson({
    prompt,
    schema,
    label: "Scoring",
    validate: (out) => {
      const result = { byJob: {} };
      for (const { key } of jobs) {
        const expected = criteria.filter((c) => c.role === key);
        const got = Array.isArray(out[key]) ? out[key] : [];
        if (got.length !== expected.length) throw new Error(`${key}: expected ${expected.length} scores, got ${got.length}`);
        const rows = expected.map((c) => {
          const matches = got.filter((g) => g.criterion === c.position);
          if (matches.length !== 1) throw new Error(`${key} criterion ${c.position}: expected 1 score, got ${matches.length}`);
          const { score, evidence } = matches[0];
          if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error(`${key} criterion ${c.position}: bad score ${score}`);
          if (typeof evidence !== "string" || !evidence.trim()) throw new Error(`${key} criterion ${c.position}: missing evidence`);
          return { criterion_id: c.id, position: c.position, weight: c.weight, score, reason: evidence.trim().slice(0, 500) };
        });
        result.byJob[key] = { rows, total: matchPct(rows) };
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

// `job` is the job applied for: { key, title }.
export async function draftCommunications(cvText, job, scoring, criteria) {
  const role = job.title;
  const appliedRole = job.key;
  const mine = scoring.byJob[appliedRole];
  const nameOf = (id) => criteria.find((c) => c.id === id)?.name;
  const evidence = mine.rows
    .map((r) => `- ${nameOf(r.criterion_id)} (${r.weight}%): ${r.score}/5. ${r.reason}`)
    .join("\n");

  const prompt = `You support Arjun Mehta, founder of Kargo (Series A logistics SaaS, Mumbai), who is hiring a ${role}.
Below is an anonymised CV and its rubric scores for the ${role} role: ${mine.total}% match.
Risk flags: ${scoring.riskFlags.length ? scoring.riskFlags.join(", ") : "none"}.

SCORES FOR ${role}
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

// --- New job: generate a rubric from a job description ------------------------

const RUBRIC_SCHEMA = {
  type: "object",
  properties: {
    criteria: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, description: { type: "string" }, weight: { type: "integer" } },
        required: ["name", "description", "weight"],
      },
    },
  },
  required: ["criteria"],
};

export async function generateRubric(title, jd) {
  const prompt = `You design hiring rubrics for Kargo, a Series A logistics SaaS company in Mumbai.
Write a scoring rubric for the job below: 4 to 6 criteria that predict success in THIS job.

For each criterion:
- "name": short (2-6 words).
- "description": what a strong candidate's CV shows, concretely enough that two reviewers would score the same CV the same way. Say what counts as evidence (specific actions, outcomes, numbers) and what does not (titles, buzzwords, years alone).
- "weight": an integer percentage. The weights must add up to exactly 100.

Do not include criteria about years of experience, degrees, college brand, age, gender or location.

JOB TITLE: ${title}

JOB DESCRIPTION
"""
${jd.slice(0, 15000)}
"""`;
  return geminiJson({
    prompt,
    schema: RUBRIC_SCHEMA,
    label: "Rubric generation",
    validate: (out) => validateRubric(out.criteria),
  });
}

// Checks (and lightly repairs) a rubric: 4-6 criteria, names/descriptions present, weights
// summing to 100. A small rounding drift from the model is fixed on the largest weight.
export function validateRubric(list) {
  const criteria = (Array.isArray(list) ? list : []).map((c) => ({
    name: String(c?.name || "").trim().slice(0, 80),
    description: String(c?.description || "").trim().slice(0, 1200),
    weight: Math.round(Number(c?.weight) || 0),
  }));
  if (criteria.length < 4 || criteria.length > 6) throw new Error(`A rubric needs 4-6 criteria, got ${criteria.length}`);
  for (const c of criteria) {
    if (!c.name || c.description.length < 20) throw new Error("Every criterion needs a name and a real description");
    if (c.weight < 1) throw new Error(`"${c.name}" needs a weight above 0`);
  }
  const total = criteria.reduce((a, c) => a + c.weight, 0);
  if (Math.abs(total - 100) > 5) throw new Error(`Weights add up to ${total}%, not 100%`);
  if (total !== 100) criteria.sort((a, b) => b.weight - a.weight)[0].weight += 100 - total;
  return criteria;
}
