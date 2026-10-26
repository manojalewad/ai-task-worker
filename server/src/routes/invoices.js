const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { Document, FinanceRecord } = require('../models');
const { ingestInvoice, applyFieldCorrections } = require('../services/documentService');
const storage = require('../services/storage');
const asyncHandler = require('../utils/asyncHandler');
const HttpError = require('../utils/httpError');
const { requireRole } = require('../middleware/auth');
const router = express.Router();
const SAFE = '-storage -sha256';
const maxMb = Math.max(1, Math.min(Number(process.env.MAX_UPLOAD_MB) || 10, 15));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024, files: 1 }, fileFilter: (req, file, cb) => cb(null, /pdf/i.test(file.mimetype) || file.originalname.toLowerCase().endsWith('.pdf')) });

router.post('/upload', requireRole('admin', 'employee'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Select a PDF invoice. Only PDF files are accepted.', 'FILE_REQUIRED');
  const r = await ingestInvoice({ buffer: req.file.buffer, fileName: req.file.originalname, company: req.company, user: req.user });
  res.status(r.duplicate ? 200 : 201).json({ success: true, duplicate: r.duplicate, message: r.duplicate ? 'This PDF is already in your repository.' : r.missing?.length ? `Uploaded. I couldn't read: ${r.missing.join(', ')} — you can fill them in or let the worker ask.` : 'Invoice uploaded and read successfully.', document: r.document });
}));
router.get('/', asyncHandler(async (req, res) => {
  const q = z.object({ search: z.string().max(150).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(req.query);
  if (!q.success) throw new HttpError(400, 'Invalid invoice search parameters.', 'INVALID_QUERY');
  const filter = { companyId: req.company._id };
  if (q.data.search) { const safe = q.data.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); filter.$or = ['fileName', 'extractedFields.invoiceNumber', 'extractedFields.supplier'].map(k => ({ [k]: { $regex: safe, $options: 'i' } })); }
  const documents = await Document.find(filter).sort({ createdAt: -1 }).limit(q.data.limit).select(SAFE).lean();
  const recs = await FinanceRecord.find({ companyId: req.company._id }).select('documentId status').lean(); const m = Object.fromEntries(recs.map(r => [String(r.documentId), r]));
  res.json({ success: true, documents: documents.map(d => ({ ...d, registered: Boolean(m[String(d._id)]), billStatus: m[String(d._id)]?.status })) });
}));
router.get('/:id', asyncHandler(async (req, res) => {
  const document = await Document.findOne({ _id: req.params.id, companyId: req.company._id }).select(SAFE).catch(() => null);
  if (!document) throw new HttpError(404, 'Invoice document not found.', 'DOCUMENT_NOT_FOUND');
  res.json({ success: true, document, financeRecord: await FinanceRecord.findOne({ companyId: req.company._id, documentId: document._id }) });
}));
router.get('/:id/file', asyncHandler(async (req, res) => {
  const doc = await Document.findOne({ _id: req.params.id, companyId: req.company._id }).catch(() => null);
  if (!doc) throw new HttpError(404, 'Invoice document not found.', 'DOCUMENT_NOT_FOUND');
  const buf = await storage.readFile(doc);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${doc.fileName.replace(/[^\w.\- ]/g, '_')}"`, 'Cache-Control': 'private, max-age=60' }).send(buf);
}));
// Manual correction of extracted fields (same validation + provenance as when the worker asks you).
router.patch('/:id/fields', requireRole('admin', 'employee'), asyncHandler(async (req, res) => {
  const doc = await Document.findOne({ _id: req.params.id, companyId: req.company._id }).catch(() => null);
  if (!doc) throw new HttpError(404, 'Invoice document not found.', 'DOCUMENT_NOT_FOUND');
  if (await FinanceRecord.exists({ companyId: req.company._id, documentId: doc._id })) throw new HttpError(409, 'This invoice is already registered; its fields are locked.', 'ALREADY_REGISTERED');
  const { fieldsSchema } = require('../agent/reply');
  const parsed = fieldsSchema.safeParse(req.body || {}); if (!parsed.success) throw new HttpError(400, 'Some values look invalid: ' + parsed.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; '), 'INVALID_FIELDS');
  const vals = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)); if (!Object.keys(vals).length) throw new HttpError(400, 'No valid values supplied.', 'NO_FIELDS');
  await applyFieldCorrections(doc, vals);
  res.json({ success: true, document: await Document.findById(doc._id).select(SAFE) });
}));
module.exports = router;
