// Reports any candidate whose stored AI-facing CV text still contains their name, email or
// phone. With --after, it first applies the current redaction in memory (nothing is saved).
//   node --env-file=.env.local scripts/leak-check.mjs [--after]
import { createClient } from "@supabase/supabase-js";
import { extractPii, nameFromFileName } from "../lib/pii.js";

const after = process.argv.includes("--after");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: rows } = await db.from("candidates").select("id, file_name, cv_text");
const { data: pii } = await db.from("candidate_pii").select("candidate_id, name, email, phone");

let leaks = 0;
for (const r of rows) {
  const p = pii.find((x) => x.candidate_id === r.id) || {};
  const text = after ? extractPii(r.cv_text, { fileName: r.file_name, knownName: p.name || undefined }).cvText : r.cv_text;
  const names = [p.name, nameFromFileName(r.file_name)].filter(Boolean);
  const parts = [...new Set(names.flatMap((n) => n.split(" ")).filter((t) => t.length >= 3))];
  const found = parts.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(text.replace(/([a-z])([A-Z])/g, "$1 $2")));
  if (p.email && text.toLowerCase().includes(p.email.toLowerCase())) found.push("email");
  const digits = text.replace(/\D/g, "");
  if (p.phone && p.phone.replace(/\D/g, "").length >= 10 && digits.includes(p.phone.replace(/\D/g, "").slice(-10))) found.push("phone");
  if (found.length) { leaks++; console.log(`${r.file_name.padEnd(32)} leaks: ${found.join(", ")}`); }
}
console.log(`${after ? "AFTER fix" : "NOW"}: ${leaks} of ${rows.length} stored CV texts leak personal details`);
