function safeUser(user) { return { id: String(user._id), name: user.name, email: user.email, memberships: user.memberships.map(m => ({ companyId: String(m.companyId), role: m.role })) }; }
function redact(value, max = 500) { const s = typeof value === 'string' ? value : JSON.stringify(value ?? {}); return s.length > max ? s.slice(0, max) + '…' : s; }
module.exports = { safeUser, redact };
