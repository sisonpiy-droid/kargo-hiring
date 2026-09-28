// Every API route requires the dashboard passcode, sent as the x-passcode header.
// Without it, anyone with the URL could read candidate PII or send email.
import { timingSafeEqual } from "node:crypto";

export function checkPasscode(request) {
  const expected = process.env.DASHBOARD_PASSCODE;
  if (!expected) return Response.json({ error: "DASHBOARD_PASSCODE is not set on the server" }, { status: 500 });
  const given = Buffer.from(request.headers.get("x-passcode") || "");
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return Response.json({ error: "Wrong passcode" }, { status: 401 });
  }
  return null;
}
