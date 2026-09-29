// POST multipart { title, jd?, file? } -> an AI-drafted rubric for a new job, for the founder
// to review before saving. Nothing is written to the database here.
import { checkPasscode } from "@/lib/auth";
import { cvFileToText, MAX_FILE_BYTES } from "@/lib/cv-text";
import { generateRubric } from "@/lib/pipeline";

export const maxDuration = 60;

export async function POST(request) {
  const denied = checkPasscode(request);
  if (denied) return denied;

  try {
    const form = await request.formData();
    const title = String(form.get("title") || "").trim().slice(0, 80);
    let jd = String(form.get("jd") || "").trim();
    const file = form.get("file");
    if (file && typeof file !== "string" && file.size) {
      if (file.size > MAX_FILE_BYTES) return Response.json({ error: "JD file is over 5 MB" }, { status: 400 });
      jd = await cvFileToText(file);
    }
    if (!title) return Response.json({ error: "Give the job a title" }, { status: 400 });
    if (jd.length < 200) return Response.json({ error: "Paste or upload the full job description (at least a few paragraphs)" }, { status: 400 });

    const criteria = await generateRubric(title, jd);
    return Response.json({ title, jd, criteria });
  } catch (err) {
    console.error("rubric draft failed:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
