// Simulated internal finance system. It has its own validation rules and can be made flaky,
// so the agent must handle real-world failure modes (rejections, transient outages) instead of assuming success.
const { FinanceRecord } = require('../models');
const HttpError = require('../utils/httpError');
const chaos = { failNext: 0 };
const ISO = /^[A-Z]{3}$/;
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shape = r => ({ id: String(r._id), invoiceNumber: r.invoiceNumber, supplier: r.supplier, issueDate: r.issueDate, dueDate: r.dueDate, amount: r.amount, currency: r.currency, status: r.status, source: r.source, documentId: String(r.documentId), createdAt: r.createdAt });

function maybeOutage() {
  const rate = Number(process.env.ERP_CHAOS_RATE) || 0;
  if (chaos.failNext > 0 || (rate > 0 && Math.random() < rate)) { chaos.failNext = Math.max(0, chaos.failNext - 1); throw new HttpError(503, 'Finance system is temporarily unavailable.', 'ERP_UNAVAILABLE', { retryable: true }); }
}
function validateBill(b) {
  const errors = [];
  if (!b.invoiceNumber || String(b.invoiceNumber).trim().length < 2) errors.push({ field: 'invoiceNumber', message: 'Invoice number is required.' });
  if (!b.supplier || String(b.supplier).trim().length < 2) errors.push({ field: 'supplier', message: 'Supplier name is required.' });
  if (!(Number(b.amount) > 0)) errors.push({ field: 'amount', message: 'Amount must be greater than zero.' });
  if (!ISO.test(String(b.currency || '').toUpperCase())) errors.push({ field: 'currency', message: 'Currency must be a 3-letter ISO code.' });
  if (b.issueDate && b.dueDate && new Date(b.dueDate) < new Date(b.issueDate)) errors.push({ field: 'dueDate', message: 'Due date cannot be before the issue date.' });
  return errors;
}
async function findBill({ companyId, invoiceNumber, supplier, id }) {
  const f = { companyId };
  if (id) f._id = id; else { f.invoiceNumber = { $regex: `^${esc(invoiceNumber)}$`, $options: 'i' }; if (supplier) f.supplier = { $regex: `^${esc(supplier)}$`, $options: 'i' }; }
  const r = await FinanceRecord.findOne(f); return r ? shape(r) : null;
}
async function createBill({ companyId, userId, taskId, doc }) {
  maybeOutage();
  const f = doc.extractedFields || {};
  const candidate = { invoiceNumber: f.invoiceNumber, supplier: f.supplier, amount: f.amount, currency: f.currency, issueDate: f.issueDate || doc.issueDate, dueDate: f.dueDate };
  const errors = validateBill(candidate);
  if (errors.length) throw new HttpError(422, 'The finance system rejected the bill: ' + errors.map(e => e.message).join(' '), 'ERP_VALIDATION', { fieldErrors: errors });
  const key = `${doc._id}:${String(candidate.invoiceNumber).toLowerCase()}:${String(candidate.supplier).toLowerCase()}`;
  const existing = await FinanceRecord.findOne({ companyId, $or: [{ idempotencyKey: key }, { invoiceNumber: String(candidate.invoiceNumber).trim(), supplier: String(candidate.supplier).trim() }] });
  if (existing) return { created: false, alreadyExists: true, record: shape(existing) };
  try {
    const rec = await FinanceRecord.create({ companyId, documentId: doc._id, createdBy: userId, taskId, invoiceNumber: String(candidate.invoiceNumber).trim(), supplier: String(candidate.supplier).trim(), issueDate: candidate.issueDate, dueDate: candidate.dueDate, amount: Number(candidate.amount), currency: String(candidate.currency).toUpperCase(), idempotencyKey: key });
    return { created: true, record: shape(rec) };
  } catch (e) {
    if (e.code === 11000) { const ex = await FinanceRecord.findOne({ companyId, $or: [{ idempotencyKey: key }, { invoiceNumber: String(candidate.invoiceNumber).trim(), supplier: String(candidate.supplier).trim() }] }); if (ex) return { created: false, alreadyExists: true, record: shape(ex) }; }
    throw e;
  }
}
async function listBills({ companyId, supplier, status, limit = 20 }) {
  const f = { companyId };
  if (supplier) f.supplier = { $regex: esc(supplier), $options: 'i' };
  if (status) f.status = status;
  const rows = await FinanceRecord.find(f).sort({ createdAt: -1 }).limit(limit);
  const totals = {}; rows.forEach(r => { totals[r.currency] = Math.round(((totals[r.currency] || 0) + r.amount) * 100) / 100; });
  return { count: rows.length, bills: rows.map(shape), totalsByCurrency: totals };
}
module.exports = { createBill, findBill, listBills, validateBill, chaos, shape, esc };
