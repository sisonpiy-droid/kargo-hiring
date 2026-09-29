// Sends one candidate's invite or rejection through Resend and marks them sent.
// Invites go now; rejections are scheduled REJECTION_DELAY_HOURS (default 48) ahead.
import { Resend } from "resend";
import { db, q } from "./db.js";
import { loadJobs, jobTitle } from "./jobs.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class MailError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function sendCandidateEmail(id, type, overrides = {}) {
  if (!process.env.RESEND_API_KEY) throw new MailError("RESEND_API_KEY is not set", 500);
  if (!["invite", "rejection"].includes(type)) throw new MailError("type must be invite or rejection", 400);

  const [c] = await q(db().from("candidates").select("id, applied_role, invite_subject, invite_draft, rejection_draft, status").eq("id", id));
  if (!c) throw new MailError("Candidate not found", 404);
  if (c.status === "sent") throw new MailError("Already sent", 409);
  const [person] = await q(db().from("candidate_pii").select("name, email").eq("candidate_id", id));

  const overrideTo = String(overrides.to || "").trim();
  if (overrideTo && !EMAIL.test(overrideTo)) throw new MailError("The To address is not a valid email", 400);
  // TEST_RECIPIENT wins over everything, so a demo can never email a real candidate.
  const to = process.env.TEST_RECIPIENT || overrideTo || person?.email;
  if (!to) throw new MailError("No email address for this candidate", 400);

  const firstName = person?.name?.split(" ")[0] || "there";
  const role = jobTitle(await loadJobs(), c.applied_role);
  const subject = type === "invite"
    ? String(overrides.subject || c.invite_subject || `Interview invitation: ${role} at Kargo`).trim()
    : `Your ${role} application at Kargo`;
  const body = String(overrides.body || (type === "invite" ? c.invite_draft : c.rejection_draft)).replaceAll("[NAME]", firstName);
  const hours = Number(process.env.REJECTION_DELAY_HOURS ?? 48);
  const scheduledFor = type === "rejection" && hours > 0 ? new Date(Date.now() + hours * 3600e3).toISOString() : null;

  // Claim the row first so a double click can't send twice.
  const rows = await q(
    db().from("candidates")
      .update({ status: "sent", sent_email_type: type, sent_at: new Date().toISOString(), scheduled_for: scheduledFor })
      .eq("id", id).eq("status", "scored").select("id")
  );
  if (!rows.length) throw new MailError("Already sent", 409);

  const unclaim = () =>
    db().from("candidates").update({ status: "scored", sent_email_type: null, sent_at: null, scheduled_for: null }).eq("id", id);
  try {
    const { data, error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.RESEND_FROM || "Kargo Hiring <onboarding@resend.dev>",
      to,
      subject,
      text: body,
      ...(scheduledFor ? { scheduledAt: scheduledFor } : {}),
    });
    if (error) throw new MailError(`Resend: ${error.message}`, 502);
    return { resend_id: data.id, scheduled_for: scheduledFor };
  } catch (err) {
    await unclaim(); // so the founder can retry
    throw err;
  }
}
