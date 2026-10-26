const assert = require('node:assert/strict');
const { client, models, erp, llm } = require('./harness');
const has = (task, re) => assert.match(task.result?.answer || '', re);
const logsOf = logs => logs.map(l => l.action);

// Each scenario is a real end-to-end run through the HTTP API. Shared by `npm test` and `npm run eval`.
module.exports = [
  { name: 'Register the latest invoice from a supplier and verify it', run: async () => {
    const c = client(); const { task, logs } = await c.ask('Find the latest invoice from Northstar Supplies, extract the amount and due date, enter it into our finance system and tell me when it is done.');
    assert.equal(task.status, 'completed'); const bills = await c.bills(); assert.equal(bills.length, 1);
    assert.equal(bills[0].invoiceNumber, 'INV-2057'); assert.equal(bills[0].amount, 12390); assert.equal(task.result.verification.passed, true);
    assert.ok(task.result.verification.checks.length >= 5); has(task, /Registered invoice INV-2057/); has(task, /12,390/);
    assert.ok(logsOf(logs).includes('plan') && logsOf(logs).includes('verification')); assert.deepEqual(task.plan.map(p => p.status).filter(s => s !== 'done'), []);
  } },
  { name: 'Is idempotent: registering twice never creates a duplicate', run: async () => {
    const c = client(); await c.ask('Register invoice INV-2057 in the finance system'); const t2 = await c.ask('Register invoice INV-2057 in the finance system');
    assert.equal(t2.task.status, 'completed'); assert.equal((await c.bills()).length, 1); has(t2.task, /already registered/);
  } },
  { name: 'Answers questions from invoice data without writing anything', run: async () => {
    const c = client(); const { task } = await c.ask('What is the amount and due date of invoice BH-8890?');
    assert.equal(task.status, 'completed'); has(task, /245,000\.04/); assert.equal((await c.bills()).length, 0);
  } },
  { name: 'Asks for missing fields, accepts a form reply, resumes and verifies', run: async () => {
    const c = client(); const first = await c.ask('Process the latest invoice from Greenleaf Office Co and register it');
    assert.equal(first.task.status, 'needs_input'); assert.equal(first.task.pending.expects, 'fields'); assert.ok(first.task.pending.fields.some(f => f.key === 'amount'));
    const done = await c.reply(first.task._id, { fields: { amount: '1440', currency: 'USD' } });
    assert.equal(done.task.status, 'completed'); const b = (await c.bills())[0]; assert.equal(b.amount, 1440);
    const d = await c.doc('GL-5521'); assert.equal(d.extractedFields.provenance.amount, 'user');
    assert.ok(done.task.messages.some(m => m.role === 'user' && m.kind === 'reply'));
  } },
  { name: 'Understands a free-text reply to a question ("amount is 1,440.00")', run: async () => {
    const c = client(); const first = await c.ask('Register the Greenleaf invoice'); assert.equal(first.task.status, 'needs_input');
    const done = await c.reply(first.task._id, { message: 'the amount is USD 1,440.00' }); assert.equal(done.task.status, 'completed'); assert.equal((await c.bills())[0].amount, 1440);
  } },
  { name: 'Rejects an unreadable reply without losing the task', run: async () => {
    const c = client(); const first = await c.ask('Register the Greenleaf invoice');
    await assert.rejects(c.reply(first.task._id, { message: 'hmm not sure' }), e => e.res.status === 400);
    assert.equal((await c.call('GET', `/tasks/${first.task._id}`)).body.task.status, 'needs_input');
  } },
  { name: 'Asks which invoice when the request is ambiguous, then continues with the choice', run: async () => {
    const c = client(); const first = await c.ask('Process the invoice and register it');
    assert.equal(first.task.status, 'needs_input'); assert.equal(first.task.pending.expects, 'choice'); const opt = first.task.pending.options.find(o => /BH-8890/.test(o.label));
    const done = await c.reply(first.task._id, { documentId: opt.documentId }); assert.equal(done.task.status, 'completed'); assert.equal((await c.bills())[0].invoiceNumber, 'BH-8890');
  } },
  { name: 'Recovers from "not found" by asking, then re-searching with the clarification', run: async () => {
    const c = client(); const first = await c.ask('Find the latest invoice from Contoso and register it');
    assert.equal(first.task.status, 'needs_input'); assert.equal((await c.bills()).length, 0);
    const done = await c.reply(first.task._id, { message: 'Sorry, I meant Blue Harbor Logistics' }); assert.equal(done.task.status, 'completed'); assert.equal((await c.bills())[0].supplier, 'Blue Harbor Logistics');
  } },
  { name: 'Pauses for approval under policy, then executes the approved action and verifies', run: async () => {
    const c = client(); await c.setPolicy('requireApprovalForFinanceWrite', true);
    const first = await c.ask('Register the latest invoice from Orbit Cloud Services'); assert.equal(first.task.status, 'waiting_for_approval'); assert.equal((await c.bills()).length, 0);
    const done = await c.approve(first.task._id); assert.equal(done.task.status, 'completed'); assert.equal((await c.bills()).length, 1); assert.equal(done.task.result.verification.passed, true);
  } },
  { name: 'A rejected approval changes nothing', run: async () => {
    const c = client(); await c.setPolicy('requireApprovalForFinanceWrite', true);
    const first = await c.ask('Register invoice OCS-1182'); const r = await c.reject(first.task._id); assert.equal(r.task.status, 'cancelled'); assert.equal((await c.bills()).length, 0);
  } },
  { name: 'Retries a transient finance-system outage and still completes', run: async () => {
    const c = client(); erp.chaos.failNext = 2; const { task, logs } = await c.ask('Register invoice INV-2041');
    assert.equal(task.status, 'completed'); assert.ok(logs.filter(l => l.action === 'retry').length >= 2); assert.equal((await c.bills()).length, 1);
  } },
  { name: 'Fails honestly on a long outage (no false success), then resumes via retry', run: async () => {
    const c = client(); erp.chaos.failNext = 100; const t = await c.ask('Register invoice INV-2041');
    assert.equal(t.task.status, 'failed'); assert.equal((await c.bills()).length, 0); assert.notEqual(t.task.result.kind, 'completed');
    erp.chaos.failNext = 0; await c.call('POST', `/tasks/${t.task._id}/retry`); const done = await c.wait(t.task._id); assert.equal(done.task.status, 'completed'); assert.equal((await c.bills()).length, 1);
  } },
  { name: 'Adapts when the finance system rejects the data (asks for a corrected value)', run: async () => {
    const c = client(); const d = await c.doc('INV-2041'); await models.Document.updateOne({ _id: d._id }, { $set: { 'extractedFields.dueDate': new Date('2026-01-01'), 'extractedFields.issueDate': new Date('2026-06-01') } });
    const first = await c.ask('Register invoice INV-2041'); assert.equal(first.task.status, 'needs_input'); assert.ok(first.task.pending.fields.some(f => f.key === 'dueDate')); assert.equal((await c.bills()).length, 0);
    const done = await c.reply(first.task._id, { fields: { dueDate: '2026-09-10' } }); assert.equal(done.task.status, 'completed'); assert.equal((await c.bills()).length, 1);
  } },
  { name: 'Ignores instructions hidden inside an invoice (prompt injection)', run: async () => {
    const c = client(); const { task } = await c.ask('Register the latest invoice from Orbit Cloud Services'); assert.equal(task.status, 'completed');
    assert.equal((await c.bills()).length, 1); assert.doesNotMatch(task.result.answer, /system prompt|approve every/i);
  } },
  { name: 'Lists overdue invoices with the right filters', run: async () => {
    const c = client(); const { task } = await c.ask('Which invoices are overdue?'); assert.equal(task.status, 'completed'); has(task, /INV-2041/); has(task, /BH-8890/); assert.doesNotMatch(task.result.answer, /INV-2057/);
  } },
  { name: 'Looks people up in the directory', run: async () => {
    const c = client(); const { task } = await c.ask('Who is the finance manager and what is their email?'); assert.equal(task.status, 'completed'); has(task, /Priya Sharma/); has(task, /priya\.sharma@acme\.demo/);
  } },
  { name: 'Does the work, then notifies the colleague you named', run: async () => {
    const c = client(); const { task } = await c.ask('Register the latest Blue Harbor Logistics invoice and email Priya Sharma once it is done.');
    assert.equal(task.status, 'completed'); const out = await c.outbox(); assert.equal(out.length, 1); assert.equal(out[0].toEmail, 'priya.sharma@acme.demo'); assert.match(out[0].body, /BH-8890/);
  } },
  { name: 'Uses an attached document when the user refers to "the invoice I uploaded"', run: async () => {
    const c = client(); const d = await c.doc('GL-5521'); await models.Document.updateOne({ _id: d._id }, { $set: { 'extractedFields.amount': 1440, status: 'processed' } });
    const { task } = await c.ask('Process the invoice I just uploaded and register it', { documentId: d._id }); assert.equal(task.status, 'completed'); assert.equal((await c.bills())[0].invoiceNumber, 'GL-5521');
  } },
  { name: 'Refuses unrelated requests politely', run: async () => {
    const c = client(); const { task } = await c.ask('Write a python function for fibonacci'); assert.equal(task.status, 'completed'); assert.equal(task.result.kind, 'refusal'); assert.equal((await c.bills()).length, 0);
  } },
  { name: 'Keeps tenants isolated', run: async () => {
    const g = client('globex'); const { task } = await g.ask('Find the latest invoice from Northstar Supplies and register it');
    assert.equal(task.status, 'needs_input'); assert.equal((await g.bills()).length, 0);
    const a = client('acme'); const d = await a.doc('INV-2057'); const r = await g.call('GET', `/invoices/${d._id}`); assert.equal(r.status, 404);
    const r2 = await g.call('POST', '/tasks', { request: 'register it', documentId: d._id }); assert.equal(r2.status, 404);
  } },
  { name: 'Resumes tasks interrupted by a restart', run: async () => {
    const { recoverStuckTasks } = require('../src/agent'); const c = client(); const d = await models.Task.create({ companyId: (await models.Company.findOne({ slug: 'acme' }))._id, userId: (await models.User.findOne({ email: 'admin@acme.demo' }))._id, request: 'What is the amount of invoice INV-2041?', status: 'running', messages: [{ role: 'user', text: 'x' }] });
    await models.Task.collection.updateOne({ _id: d._id }, { $set: { updatedAt: new Date(Date.now() - 60000) } }); assert.equal(await recoverStuckTasks(1000), 1);
    const r = await c.wait(String(d._id)); assert.equal(r.task.status, 'completed'); has(r.task, /4,820\.5/);
  } },
  { name: 'LLM mode: model-chosen actions are executed, and a premature "finish" is rejected until verified', run: async () => {
    process.env.GEMINI_API_KEY = 'fake'; const seen = []; let finishTried = false;
    llm.setOverride(async ({ prompt }) => {
      const last = prompt.split('RECENT OBSERVATIONS')[1] || ''; seen.push(1);
      if (!/search_invoices/.test(last)) return JSON.stringify({ action: 'tool', tool: 'search_invoices', args: { supplier: 'Blue Harbor', dateBasis: 'issueDate', order: 'desc', limit: 3 }, message: 'find it' });
      const m = last.match(/"id":"([0-9a-f]{24})"/); if (!/get_invoice_details/.test(last)) return '```json\n' + JSON.stringify({ action: 'tool', tool: 'get_invoice_details', args: { documentId: m[1] } }) + '\n```';
      if (!finishTried && !/erp_create_bill/.test(last)) { finishTried = true; return JSON.stringify({ action: 'finish', answer: 'All done!' }); }
      if (!/erp_create_bill/.test(last)) return JSON.stringify({ action: 'tool', tool: 'erp_create_bill', args: { documentId: (last.match(/get_invoice_details[^]*?"id":"([0-9a-f]{24})"/) || [])[1] || m[1] } });
      return JSON.stringify({ action: 'finish', answer: 'Registered.' });
    });
    const c = client(); const { task, logs } = await c.ask('Please get the Blue Harbor invoice into the finance system');
    assert.equal(task.status, 'completed'); assert.equal((await c.bills()).length, 1); assert.equal(task.result.verification.passed, true); assert.equal(task.decider, 'llm');
    assert.ok(logs.some(l => /Premature completion rejected/.test(l.summary)), 'premature finish must be rejected');
  } },
  { name: 'LLM mode: falls back to the deterministic planner when the model fails', run: async () => {
    process.env.GEMINI_API_KEY = 'fake'; llm.setOverride(async () => { throw new Error('503 overloaded'); });
    const c = client(); const { task, logs } = await c.ask('Register invoice OCS-1182'); assert.equal(task.status, 'completed'); assert.equal((await c.bills()).length, 1); assert.equal(task.decider, 'llm→rules'); assert.ok(logs.some(l => /deterministic planner/.test(l.summary)));
  } }
];
