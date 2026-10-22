# CV Tailor — Product SRS, Design Plan & Agent Build Instructions

Version 1.0 · Personal project (2 users) · 100% free-tier · Mobile-first, fully responsive

---

## 0. How to use this file (for the AI coding agent)

This file is the single source of truth. You (the coding agent, Gemini Flash in Antigravity) must:

1. Read this whole file before writing any code.
2. Build **phase by phase** (Section 14). After each phase: run typecheck, lint and tests, then **stop and report** what works and what to verify manually. Do not start the next phase until the user says "next".
3. **Never guess an external API.** Before coding against `@vercel/blob`, Groq, or iLoveAPI, open their official docs (links in Section 15) and follow the current shapes. If docs and this file disagree, docs win for API details and this file wins for product behavior. Tell the user about the mismatch.
4. Keep it light: only the dependencies listed in Section 4. Ask before adding any other.
5. No database. No ORM. No auth library. No UI component library.
6. TypeScript strict mode. Small files, small functions, short comments on non-obvious logic.
7. Never commit secrets. `.env.local` must be in `.gitignore`. Create `.env.example` with empty values.
8. Never invent CV content. The product must only reorder, trim, and rephrase text that already exists in the user's CV (see Section 8).
9. If something is ambiguous, ask one short question instead of assuming.

---

## 1. Product summary

A tiny web app for two people (the owner and one friend). Each user:

1. Logs in with a username and password defined in environment variables.
2. Uploads their existing CV as a `.docx` once. It stays stored until they replace it.
3. Pastes a job description. An LLM rearranges, trims and rephrases the **content** of the CV to fit that job. **No template, font, colour, spacing or layout change.**
4. Gets the tailored `.docx` back, with a list of what changed.
5. Taps **Convert to PDF** (via iLoveAPI). Then downloads or shares the PDF.
6. If iLoveAPI is unavailable (limit reached or invalid keys), the app shows the tailored DOCX download plus a button to the iLovePDF website for manual conversion.

CVs have **different structures** (different Word templates). The system must not assume fixed section names.

## 2. Goals and non-goals

### Goals
- Preserve the original DOCX design exactly by editing the DOCX XML in place.
- Work for arbitrary Word CV layouts (paragraphs, bullets, tables, two-column via tables).
- Free hosting and free APIs only.
- Excellent on phones (primary), good on tablets and desktops.
- Clear, friendly error messages when limits are hit.

### Non-goals (v1)
- Public sign-up, user management, payments.
- Canva-made CVs (Canva does not export a clean editable DOCX; users must provide a Word file).
- Job-site scraping or auto-apply.
- Design or template changes.
- Storing a history of every tailored CV (only the latest per user).
- Fully guaranteeing identical page count (best-effort guard only).

## 3. Users and access

- Exactly the users defined in env vars (Section 11). No registration page.
- Internal ids are `user1`, `user2`, ... (from the env var index). Display name comes from `USERn_NAME`.
- Users cannot see each other's files. Every storage path is built from the session's user id, never from client input.

---

## 4. Tech stack (fixed)

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router), TypeScript strict, Node runtime for API routes |
| Styling | Tailwind CSS only |
| Hosting | Vercel Hobby |
| File storage | Vercel Blob (see 4.1) |
| Session | Signed JWT in an `httpOnly` cookie using `jose` |
| DOCX read/write | `pizzip` (zip) + `@xmldom/xmldom` (XML DOM, preserves structure on serialize) |
| Validation | `zod` |
| LLM | Groq OpenAI-compatible HTTP API via plain `fetch` (no SDK) |
| PDF conversion | iLoveAPI (official Node library if its docs recommend it, else raw REST) |
| Tests | `vitest` |
| Icons | `lucide-react` (only a handful of icons) |

Do not add anything else without asking.

### 4.1 Blob notes
- Prefer a **private** Blob store if the current `@vercel/blob` docs support it, and serve files through authenticated API routes.
- If private is not available, use a public store with **unguessable pathnames** (include a random 16+ char token per user, kept in meta). The owner stated the CV is not sensitive, but the app login must still protect everything else.
- Overwrite fixed paths instead of creating new ones each time (no storage growth).

### 4.2 Storage layout (per user)

