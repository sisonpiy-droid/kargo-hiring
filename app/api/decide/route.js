// POST { id, decision: "reconsidered" | "passed" | null } -> the founder's call on a candidate.
// reconsidered moves them onto the Shortlist; passed moves them to the rejection list.
import { checkPasscode } from "@/lib/auth";
import { db, q } from "@/lib/db";

export async function POST(request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  const { id, decision } = await request.json().catch(() => ({}));
  if (!id || ![null, "reconsidered", "passed"].includes(decision ?? null)) {
    return Response.json({ error: "id and decision (reconsidered | passed | null) required" }, { status: 400 });
  }
  try {
    const rows = await q(db().from("candidates").update({ decision: decision ?? null }).eq("id", id).eq("status", "scored").select("id"));
    if (!rows.length) return Response.json({ error: "Candidate not found or already emailed" }, { status: 409 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("decide failed:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
