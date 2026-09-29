// POST { confirm: "DELETE" } -> delete every CV (candidates, their personal details and
// scores) so the founder can start again. Jobs, JDs and rubrics are NOT touched.
import { checkPasscode } from "@/lib/auth";
import { db, q } from "@/lib/db";

export async function POST(request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  const { confirm } = await request.json().catch(() => ({}));
  if (confirm !== "DELETE") return Response.json({ error: 'Type DELETE to confirm' }, { status: 400 });
  try {
    // candidate_pii and scores cascade from candidates.
    const removed = await q(db().from("candidates").delete().not("id", "is", null).select("id"));
    return Response.json({ ok: true, deleted: removed.length });
  } catch (err) {
    console.error("reset failed:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
