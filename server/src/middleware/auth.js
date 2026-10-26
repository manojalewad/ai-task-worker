const jwt = require('jsonwebtoken');
const { User, Company } = require('../models');
const HttpError = require('../utils/httpError');
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Please sign in to continue.', 'AUTH_REQUIRED');
    let payload;
    try { payload = jwt.verify(token, process.env.JWT_SECRET); } catch { throw new HttpError(401, 'Your session is invalid or expired. Please sign in again.', 'INVALID_TOKEN'); }
    const user = await User.findById(payload.sub).select('-passwordHash');
    if (!user || !user.active) throw new HttpError(401, 'This account is unavailable.', 'USER_UNAVAILABLE');
    const membership = user.memberships.find(m => String(m.companyId) === String(payload.companyId));
    if (!membership) throw new HttpError(403, 'You do not have access to this company.', 'COMPANY_ACCESS_DENIED');
    const company = await Company.findById(membership.companyId);
    if (!company) throw new HttpError(403, 'Company context could not be resolved.', 'COMPANY_NOT_FOUND');
    req.user = user; req.company = company; req.role = membership.role;
    next();
  } catch (e) { next(e); }
}
function requireRole(...roles) { return (req, res, next) => roles.includes(req.role) ? next() : next(new HttpError(403, 'Your role does not permit this action.', 'ROLE_FORBIDDEN')); }
module.exports = { authenticate, requireRole };
