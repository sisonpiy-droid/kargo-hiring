// Optional dashboard passcode. If DASHBOARD_PASSCODE is set, every API route requires it
// as the x-passcode header; if it is not set, the dashboard is open to anyone with the URL.
import { timingSafeEqual } from "node:crypto";

export function checkPasscode(request) {
  const expected = process.env.DASHBOARD_PASSCODE;
  if (!expected) return null;
  const given = Buffer.from(request.headers.get("x-passcode") || "");
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return Response.json({ error: "Wrong passcode" }, { status: 401 });
  }
  return null;
}
