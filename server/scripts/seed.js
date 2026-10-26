require('dotenv').config();
const connectDB = require('../src/config/db');
const { seed } = require('../src/services/seedService');
(async () => {
  if (!process.env.MONGODB_URI || process.env.MONGODB_URI === 'memory') { console.error('Seeding needs a persistent MONGODB_URI. (In memory mode the server seeds itself on start.)'); process.exit(1); }
  await connectDB(); await seed(); console.log('Seed complete: 2 tenants, employees, and sample invoices (incl. an incomplete one and a prompt-injection one).'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
