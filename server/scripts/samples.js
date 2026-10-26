// Writes the sample invoice PDFs to ./samples so you can try uploading them yourself.
const fs = require('fs'); const path = require('path');
const { specs } = require('../src/services/seedService'); const { buildInvoicePdf } = require('../src/services/samplePdf');
(async () => { const dir = path.resolve(__dirname, '../../samples'); fs.mkdirSync(dir, { recursive: true });
  for (const s of specs()) for (const inv of s.invoices) { fs.writeFileSync(path.join(dir, `${s.slug}-${inv.file}`), await buildInvoicePdf({ ...inv, customer: s.customer })); }
  console.log('Wrote sample PDFs to', dir); })();
