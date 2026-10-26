const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const { Document } = require('../models');
const { extractInvoiceFields } = require('./extractionService');
const { missingRequired } = require('./heuristic');
const storage = require('./storage');
const llm = require('../llm');
const HttpError = require('../utils/httpError');
const SAFE = '-storage -sha256';

// Shared by the upload route and the seeder.
async function ingestInvoice({ buffer, fileName, company, user }) {
  if (!buffer?.length) throw new HttpError(400, 'Choose a PDF invoice to upload.', 'FILE_REQUIRED');
  if (buffer.slice(0, 5).toString() !== '%PDF-') throw new HttpError(400, 'Only PDF invoices are supported.', 'PDF_ONLY');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const existing = await Document.findOne({ companyId: company._id, sha256 }).select(SAFE);
  if (existing) return { document: existing, duplicate: true };
  let text = '';
  try { text = String((await pdfParse(buffer)).text || '').trim(); } catch { if (!llm.isConfigured()) throw new HttpError(422, 'This PDF could not be read. Try a text-based PDF.', 'PDF_PARSE_FAILED'); }
  if (text.length < 10 && !llm.isConfigured()) throw new HttpError(422, 'No readable text was found. Scanned PDFs need a Gemini key (vision OCR) — set GEMINI_API_KEY or upload a text-based PDF.', 'PDF_NO_TEXT');
  const { fields, missing } = await extractInvoiceFields({ text, pdfBuffer: buffer });
  const stored = await storage.saveFile({ buffer, companyId: company._id, userId: user._id, sha256 });
  const doc = await Document.create({
    companyId: company._id, uploadedBy: user._id, fileName: String(fileName || 'invoice.pdf').slice(0, 240), fileSize: buffer.length, sha256, storage: stored,
    issueDate: fields.issueDate || undefined, status: missing.length ? 'needs_review' : 'processed', extractedFields: fields,
    extractionError: missing.length ? `Could not confidently extract: ${missing.join(', ')}.` : undefined
  });
  return { document: await Document.findById(doc._id).select(SAFE), duplicate: false, missing };
}

// Applies values the user supplied (or corrected). Records provenance so humans' input is distinguishable from AI output.
async function applyFieldCorrections(doc, corrections) {
  const f = doc.extractedFields?.toObject ? doc.extractedFields.toObject() : { ...(doc.extractedFields || {}) };
  const prov = { ...(f.provenance || {}) };
  for (const [k, v] of Object.entries(corrections)) { f[k] = v; prov[k] = 'user'; }
  f.provenance = prov; f.confidence = Math.max(f.confidence || 0, 0.9);
  doc.extractedFields = f; doc.markModified('extractedFields');
  if (corrections.issueDate) doc.issueDate = corrections.issueDate;
  const missing = missingRequired(f);
  doc.status = missing.length ? 'needs_review' : 'processed'; doc.extractionError = missing.length ? `Missing: ${missing.join(', ')}.` : undefined;
  await doc.save(); return doc;
}
module.exports = { ingestInvoice, applyFieldCorrections };
