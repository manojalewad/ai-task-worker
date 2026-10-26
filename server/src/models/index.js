const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const oid = (ref, extra = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });

const ALL_TOOLS = [
  'search_invoices', 'get_invoice_details', 'erp_find_bill', 'erp_create_bill',
  'erp_get_bill', 'erp_list_bills', 'search_employees', 'send_message'
];

const companySchema = new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  description: String,
  enabledTools: { type: [String], default: ALL_TOOLS },
  policy: { requireApprovalForFinanceWrite: { type: Boolean, default: false } }
}, { timestamps: true });

const membershipSchema = new Schema({ companyId: oid('Company', { required: true }), role: { type: String, enum: ['admin', 'employee', 'viewer'], default: 'employee' } }, { _id: false });
const userSchema = new Schema({
  name: { type: String, required: true }, email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true }, memberships: { type: [membershipSchema], default: [] }, active: { type: Boolean, default: true }
}, { timestamps: true });

const documentSchema = new Schema({
  companyId: oid('Company', { required: true, index: true }), uploadedBy: oid('User', { required: true }),
  fileName: { type: String, required: true }, mimeType: { type: String, default: 'application/pdf' }, fileSize: Number,
  sha256: { type: String, required: true },
  storage: { provider: { type: String, enum: ['cloudinary', 'database'], default: 'database' }, ref: String },
  uploadDate: { type: Date, default: Date.now }, issueDate: Date,
  status: { type: String, enum: ['uploaded', 'processing', 'processed', 'needs_review', 'failed'], default: 'uploaded' },
  extractedFields: {
    invoiceNumber: String, supplier: String, customer: String, issueDate: Date, dueDate: Date,
    amount: Number, currency: String, taxAmount: Number, confidence: Number, notes: String,
    provenance: Schema.Types.Mixed
  },
  extractionError: String
}, { timestamps: true });
documentSchema.index({ companyId: 1, sha256: 1 });
documentSchema.index({ companyId: 1, 'extractedFields.invoiceNumber': 1 });

const fileBlobSchema = new Schema({ companyId: oid('Company', { required: true, index: true }), data: { type: Buffer, required: true }, mimeType: String }, { timestamps: true });

// Simulated internal finance system ("ERP"): bills are the records the agent must create & verify.
const financeRecordSchema = new Schema({
  companyId: oid('Company', { required: true }), documentId: oid('Document', { required: true }), createdBy: oid('User', { required: true }),
  taskId: oid('Task'),
  invoiceNumber: { type: String, required: true, trim: true }, supplier: { type: String, required: true, trim: true },
  issueDate: Date, dueDate: Date, amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  status: { type: String, enum: ['registered', 'needs_review', 'paid'], default: 'registered' },
  source: { type: String, enum: ['agent', 'manual'], default: 'agent' },
  idempotencyKey: { type: String, required: true }
}, { timestamps: true });
financeRecordSchema.index({ companyId: 1, idempotencyKey: 1 }, { unique: true });
financeRecordSchema.index({ companyId: 1, invoiceNumber: 1, supplier: 1 }, { unique: true });

const messageSchema = new Schema({ role: { type: String, enum: ['user', 'agent', 'system'], required: true }, kind: String, text: { type: String, maxlength: 4000 }, at: { type: Date, default: Date.now } }, { _id: false });

const taskSchema = new Schema({
  companyId: oid('Company', { required: true, index: true }), userId: oid('User', { required: true }),
  request: { type: String, required: true, maxlength: 3000 }, attachedDocumentId: oid('Document'),
  intent: { type: String, default: 'unknown' },
  status: { type: String, enum: ['queued', 'running', 'waiting_for_approval', 'needs_input', 'verifying', 'completed', 'failed', 'cancelled'], default: 'queued', index: true },
  messages: { type: [messageSchema], default: [] },
  // Durable agent state: lets the worker pause for input/approval and resume exactly where it stopped.
  state: { type: Schema.Types.Mixed, default: () => ({ plan: [], facts: {}, history: [], pending: null, runs: 0 }) },
  currentStep: { type: Number, default: 0 }, stepCount: { type: Number, default: 0 },
  decider: { type: String, default: 'rules' },
  result: Schema.Types.Mixed, error: { code: String, message: String },
  startedAt: Date, finishedAt: Date,
  approval: { status: { type: String, enum: ['not_required', 'pending', 'approved', 'rejected'], default: 'not_required' }, requestedAt: Date, decidedAt: Date, approvedBy: oid('User'), note: String }
}, { timestamps: true, minimize: false });
taskSchema.index({ companyId: 1, userId: 1, createdAt: -1 });

const logSchema = new Schema({
  companyId: oid('Company', { required: true, index: true }), taskId: oid('Task', { required: true, index: true }),
  toolName: String, action: { type: String, default: 'message' }, status: String,
  summary: { type: String, maxlength: 1500 }, errorCode: String, durationMs: Number
}, { timestamps: true });

const employeeSchema = new Schema({ companyId: oid('Company', { required: true, index: true }), name: { type: String, required: true }, title: String, department: String, workEmail: String, active: { type: Boolean, default: true } }, { timestamps: true });
const policySchema = new Schema({ companyId: oid('Company', { required: true, index: true }), key: { type: String, required: true }, value: Schema.Types.Mixed, description: String }, { timestamps: true });
policySchema.index({ companyId: 1, key: 1 }, { unique: true });
const outboxSchema = new Schema({ companyId: oid('Company', { required: true, index: true }), taskId: oid('Task'), sentBy: oid('User'), to: String, toEmail: String, subject: String, body: String, status: { type: String, default: 'sent (simulated)' } }, { timestamps: true });

const reg = (name, schema) => mongoose.models[name] || model(name, schema);
module.exports = {
  ALL_TOOLS,
  Company: reg('Company', companySchema), User: reg('User', userSchema), Document: reg('Document', documentSchema),
  FileBlob: reg('FileBlob', fileBlobSchema), FinanceRecord: reg('FinanceRecord', financeRecordSchema),
  Task: reg('Task', taskSchema), ExecutionLog: reg('ExecutionLog', logSchema), Employee: reg('Employee', employeeSchema),
  CompanyPolicy: reg('CompanyPolicy', policySchema), Outbox: reg('Outbox', outboxSchema)
};