```
cv/{userId}/master.docx      the original uploaded CV (replaced only when user uploads again)
cv/{userId}/latest.docx      most recent tailored DOCX
cv/{userId}/latest.pdf       most recent converted PDF (optional, may not exist)
cv/{userId}/meta.json        { originalFilename, uploadedAt, lastLabel, lastTailoredAt, changes[] }
```

Limits: uploads max **3 MB** (Vercel serverless request bodies are limited to about 4.5 MB). Accept only `.docx` (check extension, MIME type, and that it opens as a zip containing `word/document.xml`).

---

## 5. Functional requirements

### FR-1 Login
- Login page with username and password.
- Server compares credentials against env vars using timing-safe comparison (hash both with SHA-256 then `crypto.timingSafeEqual`).
- On success: set cookie `session` = JWT `{ uid, name }`, signed with `SESSION_SECRET`, `httpOnly`, `secure` (in production), `sameSite=lax`, `path=/`, 30 days.
- On failure: generic message "Wrong username or password", plus a ~800 ms artificial delay and a best-effort in-memory attempt counter (5 fails per IP per 15 minutes returns 429). Note in code comments that serverless memory is not persistent, so this is best-effort only.
- Logout clears the cookie.
- Middleware verifies the JWT (using `jose`, edge-compatible) for every page and API route except `/login` and `/api/login`. Unauthenticated page requests redirect to `/login`; API requests return 401 JSON.
- Mutating routes also check the `Origin` header matches the site host (basic CSRF defence).

### FR-2 Upload / replace CV
- If the user has no master CV: show a large upload area as the first thing on the home page.
- If they have one: show a card with filename, uploaded date, and a **Replace CV** button.
- Upload via `multipart/form-data` to `POST /api/cv`. Validate size, type, and zip structure. Save to `cv/{userId}/master.docx` with overwrite. Update `meta.json`.
- On upload, immediately run the parser (FR-4) as a sanity check and report: "Found N editable paragraphs". If 0, reject with a helpful message.

### FR-3 Tailor
- Inputs: job description text (required, 50 to 8000 chars) and optional label (company or role, max 60 chars) used in file names.
- `POST /api/tailor`:
  1. Load `master.docx` from Blob.
  2. Parse paragraphs (FR-4).
  3. Build the compact prompt (Section 8) and call the LLM with the fallback chain (FR-5).
  4. Validate and apply operations (FR-6).
  5. Save `latest.docx`, update `meta.json`.
  6. Return `{ ok, changes[], stats }`. File bytes are served by `GET /api/files/latest.docx`.
- Always tailor from `master.docx`, never from a previous tailored version.

### FR-4 DOCX paragraph model
Parse `word/document.xml` and list every `w:p` in document order, including paragraphs inside tables (`w:tbl > w:tr > w:tc`). Each paragraph record:

```ts
type Para = {
  id: number;            // index in document order
  text: string;          // concatenated w:t text
  style: string | null;  // w:pStyle value
  isList: boolean;       // has w:numPr
  parentKey: string;     // "body" or "tbl{i}.r{j}.c{k}" — identifies the container
  runCount: number;
  mixedFormatting: boolean; // runs have different rPr
  locked: boolean;       // contains drawing, field, hyperlink, sdt, page break, or text box; never edited
};
```

Rules:
- Skip headers, footers, footnotes (v1). Text boxes (`w:txbxContent`) are treated as `locked`.
- Empty paragraphs are kept in the XML but omitted from the LLM prompt.
- The parser must be deterministic and also usable at upload time for validation.

### FR-5 LLM call with fallback chain
Order of attempts (stop at first success):

1. `GROQ_API_KEY_1` + `openai/gpt-oss-120b`
2. `GROQ_API_KEY_1` + `openai/gpt-oss-20b`
3. `GROQ_API_KEY_2` + `openai/gpt-oss-120b`
4. `GROQ_API_KEY_2` + `openai/gpt-oss-20b`

Advance to the next attempt on: HTTP 429, 401/403 (invalid key), 5xx, or network timeout (20 s). Rate limits are per organization and per model, which is why the model fallback helps.

If all fail, return error code `LLM_LIMIT_REACHED` with message: "AI limit reached on both accounts. Please try again in a few minutes (or tomorrow if the daily limit is used)." If the 429 response includes a retry time, show it. If every failure was 401/403, return `LLM_KEYS_INVALID` with message "AI keys are invalid. Check the server settings."

