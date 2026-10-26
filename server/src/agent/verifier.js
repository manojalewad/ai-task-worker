// Independent verification: compares what the finance system now holds against the source invoice. The agent's own claims are never trusted.
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const day = v => (v ? new Date(v).toISOString().slice(0, 10) : '');
function verifyBill(sourceFields = {}, bill) {
  if (!bill) return { passed: false, checks: [], reason: 'The bill could not be read back from the finance system.', verifiedAt: new Date() };
  const checks = [
    { field: 'invoiceNumber', expected: sourceFields.invoiceNumber, actual: bill.invoiceNumber, ok: same(sourceFields.invoiceNumber, bill.invoiceNumber) },
    { field: 'supplier', expected: sourceFields.supplier, actual: bill.supplier, ok: same(sourceFields.supplier, bill.supplier) },
    { field: 'amount', expected: sourceFields.amount, actual: bill.amount, ok: Math.abs(Number(sourceFields.amount) - Number(bill.amount)) < 0.005 },
    { field: 'currency', expected: sourceFields.currency, actual: bill.currency, ok: same(sourceFields.currency, bill.currency) }
  ];
  if (sourceFields.dueDate) checks.push({ field: 'dueDate', expected: day(sourceFields.dueDate), actual: day(bill.dueDate), ok: day(sourceFields.dueDate) === day(bill.dueDate) });
  if (sourceFields.issueDate) checks.push({ field: 'issueDate', expected: day(sourceFields.issueDate), actual: day(bill.issueDate), ok: day(sourceFields.issueDate) === day(bill.issueDate) });
  const passed = checks.every(c => c.ok);
  return { passed, checks, billId: bill.id, reason: passed ? 'All fields in the finance system match the source invoice.' : 'Mismatch: ' + checks.filter(c => !c.ok).map(c => c.field).join(', '), verifiedAt: new Date() };
}
module.exports = { verifyBill };
