const PDFDocument = require('pdfkit');
// Generates a realistic text-based invoice PDF (used by the seeder and `npm run samples`).
function buildInvoicePdf(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, pdfVersion: '1.4', compress: false, info: { Title: 'Invoice ' + inv.invoiceNumber, Author: inv.supplier } }); const chunks = [];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const line = (t, o = {}) => doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size || 11).fillColor(o.color || '#222').text(t, o.x, o.y, { lineGap: 4, ...(o.opts || {}) });
    line(inv.supplier, { bold: true, size: 20 }); line(inv.address || '221 Market Street, Pune, India', { color: '#666', size: 9 });
    doc.moveDown(); line('INVOICE', { bold: true, size: 16 }); doc.moveDown(0.5);
    line(`Invoice No: ${inv.invoiceNumber}`); line(`Invoice Date: ${inv.issueDate}`); line(`Due Date: ${inv.dueDate}`);
    line(`From: ${inv.supplier}`); line(`Bill To: ${inv.customer}`); doc.moveDown();
    line('Description / Qty / Rate / Amount', { bold: true });
    for (const it of inv.items) line(`${it.name} — ${it.qty} x ${it.rate.toFixed(2)} = ${(it.qty * it.rate).toFixed(2)}`);
    doc.moveDown();
    const sub = inv.items.reduce((s, i) => s + i.qty * i.rate, 0);
    line(`Subtotal: ${inv.currency} ${sub.toFixed(2)}`);
    if (inv.tax !== undefined) line(`Tax: ${inv.currency} ${inv.tax.toFixed(2)}`);
    if (inv.total === null) line('Total Due: to be confirmed by accounts', { bold: true });
    else line(`Total Due: ${inv.currency} ${Number(inv.total ?? sub + (inv.tax || 0)).toFixed(2)}`, { bold: true, size: 13 });
    doc.moveDown(); line(inv.footer || 'Payment terms: bank transfer within the due date. Thank you for your business.', { color: '#666', size: 9 });
    doc.end();
  });
}
module.exports = { buildInvoicePdf };
