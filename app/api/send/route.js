// POST { id, type: "invite" | "rejection", to?, subject?, body? } -> send via Resend, mark sent.
// Only ever triggered by the founder clicking Send.
import { checkPasscode } from "@/lib/auth";
import { sendCandidateEmail } from "@/lib/mail";

export async function POST(request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  const { id, type, to, subject, body } = await request.json().catch(() => ({}));
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await sendCandidateEmail(id, type, { to, subject, body })) });
  } catch (err) {
    console.error("send failed:", err.message);
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
