// POST -> schedule the rejection email for everyone on the rejection list who hasn't
// been emailed yet. Founder-triggered ("Send all rejection mails"); never automatic.
import { checkPasscode } from "@/lib/auth";
import { db, q } from "@/lib/db";
import { tierOf, listOf } from "@/lib/tier";
import { sendCandidateEmail } from "@/lib/mail";

export const maxDuration = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function POST(request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  try {
    const rows = await q(db().from("candidates").select("id, applied_role, pm_score, spm_score, risk_score, decision").eq("status", "scored"));
    const targets = rows.filter((c) => {
      const match = Number(c.applied_role === "PM" ? c.pm_score : c.spm_score);
      return listOf(tierOf(match, c.risk_score ?? 0), c.decision) === "rejection";
    });

    let sent = 0;
    const failed = [];
    for (const c of targets) {
      try {
        await sendCandidateEmail(c.id, "rejection");
        sent++;
      } catch (err) {
        if (err.status !== 409) failed.push(err.message);
      }
      await sleep(600); // Resend's free tier allows ~2 requests/second
    }
    return Response.json({ sent, failed: failed.length, errors: [...new Set(failed)].slice(0, 3) });
  } catch (err) {
    console.error("send-rejections failed:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
