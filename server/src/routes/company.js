const express = require('express');
const { z } = require('zod');
const { Company, Employee, FinanceRecord, Document, Task, Outbox, CompanyPolicy, User } = require('../models');
const { publicToolList } = require('../tools/registry');
const llm = require('../llm');
const erp = require('../services/erp');
const storage = require('../services/storage');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const HttpError = require('../utils/httpError');
const router = express.Router();
const POLICIES = { requireApprovalForFinanceWrite: 'Require an administrator to approve before the worker registers a bill in the finance system.', requireApprovalForMessages: 'Require approval before the worker sends a message to a colleague.' };
const getPolicies = async companyId => { const rows = await CompanyPolicy.find({ companyId }).lean(); const m = Object.fromEntries(rows.map(r => [r.key, r.value === true])); return Object.keys(POLICIES).map(key => ({ key, value: m[key] === true, description: POLICIES[key] })); };

router.get('/overview', asyncHandler(async (req, res) => {
  const companyId = req.company._id; const mine = { companyId, ...(req.role !== 'admin' ? { userId: req.user._id } : {}) };
  const [documents, records, tasks, employees, needsAttention, bills] = await Promise.all([Document.countDocuments({ companyId }), FinanceRecord.countDocuments({ companyId }), Task.countDocuments(mine), Employee.countDocuments({ companyId, active: true }), Task.countDocuments({ ...mine, status: { $in: ['needs_input', 'waiting_for_approval'] } }), FinanceRecord.find({ companyId }).select('amount currency')]);
  const totals = {}; bills.forEach(b => { totals[b.currency] = Math.round(((totals[b.currency] || 0) + b.amount) * 100) / 100; });
  const recentTasks = await Task.find(mine).sort({ createdAt: -1 }).limit(6).select('request status intent createdAt result.answer error');
  res.json({ success: true, stats: { documents, financeRecords: records, tasks, employees, needsAttention }, registeredTotals: totals, recentTasks, company: { id: String(companyId), name: req.company.name, slug: req.company.slug, role: req.role } });
}));
router.get('/employees', asyncHandler(async (req, res) => res.json({ success: true, employees: await Employee.find({ companyId: req.company._id, active: true }).sort({ department: 1, name: 1 }).select('name title department workEmail') })));
router.get('/bills', asyncHandler(async (req, res) => res.json({ success: true, ...(await erp.listBills({ companyId: req.company._id, limit: 100, supplier: req.query.supplier })) })));
router.get('/outbox', asyncHandler(async (req, res) => res.json({ success: true, messages: await Outbox.find({ companyId: req.company._id }).sort({ createdAt: -1 }).limit(50) })));
router.get('/policies', asyncHandler(async (req, res) => res.json({ success: true, policies: await getPolicies(req.company._id) })));
router.put('/policies', requireRole('admin'), asyncHandler(async (req, res) => {
  const p = z.object({ key: z.enum(Object.keys(POLICIES)), value: z.boolean() }).safeParse(req.body); if (!p.success) throw new HttpError(400, 'Invalid policy update.', 'INVALID_POLICY');
  await CompanyPolicy.updateOne({ companyId: req.company._id, key: p.data.key }, { $set: { value: p.data.value, description: POLICIES[p.data.key] } }, { upsert: true });
  res.json({ success: true, policies: await getPolicies(req.company._id) });
}));
router.get('/companies', asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('memberships.companyId', 'name slug');
  res.json({ success: true, companies: user.memberships.map(m => ({ id: String(m.companyId._id), name: m.companyId.name, slug: m.companyId.slug, role: m.role })), activeCompanyId: String(req.company._id) });
}));
// What the agent can do and how it is currently running — shown in the UI and useful for demos.
router.get('/agent', asyncHandler(async (req, res) => res.json({ success: true, planner: llm.isConfigured() ? { mode: 'llm', model: llm.modelName(), fallback: 'rules' } : { mode: 'rules', note: 'Deterministic planner (no GEMINI_API_KEY).' }, storage: storage.provider(), tools: publicToolList(req.company.enabledTools), erpChaos: Number(process.env.ERP_CHAOS_RATE) || 0 })));
module.exports = router;
