# Alignwork — Autonomous Company AI Worker

Give it an outcome in plain English — *"Find the latest invoice from Northstar Supplies, extract the amount and due date, enter it into our finance system and tell me when it's done"* — and it **finds the document, reads it, checks for duplicates, writes to the finance system, reads the record back to verify every field, and reports with evidence**. If it can't proceed it **asks you, waits, and resumes exactly where it stopped**.

`Goal → Understand → Plan → Execute → Observe → Adapt → Verify → Complete` — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start (no accounts needed)
```bash
npm install
npm --prefix client install
cp .env.example .env        # defaults work as-is
npm run dev                 # UI http://localhost:5173  ·  API http://localhost:5000
```
Sign in with the pre-filled **admin@acme.demo / DemoPass123!**. With `MONGODB_URI` empty the app uses a built-in throwaway MongoDB and seeds demo data automatically (the first start downloads a MongoDB binary, ~1–2 min). To persist data, set `MONGODB_URI` and run `npm run seed`.

No Gemini key? Everything still works via the deterministic planner. Add `GEMINI_API_KEY` to let the model choose actions (with automatic fallback). No Cloudinary? PDFs are stored in MongoDB.

Production-style run: `npm run build && npm start` → http://localhost:5000.

## Try these (each shows a different capability)
| Say | You'll see |
|---|---|
| *Find the latest invoice from Northstar Supplies, extract amount and due date, enter it into our finance system…* | full loop, verification table, evidence |
| *Process the latest invoice from Greenleaf Office Co and register it* | **asks for the missing amount** → type `amount is USD 1,440` or use the form → resumes → verified |
| *Process the invoice and register it* | ambiguous → asks **which invoice** (buttons) |
| *Find the latest invoice from Contoso and register it* | not found → asks → you reply "Blue Harbor Logistics" → continues |
| Settings → enable **finance write approval**, then register anything | pauses → **Approve** → executes the approved call → verified |
| *Register the latest Blue Harbor Logistics invoice and email Priya Sharma once done* | does the work, then notifies (see **Outbox**) |
| *Which invoices are overdue and not yet registered?* | filtered search + totals |
| *Register invoice OCS-1182* | Orbit's PDF contains a hidden prompt-injection; it is ignored |
| Start with `ERP_CHAOS_RATE=0.5` | transient finance outages → visible retries → still completes |
| Upload your own text-PDF invoice (drag onto the composer) | extracted, editable, registrable |

Sample PDFs: `npm run samples` writes them to `./samples`.

## Evaluate the agent
```bash
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/caw_eval npm run eval   # scorecard of 23 end-to-end scenarios
npm test                                                            # same scenarios under node:test
```
Scenarios drive the real HTTP API: happy path, idempotency, ask-and-resume (form and free text), ambiguity, not-found recovery, approval/rejection, transient outage retry, long outage honesty + resume, ERP validation rejection, prompt injection, tenant isolation, restart recovery, LLM mode with premature-finish rejection, and LLM-failure fallback.

## API
`POST /api/auth/login` · `GET /api/company/{overview,employees,bills,outbox,policies,agent}` · `PUT /api/company/policies`
`POST /api/invoices/upload` · `GET /api/invoices[/:id[/file]]` · `PATCH /api/invoices/:id/fields`
`POST /api/tasks` · `GET /api/tasks[/:id]` · **`POST /api/tasks/:id/reply`** `{message?, fields?, documentId?}` · `POST /api/tasks/:id/{approve,reject,cancel,retry}`

## What's pre-built vs. mine
Express, Mongoose, React/Vite, zod, pdf-parse, pdfkit (sample PDFs), `@google/generative-ai` (optional). The agent runtime, tools, simulated finance system, verifier, planner/deciders, UI and eval harness are original to this repo.

## Limitations & next steps
In-process execution (→ BullMQ + leases) · real browser/desktop "computer use" connector behind the same tool interface · OCR path only via Gemini · learn from user corrections (store supplier-specific extraction hints) · streaming (SSE) instead of polling · richer approval chains.

Never commit `.env`. Demo credentials are for local use only — change `DEMO_PASSWORD` before any public deployment.
