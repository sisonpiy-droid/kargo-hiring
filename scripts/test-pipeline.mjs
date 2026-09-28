// Live test of the AI steps (no database): redact -> score -> draft, for each sample CV.
//   node --env-file=.env.local scripts/test-pipeline.mjs [file.txt]
import { readFileSync, readdirSync } from "node:fs";
import { parseRubric } from "../lib/rubric.js";
import { extractPii } from "../lib/pii.js";
import { scoreCv, draftCommunications } from "../lib/pipeline.js";

const criteria = parseRubric(readFileSync(new URL("../rubric.txt", import.meta.url), "utf8")).map((c, i) => ({ id: i + 1, ...c }));
const dir = new URL("../test-cvs/", import.meta.url);
const files = process.argv[2] ? [process.argv[2]] : readdirSync(dir).filter((f) => f.endsWith(".txt"));

for (const file of files) {
  const applied = file.includes("spm") || file.includes("ambiguous") ? "SPM" : "PM";
  const { pii, cvText } = extractPii(readFileSync(new URL(file, dir), "utf8"));
  if (pii.email && cvText.includes(pii.email)) throw new Error("PII leak");

  const t0 = Date.now();
  const scoring = await scoreCv(cvText, criteria);
  const drafts = await draftCommunications(cvText, applied, scoring, criteria);
  console.log(`\n=== ${file} (applied ${applied}) ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const role of ["PM", "SPM"]) {
    console.log(`${role} ${scoring[role].total}/100`);
    for (const r of scoring[role].rows) console.log(`   ${r.position}. ${r.score}/10  ${r.reason}`);
  }
  console.log("BRIEF:", drafts.brief);
  console.log("INVITE:\n" + drafts.invite);
  console.log("REJECTION:\n" + drafts.rejection);
}
