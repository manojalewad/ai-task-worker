const multer = require('multer');
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'An unexpected error occurred.';
  if (err instanceof multer.MulterError) { status = 400; code = 'UPLOAD_ERROR'; message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large. Please upload a smaller PDF.' : 'The upload could not be accepted.'; }
  if (err.name === 'ValidationError') { status = 400; code = 'VALIDATION_ERROR'; message = 'Some submitted data is invalid.'; }
  if (err.code === 11000) { status = 409; code = 'DUPLICATE_RECORD'; message = 'A matching record already exists.'; }
  if (process.env.NODE_ENV !== 'production') console.error('[api-error]', err);
  res.status(status).json({ success: false, error: { code, message, ...(err.details ? { details: err.details } : {}) } });
}
module.exports = errorHandler;
