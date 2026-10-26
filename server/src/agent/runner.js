'use strict';
const { Task, Document, Company, User, CompanyPolicy, Employee } = require('../models');
const llm = require('../llm');
const { tools, executeTool, needsApproval } = require('../tools/registry');
const { logEvent } = require('../services/audit');
const { parseRequest } = require('./understand');
const { newState, absorb, pushError, refreshPlan } = require('./state');
const rules = require('./deciders/rules');
const llmDecider = require('./deciders/llm');
const { composeAnswer } = require('./answer');
const HttpError = require('../utils/httpError');

const maxSteps = () => Math.max(4, Math.min(Number(process.env.MAX_AGENT_STEPS) || 14, 30));
const RETRY_BASE = () => Number(process.env.AGENT_RETRY_BASE_MS ?? 350);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REFUSAL = 'I can help with company information and supported business workflows: reading and registering invoices, listing overdue or unregistered invoices, verifying finance records and looking up colleagues. I can\'t help with unrelated requests.';
class Aborted extends Error {}

async function runTask(taskId) {
  const claimed = await Task.findOneAndUpdate({ _id: taskId, status: 'queued' }, { $set: { status: 'running' } }, { new: true });
  if (!claimed) return; // already running, finished or cancelled
  const task = claimed;
  const state = Object.assign(newState(), task.state || {}); state.facts = Object.assign({ searches: [] }, state.facts); state.history = state.history || [];
  const log = (action, status, summary, extra = {}) => logEvent({ companyId: task.companyId, taskId: task._id, action, status, summary, ...extra });
  const persist = async (patch = {}) => { const r = await Task.updateOne({ _id: task._id, status: 'running' }, { $set: { state, ...patch } }); if (!r.matchedCount) throw new Aborted(); };
  const settle = async (status, patch) => { // terminal/paused transition; only from 'running' so a concurrent cancel wins
    const r = await Task.updateOne({ _id: task._id, status: 'running' }, { $set: { status, state, ...patch } }); return r.matchedCount > 0;
  };
  try {
    const [company, user] = await Promise.all([Company.findById(task.companyId), User.findById(task.userId)]);
    const membership = user?.memberships.find(m => String(m.companyId) === String(task.companyId));
    if (!company || !membership) return await fail('COMPANY_ACCESS_DENIED', 'You no longer have access to this company.');
    const policyDocs = await CompanyPolicy.find({ companyId: task.companyId }).lean();
    const policies = Object.fromEntries(policyDocs.map(p => [p.key, p.value]));
    if (policies.requireApprovalForFinanceWrite === undefined) policies.requireApprovalForFinanceWrite = Boolean(company.policy?.requireApprovalForFinanceWrite);
    const [supplierNames, employees] = await Promise.all([Document.distinct('extractedFields.supplier', { companyId: task.companyId }), Employee.find({ companyId: task.companyId, active: true }).select('name workEmail').lean()]);
    state.facts.knownSuppliers = Object.fromEntries(supplierNames.filter(Boolean).map(s => [s, 1]));
    // Keep finance registration safe for companies with an older persisted tool list.
    // A company that is allowed to create bills must also be able to check duplicates
    // and read the bill back for verification; otherwise the planner loops on a
    // registered tool that the stale enabledTools list incorrectly rejects.
    const enabledTools = company.enabledTools?.length
  ? [...company.enabledTools]
  : Object.keys(tools);

for (const requiredTool of ['erp_find_bill', 'erp_get_bill']) {
  if (tools[requiredTool] && !enabledTools.includes(requiredTool)) {
    enabledTools.push(requiredTool);
  }
}
console.log('Enabled tools:', enabledTools);
console.log('erp_find_bill registered:', Boolean(tools.erp_find_bill));
    console.log('Tool diagnostic:', {
  enabledTools,
  findBillRegistered: Boolean(tools.erp_find_bill),
  createBillRegistered: Boolean(tools.erp_create_bill),
  getBillRegistered: Boolean(tools.erp_get_bill)
});
    const ctx = { companyId: task.companyId, userId: task.userId, taskId: String(task._id), role: membership.role, enabledTools, policies, companyName: company.name, request: task.request, attachedDocumentId: task.attachedDocumentId ? String(task.attachedDocumentId) : null, messages: task.messages, approved: false };
    const parse = () => parseRequest(`${task.request} ${state.extraText || ''}`, { suppliers: Object.keys(state.facts.knownSuppliers), employees });
    state.runs += 1; let parsed = parse(); task.intent = parsed.kind;
    if (state.runs === 1) { await log('route', 'success', `Understood as “${parsed.kind}”${parsed.supplier ? ` · supplier: ${parsed.supplier}` : ''}${parsed.invoiceNumber ? ` · invoice: ${parsed.invoiceNumber}` : ''}${parsed.latest ? ' · latest' : ''}${parsed.notify ? ` · notify ${parsed.notify.name || parsed.notify.email}` : ''}.`); }
    refreshPlan(state, parsed); if (state.runs === 1) await log('plan', 'success', state.plan.map((s, i) => `${i + 1}. ${s.title}`).join('  →  '));
    await persist({ intent: parsed.kind, startedAt: task.startedAt || new Date() });

    // ---- resume: an approved action is executed first, exactly as it was requested ----
    if (state.pending?.kind === 'approval' && task.approval?.status === 'approved') {
      const p = state.pending; state.pending = null; ctx.approved = true;
      const out = await act({ action: 'tool', tool: p.tool, args: p.args, message: 'Running the approved action.' }); ctx.approved = false;
      if (out !== 'continue') return;
    }

    let streak = 0; let lastSig = ''; let repeats = 0; let invalid = 0;
    for (let step = 0; step < maxSteps(); step++) {
      parsed = parse(); refreshPlan(state, parsed); state.stepsThisRun = step + 1;
      await persist({ currentStep: step + 1, stepCount: (task.stepCount || 0) + 1 });
      task.stepCount = (task.stepCount || 0) + 1;
      const decision = await decide(parsed);
      if (decision.action === 'refuse') return complete(REFUSAL, 'refusal', parsed);
      if (decision.action === 'fail') return fail(decision.code, decision.message);
      if (decision.action === 'ask_user') { if (state.askCount >= 6) return fail('TOO_MANY_QUESTIONS', 'I still can\'t complete this after several clarifications. Please check the source document or try a more specific request.'); return pause(decision); }
      if (decision.action === 'finish') {
        const g = await finishGuard(parsed, decision); if (g) { if (g === 'abort') return; if (g === 'fail') return fail('NOT_VERIFIED', 'I could not verify that the requested outcome was achieved, so I am not marking it complete.'); continue; }
        const answer = (parsed.kind === 'register' && state.facts.invoice) || !decision.answer || decision.fromRules ? composeAnswer(state, parsed) : decision.answer;
        return complete(answer, 'completed', parsed);
      }
      // tool
      const sig = JSON.stringify([decision.tool, decision.args]);
      if (sig === lastSig) { repeats++; if (repeats >= 2) { if (state.degraded || !llm.isConfigured()) return fail('LOOP_DETECTED', 'I kept repeating the same action without progress, so I stopped.'); state.degraded = true; await log('reflect', 'warning', 'The AI planner repeated itself; switching to the deterministic planner.'); repeats = 0; continue; } } else repeats = 0; lastSig = sig;
      if (!tools[decision.tool] || !ctx.enabledTools.includes(decision.tool)) { invalid++; pushError(state, decision.tool, decision.args, { code: 'TOOL_NOT_ALLOWED', message: `Unknown or disabled tool "${decision.tool}". Allowed: ${ctx.enabledTools.join(', ')}` }); await log('reflect', 'warning', `Rejected unknown tool “${decision.tool}”.`); if (invalid >= 3) { state.degraded = true; } continue; }
      const out = await act(decision);
      if (out === 'continue') { const ok = !state.history.at(-1)?.error; streak = ok ? 0 : streak + 1; if (streak >= 3) return fail(state.lastError?.code || 'REPEATED_FAILURE', `I tried several times but “${decision.tool}” kept failing: ${state.lastError?.message || 'unknown error'}. You can retry the task later.`); continue; }
      return;
    }
    return fail('STEP_LIMIT_REACHED', `I reached the ${maxSteps()}-step limit before finishing. Progress is saved — press Continue to let me keep going, or narrow the request.`);

    // ------------------------------------------------------------------ helpers (closures over task/state/ctx)
    async function decide(p) {
      if (!state.degraded && llm.isConfigured() && p.kind !== 'out_of_scope') {
        try { const d = await llmDecider.next(state, ctx, p); task.decider = 'llm'; return d; }
        catch (e) { if (e instanceof Aborted) throw e; state.degraded = true; await log('reflect', 'warning', `AI planner unavailable (${String(e.message).slice(0, 120)}). Continuing with the deterministic planner.`); }
      }
      task.decider = state.degraded ? 'llm→rules' : 'rules';
      const d = rules.next(state, ctx, p); return { ...d, fromRules: true };
    }
    async function runWithRetry(name, args) {
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { return await executeTool(name, args, ctx); }
        catch (e) {
          lastErr = e; const transient = e.details?.retryable || /ECONN|ETIMEDOUT|timed out|socket|network/i.test(e.message || '');
          if (!transient || attempt === 2) break;
          await log('retry', 'warning', `${name} failed transiently (${e.code || e.message}); retrying (${attempt + 2}/3).`, { errorCode: e.code, toolName: name }); await sleep(RETRY_BASE() * 2 ** attempt);
        }
      }
      throw lastErr;
    }
    async function act(decision) {
      const { tool: name, args } = decision; const started = Date.now();
      await log('tool_start', 'running', decision.message || `Running ${name}.`, { toolName: name });
      try {
        const result = await runWithRetry(name, args);
        if (result?.approvalRequired) {
          state.pending = { kind: 'approval', tool: name, args: result.args, message: result.message };
          const text = `I need your approval before I run “${name}”${result.args?.documentId ? '' : ''}. ${result.message}`;
          task.messages.push({ role: 'agent', kind: 'approval', text });
          await log('approval', 'waiting', result.message, { toolName: name }); refreshPlan(state, parsed);
          await settle('waiting_for_approval', { approval: { status: 'pending', requestedAt: new Date(), note: result.message }, messages: task.messages, result: { kind: 'approval', answer: text, evidence: [{ tool: name, args: result.args }] } });
          return 'paused';
        }
        absorb(state, name, args, result);
        await log('tool_result', 'success', summarize(name, result), { toolName: name, durationMs: Date.now() - started });
        if (name === 'erp_create_bill' && (result.created || result.alreadyExists) && ctx.enabledTools.includes('erp_get_bill')) {
          const v = await runWithRetry('erp_get_bill', { billId: result.record.id }); absorb(state, 'erp_get_bill', { billId: result.record.id }, v);
          await log('verification', state.facts.verification?.passed ? 'success' : 'error', state.facts.verification?.reason || 'Verification finished.', { toolName: 'erp_get_bill' });
        }
        if (result?.needsInput) return pause({ question: `I can't register this invoice yet — these fields are missing: ${result.missingFields.join(', ')}. Please fill them in (check the source PDF).`, expects: 'fields', fields: rules.fieldSpec(result.missingFields, state.facts.invoice) });
        state.lastError = null; return 'continue';
      } catch (e) {
        if (e instanceof Aborted) throw e;
        pushError(state, name, args, e);
        await log('tool_result', 'error', `${name} failed: ${e.message}`, { toolName: name, errorCode: e.code || 'TOOL_FAILED', durationMs: Date.now() - started });
        if (e.status === 403) { await fail(e.code || 'FORBIDDEN', e.message); return 'failed'; }
        return 'continue'; // the decider sees the error observation and adapts
      }
    }
    async function finishGuard(p, decision) {
      const f = state.facts; const wroteSomething = f.billSource === 'created';
      const claimsWrite = decision && !decision.fromRules && /\b(registered|created|entered|booked|recorded|posted)\b/i.test(decision.answer || '') && !/\b(not|n't|never|no)\b.{0,25}\b(registered|created|entered)/i.test(decision.answer || '');
      if (p.kind !== 'register' && !wroteSomething && !claimsWrite) return null;
      if (f.bill && !f.verification) { try { const v = await runWithRetry('erp_get_bill', { billId: f.bill.id }); absorb(state, 'erp_get_bill', { billId: f.bill.id }, v); } catch { /* fallthrough */ } }
      if (f.verification?.passed && f.bill) return null;
      state.rejections++; state.history.push({ tool: 'runtime', error: { code: 'FINISH_REJECTED', message: 'You cannot finish yet: the write has not been performed and verified by reading the bill back from the finance system.' }, at: new Date().toISOString() });
      await log('reflect', 'warning', 'Premature completion rejected: the outcome is not verified yet.');
      if (f.verification && !f.verification.passed) return 'fail';
      return state.rejections >= 3 ? 'fail' : 'again';
    }
    async function pause(d) {
      state.pending = { kind: 'question', question: d.question, expects: d.expects || 'text', fields: d.fields, options: d.options, suggestions: d.suggestions };
      task.messages.push({ role: 'agent', kind: 'question', text: d.question }); refreshPlan(state, parsed);
      await log('question', 'needs_input', d.question);
      await settle('needs_input', { messages: task.messages, result: { kind: 'clarification', answer: d.question, evidence: [] } }); return 'paused';
    }
    async function complete(answer, kind, p) {
      refreshPlan(state, p, true); const f = state.facts;
      const used = [...new Set(state.history.filter(h => tools[h.tool]).map(h => h.tool))]; const retries = (await countRetries());
      const result = { kind, answer, verification: f.verification ? { passed: f.verification.passed, reason: f.verification.reason, checks: f.verification.checks } : undefined, evidence: buildEvidence(state), summary: { steps: state.history.filter(h => tools[h.tool]).length, toolsUsed: used, retries, decider: task.decider || 'rules' } };
      task.messages.push({ role: 'agent', kind: 'result', text: answer });
      await log('verification', 'completed', f.verification ? `Final check: ${f.verification.reason}` : 'Task completed.');
      await settle('completed', { messages: task.messages, result, finishedAt: new Date(), decider: task.decider }); return 'done';
    }
    async function fail(code, message) {
      task.messages.push({ role: 'agent', kind: 'error', text: message }); await log('error', 'failed', message, { errorCode: code });
      refreshPlan(state, parse(), false);
      await settle('failed', { error: { code, message }, messages: task.messages, result: { kind: 'error', answer: message, evidence: buildEvidence(state) }, finishedAt: new Date(), decider: task.decider }); return 'failed';
    }
    async function countRetries() { const { ExecutionLog } = require('../models'); return ExecutionLog.countDocuments({ taskId: task._id, action: 'retry' }); }
  } catch (e) {
    if (e instanceof Aborted) return; // cancelled while running
    console.error('Agent task crashed:', e);
    const msg = 'The worker hit an unexpected error. Your progress is saved — press Retry to resume.';
    await Task.updateOne({ _id: task._id, status: 'running' }, { $set: { status: 'failed', error: { code: e.code || 'AGENT_EXECUTION_FAILED', message: msg }, result: { kind: 'error', answer: msg, evidence: [] }, finishedAt: new Date(), state } });
    await logEvent({ companyId: task.companyId, taskId: task._id, action: 'error', status: 'failed', summary: String(e.message).slice(0, 300), errorCode: e.code || 'AGENT_EXECUTION_FAILED' });
  }
}

