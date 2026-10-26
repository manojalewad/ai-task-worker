const express = require('express');
const { z } = require('zod');
const { Task, ExecutionLog, Document } = require('../models');
const { enqueue, applyReply } = require('../agent');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const HttpError = require('../utils/httpError');
const { logEvent } = require('../services/audit');
const router = express.Router();
const ACTIVE = ['queued', 'running', 'verifying'];
const scope = req => ({ companyId: req.company._id, ...(req.role !== 'admin' ? { userId: req.user._id } : {}) });
const publicTask = t => { const o = t.toObject ? t.toObject() : { ...t }; const st = o.state || {}; o.plan = st.plan || []; o.pending = st.pending || null; o.facts = st.facts ? { documentId: st.facts.documentId, billSource: st.facts.billSource } : {}; delete o.state; return o; };

router.post('/', asyncHandler(async (req, res) => {
  const p = z.object({ request: z.string().trim().min(3).max(3000), documentId: z.string().optional() }).safeParse(req.body);
  if (!p.success) throw new HttpError(400, 'Describe the task in at least three characters.', 'INVALID_TASK');
  if (p.data.documentId) { const doc = await Document.findOne({ _id: p.data.documentId, companyId: req.company._id }).catch(() => null); if (!doc) throw new HttpError(404, 'Selected invoice is not available in this company.', 'DOCUMENT_NOT_FOUND'); }
  const task = await Task.create({ companyId: req.company._id, userId: req.user._id, request: p.data.request, attachedDocumentId: p.data.documentId, status: 'queued', messages: [{ role: 'user', kind: 'request', text: p.data.request }] });
  res.status(202).json({ success: true, task: publicTask(task) }); enqueue(task._id);
}));

router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 30, 100));
  const tasks = await Task.find(scope(req)).sort({ createdAt: -1 }).limit(limit).select('-state -messages');
  res.json({ success: true, tasks });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const task = await Task.findOne({ _id: req.params.id, ...scope(req) }).catch(() => null);
  if (!task) throw new HttpError(404, 'Task not found.', 'TASK_NOT_FOUND');
  const logs = await ExecutionLog.find({ companyId: req.company._id, taskId: task._id }).sort({ createdAt: 1 }).select('toolName action status summary errorCode durationMs createdAt');
  res.json({ success: true, task: publicTask(task), logs });
}));

// The user answers a question the worker asked (form values, a choice, free text, or a document) and the task resumes.
router.post('/:id/reply', asyncHandler(async (req, res) => {
  const body = z.object({ message: z.string().max(2000).optional(), fields: z.record(z.union([z.string(), z.number()])).optional(), documentId: z.string().max(60).optional() }).safeParse(req.body || {});
  if (!body.success) throw new HttpError(400, 'Invalid reply.', 'INVALID_REPLY');
  const task = await Task.findOne({ _id: req.params.id, companyId: req.company._id, userId: req.user._id }).catch(() => null);
  if (!task) throw new HttpError(404, 'Task not found.', 'TASK_NOT_FOUND');
  const out = await applyReply(task, body.data);
  if (out.cancel) { task.status = 'cancelled'; task.finishedAt = new Date(); task.result = { kind: 'cancelled', answer: 'Okay — I stopped. Nothing was changed.', evidence: [] }; task.messages.push({ role: 'user', kind: 'reply', text: body.data.message }, { role: 'agent', kind: 'result', text: task.result.answer }); await task.save(); return res.json({ success: true, task: publicTask(task) }); }
  task.status = 'queued'; task.result = undefined; task.markModified('state'); await task.save();
  await logEvent({ companyId: task.companyId, taskId: task._id, action: 'reply', status: 'received', summary: `You replied: ${out.note || 'details provided'}` });
  res.json({ success: true, task: publicTask(task) }); enqueue(task._id);
}));

// Resume a failed/step-limited task from its saved state.
router.post('/:id/retry', asyncHandler(async (req, res) => {
  const task = await Task.findOne({ _id: req.params.id, companyId: req.company._id, userId: req.user._id }).catch(() => null);
  if (!task) throw new HttpError(404, 'Task not found.', 'TASK_NOT_FOUND');
  if (task.status !== 'failed') throw new HttpError(409, 'Only failed tasks can be retried.', 'NOT_FAILED');
  task.status = 'queued'; task.error = undefined; task.finishedAt = undefined; task.state.rejections = 0; task.state.lastError = null; task.markModified('state');
  task.messages.push({ role: 'user', kind: 'retry', text: 'Retry / continue' }); await task.save();
  await logEvent({ companyId: task.companyId, taskId: task._id, action: 'reply', status: 'retry', summary: 'Retrying from saved progress.' });
  res.json({ success: true, task: publicTask(task) }); enqueue(task._id);
}));

async function decide(req, res, approve) {
  const task = await Task.findOne({ _id: req.params.id, companyId: req.company._id }).catch(() => null);
  if (!task) throw new HttpError(404, 'Task not found.', 'TASK_NOT_FOUND');
  if (task.status !== 'waiting_for_approval' || task.approval?.status !== 'pending') throw new HttpError(409, 'This task is not waiting for approval.', 'APPROVAL_NOT_PENDING');
  const note = String(req.body?.note || (approve ? 'Approved by administrator' : 'Rejected by administrator')).slice(0, 300);
  task.approval.status = approve ? 'approved' : 'rejected'; task.approval.approvedBy = req.user._id; task.approval.decidedAt = new Date(); task.approval.note = note;
  if (approve) { task.status = 'queued'; task.messages.push({ role: 'system', kind: 'approval', text: `Approved by ${req.user.name}. Resuming.` }); }
  else { task.status = 'cancelled'; task.finishedAt = new Date(); task.state.pending = null; task.markModified('state'); task.result = { kind: 'approval_rejected', answer: 'An administrator rejected the action, so nothing was changed.', evidence: [] }; task.messages.push({ role: 'system', kind: 'approval', text: `Rejected by ${req.user.name}. Nothing was changed.` }); }
  await task.save(); await logEvent({ companyId: req.company._id, taskId: task._id, action: 'approval', status: approve ? 'approved' : 'rejected', summary: `${approve ? 'Approved' : 'Rejected'} by ${req.user.email}` });
  res.json({ success: true, task: publicTask(task) }); if (approve) enqueue(task._id);
}
router.post('/:id/approve', requireRole('admin'), asyncHandler((req, res) => decide(req, res, true)));
router.post('/:id/reject', requireRole('admin'), asyncHandler((req, res) => decide(req, res, false)));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const task = await Task.findOneAndUpdate({ _id: req.params.id, companyId: req.company._id, userId: req.user._id, status: { $in: [...ACTIVE, 'needs_input', 'waiting_for_approval'] } }, { $set: { status: 'cancelled', finishedAt: new Date(), result: { kind: 'cancelled', answer: 'Cancelled. Any step already completed is kept in the audit log.', evidence: [] } } }, { new: true });
  if (!task) throw new HttpError(409, 'This task has already finished.', 'TASK_ALREADY_FINISHED');
  await logEvent({ companyId: req.company._id, taskId: task._id, action: 'message', status: 'cancelled', summary: 'Cancelled by user.' });
  res.json({ success: true, task: publicTask(task) });
}));
module.exports = router;
