// Checks PII extraction on the sample CVs: name/email/phone must be found, and
// none of them may survive in the redacted text that goes to the AI.
import { readFileSync, readdirSync } from "node:fs";
import { extractPii } from "../lib/pii.js";

const dir = new URL("../test-cvs/", import.meta.url);
let failed = 0;

for (const file of readdirSync(dir).filter((f) => f.endsWith(".txt"))) {
  const text = readFileSync(new URL(file, dir), "utf8");
  const { pii, cvText } = extractPii(text);
  const problems = [];
  if (!pii.name) problems.push("no name found");
  if (!pii.email) problems.push("no email found");
  if (!pii.phone) problems.push("no phone found");
  for (const v of [pii.email, pii.phone, ...(pii.name || "").split(" ")].filter(Boolean)) {
    if (cvText.toLowerCase().includes(v.toLowerCase())) problems.push(`"${v}" still in redacted text`);
  }
  if (/@/.test(cvText)) problems.push("an @ survives redaction");

  console.log(`${problems.length ? "FAIL" : "ok  "} ${file}  name=${pii.name}  email=${pii.email}  phone=${pii.phone}`);
  for (const p of problems) console.log("       - " + p);
  failed += problems.length ? 1 : 0;
}
process.exit(failed ? 1 : 0);
