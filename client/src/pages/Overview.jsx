import React from 'react';
import { Activity, ArrowUpRight, Banknote, Clock3, FileCheck2, FileText, Users, AlertTriangle, ListChecks } from 'lucide-react';
import Composer from '../components/Composer';
import { Badge, Stat, TaskIcon } from '../components/ui';
import { formatDate, money, statusLabel, statusTone } from '../lib/api';
const EXAMPLES = [
  { icon: FileCheck2, tone: 'mint', title: 'Find → extract → register → verify', text: 'Find the latest invoice from Northstar Supplies, extract the amount and due date, enter it into our finance system and tell me once it is done.' },
  { icon: AlertTriangle, tone: 'peach', title: 'Needs your input (try it)', text: 'Process the latest invoice from Greenleaf Office Co and register it.' },
  { icon: ListChecks, tone: 'lilac', title: 'Overdue & unregistered', text: 'Which invoices are overdue and not yet registered in the finance system?' },
  { icon: Users, tone: 'lilac', title: 'Do it, then notify', text: 'Register the latest Blue Harbor Logistics invoice and email Priya Sharma once it is done.' },
  { icon: Clock3, tone: 'mint', title: 'Answer from the data', text: 'What are the amount and due date of invoice BH-8890?' },
  { icon: Users, tone: 'peach', title: 'Find a colleague', text: 'Who is the finance manager and what is their email?' }
];
export default function Overview({ overview, company, onOpenTask, go, setNotice }) {
  const s = overview?.stats; const [prefill, setPrefill] = React.useState({ text: '', k: 0 });
  return <>
    <div className="page-heading"><div><div className="eyebrow">YOUR COMPANY, IN MOTION</div><h1>Good work starts with a clear goal.</h1><p>Give the worker an outcome. It plans, acts, checks its own work and only interrupts you when it has to.</p></div><Badge tone="green"><span className="pulse-dot" /> Workspace connected</Badge></div>
    {s?.needsAttention > 0 && <button className="attention" onClick={() => go('tasks')}><AlertTriangle size={16} /> {s.needsAttention} task{s.needsAttention > 1 ? 's are' : ' is'} waiting for you <ArrowUpRight size={14} /></button>}
    <Composer key={prefill.k} prefill={prefill} onCreated={onOpenTask} setNotice={setNotice} />
    <div className="section-heading"><div><h3>Try these</h3><p>Click to load into the box — each exercises a different capability</p></div></div>
    <div className="suggestion-grid">{EXAMPLES.map((e) => <button key={e.title} className="suggestion-card" onClick={() => setPrefill({ text: e.text, k: prefill.k + 1 })}><span className={`suggestion-icon ${e.tone}`}><e.icon size={18} /></span><strong>{e.title}</strong><p>{e.text}</p><ArrowUpRight size={16} className="suggestion-arrow" /></button>)}</div>
    <div className="section-heading section-heading-spaced"><div><h3>Workspace snapshot</h3><p>{company.name}</p></div></div>
    <div className="stats-grid"><Stat icon={FileText} label="Invoices" value={s?.documents ?? '—'} tone="blue" onClick={() => go('invoices')} /><Stat icon={FileCheck2} label="Bills in finance system" value={s?.financeRecords ?? '—'} tone="green" onClick={() => go('finance')} /><Stat icon={Activity} label="Tasks" value={s?.tasks ?? '—'} tone="purple" onClick={() => go('tasks')} /><Stat icon={Banknote} label="Registered total" value={Object.entries(overview?.registeredTotals || {}).map(([c, v]) => money(v, c)).join(' · ') || '—'} tone="orange" onClick={() => go('finance')} /></div>
    <div className="table-card recent-card"><div className="table-header"><div><h3>Recent tasks</h3><span>Latest requests and outcomes</span></div></div>{overview?.recentTasks?.length ? overview.recentTasks.map((t) => <button className="recent-row" key={t._id} onClick={() => onOpenTask(t._id)}><span className={`mini-status status-${t.status}`}><TaskIcon status={t.status} /></span><span className="recent-main"><strong>{t.request}</strong><small>{formatDate(t.createdAt)}</small></span><Badge tone={statusTone(t.status)}>{statusLabel(t.status)}</Badge><ArrowUpRight size={15} /></button>) : <div className="empty-inline">Your tasks will appear here.</div>}</div>
  </>;
}
