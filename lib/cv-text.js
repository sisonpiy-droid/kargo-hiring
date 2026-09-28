// Turns an uploaded CV file (PDF, DOCX, TXT/MD) into plain text.
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function cvFileToText(file) {
  const name = (file.name || "").toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  let text;
  if (name.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    ({ text } = await extractText(pdf, { mergePages: true }));
  } else if (name.endsWith(".docx")) {
    ({ value: text } = await mammoth.extractRawText({ buffer: buf }));
  } else if (name.endsWith(".txt") || name.endsWith(".md")) {
    text = buf.toString("utf8");
  } else {
    throw new Error("Unsupported file type. Upload PDF, DOCX or TXT.");
  }

  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (text.length < 200) throw new Error("Could not read enough text from this CV (scanned image?).");
  return text.slice(0, 40000);
}
