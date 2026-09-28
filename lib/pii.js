// Pulls name / email / phone out of CV text and returns a redacted copy.
// Deliberately done with plain code, not AI: the whole point is that personal
// details never reach the model.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Digit runs with common phone punctuation; filtered by digit count below.
const PHONE_CANDIDATE = /\+?\(?\d[\d\s().-]{7,}\d/g;
const PROFILE_URL = /\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com)\/[^\s,;|)]+/gi;
const NOT_A_NAME = /\b(resume|résumé|curriculum|vitae|cv|profile|summary|product|manager|experience|contact|page)\b/i;

function isPhone(s) {
  const digits = s.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return false;
  // Reject things like "2019 2021 2023" (year ranges), which are all 4-digit years.
  const groups = s.trim().split(/[\s().-]+/).filter(Boolean);
  return !groups.every((g) => /^(19|20)\d\d$/.test(g));
}

function findName(lines) {
  for (const line of lines) {
    const labelled = line.match(/^\s*(?:full\s+)?name\s*[:\-]\s*(.+)$/i);
    if (labelled) return labelled[1].trim();
  }
  // Otherwise: the first short line of 2-4 capitalised words, near the top.
  for (const raw of lines.slice(0, 8)) {
    const line = raw.replace(/[|•·,]+.*$/, "").trim(); // "Jane Doe | PM | Mumbai" -> "Jane Doe"
    const words = line.split(/\s+/);
    if (
      words.length >= 2 && words.length <= 4 &&
      words.every((w) => /^[A-Z][A-Za-z.'-]*$/.test(w) || /^[A-Z.'-]+$/.test(w)) &&
      !NOT_A_NAME.test(line)
    ) {
      return line;
    }
  }
  return null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function extractPii(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const emails = text.match(EMAIL) || [];
  const phones = (text.match(PHONE_CANDIDATE) || []).filter(isPhone);
  const rawName = findName(lines);
  let name = rawName ? rawName.replace(/\s+/g, " ") : null;
  if (name && name === name.toUpperCase()) {
    name = name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()); // "ANANYA DESHPANDE" -> "Ananya Deshpande"
  }

  let redacted = text
    .replace(EMAIL, "[EMAIL]")
    .replace(PROFILE_URL, "[PROFILE LINK]");
  for (const p of phones) redacted = redacted.split(p).join("[PHONE]");
  if (name) {
    // Remove the full name and each part of it wherever it appears (e.g. "Priya" alone in a summary).
    const parts = name.split(" ").filter((p) => p.replace(/\./g, "").length >= 2);
    for (const token of [name, ...parts]) {
      redacted = redacted.replace(new RegExp(`\\b${escapeRe(token)}\\b`, "gi"), "[CANDIDATE]");
    }
  }
  // Drop now-empty label lines like "Email: [EMAIL]" to keep the text tidy.
  redacted = redacted
    .split("\n")
    .filter((l) => !/^\s*(e-?mail|phone|mobile|tel|contact|name)?\s*[:\-]?\s*(\[(EMAIL|PHONE|CANDIDATE|PROFILE LINK)\][\s|,•]*)+$/i.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    pii: { name, email: emails[0] || null, phone: phones[0]?.trim() || null },
    cvText: redacted,
  };
}