Request settings: `temperature` 0.2, `reasoning_effort` low (if supported for the model), JSON-only output, `max_tokens` about 3000. Groq free tier has a small tokens-per-minute budget (about 8K per minute per model at time of writing; verify), so keep prompts compact: send ids and text only, no XML. At most **one** repair retry if the JSON fails schema validation, and only on the same attempt.

### FR-6 Apply operations (safety engine)
The LLM returns operations (Section 8). The engine validates **every** operation and silently drops invalid ones (recording a warning). Rules:

- `reorder`: `ids` must be unique, exist, be unlocked, share the same `parentKey`, be a **contiguous run** of siblings, and all have the same `isList` value. The new order is written into the same slots those paragraphs occupied. Only bullets and skill/list-like lines are meant to be reordered. Never reorder headings or job title lines.
- `rewrite`: paragraph must be unlocked. New text length must be at most 115% of the original length. Every number (digits) in the new text must already appear in the original paragraph or somewhere in the master CV text. No new URLs or emails.
- `delete`: only paragraphs with `isList = true`. Max 3 deletions per run. Used only to keep the CV near its original length.
- Global guard: total characters after edits must be at most 102% of the original total. If exceeded, revert the longest rewrites first until within limit.
- Operations touching `locked` paragraphs are dropped.

Writing text back (preserve formatting):
- Default: put the new text in the **first text run**, keep that run's `rPr`, and remove the text from the other runs (remove empty runs).
- Label pattern: if the first run is bold and later runs are not (like `Skills: Python, SQL`), keep the first run as is and put the new text into the second run.
- Use `xml:space="preserve"` on `w:t` when text has leading/trailing spaces.
- Paragraph properties (`w:pPr`) are never changed.
- Serialize with the same XML declaration and namespaces, then re-zip, keeping all other zip entries byte-identical.

### FR-7 Convert to PDF (iLoveAPI)
- Button **Convert to PDF** is enabled only when `latest.docx` exists.
- `POST /api/convert`:
  1. Load `latest.docx`.
  2. Try iLoveAPI with key set 1 (`ILOVEAPI_PUBLIC_KEY_1` + `ILOVEAPI_SECRET_KEY_1`).
  3. If it fails with an auth error, quota or limit error, or a credits error, try key set 2.
  4. If both fail, return error code `PDF_UNAVAILABLE`.
  5. On success, save `latest.pdf` and return `{ ok: true }`.
- iLoveAPI flow (follow the official docs for exact endpoints and field names): authenticate, start task `officepdf`, upload the file, process, download the result.
- Do not try to count credits (no database). Just attempt, and handle the error.
- Allow up to 60 s for this route (`export const maxDuration = 60`, verify the Hobby limit).
- Error handling: network or temporary errors may retry once on the same key set before moving on.

### FR-8 Result and fallback UI behavior
After tailoring succeeds, show:
- A summary of changes (FR-9).
- **Download DOCX** (always).
- **Convert to PDF**.

After conversion:
- Success: **Download PDF** (primary) and **Share** (uses `navigator.share` with a File when supported; otherwise hide it).
- Failure (`PDF_UNAVAILABLE`): show a calm info panel:
  "PDF conversion is unavailable right now (monthly limit reached or keys not working). You can convert it yourself in under a minute:"
  1. **Download DOCX** button
  2. **Open iLovePDF** button (opens `https://www.ilovepdf.com/word_to_pdf` in a new tab with `rel="noopener noreferrer"`)
  3. A short note: "Upload the downloaded file there, convert, and download the PDF."

### FR-9 Change summary
The LLM returns short human-readable notes. The app also computes its own facts: number of bullets reordered, paragraphs rewritten, paragraphs removed, and character delta. Show them in a collapsible "What changed" card, so the user can check nothing was invented.

### FR-10 File naming
Download filenames: `{DisplayName}_CV_{label-or-"Tailored"}_{YYYY-MM-DD}.docx|pdf`, sanitized to letters, numbers, dash and underscore.

---

## 6. Non-functional requirements

