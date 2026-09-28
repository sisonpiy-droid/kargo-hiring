// Loads rubric.txt into the rubric_criteria table.
//   npm run load-rubric            parse, validate, upsert
//   npm run load-rubric -- --dry   parse and validate only, no database
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseRubric } from "../lib/rubric.js";

const rows = parseRubric(readFileSync(new URL("../rubric.txt", import.meta.url), "utf8"));
for (const r of rows) console.log(`${r.role}  ${r.position}. ${r.name.padEnd(42)} ${r.weight}%`);

if (process.argv.includes("--dry")) process.exit(0);

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Upsert on (role, position) so ids stay stable and existing scores keep pointing at them.
const { error } = await db.from("rubric_criteria").upsert(rows, { onConflict: "role,position" });
if (error) {
  console.error("Upsert failed:", error.message);
  process.exit(1);
}
const { count } = await db.from("rubric_criteria").select("*", { count: "exact", head: true });
console.log(`rubric_criteria now has ${count} rows.`);
