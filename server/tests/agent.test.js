const { test, before, after, beforeEach } = require('node:test');
const h = require('./harness'); const scenarios = require('./scenarios');
if (!process.env.TEST_MONGODB_URI) console.log('(no TEST_MONGODB_URI set: using an in-memory MongoDB)');
before(() => h.boot()); after(() => h.shutdown()); beforeEach(() => h.reset());
for (const s of scenarios) test(s.name, { timeout: 60000 }, s.run);