- **Responsive**: works from 360 px wide phones up to desktop; mobile is the design priority.
- **Performance**: first load JS as small as possible; the home page must be a mostly static shell. No heavy client libraries.
- **Reliability**: every API route returns JSON `{ ok: false, code, message }` on error with a proper HTTP status. Never leak stack traces, keys or file contents.
- **Security**: secrets only on the server; auth middleware on everything; strict upload validation; same-origin checks on POST; no user-supplied paths.
- **Cost**: zero. Stay inside free tiers. Delete nothing automatically except overwriting fixed paths.
- **Accessibility**: labels on all inputs, visible focus, `aria-live` for status messages, minimum 44 px touch targets, contrast AA.
- **Privacy**: do not log CV text or job descriptions. Log only error codes and timings.

---

## 7. Error codes and user messages

| Code | HTTP | Message to user |
|---|---|---|
| `UNAUTHORIZED` | 401 | "Please log in again." |
| `BAD_LOGIN` | 401 | "Wrong username or password." |
| `TOO_MANY_ATTEMPTS` | 429 | "Too many attempts. Try again in a few minutes." |
| `NO_CV` | 400 | "Upload your CV first." |
| `BAD_FILE` | 400 | "Please upload a .docx Word file under 3 MB." |
| `EMPTY_DOC` | 400 | "I couldn't find editable text in this file." |
| `BAD_JD` | 400 | "Paste a job description (at least 50 characters)." |
| `LLM_LIMIT_REACHED` | 503 | "AI limit reached on both accounts. Try again in a few minutes or tomorrow." |
| `LLM_KEYS_INVALID` | 503 | "AI keys are invalid. Check the server settings." |
| `LLM_BAD_OUTPUT` | 502 | "The AI returned something unusable. Please try again." |
| `PDF_UNAVAILABLE` | 503 | Fallback panel in FR-8 |
| `INTERNAL` | 500 | "Something went wrong. Please try again." |

---

## 8. LLM design

### 8.1 Prompt payload (compact)
Send only non-empty paragraphs, one per line:

```
id|style|flags|text
12|Normal|L|Built REST APIs in Node.js serving 2M requests/day
```
Flags: `B` bullet, `X` locked (do not touch). Also send the job description. Do not send XML.

### 8.2 System prompt (use as written)

```
You tailor a CV to a job description by editing existing text only.
You receive CV paragraphs as lines "id|style|flags|text" and a job description.

HARD RULES
- Never invent skills, tools, employers, titles, dates, degrees, numbers, or achievements.
- Use only facts already present in the CV paragraphs.
- Do not touch paragraphs flagged X.
- Do not reorder headings, names, contact lines, job titles, or dates.
- You may: (1) reorder a contiguous run of bullet or list-item paragraphs so the most relevant come first,
  (2) rewrite a paragraph to emphasize relevant existing facts and use the job's wording when it truthfully
  matches existing content, (3) delete at most 3 least-relevant bullets.
- A rewrite must be about the same length as the original (at most 15% longer). Keep numbers exactly.
- For skills lines, reorder the items so the most relevant skills come first; do not add skills that are not in the CV.
- The professional summary may be rewritten to target the job, using only existing facts.
- Prefer a few high-impact changes over many small ones.

OUTPUT: JSON only, no markdown, matching exactly:
{
  "operations": [
    {"type":"reorder","ids":[<paragraph ids in the new order>]},
    {"type":"rewrite","id":<id>,"text":"<new text>"},
    {"type":"delete","id":<id>}
  ],
  "notes": ["<short plain-English description of each meaningful change>"]
}
```

### 8.3 Output schema (zod)
```ts
const Op = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reorder"), ids: z.array(z.number().int()).min(2).max(40) }),
  z.object({ type: z.literal("rewrite"), id: z.number().int(), text: z.string().min(1).max(1200) }),
  z.object({ type: z.literal("delete"), id: z.number().int() }),
]);
const Out = z.object({ operations: z.array(Op).max(60), notes: z.array(z.string().max(200)).max(20) });
```
Strip code fences before `JSON.parse` in case the model adds them.

### 8.4 Token budget
Target prompt size: under about 4,000 tokens (CV plus JD). If the CV text is too long, truncate the JD to 8,000 chars and log a warning. Do not send CV paragraphs that are empty or locked-only.

---

