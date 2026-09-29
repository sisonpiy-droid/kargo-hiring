// Files every candidate under the role they applied for, and re-evaluates anyone who moves.
//   pm_*.pdf / spm_*.pdf  -> role from the file name
//   anything else         -> Gemini judges seniority from the redacted CV (PM vs SPM)
// Candidates already emailed are left alone. Also uploads any CV in the folder that is
// missing from the database.
//   node --env-file=.env.local scripts/refile.mjs "<folder>" [--dry]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { geminiJson } from "../lib/gemini.js";
import { evaluateCv } from "../lib/evaluate.js";
import { extractPii } from "../lib/pii.js";
import { cvFileToText } from "../lib/cv-text.js";

const folder = process.argv[2];
const dry = process.argv.includes("--dry");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const must = async (p) => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };

const roleFromName = (f) => (/^spm_/i.test(f) ? "SPM" : /^pm_/i.test(f) ? "PM" : null);

async function judgeRole(cvText) {
  return geminiJson({
    label: "Role check",
    schema: {
      type: "object",
      properties: { role: { type: "string", enum: ["PM", "SPM"] }, product_years: { type: "number" }, reason: { type: "string" } },
      required: ["role", "product_years", "reason"],
    },
    prompt: `Kargo is hiring a Product Manager (PM) and a Senior Product Manager (SPM). This anonymised CV does not say which one the person applied for. Decide which role their seniority fits.
SPM: roughly 6+ years in product roles, or clear senior product leadership (Senior/Lead/Principal PM, Head of Product, managed other PMs, owned a whole product area alone).
PM: earlier-career product people (APM, PM, product analyst/associate, founder's office or career switchers into product) with under ~6 years in product.
Count only product-role years, not total experience. Return the role, your estimate of product_years, and a one-sentence reason citing the CV.

CV
"""
${cvText.slice(0, 12000)}
"""`,
    validate: (o) => {
      if (!["PM", "SPM"].includes(o.role)) throw new Error("bad role");
      return { role: o.role, years: Number(o.product_years) || 0, reason: String(o.reason || "").trim() };
    },
  });
}

const criteria = await must(db.from("rubric_criteria").select("*"));
const rows = await must(db.from("candidates").select("id, file_name, applied_role, status, cv_text"));
const files = readdirSync(folder).filter((f) => /\.(pdf|docx|txt)$/i.test(f));

// 0. Re-redact every stored CV text with the improved PII rules (names recovered from the
//    file name, glued PDF text split apart) and fill in names/phones that were missed.
const pii = await must(db.from("candidate_pii").select("candidate_id, name, email, phone"));
let cleaned = 0;
for (const r of rows) {
  const p = pii.find((x) => x.candidate_id === r.id) || {};
  const out = extractPii(r.cv_text, { fileName: r.file_name, knownName: p.name || undefined });
  const fill = {};
  if (!p.name && out.pii.name) fill.name = out.pii.name;
  if (!p.phone && out.pii.phone) fill.phone = out.pii.phone;
  if (out.cvText !== r.cv_text || Object.keys(fill).length) {
    cleaned++;
    if (!dry) {
      await must(db.from("candidates").update({ cv_text: out.cvText }).eq("id", r.id));
      if (Object.keys(fill).length) await must(db.from("candidate_pii").upsert({ candidate_id: r.id, ...p, ...fill }));
    }
    r.cv_text = out.cvText;
  }
}
console.log(`${cleaned} stored CV texts re-redacted${dry ? " (dry run)" : ""}.\n`);

// 1. Decide the right role for every candidate that came from the folder.
const plan = [];
for (const r of rows.filter((r) => files.includes(r.file_name))) {
  const fromName = roleFromName(r.file_name);
  const j = fromName ? null : await judgeRole(r.cv_text);
  plan.push({ ...r, target: fromName || j.role, how: fromName ? "file name" : `judged: ~${j.years} yrs product. ${j.reason}` });
}

let moved = 0;
for (const p of plan.sort((a, b) => a.file_name.localeCompare(b.file_name))) {
  const change = p.target !== p.applied_role;
  const skip = change && p.status === "sent";
  console.log(`${p.file_name.padEnd(30)} ${p.applied_role} -> ${p.target}${change ? (skip ? "  (already emailed, left as is)" : "  MOVE") : ""}  | ${p.how}`);
  if (!change || skip || dry) continue;
  // 2. Re-evaluate for the new role: the brief and emails were written for the old one.
  const r = await evaluateCv(p.cv_text, p.target, criteria);
  await must(db.from("candidates").update({ applied_role: p.target, decision: null, ...r.fields }).eq("id", p.id));
  await must(db.from("scores").delete().eq("candidate_id", p.id));
  await must(db.from("scores").insert(r.scoreRows.map((s) => ({ candidate_id: p.id, ...s }))));
  moved++;
}

// 3. Upload any CV from the folder that never made it into the database.
const missing = files.filter((f) => !rows.some((r) => r.file_name === f));
for (const f of missing) {
  const buf = readFileSync(join(folder, f));
  const { pii, cvText } = extractPii(await cvFileToText(new File([buf], f)), { fileName: f });
  const role = roleFromName(f) || (await judgeRole(cvText)).role;
  console.log(`${f.padEnd(30)} missing from the database -> uploading as ${role}`);
  if (dry) continue;
  const r = await evaluateCv(cvText, role, criteria);
  const [c] = await must(db.from("candidates").insert({ applied_role: role, file_name: f, cv_text: cvText, ...r.fields }).select("id"));
  await must(db.from("candidate_pii").insert({ candidate_id: c.id, ...pii }));
  await must(db.from("scores").insert(r.scoreRows.map((s) => ({ candidate_id: c.id, ...s }))));
}

console.log(`\n${dry ? "DRY RUN, nothing changed. " : ""}${moved} moved, ${missing.length} uploaded.`);
