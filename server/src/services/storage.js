// File storage abstraction: Cloudinary (authenticated, raw) when configured, otherwise MongoDB. Never the app's local disk.
const { cloudinary, cloudinaryReady } = require('../config/cloudinary');
const { FileBlob } = require('../models');
const HttpError = require('../utils/httpError');
const provider = () => (cloudinaryReady() && process.env.STORAGE_PROVIDER !== 'database' ? 'cloudinary' : 'database');
function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => cloudinary.uploader.upload_stream(options, (err, r) => err ? reject(err) : resolve(r)).end(buffer));
}
async function saveFile({ buffer, companyId, userId, sha256, mimeType = 'application/pdf' }) {
  if (provider() === 'cloudinary') {
    try {
      const up = await uploadBuffer(buffer, { resource_type: 'raw', type: 'authenticated', folder: `${process.env.CLOUDINARY_FOLDER || 'company-ai-worker'}/${companyId}`, public_id: `${Date.now()}-${sha256.slice(0, 12)}.pdf`, overwrite: false, context: { companyId: String(companyId), uploadedBy: String(userId) } });
      return { provider: 'cloudinary', ref: up.public_id };
    } catch (e) {
      console.warn('Cloudinary upload failed, storing in database instead:', e.message);
    }
  }
  const blob = await FileBlob.create({ companyId, data: buffer, mimeType });
  return { provider: 'database', ref: String(blob._id) };
}
async function readFile(doc) {
  if (doc.storage?.provider === 'cloudinary') {
    const url = cloudinary.url(doc.storage.ref, { resource_type: 'raw', type: 'authenticated', sign_url: true, secure: true });
    const r = await fetch(url);
    if (!r.ok) throw new HttpError(502, 'The stored file could not be retrieved.', 'STORAGE_READ_FAILED');
    return Buffer.from(await r.arrayBuffer());
  }
  const blob = await FileBlob.findOne({ _id: doc.storage?.ref, companyId: doc.companyId });
  if (!blob) throw new HttpError(404, 'The stored file is no longer available.', 'FILE_NOT_FOUND');
  return blob.data;
}
module.exports = { saveFile, readFile, provider };
