// Deterministic invoice field extraction: works with no AI key and is also used to cross-check AI output.
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const iso = d => (d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : undefined);
function parseDate(s) {
  if (!s) return undefined; s = String(s).trim().replace(/(\d)(st|nd|rd|th)\b/i, '$1');
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/); if (m) return iso(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/); if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return iso(new Date(Date.UTC(y, +m[2] - 1, +m[1]))); } // dd/mm/yyyy
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/); if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) return iso(new Date(Date.UTC(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1])));
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/); if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined) return iso(new Date(Date.UTC(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2])));
  return undefined;
}
const DATE_RX = '(\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}|\\d{1,2}(?:st|nd|rd|th)?\\s+[A-Za-z]{3,9}\\.?,?\\s+\\d{4}|[A-Za-z]{3,9}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})';
const CUR = [[/\bUSD\b|US\$|\$/, 'USD'], [/\bEUR\b|€/, 'EUR'], [/\bGBP\b|£/, 'GBP'], [/\bINR\b|₹|\bRs\.?(?=\s|\d)/i, 'INR'], [/\bAUD\b/, 'AUD'], [/\bCAD\b/, 'CAD'], [/\bSGD\b/, 'SGD'], [/\bAED\b/, 'AED'], [/\bJPY\b|¥/, 'JPY']];
const detectCurrency = s => { for (const [rx, c] of CUR) if (rx.test(s)) return c; return undefined; };
const num = s => { const n = Number(String(s).replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : undefined; };

function heuristicExtract(text) {
  const raw = String(text || '');
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const flat = lines.join(' \n ');
  const one = re => { const m = flat.match(re); return m ? m[1].trim() : undefined; };
  const out = {};
  out.invoiceNumber = one(/invoice\s*(?:no\.?|number|num|#)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9/_-]{1,40})/i) || one(/\b((?:INV|BILL|BH|OCS)[-/]?\d[\w/-]{1,30})\b/);
  if (out.invoiceNumber && /^(date|from|to|due|total)$/i.test(out.invoiceNumber)) out.invoiceNumber = undefined;
  // supplier: labelled line, else first meaningful line
  let supplier = one(/(?:^|\n)\s*(?:from|supplier|vendor|bill\s*from|seller|issued\s*by)\s*[:\-]\s*([^\n]{2,80})/i);
  if (!supplier) supplier = lines.find(l => !/^(tax\s*)?invoice\b|^page\b|^\d/i.test(l) && /[A-Za-z]{3,}/.test(l) && l.length < 70 && !/:/.test(l));
  if (supplier) out.supplier = supplier.replace(/\s{2,}.*/, '').replace(/[,;]\s*$/, '').trim();
  out.customer = one(/(?:bill\s*to|billed\s*to|customer|client|sold\s*to)\s*[:\-]\s*([^\n]{2,80})/i);
  out.issueDate = parseDate(one(new RegExp('(?:invoice\\s*date|issue\\s*date|date\\s*of\\s*issue|dated?)\\s*[:\\-]?\\s*' + DATE_RX, 'i')));
  out.dueDate = parseDate(one(new RegExp('(?:due\\s*date|payment\\s*due(?:\\s*date)?|pay\\s*by|due\\s*on)\\s*[:\\-]?\\s*' + DATE_RX, 'i')));
  if (!out.dueDate && out.issueDate) { const net = one(/\bnet\s*(\d{1,3})\b/i); if (net) { const d = new Date(out.issueDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + Number(net)); out.dueDate = iso(d); } }
  // amount: prefer explicitly "due/grand/total amount" labels; take the last labelled match, ignoring subtotal/tax lines
  const amtRx = /(?:^|\n)\s*(amount\s*due|balance\s*due|grand\s*total|total\s*(?:amount|due|payable)?|total\s*invoice\s*amount)\s*[:\-]?\s*([A-Z]{3}|US\$|[$€£₹¥]|Rs\.?)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi;
  let best; let m;
  while ((m = amtRx.exec(flat))) { const label = m[1].toLowerCase(); const v = num(m[3]); if (v === undefined) continue; const rank = /due|grand|payable|invoice/.test(label) ? 2 : 1; if (!best || rank >= best.rank) best = { v, rank, cur: m[2] }; }
  if (best) { out.amount = best.v; out.currency = detectCurrency(best.cur || '') || undefined; }
  out.currency = out.currency || detectCurrency(flat);
  const tax = one(/(?:tax|gst|vat)(?:\s*\(?\d+%?\)?)?\s*[:\-]?\s*(?:[A-Z]{3}|[$€£₹])?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
  if (tax) out.taxAmount = num(tax);
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === '') delete out[k];
  return out;
}
const REQUIRED = ['invoiceNumber', 'supplier', 'amount', 'currency'];
const missingRequired = f => REQUIRED.filter(k => f?.[k] === undefined || f?.[k] === null || f?.[k] === '');
module.exports = { heuristicExtract, parseDate, detectCurrency, REQUIRED, missingRequired };
