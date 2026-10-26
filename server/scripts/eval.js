// Agent evaluation: runs every end-to-end scenario and prints a scorecard. `TEST_MONGODB_URI=... npm run eval`
require('dotenv').config(); if (process.env.MONGODB_URI && !process.env.TEST_MONGODB_URI && process.env.MONGODB_URI !== 'memory') { console.log('Tip: set TEST_MONGODB_URI to a throwaway database (eval resets data). Using in-memory DB instead.'); }
const h = require('../tests/harness'); const scenarios = require('../tests/scenarios');
(async () => {
  await h.boot(); let pass = 0; const rows = [];
  for (const s of scenarios) { await h.reset(); const t0 = Date.now(); try { await s.run(); pass++; rows.push(['PASS', s.name, Date.now() - t0]); } catch (e) { rows.push(['FAIL', s.name, Date.now() - t0, e.message.split('\n')[0]]); } }
  for (const r of rows) console.log(`${r[0] === 'PASS' ? '✅' : '❌'} ${r[1]}  (${r[2]} ms)${r[3] ? '\n     ' + r[3] : ''}`);
  console.log(`\n${pass}/${scenarios.length} scenarios passed`); await h.shutdown(); process.exit(pass === scenarios.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
