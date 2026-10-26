import React from 'react';
import { ArrowUpRight, Mail, Users } from 'lucide-react';
import { Empty } from '../components/ui';
import { formatDate } from '../lib/api';
export const Employees = ({ employees }) => <><div className="page-heading"><div><div className="eyebrow">COMPANY CONTEXT</div><h1>Employee directory</h1><p>Only this company's people are visible to the worker.</p></div></div>
  <div className="employee-grid">{employees.map((e) => <div className="employee-card" key={e._id}><div className="employee-avatar">{e.name.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div><div><strong>{e.name}</strong><span>{e.title}</span><small>{e.department}</small></div><a href={`mailto:${e.workEmail}`}><ArrowUpRight size={15} /></a><div className="employee-email">{e.workEmail}</div></div>)}</div>{!employees.length && <Empty icon={Users} title="No entries" text="Nothing here yet." />}</>;
export const Outbox = ({ messages }) => <><div className="page-heading"><div><div className="eyebrow">SIMULATED EMAIL</div><h1>Outbox</h1><p>Messages the worker sent on your behalf (nothing leaves this app).</p></div></div>
  {messages.length ? <div className="outbox">{messages.map((m) => <div className="mail" key={m._id}><div className="mail-head"><strong>{m.subject}</strong><small>{formatDate(m.createdAt)}</small></div><div className="muted-small">To: {m.to} &lt;{m.toEmail}&gt;</div><pre>{m.body}</pre></div>)}</div> : <Empty icon={Mail} title="No messages sent" text={'Try: "Register the latest Blue Harbor invoice and email Priya Sharma once it is done."'} />}</>;
