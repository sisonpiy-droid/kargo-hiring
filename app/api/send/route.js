// POST { id, type: "invite" | "rejection" } -> send that draft via Resend, mark the candidate sent.
// Only ever triggered by the founder clicking Send.
import { Resend } from "resend";
import { checkPasscode } from "@/lib/auth";
import { db, q } from "@/lib/db";

const SUBJECTS = {
  invite: (role) => `Interview invitation: ${role} at Kargo`,
  rejection: (role) => `Your ${role} application at Kargo`,
};
const ROLE_NAMES = { PM: "Product Manager", SPM: "Senior Product Manager" };

export async function POST(request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  const { id, type } = await request.json().catch(() => ({}));
  if (!id || !SUBJECTS[type]) return Response.json({ error: "id and type (invite|rejection) required" }, { status: 400 });
  if (!process.env.RESEND_API_KEY) return Response.json({ error: "RESEND_API_KEY is not set" }, { status: 500 });

  let claimed = false;
  const unclaim = () =>
    db().from("candidates").update({ status: "scored", sent_email_type: null, sent_at: null }).eq("id", id);
  try {
    const [c] = await q(db().from("candidates").select("id, applied_role, invite_draft, rejection_draft, status").eq("id", id));
    if (!c) return Response.json({ error: "Candidate not found" }, { status: 404 });
    if (c.status === "sent") return Response.json({ error: "Already sent" }, { status: 409 });
    const [person] = await q(db().from("candidate_pii").select("name, email").eq("candidate_id", id));
    const to = process.env.TEST_RECIPIENT || person?.email;
    if (!to) return Response.json({ error: "No email address was found in this CV" }, { status: 400 });

    // Claim the row first so a double click can't send twice.
    const rows = await q(
      db().from("candidates")
        .update({ status: "sent", sent_email_type: type, sent_at: new Date().toISOString() })
        .eq("id", id).eq("status", "scored").select("id")
    );
    if (!rows.length) return Response.json({ error: "Already sent" }, { status: 409 });
    claimed = true;

    const firstName = person?.name?.split(" ")[0] || "there";
    const draft = type === "invite" ? c.invite_draft : c.rejection_draft;
    const { data, error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.RESEND_FROM || "Kargo Hiring <onboarding@resend.dev>",
      to,
      subject: SUBJECTS[type](ROLE_NAMES[c.applied_role]),
      text: draft.replaceAll("[NAME]", firstName),
    });

    if (error) {
      await unclaim(); // so the founder can retry
      return Response.json({ error: `Resend: ${error.message}` }, { status: 502 });
    }
    return Response.json({ ok: true, resend_id: data.id });
  } catch (err) {
    if (claimed) await unclaim();
    console.error("send failed:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
