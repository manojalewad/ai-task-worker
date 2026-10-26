const { ExecutionLog } = require('../models');
const { redact } = require('../utils/sanitize');
async function logEvent({ companyId, taskId, toolName, action = 'message', status = 'info', summary = '', errorCode, durationMs }) {
  try { await ExecutionLog.create({ companyId, taskId, toolName, action, status, summary: redact(summary, 1400), errorCode, durationMs }); }
  catch (e) { console.error('Audit log write failed:', e.message); }
}
module.exports = { logEvent };
