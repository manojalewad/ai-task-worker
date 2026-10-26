const { verifyBill } = require('./verifier');
const { stagesFor } = require('./understand');
const newState = () => ({ plan: [], facts: { searches: [] }, history: [], pending: null, runs: 0, degraded: false, extraText: '', rejections: 0, askCount: 0 });
const compact = (r, max = 3500) => { const s = JSON.stringify(r ?? {}); if (s.length <= max) return r; return { truncated: true, preview: s.slice(0, max) }; };

// Single place where observations become memory (facts). Both deciders read the same facts.
function absorb(state, tool, args, result) {
  const f = state.facts; f.searches = f.searches || [];
  switch (tool) {
    case 'search_invoices': f.searches.push({ args, count: result.count, suppliers: result.suppliers, ids: result.invoices.map(i => i.id) }); f.candidates = result.invoices; f.list = result; break;
    case 'get_invoice_details': f.documentId = result.id; f.invoice = result; if (result.bill) { f.bill = result.bill; f.billSource = 'existing'; } break;
    case 'erp_find_bill': f.dupChecked = true; if (result.found) { f.bill = result.record; f.billSource = String(result.record.documentId) === String(f.documentId) ? 'existing' : 'existing-other-document'; } break;
    case 'erp_create_bill': if (result.created) { f.bill = result.record; f.billSource = 'created'; } else if (result.alreadyExists) { f.bill = result.record; f.billSource = 'existing'; } break;
    case 'erp_get_bill':
      if (result.found) { f.billRead = result.record; if (f.invoice) f.verification = verifyBill(f.invoice.fields, result.record); else f.verification = { passed: true, checks: [], reason: 'Bill exists in the finance system.' }; }
      else { f.billRead = null; if (f.bill) f.verification = verifyBill(f.invoice?.fields, null); else f.billLookupMiss = args; }
      break;
    case 'erp_list_bills': f.billList = result; break;
    case 'search_employees': f.employees = result.employees; f.employeeSearches = (f.employeeSearches || 0) + 1; if (result.employees.length === 1) f.recipientCandidate = result.employees[0]; break;
    case 'send_message': f.messageSent = result; break;
    default: break;
  }
  state.history.push({ tool, args, result: compact(result), at: new Date().toISOString() });
  if (state.history.length > 40) state.history.splice(0, state.history.length - 40);
}
function pushError(state, tool, args, err, extra = {}) {
  state.history.push({ tool, args, error: { code: err.code || 'TOOL_FAILED', message: String(err.message || '').slice(0, 300), ...extra }, at: new Date().toISOString() });
  state.lastError = { tool, code: err.code, message: err.message, fieldErrors: err.details?.fieldErrors };
}
function refreshPlan(state, parsed, finished = false) {
  const f = state.facts;
  if (!state.plan?.length || state.planKind !== parsed.kind) { state.plan = stagesFor(parsed); state.planKind = parsed.kind; }
  const done = {
    locate: !!f.documentId, read: !!f.invoice, dupcheck: !!(f.dupChecked || f.bill), register: !!f.bill, verify: !!f.verification?.passed,
    notify: !!f.messageSent, search: f.searches?.length > 0 || f.employeeSearches > 0, clarify: false, report: finished
  };
  let activeSet = false;
  for (const st of state.plan) {
    if (finished) { st.status = (st.id === 'verify' && f.verification && !f.verification.passed) ? 'failed' : 'done'; continue; }
    if (done[st.id]) st.status = 'done'; else if (!activeSet) { st.status = state.pending ? 'blocked' : 'active'; activeSet = true; } else st.status = 'pending';
  }
}
module.exports = { newState, absorb, pushError, refreshPlan, compact };