## 9. API routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/login` | Validate credentials, set session cookie |
| POST | `/api/logout` | Clear cookie |
| GET | `/api/me` | `{ name, hasCv, meta }` for the UI |
| POST | `/api/cv` | Upload or replace master CV (multipart) |
| POST | `/api/tailor` | Body `{ jd, label? }` → create `latest.docx` |
| POST | `/api/convert` | Convert `latest.docx` to `latest.pdf` via iLoveAPI |
| GET | `/api/files/[name]` | Authenticated download of `master.docx`, `latest.docx`, `latest.pdf`; `Content-Disposition: attachment` with the sanitized filename |

All routes use `export const runtime = "nodejs"`. The user id always comes from the verified session.

---

## 10. UI / UX design plan

### 10.1 Principles
- One page, one column, big touch targets. Phone first, then scale up.
- The next action is always obvious (one primary button visible at a time).
- Calm, plain language. No jargon.

### 10.2 Layout
- Container: `max-w-xl` centered on small and medium screens. At `lg` (1024 px+), use two columns: left = CV card and job description input, right = result panel. Max total width about 1000 px.
- Use `min-h-dvh` (not `vh`) for full-height areas so mobile browser bars do not break the layout.
- Respect safe areas: `padding-bottom: env(safe-area-inset-bottom)` for the sticky action bar.
- Input and textarea font size at least 16 px so iOS does not zoom on focus.

### 10.3 Screens

**Login**
```
┌───────────────────────────┐
│        CV Tailor          │
│  Username  [____________] │
│  Password  [____________] │
│  [        Log in        ] │
│  (error message area)     │
└───────────────────────────┘
```

**Home (mobile, stacked cards)**
```
┌ CV Tailor        Hi, Name  ⎋ ┐   top bar (sticky)
├───────────────────────────────┤
│ ① Your CV                     │
│  📄 my_cv.docx · 12 Oct       │
│  [ Replace CV ]               │
├───────────────────────────────┤
│ ② Job description             │
│  Role or company (optional)   │
│  [__________________________] │
│  [ paste job description…   ] │
│  [                          ] │
│  1,240 / 8,000                │
├───────────────────────────────┤
│ ③ Result  (appears after run) │
│  ✓ Tailored CV ready          │
│  ▸ What changed (3)           │
│  [ Download DOCX ]            │
│  [ Convert to PDF ]           │
└───────────────────────────────┘
 [        Tailor my CV        ]    sticky bottom bar on mobile
```

**No CV yet**: card ① becomes a large dashed drop area "Tap to upload your .docx CV" and cards ② ③ are disabled.

**After PDF success**: the result card shows **Download PDF** (primary), **Share** (if supported), **Download DOCX** (secondary).

**PDF unavailable**: info panel from FR-8 with numbered steps, **Download DOCX** and **Open iLovePDF** buttons.

### 10.4 States
- Idle, uploading, tailoring, converting, success, error. Disable the action button while busy to avoid double-spending quota.
- Busy text: "Tailoring your CV… this takes about 10 to 20 seconds." Converting: "Converting to PDF…".
- Errors appear in an inline alert with `role="alert"` near the action, with the friendly message from Section 7.
- Keep the user's pasted job description if an error happens.
- Remember the last job description in component state only (no browser storage needed).

### 10.5 Visual style
- Font: system font stack (or `next/font` Inter, subset latin). No custom icon font.
- Tokens (Tailwind): radius `rounded-xl`, cards `border` + subtle shadow, spacing scale 4/8/12/16/24.
- Colors: neutral grays, one accent (indigo-600) for primary buttons, green for success, amber for info/warning, red for errors.
- Dark mode: follow `prefers-color-scheme` using Tailwind `dark:` classes.
- Buttons: min height 48 px on mobile, full width on mobile, auto width on desktop. Primary = filled accent, secondary = outlined.
- Motion: minimal. A simple spinner. Respect `prefers-reduced-motion`.

### 10.6 Responsive checklist (must pass)
- 360×640, 390×844, 768×1024, 1280×800 all usable with no horizontal scroll.
- Sticky bottom action bar only on screens below `lg`; inline button on desktop.
- Long filenames truncate with ellipsis.
- Textarea resizes vertically only.
- Touch targets at least 44 px.

