const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { User, Company } = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const HttpError = require('../utils/httpError');
const { authenticate } = require('../middleware/auth');
const { safeUser } = require('../utils/sanitize');
const router = express.Router();
const loginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200), companySlug: z.string().trim().min(1).max(100).optional() });
router.post('/login', asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Enter a valid email and password.', 'INVALID_LOGIN_INPUT');
  const email = parsed.data.email.toLowerCase();
  const user = await User.findOne({ email, active: true });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) throw new HttpError(401, 'Email or password is incorrect.', 'LOGIN_FAILED');
  let membership;
  if (parsed.data.companySlug) {
    const company = await Company.findOne({ slug: parsed.data.companySlug.toLowerCase() });
    membership = company && user.memberships.find(m => String(m.companyId) === String(company._id));
  } else membership = user.memberships[0];
  if (!membership) throw new HttpError(403, 'This account does not have access to the selected company.', 'COMPANY_ACCESS_DENIED');
  const company = await Company.findById(membership.companyId);
  const token = jwt.sign({ sub: String(user._id), companyId: String(company._id) }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '12h', issuer: 'company-ai-worker' });
  res.json({ success: true, token, user: safeUser(user), activeCompany: { id: String(company._id), name: company.name, slug: company.slug, role: membership.role } });
}));
router.get('/me', authenticate, asyncHandler(async (req, res) => res.json({ success: true, user: safeUser(req.user), activeCompany: { id: String(req.company._id), name: req.company.name, slug: req.company.slug, role: req.role } })));
module.exports = router;
