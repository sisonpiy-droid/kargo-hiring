// Server-only Supabase client. Uses the service role key, so this module must
// never be imported from a client component.
import { createClient } from "@supabase/supabase-js";

let client;
export function db() {
  if (!client) {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase env vars are not set");
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  }
  return client;
}

// Throws on a Supabase error, returns data otherwise.
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

export async function loadCriteria() {
  const rows = await q(db().from("rubric_criteria").select("*").order("role").order("position"));
  if (!rows.length) throw new Error("rubric_criteria is empty. Run: npm run load-rubric");
  return rows;
}
