import React from 'react';
import { Banknote, RefreshCw } from 'lucide-react';
import { Badge, Empty } from '../components/ui';
import { formatDate, money } from '../lib/api';
export default function Finance({ bills, reload }) {
  return <><div className="page-heading"><div><div className="eyebrow">SIMULATED INTERNAL SYSTEM</div><h1>Finance system</h1><p>The records the worker creates. It has its own validation rules and can fail — the worker must handle that.</p></div></div>
    <div className="chips-row">{Object.entries(bills?.totalsByCurrency || {}).map(([c, v]) => <Badge key={c} tone="green">{money(v, c)}</Badge>)}</div>
    <div className="table-card"><div className="table-header"><div><h3>Registered bills</h3><span>{bills?.count || 0} record(s)</span></div><button className="icon-button" onClick={reload}><RefreshCw size={15} /></button></div>
      {bills?.bills?.length ? <div className="table-scroll"><table><thead><tr><th>Record</th><th>Supplier</th><th>Invoice</th><th>Amount</th><th>Due</th><th>Status</th><th>Created</th></tr></thead><tbody>{bills.bills.map((b) => <tr key={b.id}><td><code>{b.id.slice(-8)}</code></td><td><strong>{b.supplier}</strong></td><td>{b.invoiceNumber}</td><td className="amount-cell">{money(b.amount, b.currency)}</td><td>{formatDate(b.dueDate)}</td><td><Badge tone="green">{b.status}</Badge></td><td>{formatDate(b.createdAt)}</td></tr>)}</tbody></table></div> : <Empty icon={Banknote} title="Nothing registered yet" text="Ask the worker to register an invoice and it will appear here." />}</div></>;
}
