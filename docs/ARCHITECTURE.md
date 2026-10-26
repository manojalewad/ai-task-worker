# Architecture

```
Goal ─► Understand ─► Plan ─► Decide ─► Execute ─► Observe ─► (loop) ─► Verify ─► Report
         parse.js     stages   LLM or    tools     facts       │            verifier   evidence
                               rules                  ▲        ▼
                                   pause: ask user / approval ──► resume from saved state
```

## Runtime (`server/src/agent`)
| File | Role |
|---|---|
| `understand.js` | Free text → structured intent (kind, supplier, invoice no., "latest", notify target, filters). Transparent, no model call. Also defines the **plan stages** per intent. |
| `state.js` | Durable task state: `plan`, `facts` (working memory), `history` (observations), `pending` (question/approval). `absorb()` is the *only* place observations become memory, so both deciders share it. |
| `deciders/llm.js` | Gemini picks one next action as JSON (`tool` / `ask_user` / `finish` / `refuse`); output is zod-validated with one repair attempt and retries on 429/5xx. |
| `deciders/rules.js` | Deterministic decider with the **same action protocol**. Used with no API key, and as automatic fallback if the model errors, loops, or emits garbage. |
| `runner.js` | The loop. Claims the task atomically, executes tools with retry/back-off, logs every step, pauses/resumes, enforces the finish guard, handles cancel/crash/restart. |
| `verifier.js` | Compares what the finance system now holds against the source invoice, field by field. The agent's own claims are never trusted. |
| `reply.js` | Applies a human reply (form values / free text / choice / uploaded doc) with provenance, then the task resumes. |

## Design decisions
1. **Pause ≠ end.** The original version marked a task `needs_input` and stopped, with nowhere to answer. State is now persisted on the task (`state.pending`), `POST /tasks/:id/reply` applies the answer and re-queues the same task. Approvals use the same mechanism: the exact approved tool call is stored and replayed.
2. **The model proposes, the runtime disposes.** Tools are a closed registry with zod-validated args, a risk class (`read|write|external`), role checks and policy-driven approval. The model cannot run code, queries, or unlisted tools. Document text and tool output are treated as data (prompt-injection safe — see the seeded Orbit invoice).
3. **Verification is independent and enforced.** After any write the runtime itself reads the bill back and compares fields. A `finish` is rejected if a write was requested/claimed but not verified. Failure to verify = task fails honestly, never "done".
4. **Graceful degradation.** AI down? Same loop, rules decider. ERP flaky? Transient errors retry with exponential back-off; validation rejections turn into a targeted question; persistent outage fails visibly and can be resumed (`/retry`).
5. **Idempotency & concurrency.** Unique indexes + idempotency keys on bills; atomic `queued → running` claim; step writes are conditional on `running` so a cancel always wins; interrupted tasks are resumed on boot.
6. **Generalisation.** Adding a capability = add one tool to `tools/registry.js` (schema, risk, handler). The loop, planner prompt, approvals, audit log, UI timeline and eval harness need no change.
7. **Tenant isolation.** Every query is scoped by `companyId` derived from the JWT; covered by an automated scenario.

## Data
`Task` (state, messages, result) · `ExecutionLog` (audit) · `Document` (+ `FileBlob` or Cloudinary) · `FinanceRecord` (simulated ERP bills) · `Employee` · `CompanyPolicy` · `Outbox`.

## Known limitations
- Execution is in-process (resumed on restart, but not horizontally scaled) — production would use a queue (BullMQ/Redis) with leases.
- The "finance system" is simulated in Mongo; connectors for real systems / browser-driven UIs would implement the same tool interface.
- Rule-based extraction handles common layouts; unusual invoices need the Gemini path or the correction form.
- Free-text → field parsing in replies is rule-based.
