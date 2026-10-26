// The ONLY things the agent can do. Each tool: typed args (zod), a risk class, optional approval policy, company-scoped handler.
const { z } = require('zod');
const { Document, Employee, Outbox, FinanceRecord } = require('../models');
const erp = require('../services/erp');
const { missingRequired } = require('../services/heuristic');
const HttpError = require('../utils/httpError');
const esc = erp.esc;
const tokens = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1 && !['the', 'and', 'inc', 'ltd', 'llc', 'co', 'pvt'].includes(t));
const docShape = (d, billByDoc = {}) => ({ id: String(d._id), fileName: d.fileName, uploadDate: d.uploadDate, issueDate: d.issueDate || d.extractedFields?.issueDate, status: d.status, fields: stripFields(d.extractedFields), registered: Boolean(billByDoc[String(d._id)]), billId: billByDoc[String(d._id)] || null });
const stripFields = f => { if (!f) return {}; const o = f.toObject ? f.toObject() : { ...f }; delete o.provenance; delete o.notes; return o; };

const tools = {
  search_invoices: {
    risk: 'read',
    description: 'Search invoice documents in the company repository. Supports supplier/invoice-number filters, overdue/registered flags and ordering. Use dateBasis=issueDate for "latest invoice", uploadDate for "recently uploaded".',
    argsHint: '{query?, invoiceNumber?, supplier?, status?:"processed"|"needs_review", registered?:boolean, overdue?:boolean, minAmount?, maxAmount?, dateBasis?:"uploadDate"|"issueDate", order?:"asc"|"desc", limit?:1..20}',
    schema: z.object({ query: z.string().max(120).optional(), invoiceNumber: z.string().max(80).optional(), supplier: z.string().max(120).optional(), status: z.enum(['processed', 'needs_review']).optional(), registered: z.boolean().optional(), overdue: z.boolean().optional(), minAmount: z.number().optional(), maxAmount: z.number().optional(), dateBasis: z.enum(['uploadDate', 'issueDate']).default('issueDate'), order: z.enum(['asc', 'desc']).default('desc'), limit: z.number().int().min(1).max(20).default(5) }),
    handler: async (a, ctx) => {
      const filter = { companyId: ctx.companyId }; const and = [];
      if (a.invoiceNumber) filter['extractedFields.invoiceNumber'] = { $regex: esc(a.invoiceNumber), $options: 'i' };
      for (const t of tokens(a.supplier)) and.push({ 'extractedFields.supplier': { $regex: esc(t), $options: 'i' } });
      if (a.query) { const ts = tokens(a.query); for (const t of ts) and.push({ $or: [{ fileName: { $regex: esc(t), $options: 'i' } }, { 'extractedFields.invoiceNumber': { $regex: esc(t), $options: 'i' } }, { 'extractedFields.supplier': { $regex: esc(t), $options: 'i' } }] }); }
      if (a.status) filter.status = a.status;
      if (a.minAmount !== undefined || a.maxAmount !== undefined) filter['extractedFields.amount'] = { ...(a.minAmount !== undefined ? { $gte: a.minAmount } : {}), ...(a.maxAmount !== undefined ? { $lte: a.maxAmount } : {}) };
      if (a.overdue) filter['extractedFields.dueDate'] = { $lt: new Date() };
      if (and.length) filter.$and = and;
      const bills = await FinanceRecord.find({ companyId: ctx.companyId }).select('documentId status');
      const billByDoc = Object.fromEntries(bills.map(b => [String(b.documentId), String(b._id)]));
      const paid = new Set(bills.filter(b => b.status === 'paid').map(b => String(b.documentId)));
      const sortKey = a.dateBasis === 'issueDate' ? 'extractedFields.issueDate' : 'uploadDate';
      let docs = await Document.find(filter).sort({ [sortKey]: a.order === 'asc' ? 1 : -1, createdAt: -1 }).limit(200);
      if (a.overdue) docs = docs.filter(d => !paid.has(String(d._id)));
      if (a.registered !== undefined) docs = docs.filter(d => Boolean(billByDoc[String(d._id)]) === a.registered);
      docs = docs.slice(0, a.limit);
      const totals = {}; docs.forEach(d => { const f = d.extractedFields; if (f?.amount && f?.currency) totals[f.currency] = Math.round(((totals[f.currency] || 0) + f.amount) * 100) / 100; });
      const suppliers = [...new Set(docs.map(d => d.extractedFields?.supplier).filter(Boolean))];
      return { count: docs.length, suppliers, totalsByCurrency: totals, invoices: docs.map(d => docShape(d, billByDoc)) };
    }
  },
  get_invoice_details: {
    risk: 'read',
    description: 'Get all extracted fields of ONE invoice document, which fields are missing, and whether it is already registered in the finance system.',
    argsHint: '{documentId}',
    schema: z.object({ documentId: z.string().min(1).max(100) }),
    handler: async (a, ctx) => {
      const d = await Document.findOne({ _id: a.documentId, companyId: ctx.companyId }).catch(() => null);
      if (!d) throw new HttpError(404, 'Invoice not found in this company.', 'DOCUMENT_NOT_FOUND');
      const rec = await FinanceRecord.findOne({ companyId: ctx.companyId, documentId: d._id });
      return { ...docShape(d, rec ? { [String(d._id)]: String(rec._id) } : {}), missingFields: missingRequired(d.extractedFields), confidence: d.extractedFields?.confidence, provenance: d.extractedFields?.provenance || {}, bill: rec ? erp.shape(rec) : null };
    }
  },
  erp_find_bill: {
    risk: 'read', description: 'Check whether a bill with this invoice number (and optionally supplier) already exists in the finance system. Use before creating a bill to avoid duplicates.',
    argsHint: '{invoiceNumber, supplier?}', schema: z.object({ invoiceNumber: z.string().min(1).max(100), supplier: z.string().max(120).optional() }),
    handler: async (a, ctx) => { const b = await erp.findBill({ companyId: ctx.companyId, ...a }); return b ? { found: true, record: b } : { found: false }; }
  },
  erp_create_bill: {
    risk: 'write', approvalPolicy: 'requireApprovalForFinanceWrite',
    description: 'Register an invoice document as a bill in the finance system (idempotent). Fails with a validation error if the finance system rejects the data; may fail transiently.',
    argsHint: '{documentId}', schema: z.object({ documentId: z.string().min(1).max(100) }),
    handler: async (a, ctx) => {
      const d = await Document.findOne({ _id: a.documentId, companyId: ctx.companyId }).catch(() => null);
      if (!d) throw new HttpError(404, 'Invoice not found in this company.', 'DOCUMENT_NOT_FOUND');
      const missing = missingRequired(d.extractedFields);
      if (missing.length) return { created: false, needsInput: true, missingFields: missing };
      return erp.createBill({ companyId: ctx.companyId, userId: ctx.userId, taskId: ctx.taskId, doc: d });
    }
  },
  erp_get_bill: {
    risk: 'read', description: 'Read a bill back from the finance system by bill id or invoice number. Use this to verify a write.',
    argsHint: '{billId? | invoiceNumber?}', schema: z.object({ billId: z.string().max(100).optional(), invoiceNumber: z.string().max(100).optional() }).refine(v => v.billId || v.invoiceNumber, 'billId or invoiceNumber is required'),
    handler: async (a, ctx) => { const b = await erp.findBill({ companyId: ctx.companyId, id: a.billId, invoiceNumber: a.invoiceNumber }).catch(() => null); return b ? { found: true, record: b } : { found: false }; }
  },
  erp_list_bills: {
    risk: 'read', description: 'List bills registered in the finance system, with totals per currency.', argsHint: '{supplier?, status?:"registered"|"needs_review"|"paid", limit?}',
    schema: z.object({ supplier: z.string().max(120).optional(), status: z.enum(['registered', 'needs_review', 'paid']).optional(), limit: z.number().int().min(1).max(50).default(20) }),
    handler: async (a, ctx) => erp.listBills({ companyId: ctx.companyId, ...a })
  },
  search_employees: {
    risk: 'read', description: 'Search the employee directory by name, title or department (all words must match).', argsHint: '{query}', schema: z.object({ query: z.string().min(1).max(120) }),
    handler: async (a, ctx) => {
      const ts = tokens(a.query); const q = ts.length ? ts : [a.query];
      const rows = await Employee.find({ companyId: ctx.companyId, active: true, $and: q.map(t => ({ $or: ['name', 'title', 'department', 'workEmail'].map(k => ({ [k]: { $regex: esc(t), $options: 'i' } })) })) }).limit(10);
      return { count: rows.length, employees: rows.map(e => ({ name: e.name, title: e.title, department: e.department, workEmail: e.workEmail })) };
    }
  },
  send_message: {
    risk: 'external', approvalPolicy: 'requireApprovalForMessages',
    description: 'Send an internal message/email (simulated outbox) to an employee by email address. Use to notify someone when work is done.', argsHint: '{toEmail, subject, body}',
    schema: z.object({ toEmail: z.string().email().max(200), subject: z.string().min(1).max(200), body: z.string().min(1).max(3000) }),
    handler: async (a, ctx) => {
      const emp = await Employee.findOne({ companyId: ctx.companyId, workEmail: a.toEmail.toLowerCase(), active: true });
      if (!emp) throw new HttpError(404, 'That recipient is not in the company directory.', 'RECIPIENT_NOT_FOUND');
      const m = await Outbox.create({ companyId: ctx.companyId, taskId: ctx.taskId, sentBy: ctx.userId, to: emp.name, toEmail: emp.workEmail, subject: a.subject, body: a.body });
      return { sent: true, messageId: String(m._id), to: emp.name, toEmail: emp.workEmail };
    }
  }
};
const publicToolList = (enabled = []) => Object.entries(tools).filter(([n]) => enabled.includes(n)).map(([name, t]) => ({ name, risk: t.risk, description: t.description, args: t.argsHint, approvalPolicy: t.approvalPolicy || null }));

function needsApproval(name, ctx) { const t = tools[name]; return Boolean(t?.approvalPolicy && ctx.policies?.[t.approvalPolicy] === true); }
async function executeTool(name, rawArgs, ctx) {
  const tool = tools[name];
  if (!tool || !ctx.enabledTools.includes(name)) throw new HttpError(403, 'This tool is not available in the active company.', 'TOOL_NOT_ALLOWED');
  if (tool.risk !== 'read' && !['admin', 'employee'].includes(ctx.role)) throw new HttpError(403, 'Your role cannot perform this action.', 'ROLE_FORBIDDEN');
  const parsed = tool.schema.safeParse(rawArgs || {});
  if (!parsed.success) throw new HttpError(400, `Invalid arguments for ${name}: ${parsed.error.issues.map(i => `${i.path.join('.') || 'args'} ${i.message}`).join('; ')}`, 'INVALID_TOOL_ARGUMENTS');
  if (needsApproval(name, ctx) && !ctx.approved) return { approvalRequired: true, tool: name, args: parsed.data, message: `Company policy requires approval before "${name}" can run.` };
  return tool.handler(parsed.data, ctx);
}
module.exports = { tools, publicToolList, executeTool, needsApproval };
