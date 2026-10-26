// Turns a free-text request into structured intent. Deliberately transparent (no model call) so behaviour is predictable and testable.
const STOP = new Set(['the', 'this', 'that', 'our', 'my', 'your', 'a', 'an', 'it', 'them', 'us', 'finance', 'internal', 'company', 'system', 'latest', 'last', 'recent', 'new']);
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const toks = s => norm(s).split(' ').filter(t => t.length > 1 && !['inc', 'ltd', 'llc', 'co', 'pvt', 'the', 'and'].includes(t));

const OUT_OF_SCOPE = /\b(write|generate|debug|implement|code|program|script)\b.{0,50}\b(python|javascript|typescript|c\+\+|java|golang|rust|sql|function|algorithm|leetcode)\b|\b(recipe|movie|song lyrics|poem|horoscope|dating|joke|weather|cricket score|stock price)\b|\b(hack|exploit|malware|password of)\b/i;

function matchSupplier(text, suppliers) {
  const tt = new Set(toks(text)); let best; let bestScore = 0;
  for (const s of suppliers) {
    const st = toks(s); if (!st.length) continue;
    const hit = st.filter(t => tt.has(t)).length;
    // all tokens, or the distinctive first token (>=4 chars) of the name
    const score = hit === st.length ? 2 + hit : (hit >= 1 && st[0].length >= 4 && tt.has(st[0]) ? 1 : 0);
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}
function parseRequest(text, { suppliers = [], employees = [] } = {}) {
  const orig = String(text || ''); const s = orig.toLowerCase(); const p = { raw: orig };
  p.outOfScope = OUT_OF_SCOPE.test(s);
  const invoiceWord = /\b(invoices?|bills?|billing|payables?|receipts?)\b/.test(s);
  p.invoiceNumber = (orig.match(/\b((?:INV|BILL|BH|OCS|GL|NS)[-/]?\d{2,}[\w-]*|[A-Z]{2,5}-\d{3,}[\w-]*)\b/) || [])[1];
  p.supplier = matchSupplier(orig, suppliers);
  if (!p.supplier) { const m = orig.match(/\b(?:from|by|of|for|supplier|vendor)\s+((?:[A-Z][\w&.'-]*)(?:\s+(?:[A-Z][\w&.'-]*|&)){0,3})/); if (m && !STOP.has(m[1].toLowerCase().split(' ')[0])) p.supplier = m[1].replace(/[.,]+$/, ''); }
  p.latest = /\b(latest|most recent|newest|last)\b/.test(s); p.oldest = /\b(oldest|earliest|first)\b/.test(s);
  p.recentUpload = /\b(just uploaded|recently uploaded|uploaded (?:today|just now|recently)|i uploaded|i just uploaded|attached|uploaded invoice)\b/.test(s);
  p.fields = []; for (const [k, rx] of Object.entries({ amount: /\b(amount|total|how much|value|price)\b/, dueDate: /\bdue( date)?\b|\bdeadline\b|pay by/, invoiceNumber: /\binvoice (number|no|#)\b/, supplier: /\b(supplier|vendor|who sent|from whom)\b/, issueDate: /\b(issue|invoice) date\b|\bdated\b/, currency: /\bcurrency\b/ })) if (rx.test(s)) p.fields.push(k);
  p.wantsStatus = /\b(status|already|registered|entered|in the (?:finance|system|erp)|exists?|paid)\b/.test(s) && !/\b(register|enter|add|create|process|book) (?:it|this|the|that|an?)\b/.test(s);
  const verbs = /\b(register|enter|add|create|record|book|log|post|input|submit|process|push|key in|put|save|file)\b/;
  const target = /\b(invoice|bill|finance|system|erp|ledger|records?|accounts?)\b/;
  const intoSystem = /\b(into|in|to|onto)\s+(?:the\s+|our\s+|my\s+)?(?:internal\s+|finance\s+|accounting\s+|company\s+|payables?\s+)*(?:system|erp|ledger|books|finance|accounts?|payables?)\b/.test(s);
  p.wantsRegister = !p.outOfScope && ((verbs.test(s) && target.test(s)) || (intoSystem && /\b(get|put|load|push|move|send|enter|add|post|book|log|record|register|process|key)\b/.test(s))) && !/\bhow (do|to|can)\b/.test(s) && !/\b(do not|don't|without) (register|enter|process)\b/.test(s);
  if (/\b(only|just) (?:tell|show|extract|read)\b/.test(s) && !/\b(register|enter)\b/.test(s)) p.wantsRegister = false;
  p.overdue = /\b(overdue|past due|late|unpaid)\b/.test(s); p.unregistered = /\b(not (?:yet )?(?:registered|entered|processed)|unregistered|unprocessed|pending|outstanding)\b/.test(s); p.needsReview = /\bneeds?[ _]review|incomplete|missing\b/.test(s);
  p.wantsList = invoiceWord && /\b(list|show|which|all|how many|any|every|total|sum|overdue|unpaid|pending|unregistered)\b/.test(s) && !p.invoiceNumber && !(p.latest && !/\ball\b/.test(s) && !p.overdue);
  p.wantsTotals = /\b(total|sum|how much|altogether)\b/.test(s) && p.wantsList;
  const emp = employees.find(e => s.includes(e.name.toLowerCase()) || (e.name.split(' ')[0].length > 3 && new RegExp(`\\b${e.name.split(' ')[0].toLowerCase()}\\b`).test(s)));
  const emailTo = (orig.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0];
  p.notify = /\b(email|e-mail|message|notify|inform|ping|send (?:a )?(?:note|summary|update))\b/.test(s) && Boolean(emp || emailTo) ? { name: emp?.name, email: emailTo || emp?.workEmail } : null;
  const empWords = /\b(employee|manager|colleague|who is|who's|email of|contact|department|reach|directory|head of|lead|director|specialist|teammate)\b/.test(s) || /\b(finance|operations|people|hr|sales|engineering)\s+(manager|lead|head|team|specialist)\b/.test(s);
  p.employeeQuery = empWords && !invoiceWord ? (emp?.name || (s.match(/\b((?:finance|operations|people|hr|sales|engineering|accounts?)(?:\s+(?:manager|lead|head|specialist|payable))?)\b/) || [])[1] || (orig.match(/(?:named?|for|of|is)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/) || [])[1]) : undefined;
  if (p.outOfScope) p.kind = 'out_of_scope';
  else if (p.employeeQuery && !p.wantsRegister) p.kind = 'employee';
  else if (p.wantsRegister) p.kind = 'register';
  else if (p.wantsList) p.kind = 'list';
  else if (invoiceWord || p.invoiceNumber || p.supplier || p.latest || p.fields.length) p.kind = 'invoice_info';
  else p.kind = 'unknown';
  return p;
}
const STAGES = {
  register: [['locate', 'Find the invoice'], ['read', 'Read and check the extracted fields'], ['dupcheck', 'Check the finance system for duplicates'], ['register', 'Register the bill in the finance system'], ['verify', 'Read it back and verify every field'], ['report', 'Report the outcome with evidence']],
  invoice_info: [['locate', 'Find the invoice'], ['read', 'Read its extracted details'], ['report', 'Answer with evidence']],
  list: [['search', 'Search the repository with the right filters'], ['report', 'Summarise the results']],
  employee: [['search', 'Search the employee directory'], ['report', 'Report the matches']],
  unknown: [['clarify', 'Work out what outcome is wanted'], ['report', 'Report the outcome']],
  out_of_scope: [['report', 'Decline politely']]
};
function stagesFor(parsed) {
  const base = (STAGES[parsed.kind] || STAGES.unknown).map(([id, title]) => ({ id, title, status: 'pending' }));
  if (parsed.kind === 'register' && parsed.notify) base.splice(base.length - 1, 0, { id: 'notify', title: `Notify ${parsed.notify.name || parsed.notify.email}`, status: 'pending' });
  return base;
}
module.exports = { parseRequest, stagesFor, matchSupplier, toks, norm };