function summarize(name, r) {
  switch (name) {
    case 'search_invoices': return `Found ${r.count} invoice(s)${r.suppliers?.length ? ` from ${r.suppliers.slice(0, 3).join(', ')}` : ''}.`;
    case 'get_invoice_details': return `Read ${r.fields?.supplier || 'invoice'} ${r.fields?.invoiceNumber || ''} · ${r.fields?.currency || ''} ${r.fields?.amount ?? '?'} · due ${r.fields?.dueDate ? new Date(r.fields.dueDate).toISOString().slice(0, 10) : '?'} · ${r.registered ? 'already registered' : 'not registered'}${r.missingFields?.length ? ` · missing ${r.missingFields.join(', ')}` : ''}.`;
    case 'erp_find_bill': return r.found ? `A bill already exists (${r.record.id}).` : 'No existing bill — safe to create.';
    case 'erp_create_bill': return r.needsInput ? `Cannot create yet: missing ${r.missingFields.join(', ')}.` : r.created ? `Created bill ${r.record.id}.` : `Bill already existed (${r.record?.id}); nothing duplicated.`;
    case 'erp_get_bill': return r.found ? `Read back bill ${r.record.id}: ${r.record.currency} ${r.record.amount}.` : 'Bill not found.';
    case 'search_employees': return `Found ${r.count} employee(s).`;
    case 'send_message': return `Message sent to ${r.to}.`;
    case 'erp_list_bills': return `Listed ${r.count} bill(s).`;
    default: return JSON.stringify(r).slice(0, 300);
  }
}
function buildEvidence(state) {
  const f = state.facts; const ev = [];
  if (f.invoice) ev.push({ type: 'invoice', documentId: f.documentId, fields: f.invoice.fields, provenance: f.invoice.provenance, confidence: f.invoice.confidence });
  if (f.bill) ev.push({ type: 'finance_record', source: f.billSource, record: f.billRead || f.bill });
  if (f.verification) ev.push({ type: 'verification', passed: f.verification.passed, checks: f.verification.checks });
  if (f.messageSent) ev.push({ type: 'notification', ...f.messageSent });
  if (!f.invoice && f.list?.invoices?.length) ev.push({ type: 'invoices', items: f.list.invoices.map(i => ({ id: i.id, ...i.fields, registered: i.registered })) });
  if (f.employees?.length) ev.push({ type: 'employees', items: f.employees });
  return ev;
}

// Tasks interrupted by a restart are picked up again.
async function recoverStuckTasks(olderThanMs = 15000) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stuck = await Task.find({ status: { $in: ['running', 'queued'] }, updatedAt: { $lt: cutoff } }).select('_id');
  for (const t of stuck) { await Task.updateOne({ _id: t._id }, { $set: { status: 'queued' } }); setImmediate(() => runTask(t._id)); }
  return stuck.length;
}
const enqueue = id => setImmediate(() => runTask(id).catch(e => console.error('runTask error:', e.message)));
module.exports = { runTask, enqueue, recoverStuckTasks, REFUSAL };
