// Boots the real Express app against a real MongoDB and drives it over HTTP, exactly as the UI does.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-123456';
process.env.AGENT_RETRY_BASE_MS = '1'; process.env.NODE_ENV = 'test'; process.env.STORAGE_PROVIDER = 'database';
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const models = require('../src/models');
const erp = require('../src/services/erp');
const llm = require('../src/llm');
const { seed } = require('../src/services/seedService');
let server; let base; const tokens = {};

async function boot() {
  delete process.env.GEMINI_API_KEY; llm.setOverride(null);
  await connectDB(process.env.TEST_MONGODB_URI || 'memory');
  if (process.env.TEST_MONGODB_URI) await mongoose.connection.dropDatabase();
  await seed({ log: () => {} });
  const app = require('../src/server');
  await new Promise(r => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api`;
  for (const slug of ['acme', 'globex']) { const r = await raw('POST', '/auth/login', { email: `admin@${slug}.demo`, password: 'DemoPass123!', companySlug: slug }); tokens[slug] = r.body.token; }
}
async function shutdown() { llm.setOverride(null); await new Promise(r => server.close(r)); await connectDB.disconnectDB(); }
async function raw(method, path, body, token) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function reset() {
  await Promise.all([models.Document, models.FileBlob, models.FinanceRecord, models.Task, models.ExecutionLog, models.Outbox].map(m => m.deleteMany({})));
  await models.CompanyPolicy.updateMany({}, { $set: { value: false } }); erp.chaos.failNext = 0; llm.setOverride(null); delete process.env.GEMINI_API_KEY; delete process.env.ERP_CHAOS_RATE;
  await seed({ log: () => {} });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAUSED = ['needs_input', 'waiting_for_approval', 'completed', 'failed', 'cancelled'];
function client(slug = 'acme') {
  const t = tokens[slug]; const call = (m, p, b) => raw(m, p, b, t);
  const c = {
    call,
    async docs() { return (await call('GET', '/invoices')).body.documents; },
    async doc(supplierOrNumber) { const all = await c.docs(); return all.find(d => d.extractedFields?.invoiceNumber === supplierOrNumber || d.extractedFields?.supplier === supplierOrNumber); },
    async wait(id, until = PAUSED, ms = 20000) { const end = Date.now() + ms; for (;;) { const r = await call('GET', `/tasks/${id}`); if (until.includes(r.body.task.status)) { await sleep(60); return (await call('GET', `/tasks/${id}`)).body; } if (Date.now() > end) throw new Error(`timeout waiting for task; last status ${r.body.task.status}`); await sleep(40); } },
    async ask(request, extra = {}) { const r = await call('POST', '/tasks', { request, ...extra }); if (r.status !== 202) throw new Error('create failed ' + JSON.stringify(r.body)); return c.wait(r.body.task._id); },
    async reply(id, body) { const r = await call('POST', `/tasks/${id}/reply`, body); if (r.status !== 200) throw Object.assign(new Error('reply failed ' + JSON.stringify(r.body)), { res: r }); return c.wait(id); },
    async approve(id) { const r = await call('POST', `/tasks/${id}/approve`, {}); if (r.status !== 200) throw new Error('approve failed ' + JSON.stringify(r.body)); return c.wait(id); },
    async reject(id) { await call('POST', `/tasks/${id}/reject`, {}); return c.wait(id); },
    bills: () => models.FinanceRecord.find({}).lean(), outbox: () => models.Outbox.find({}).lean(),
    setPolicy: (key, value) => call('PUT', '/company/policies', { key, value })
  };
  return c;
}
module.exports = { boot, shutdown, reset, client, models, erp, llm };
