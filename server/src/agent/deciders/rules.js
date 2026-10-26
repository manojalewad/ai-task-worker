// Deterministic planner/decider. Same action protocol as the LLM decider, so the runtime is identical in both modes.
// Used when no AI key is configured, and as the automatic fallback when the model is unavailable or misbehaves.
const { composeAnswer, composeNotification, LABEL } = require('../answer');
const { parseRequest } = require('../understand');
const FIELD_META = { invoiceNumber: ['Invoice number', 'text'], supplier: ['Supplier', 'text'], amount: ['Amount', 'number'], currency: ['Currency (e.g. USD)', 'text'], dueDate: ['Due date', 'date'], issueDate: ['Issue date', 'date'] };
const fieldSpec = (keys, inv) => keys.map(k => ({ key: k, label: FIELD_META[k]?.[0] || k, type: FIELD_META[k]?.[1] || 'text', value: inv?.fields?.[k] ?? '' }));
const tool = (name, args, message) => ({ action: 'tool', tool: name, args, message });
const ask = (question, extra = {}) => ({ action: 'ask_user', question, ...extra });

function next(state, ctx, parsed) {
  const f = state.facts; const att = ctx.attachedDocumentId;
  if (parsed.kind === 'out_of_scope') return { action: 'refuse', reason: 'outside company workflows' };
  if (parsed.kind === 'unknown') return ask('I can find and read invoices, register them in the finance system and verify the result, list overdue or unregistered invoices, and look people up in the directory. Which outcome would you like? For example: “Find the latest invoice from <supplier> and register it”.', { expects: 'text' });

  if (parsed.kind === 'employee') {
    const q = parsed.employeeQuery; const n = f.employeeSearches || 0;
    if (n === 0) return tool('search_employees', { query: q }, `Searching the directory for “${q}”.`);
    if (!f.employees?.length && n === 1 && q.includes(' ')) return tool('search_employees', { query: q.split(' ')[0] }, 'No exact match; broadening the search.');
    if (!f.employees?.length) return ask(`I couldn't find anyone matching “${q}”. Who should I look for (name, title or department)?`, { expects: 'text' });
    return { action: 'finish', answer: composeAnswer(state, parsed) };
  }
  if (parsed.kind === 'list') {
    if (!f.searches.length) return tool('search_invoices', { supplier: parsed.supplier, overdue: parsed.overdue || undefined, registered: parsed.unregistered ? false : undefined, status: parsed.needsReview ? 'needs_review' : undefined, dateBasis: 'issueDate', order: 'desc', limit: 20 }, 'Searching invoices with the requested filters.');
    return { action: 'finish', answer: composeAnswer(state, parsed) };
  }

  // register / invoice_info: locate → read → (check → create → verify) → notify → report
  if (!f.documentId) {
    if (att && !state.attachTried) { state.attachTried = true; return tool('get_invoice_details', { documentId: att }, 'Opening the attached invoice.'); }
    const s = f.searches; const last = s[s.length - 1];
    if (!s.length) return tool('search_invoices', { supplier: parsed.supplier, invoiceNumber: parsed.invoiceNumber, dateBasis: parsed.recentUpload ? 'uploadDate' : 'issueDate', order: parsed.oldest ? 'asc' : 'desc', limit: 8 }, 'Searching the invoice repository.');
    if (!last.count) {
      const term = parsed.supplier || parsed.invoiceNumber;
      if (s.length === 1 && term) return tool('search_invoices', { query: term, dateBasis: 'issueDate', order: 'desc', limit: 8 }, 'No exact match; trying a broader search.');
      if (parsed.invoiceNumber && !f.billLookupMiss) return tool('erp_get_bill', { invoiceNumber: parsed.invoiceNumber }, 'No document found; checking the finance system directly.');
      return ask(`I couldn't find ${parsed.supplier ? `an invoice from “${parsed.supplier}”` : parsed.invoiceNumber ? `invoice ${parsed.invoiceNumber}` : 'a matching invoice'} in your repository. Upload the PDF, or tell me the supplier name or invoice number.`, { expects: 'upload', suggestions: [...new Set(Object.keys(f.knownSuppliers || {}))].slice(0, 6) });
    }
    const cands = f.candidates || [];
    const suppliers = [...new Set(cands.map(c => c.fields?.supplier))];
    if (suppliers.length > 1 && !parsed.latest && !parsed.invoiceNumber) return ask('I found invoices from more than one supplier. Which one do you mean?', { expects: 'choice', options: cands.slice(0, 6).map(c => ({ label: `${c.fields?.supplier} · ${c.fields?.invoiceNumber || c.fileName} · ${c.fields?.currency || ''} ${c.fields?.amount ?? ''}`, documentId: c.id })) });
    return tool('get_invoice_details', { documentId: cands[0].id }, `Opening ${cands[0].fields?.supplier || 'the invoice'} ${cands[0].fields?.invoiceNumber || ''}`.trim());
  }
  if (!f.invoice) return tool('get_invoice_details', { documentId: f.documentId }, 'Reading the invoice details.');
  const inv = f.invoice;

  if (parsed.kind === 'invoice_info') return { action: 'finish', answer: composeAnswer(state, parsed) };

  // ---- register ----
  const lastErr = state.lastError;
  if (lastErr?.code === 'ERP_VALIDATION' && lastErr.fieldErrors?.length && !f.bill) {
    const keys = [...new Set(lastErr.fieldErrors.map(e => e.field))]; state.lastError = null;
    return ask(`The finance system rejected this bill: ${lastErr.fieldErrors.map(e => e.message).join(' ')} Please correct the value(s) below (check the source PDF).`, { expects: 'fields', fields: fieldSpec(keys, inv) });
  }
  if (inv.missingFields?.length && !f.bill) return ask(`I found the invoice from ${inv.fields?.supplier || 'the supplier'} but couldn't read: ${inv.missingFields.map(k => LABEL[k] || k).join(', ')}. Please fill them in (check the source PDF) and I'll continue.`, { expects: 'fields', fields: fieldSpec(inv.missingFields, inv) });
  if (!f.dupChecked && !f.bill) return tool('erp_find_bill', { invoiceNumber: inv.fields.invoiceNumber, supplier: inv.fields.supplier }, 'Checking the finance system for an existing bill.');
  if (!f.bill) return tool('erp_create_bill', { documentId: f.documentId }, 'Registering the bill in the finance system.');
  if (!f.verification) return tool('erp_get_bill', { billId: f.bill.id }, 'Reading the bill back to verify it.');
  if (!f.verification.passed) return { action: 'fail', code: 'VERIFICATION_FAILED', message: `The bill was written but verification failed: ${f.verification.reason}` };
  if (parsed.notify && !f.messageSent) {
    const to = parsed.notify.email || f.recipientCandidate?.workEmail;
    if (!to) return f.employeeSearches ? ask(`I couldn't uniquely identify who to notify (“${parsed.notify.name}”). What is their work email?`, { expects: 'text' }) : tool('search_employees', { query: parsed.notify.name }, `Looking up ${parsed.notify.name} to notify them.`);
    return tool('send_message', { toEmail: to, ...composeNotification(state) }, 'Notifying the requested colleague.');
  }
  return { action: 'finish', answer: composeAnswer(state, parsed) };
}
module.exports = { next, parseRequest, fieldSpec };