---

## 11. Environment variables

`.env.example` (values empty) and Vercel Project Settings:

```
SESSION_SECRET=              # 32+ random chars

USER1_NAME=
USER1_PASSWORD=
USER2_NAME=
USER2_PASSWORD=

GROQ_API_KEY_1=
GROQ_API_KEY_2=
GROQ_MODEL_PRIMARY=openai/gpt-oss-120b
GROQ_MODEL_FALLBACK=openai/gpt-oss-20b

ILOVEAPI_PUBLIC_KEY_1=
ILOVEAPI_SECRET_KEY_1=
ILOVEAPI_PUBLIC_KEY_2=
ILOVEAPI_SECRET_KEY_2=

BLOB_READ_WRITE_TOKEN=       # created by Vercel when a Blob store is connected
```

Rules:
- Use long random passwords (16+ chars). Passwords and keys live only in env vars.
- Code must read users by scanning `USER{n}_NAME` and `USER{n}_PASSWORD` for n = 1.. (stop at the first missing index) so adding a user needs no code change.
- Missing optional keys (for example the second key) are skipped, not fatal. If both keys of a service are missing, return the matching "keys invalid" error.

---

## 12. Project structure

```
/app
  /login/page.tsx
  /page.tsx                      home (client component for interactions)
  /api/login/route.ts
  /api/logout/route.ts
  /api/me/route.ts
  /api/cv/route.ts
  /api/tailor/route.ts
  /api/convert/route.ts
  /api/files/[name]/route.ts
  layout.tsx, globals.css
/lib
  auth.ts          # env users, verify password, sign/verify JWT
  storage.ts       # Blob helpers: getUserFile, putUserFile, meta read/write
  docx/parse.ts    # DOCX → Para[]
  docx/apply.ts    # validate + apply operations, serialize
  docx/types.ts
  llm/groq.ts      # fallback chain, fetch, JSON parse
  llm/prompt.ts    # system prompt + payload builder
  llm/schema.ts    # zod
  pdf/iloveapi.ts  # convert with key-set fallback
  errors.ts        # error codes + helper to build JSON responses
/components        # Button, Card, Alert, FileDrop, Spinner, ChangesList
/middleware.ts     # JWT check (edge, jose only)
/tests
  /fixtures        # sample .docx files (user adds their own two CVs; do not commit private ones)
  docx.parse.test.ts
  docx.apply.test.ts
  llm.schema.test.ts
```

---

## 13. Testing and acceptance

### Unit tests
- **Round trip**: parse a fixture, apply zero operations, save. The resulting `word/document.xml` must equal the original (byte-equal or XML-canonical-equal), and other zip entries must be unchanged.
- **Reorder**: reordering a contiguous bullet run changes only those paragraphs' positions; run properties of each bullet stay attached to its text.
- **Rewrite**: new text appears; `w:pPr` and first-run `rPr` are unchanged.
- **Rejections**: non-contiguous ids, mixed parents, locked paragraphs, new digits, too-long rewrites, more than 3 deletions are dropped.
- **Schema**: invalid LLM JSON is rejected; fenced JSON is accepted after stripping.
- **Fallback chain**: mock `fetch` to return 429, 401, then 200; verify the order of attempts and the final error codes.

### Manual acceptance checklist
1. Log in on phone and desktop; wrong password shows the generic error.
2. Upload your CV DOCX; it persists after refresh and after logout/login.
3. Upload your friend's different-template CV on the second account; each account sees only its own file.
4. Paste a real job description, tap Tailor. Open the DOCX in Word: design looks identical, content reordered or rephrased, nothing invented.
5. Convert to PDF: PDF downloads and looks the same as the DOCX in Word.
6. Temporarily blank out `GROQ_API_KEY_1`: app falls back to key 2. Blank both: shows the limit/invalid message.
7. Temporarily blank both iLoveAPI key sets: fallback panel appears with Download DOCX and Open iLovePDF buttons.
8. No horizontal scroll at 360 px; all buttons easy to tap on a real phone.

---

## 14. Build phases (stop after each)

