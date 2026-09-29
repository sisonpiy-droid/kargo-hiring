// Loads rubric.txt, then re-scores every existing candidate from their stored
// (already redacted) CV text. Use after changing the rubric. No PII is read.
//   npm run rescore
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseRubric } from "../lib/rubric.js";
import { evaluateCv } from "../lib/evaluate.js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const must = async (p) => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };

// 1. Replace the preset (PM / SPM) rubric from rubric.txt. Other jobs' rubrics are untouched.
const rows = parseRubric(readFileSync(new URL("../rubric.txt", import.meta.url), "utf8"));
for (const role of ["PM", "SPM"]) {
  const n = rows.filter((r) => r.role === role).length;
  await must(db.from("rubric_criteria").delete().eq("role", role).gt("position", n));
}
await must(db.from("rubric_criteria").upsert(rows, { onConflict: "role,position" }));
const criteria = await must(db.from("rubric_criteria").select("*"));
const jobs = await must(db.from("jobs").select("key, title"));
console.log(`rubric loaded: ${criteria.length} criteria`);

// 2. Re-score, 3 at a time.
const candidates = await must(db.from("candidates").select("id, applied_role, cv_text, file_name"));
let done = 0;
const queue = [...candidates];
async function worker() {
  for (let c; (c = queue.shift()); ) {
    try {
      const r = await evaluateCv(c.cv_text, c.applied_role, criteria, jobs);
      await must(db.from("candidates").update(r.fields).eq("id", c.id));
      await must(db.from("scores").delete().eq("candidate_id", c.id));
      await must(db.from("scores").insert(r.scoreRows.map((s) => ({ candidate_id: c.id, ...s }))));
      console.log(`${++done}/${candidates.length}  ${c.file_name}: ${r.match}% match, risk ${r.risk}`);
    } catch (err) {
      console.log(`FAILED ${c.file_name}: ${err.message}`);
    }
  }
}
await Promise.all([worker(), worker(), worker()]);
