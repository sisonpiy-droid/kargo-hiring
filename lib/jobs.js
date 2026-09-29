// Jobs (PM and SPM are presets; new ones come from a JD) and their rubrics.
import { db, q } from "./db.js";

export async function loadJobs() {
  return q(db().from("jobs").select("key, title, jd_text, preset, created_at").order("created_at"));
}

export const jobTitle = (jobs, key) => jobs.find((j) => j.key === key)?.title || key;