| Phase | Work | Done when |
|---|---|---|
| 0 | Scaffold Next.js + TS + Tailwind, `.env.example`, `.gitignore`, base layout, folder structure | App runs locally; typecheck and lint pass |
| 1 | Auth: env users, login page, JWT cookie, middleware, logout, `/api/me` | Both users can log in; protected routes redirect |
| 2 | Blob storage + CV upload/replace, home page card ① | Upload persists per user across sessions |
| 3 | DOCX engine: parse, apply, tests with fixtures | All DOCX unit tests pass on both users' real CVs |
| 4 | Groq chain + prompt + `/api/tailor` + result card with changes and DOCX download | Tailored DOCX opens in Word with unchanged design |
| 5 | iLoveAPI convert + `/api/convert` + PDF download/share + fallback panel | PDF works; fallback shows when keys are blank |
| 6 | Responsive polish, dark mode, accessibility pass, error messages | Section 10.6 and 13 checklists pass |
| 7 | Deploy to Vercel, set env vars, connect Blob, smoke test on phone | Live URL works for both users |

---

## 15. External references (read before coding)

- Vercel Blob SDK and pricing: https://vercel.com/docs/vercel-blob (and its usage-and-pricing page)
- Groq API and rate limits: https://console.groq.com/docs/rate-limits and the chat completions docs (OpenAI-compatible)
- iLoveAPI developer docs: https://developer.ilovepdf.com (tool `officepdf`; check the Node library and REST reference)
- iLovePDF manual page for the fallback button: https://www.ilovepdf.com/word_to_pdf

### Known limits (verify, they change)
- Vercel Blob Hobby: about 1 GB storage, large per-file limit, no overage; exceeding limits blocks access until the period resets.
- Groq free tier for `gpt-oss-120b` and `gpt-oss-20b`: about 30 requests/min, 1K requests/day, 8K tokens/min, 200K tokens/day, **per organization and per model**.
- iLoveAPI: about 2,500 free credits per month per account; Office to PDF is about 10 credits per file (about 250 files).
- Vercel serverless request body limit about 4.5 MB; function duration limits depend on plan and settings.

---

## 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Complex CV layout breaks after edit | Edit XML in place; only touch text in paragraphs; lock risky paragraphs; round-trip test |
| LLM invents facts | Strict prompt, numeric and URL checks, change summary shown to the user |
| Tailored CV becomes longer than one page | Length caps per paragraph and globally; delete up to 3 bullets |
| Groq per-minute token cap | Compact prompt, low reasoning effort, clear "try again soon" message |
| PDF fonts differ after conversion | Always offer DOCX download and the manual iLovePDF route; user checks the PDF once |
| Free-tier limits change | Limits in Section 15 are marked "verify"; errors are handled generically |
| Brute-force login | Long random passwords, delay and best-effort counter, optional Vercel firewall rate limit |

---

## 17. Master prompt to paste into Antigravity (Gemini Flash, high)

```
You are building the project described in product_srs.md in this directory.

Rules:
1. Read product_srs.md fully first. Summarize your understanding in 10 lines and list any questions. Then wait.
2. Work only on the phase I name. Start with Phase 0. After each phase, run typecheck, lint and tests,
   report what you built, how I can test it manually, and stop.
3. Before using @vercel/blob, the Groq API, or iLoveAPI, open the official docs listed in Section 15 and
   follow the current API. Do not guess endpoints, parameter names or response shapes. Report any
   mismatch with the SRS.
4. Use only the dependencies in Section 4. Ask before adding any.
5. No database, no auth library, no UI library. TypeScript strict. Small files.
6. Never commit secrets. Create .env.example only. Never log CV text or job descriptions.
7. The DOCX engine must edit XML in place and keep all formatting (Section 5, FR-4 and FR-6). Write the
   round-trip test before the apply logic.
8. Mobile first (360 px), then tablet and desktop. Follow Section 10 exactly.
9. If anything is unclear, ask one short question instead of assuming.

Begin with Phase 0 now.
```

---

## 18. Definition of done

- Both users can log in on phone and desktop, keep their own CV across sessions, tailor it to any pasted job description, and get a DOCX with unchanged design and truthful content.
- PDF conversion works through iLoveAPI with automatic key fallback; when unavailable, the app shows the DOCX download and the manual iLovePDF button.
- AI key fallback works; clear messages appear when limits are reached.
- No secrets in the repo; deployed on Vercel Hobby using only free services.
