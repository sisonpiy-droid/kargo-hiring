// Server-only Supabase client. Uses the service role key, so this module must
// never be imported from a client component.
import { createClient } from "@supabase/supabase-js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Supabase sometimes rejects the first request from a fresh server instance with
// "JWT issued at future": its clock and ours differ by about a second. It clears on
// its own, so wait briefly and retry instead of failing the page load.
async function fetchWithClockRetry(url, options) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, options);
    if (attempt >= 4 || (res.status !== 401 && res.status !== 403)) return res;
    const body = await res.clone().text().catch(() => "");
    if (!/issued at future/i.test(body)) return res;
    await sleep(600 * (attempt + 1));
  }
}

let client;
export function db() {
  if (!client) {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase env vars are not set");
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { fetch: fetchWithClockRetry },
    });
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
