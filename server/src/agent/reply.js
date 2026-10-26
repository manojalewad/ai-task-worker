// Applies a human reply (form values, a choice, free text or an uploaded document) to a paused task so it can resume where it stopped.
const { z } = require('zod');
const { Document } = require('../models');
const { applyFieldCorrections } = require('../services/documentService');
const { parseDate, detectCurrency } = require('../services/heuristic');
const HttpError = require('../utils/httpError');

const ALIASES = { dueDate: ['due date', 'payment due', 'due'], issueDate: ['issue date', 'invoice date', 'dated'], invoiceNumber: ['invoice number', 'invoice no', 'invoice #', 'inv no', 'number'], supplier: ['supplier', 'vendor', 'from'], currency: ['currency'], amount: ['amount', 'total due', 'total', 'grand total'] };
const fieldsSchema = z.object({
  invoiceNumber: z.string().trim().min(2).max(80).optional(), supplier: z.string().trim().min(2).max(120).optional(),
  amount: z.coerce.number().positive().optional(), currency: z.string().trim().length(3).transform(s => s.toUpperCase()).optional(),
  issueDate: z.string().optional().transform(parseDate), dueDate: z.string().optional().transform(parseDate)
}).partial();

function parseFieldsFromText(text, keys) {
  const out = {}; const t = ' ' + String(text || '') + ' ';
  const lead = a => `\\b${a.replace(/[#]/g, '\\#')}\\s*(?:is|are|=|:|-|should be|to)?\\s*`;
  const DATE = '(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}|\\d{1,2}(?:st|nd|rd|th)?\\s+[A-Za-z]{3,9}\\.?,?\\s+\\d{4}|[A-Za-z]{3,9}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})';
  for (const k of keys) {
    for (const a of ALIASES[k] || []) {
      if (k === 'amount') { const m = t.match(new RegExp(lead(a) + '(?:[A-Za-z]{3}\\s*|[$€£₹]\\s*|Rs\\.?\\s*)?([0-9][0-9,]*(?:\\.\\d+)?)', 'i')); if (m) { out.amount = m[1].replace(/,/g, ''); break; } }
      else if (k === 'dueDate' || k === 'issueDate') { const m = t.match(new RegExp(lead(a) + DATE, 'i')); if (m) { out[k] = m[1]; break; } }
      else if (k === 'currency') { const m = t.match(new RegExp(lead(a) + '([A-Za-z]{3})\\b', 'i')); if (m) { out.currency = m[1]; break; } }
      else { const m = t.match(new RegExp(lead(a) + '([^,;\\n]{2,80})', 'i')); if (m) { out[k] = m[1].trim().replace(/\s+(and|currency)\b.*$/i, ''); break; } }
    }
  }
  if (keys.includes('currency') && !out.currency) { const c = detectCurrency(t); if (c) out.currency = c; }
  if (keys.includes('amount') && !out.amount) { const n = t.match(/(?:[$€£₹]|\b[A-Z]{3}\b|Rs\.?)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/); if (n) out.amount = n[1].replace(/,/g, ''); }
  if (!out.currency && keys.includes('currency') && /^\s*[A-Za-z]{3}\s*$/.test(text)) out.currency = text.trim();
  return out;
}

async function applyReply(task, body) {
  const state = task.state; const pending = state.pending;
  if (task.status !== 'needs_input' || pending?.kind !== 'question') throw new HttpError(409, 'This task is not waiting for your input.', 'NOT_WAITING_FOR_INPUT');
  const text = String(body.message || '').trim(); const f = state.facts; const applied = {}; let note = '';
  if (/^(cancel|stop|abort|never ?mind|forget it)\.?$/i.test(text)) return { cancel: true };

  if (body.documentId) {
    const doc = await Document.findOne({ _id: body.documentId, companyId: task.companyId }).catch(() => null);
    if (!doc) throw new HttpError(404, 'That document is not available in this company.', 'DOCUMENT_NOT_FOUND');
    f.documentId = String(doc._id); f.invoice = null; f.bill = null; f.verification = null; f.dupChecked = false; f.searches = []; applied.documentId = f.documentId; note = `Using ${doc.fileName}.`;
  }
  let raw = body.fields && Object.keys(body.fields).length ? body.fields : null;
  const askedKeys = (pending.fields || []).map(x => x.key);
  if (!raw && askedKeys.length && text) raw = parseFieldsFromText(text, askedKeys);
  if (raw && Object.keys(raw).length) {
    const clean = {}; for (const [k, v] of Object.entries(raw)) if (v !== '' && v !== null && v !== undefined) clean[k] = v;
    const parsed = fieldsSchema.safeParse(clean);
    if (!parsed.success) throw new HttpError(400, 'Some values look invalid: ' + parsed.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; '), 'INVALID_FIELDS');
    const vals = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
    if (Object.keys(vals).length) {
      if (!f.documentId) throw new HttpError(409, 'There is no invoice to apply these values to yet.', 'NO_DOCUMENT');
      const doc = await Document.findOne({ _id: f.documentId, companyId: task.companyId });
      if (!doc) throw new HttpError(404, 'Invoice not found.', 'DOCUMENT_NOT_FOUND');
      await applyFieldCorrections(doc, vals);
      f.invoice = null; f.verification = null; state.lastError = null; Object.assign(applied, vals); note = `Updated ${Object.keys(vals).join(', ')} on the invoice.`;
    }
  }
  if (!Object.keys(applied).length) {
    if (pending.expects === 'fields' && askedKeys.length) throw new HttpError(400, `I couldn't read a value from that. Please fill in: ${askedKeys.join(', ')}.`, 'NO_FIELDS_UNDERSTOOD');
    if (!text) throw new HttpError(400, 'Please type a reply, choose an option, or fill in the fields.', 'EMPTY_REPLY');
    state.extraText = `${state.extraText || ''} ${text}`.trim().slice(-1000); f.searches = []; f.documentId = f.documentId && pending.expects === 'text' && !f.invoice ? null : f.documentId; note = 'Noted your clarification.';
  }
  state.history.push({ tool: 'user_reply', args: {}, result: { applied, text: text.slice(0, 300) }, at: new Date().toISOString() });
  task.messages.push({ role: 'user', kind: 'reply', text: text || note || 'Provided details.' });
  state.pending = null; state.askCount = (state.askCount || 0) + 1;
  return { note };
}
module.exports = { applyReply, parseFieldsFromText, fieldsSchema };
