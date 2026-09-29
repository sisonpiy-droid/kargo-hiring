// Pulls name / email / phone out of CV text and returns a redacted copy.
// Deliberately done with plain code, not AI: the whole point is that personal
// details never reach the model.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Digit runs with common phone punctuation; filtered by digit count below.
const PHONE_CANDIDATE = /\+?\(?\d[\d\s().-]{7,}\d/g;
const PROFILE_URL = /\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com)\/[^\s,;|)]+/gi;
const NOT_A_NAME = /\b(resume|résumé|curriculum|vitae|cv|profile|summary|product|manager|experience|contact|page|india|education)\b/i;

function isPhone(s) {
  const digits = s.replace(/\D/g, "");
  // No upper bound: PDF extraction often glues a number to its reformatted copy
  // ("+91 97293 4421897293 44218"), and that must go too.
  if (digits.length < 10) return false;
  // Reject things like "2019 2021 2023" (year ranges), which are all 4-digit years.
  const groups = s.trim().split(/[\s().-]+/).filter(Boolean);
  return !groups.every((g) => /^(19|20)\d\d$/.test(g));
}

const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// "02_priya_sharma.pdf", "spm_16_siddharth_rao.pdf", "cv_08_rahul_bose.docx" -> "Priya Sharma" etc.
export function nameFromFileName(fileName) {
  if (!fileName) return null;
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/^(?:cv|pm|spm)?[_-]?\d*[_-]/i, "");
  const parts = base.split(/[_\-\s.]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4 || !parts.every((p) => /^[a-z]{2,}$/i.test(p))) return null;
  if (NOT_A_NAME.test(parts.join(" ")) || /\b(pm|spm|test|strong|weak|ambiguous|final|new|copy)\b/i.test(parts.join(" "))) return null;
  return titleCase(parts.join(" "));
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

// Options: fileName (used to recover the name when the CV text doesn't show it clearly)
// and knownName (a name already stored for this candidate).
export function extractPii(text, { fileName, knownName } = {}) {
  // PDF extraction glues words together ("SHARMAPriya Sharma", "tracking.ARYAN").
  // Split them first so names can be matched as whole words.
  text = text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]{2,})([A-Z][a-z])/g, "$1 $2");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const emails = text.match(EMAIL) || [];
  const phones = (text.match(PHONE_CANDIDATE) || []).filter(isPhone);
  let found = findName(lines);
  if (found && found === found.toUpperCase()) found = titleCase(found); // "ANANYA DESHPANDE" -> "Ananya Deshpande"
  const fromFile = nameFromFileName(fileName);
  const name = (knownName || fromFile || found || "").replace(/\s+/g, " ").trim() || null;

  let redacted = text
    .replace(EMAIL, "[EMAIL]")
    .replace(PROFILE_URL, "[PROFILE LINK]");
  for (const p of phones.sort((a, b) => b.length - a.length)) redacted = redacted.split(p).join("[PHONE]");
  // Remove every candidate name we know of, in full and part by part (e.g. "Priya" alone).
  const names = [...new Set([name, fromFile, found].filter(Boolean))];
  const tokens = names.flatMap((n) => [n, ...n.split(" ").filter((p) => p.replace(/\./g, "").length >= 3)]);
  for (const token of [...new Set(tokens)].sort((a, b) => b.length - a.length)) {
    redacted = redacted.replace(new RegExp(`\\b${escapeRe(token)}\\b`, "gi"), "[CANDIDATE]");
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
