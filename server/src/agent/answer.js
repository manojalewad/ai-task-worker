const d = v => (v ? new Date(v).toISOString().slice(0, 10) : '—');
const money = (a, c) => (a === undefined || a === null ? '—' : `${c || ''} ${Number(a).toLocaleString('en-US', { maximumFractionDigits: 2 })}`.trim());
const LABEL = { invoiceNumber: 'invoice number', supplier: 'supplier', amount: 'amount', currency: 'currency', dueDate: 'due date', issueDate: 'issue date' };
function invoiceLine(i) { const f = i.fields || {}; return `${f.supplier || 'Unknown supplier'} · ${f.invoiceNumber || 'no number'} · ${money(f.amount, f.currency)} · due ${d(f.dueDate)}${i.registered ? ' · registered' : ''}`; }

function composeAnswer(state, parsed) {
  const f = state.facts; const inv = f.invoice; const x = inv?.fields || {};
  switch (parsed.kind) {
    case 'register': {
      if (!inv) return 'I could not complete the registration.';
      const v = f.verification;
      const head = f.billSource === 'created' ? `✅ Registered invoice ${x.invoiceNumber} from ${x.supplier} in the finance system.`
        : f.billSource === 'existing-other-document' ? `ℹ️ A bill for ${x.invoiceNumber} from ${x.supplier} already existed in the finance system (from a different document), so I did not create a duplicate.`
          : `ℹ️ Invoice ${x.invoiceNumber} from ${x.supplier} was already registered, so I did not create a duplicate.`;
      const body = [`• Amount: ${money(x.amount, x.currency)}`, `• Due date: ${d(x.dueDate)}`, `• Issue date: ${d(x.issueDate)}`, f.bill ? `• Finance record: ${f.bill.id}` : null].filter(Boolean).join('\n');
      const ver = v ? `\nVerification: ${v.passed ? 'passed' : 'FAILED'} — I read the bill back from the finance system and compared ${v.checks.length} fields. ${v.reason}` : '';
      const note = f.messageSent ? `\nNotification sent to ${f.messageSent.to} (${f.messageSent.toEmail}).` : '';
      const warn = (inv.confidence ?? 1) < 0.6 ? '\n⚠️ Extraction confidence was low; please spot-check the source PDF.' : '';
      return `${head}\n${body}${ver}${note}${warn}`;
    }
    case 'invoice_info': {
      if (!inv) { if (f.billLookupMiss) return `No invoice document or finance record matching ${f.billLookupMiss.invoiceNumber} was found.`; return 'I could not find a matching invoice.'; }
      const wanted = parsed.fields.length ? parsed.fields : ['supplier', 'invoiceNumber', 'amount', 'dueDate'];
      const rows = wanted.map(k => `• ${LABEL[k] ? LABEL[k][0].toUpperCase() + LABEL[k].slice(1) : k}: ${k === 'amount' ? money(x.amount, x.currency) : (k === 'dueDate' || k === 'issueDate') ? d(x[k]) : x[k] ?? '—'}`);
      return `Here is what the invoice from ${x.supplier || 'the supplier'} (${x.invoiceNumber || 'no number'}) says:\n${rows.join('\n')}\n\nFinance system: ${inv.registered ? `already registered (record ${inv.billId}).` : 'not registered yet.'}${inv.missingFields?.length ? `\n⚠️ Missing fields: ${inv.missingFields.join(', ')}.` : ''}`;
    }
    case 'list': {
      const l = f.list; if (!l || !l.count) return 'No invoices matched those filters.';
      const tot = Object.entries(l.totalsByCurrency || {}).map(([c, v]) => money(v, c)).join(' + ');
      return `Found ${l.count} invoice${l.count === 1 ? '' : 's'}${tot ? ` totalling ${tot}` : ''}:\n${l.invoices.map(i => '• ' + invoiceLine(i)).join('\n')}`;
    }
    case 'employee': {
      const e = f.employees || []; if (!e.length) return 'No matching employee was found in the directory.';
      return e.map(p => `• ${p.name} — ${p.title}, ${p.department} — ${p.workEmail}`).join('\n');
    }
    default: return 'Done.';
  }
}
const composeNotification = (state) => { const x = state.facts.invoice?.fields || {}; return { subject: `Invoice ${x.invoiceNumber} from ${x.supplier} ${state.facts.billSource === 'created' ? 'registered' : 'checked'}`, body: `Hi,\n\nInvoice ${x.invoiceNumber} from ${x.supplier} for ${money(x.amount, x.currency)} (due ${d(x.dueDate)}) has been ${state.facts.billSource === 'created' ? 'registered in the finance system' : 'found already registered'} and verified.\nFinance record: ${state.facts.bill?.id}\n\n— Alignwork AI worker` }; };
module.exports = { composeAnswer, composeNotification, invoiceLine, money, d, LABEL };
