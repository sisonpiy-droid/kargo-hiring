# Kargo Hiring Dashboard

Internal tool for one founder: upload a CV, pick PM or SPM, and the backend

1. extracts name / email / phone with plain code (`lib/pii.js`) and stores them in `candidate_pii`;
2. sends **only the redacted CV text + rubric** to Gemini Flash, which scores it on **both** the PM and SPM rubrics (0-10 per criterion, one-line reason each), validated before saving (`lib/pipeline.js`);
3. drafts a 3-sentence interview brief, an invite and a rejection (with a `[NAME]` placeholder, filled from `candidate_pii` only at display/send time);
4. shows everything ranked on one page. Nothing is emailed until the founder clicks **Send** (Resend).

Weighted score = Σ(score/10 × weight), 0-100. Recommendation = **Interview** if the candidate is in the top `TOP_N` applicants for their applied role *and* scores ≥ `INVITE_THRESHOLD`; otherwise **Reject**. The founder can override before sending.

## Setup

1. `npm install`
2. Create a Supabase project, open **SQL Editor**, run `db/schema.sql`.
3. `cp .env.example .env.local` and fill it in.
4. `npm run load-rubric` loads `rubric.txt` into `rubric_criteria` (validates 4-6 criteria and 100% per role).
5. `npm run dev`

Checks: `npm run test:pii` (redaction on `test-cvs/`), `node --env-file=.env.local scripts/test-pipeline.mjs` (live Gemini, no DB).

## Deploy (Vercel)

Import the repo, add every variable from `.env.local` in Vercel project settings, deploy.

## Layout

```
rubric.txt                 source of truth for scoring
db/schema.sql              candidates, candidate_pii, rubric_criteria, scores
lib/rubric.js              parses rubric.txt
lib/cv-text.js             PDF / DOCX / TXT -> text
lib/pii.js                 PII extraction + redaction (no AI)
lib/pipeline.js            Gemini scoring + brief/email drafting, with validation
app/api/upload             POST CV -> full pipeline -> save
app/api/candidates         GET ranked candidates + breakdowns
app/api/send               POST -> Resend -> mark sent
app/page.js                the dashboard
```
