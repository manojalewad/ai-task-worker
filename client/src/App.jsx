import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Banknote, Bot, Building2, FileText, LayoutDashboard, LogOut, Mail, RefreshCw, Settings as Cog, ShieldCheck, Users, X } from 'lucide-react';
import { api } from './lib/api';
import Login from './components/Login';
import Overview from './pages/Overview';
import Tasks from './pages/Tasks';
import Invoices from './pages/Invoices';
import Finance from './pages/Finance';
import Settings from './pages/Settings';
import { Employees, Outbox } from './pages/Lists';

export default function App() {
  const [session, setSession] = useState(null); const [booting, setBooting] = useState(Boolean(localStorage.getItem('caw_token')));
  const [view, setView] = useState('overview'); const [notice, setNotice] = useState(null); const [selectedId, setSelectedId] = useState(null);
  const [d, setD] = useState({ overview: null, invoices: [], tasks: [], employees: [], bills: null, outbox: [], policies: [], agent: null });
  const [query, setQuery] = useState(''); const [uploading, setUploading] = useState(false); const [loading, setLoading] = useState(false);
  const merge = (p) => setD((x) => ({ ...x, ...p }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [overview, tasks, invoices, employees, bills, outbox, policies, agent] = await Promise.all([api('/company/overview'), api('/tasks'), api(`/invoices?search=${encodeURIComponent(query)}`), api('/company/employees'), api('/company/bills'), api('/company/outbox'), api('/company/policies'), api('/company/agent')]);
      merge({ overview, tasks: tasks.tasks, invoices: invoices.documents, employees: employees.employees, bills, outbox: outbox.messages, policies: policies.policies, agent });
    } catch (e) { setNotice({ type: 'error', text: e.message }); } finally { setLoading(false); }
  }, [query]);
  const reloadTasks = useCallback(async () => { try { const [t, o] = await Promise.all([api('/tasks'), api('/company/overview')]); merge({ tasks: t.tasks, overview: o }); } catch { /* ignore */ } }, []);
  const reloadAfterWork = useCallback(async () => { await load(); }, [load]);

  useEffect(() => { const out = () => { setSession(null); }; window.addEventListener('caw-logout', out); return () => window.removeEventListener('caw-logout', out); }, []);
  useEffect(() => { if (localStorage.getItem('caw_token')) api('/auth/me').then(setSession).catch(() => {}).finally(() => setBooting(false)); else setBooting(false); }, []);
  useEffect(() => { if (session) load(); }, [session, load]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 7000); return () => clearTimeout(t); }, [notice]);
  // keep the task list fresh while anything is running or waiting
  useEffect(() => { if (!session) return; const busy = d.tasks.some((t) => ['queued', 'running', 'needs_input', 'waiting_for_approval'].includes(t.status)); if (!busy) return; const id = setInterval(() => { reloadTasks(); }, 3000); return () => clearInterval(id); }, [session, d.tasks, reloadTasks]);
  // when a task finishes, refresh the data it may have changed
  const finishedKey = d.tasks.filter((t) => t.status === 'completed').length;
  useEffect(() => { if (session) { api('/company/bills').then((b) => merge({ bills: b })).catch(() => {}); api(`/invoices?search=${encodeURIComponent(query)}`).then((i) => merge({ invoices: i.documents })).catch(() => {}); api('/company/outbox').then((o) => merge({ outbox: o.messages })).catch(() => {}); } }, [finishedKey]); // eslint-disable-line

  const openTask = (id) => { setSelectedId(id); setView('tasks'); };
  const logout = () => { localStorage.removeItem('caw_token'); setSession(null); setD({ overview: null, invoices: [], tasks: [], employees: [], bills: null, outbox: [], policies: [], agent: null }); };
  const uploadFile = async (file) => {
    if (!file) return; setUploading(true);
    try { const fd = new FormData(); fd.append('file', file); const r = await api('/invoices/upload', { method: 'POST', body: fd }); setNotice({ type: r.duplicate ? 'info' : 'success', text: r.message }); await load(); } catch (e) { setNotice({ type: 'error', text: e.message }); } finally { setUploading(false); }
  };
  const askAbout = async (doc) => {
    const text = doc.registered ? `Tell me the details and finance status of invoice ${doc.extractedFields?.invoiceNumber || doc.fileName}.` : `Register invoice ${doc.extractedFields?.invoiceNumber || doc.fileName} from ${doc.extractedFields?.supplier || 'this supplier'} in the finance system and verify it.`;
    try { const r = await api('/tasks', { method: 'POST', body: JSON.stringify({ request: text, documentId: doc._id }) }); openTask(r.task._id); reloadTasks(); } catch (e) { setNotice({ type: 'error', text: e.message }); }
  };

  if (booting) return <div className="empty-inline" style={{ padding: 60 }}>Loading…</div>;
  if (!session) return <Login onLogin={setSession} />;
  const company = session.activeCompany || { name: 'Workspace', role: 'employee' }; const role = company.role;
  const attention = d.tasks.filter((t) => ['needs_input', 'waiting_for_approval'].includes(t.status)).length; const running = d.tasks.some((t) => ['queued', 'running'].includes(t.status));
  const nav = [{ id: 'overview', label: 'Overview', icon: LayoutDashboard }, { id: 'tasks', label: 'Tasks', icon: Activity, badge: attention || null }, { id: 'invoices', label: 'Invoices', icon: FileText }, { id: 'finance', label: 'Finance system', icon: Banknote }, { id: 'employees', label: 'Employees', icon: Users }, { id: 'outbox', label: 'Outbox', icon: Mail }, { id: 'settings', label: 'Policies & agent', icon: Cog }];
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><Bot size={21} /></span><span>alignwork<span className="brand-dot">.</span></span></div>
    <div className="workspace-switch"><span className="workspace-icon"><Building2 size={17} /></span><span className="workspace-copy"><strong>{company.name}</strong><small>{role} workspace</small></span></div>
    <div className="side-label">WORKSPACE</div><nav>{nav.map((n) => <button key={n.id} className={`nav-item ${view === n.id ? 'active' : ''}`} onClick={() => setView(n.id)}><n.icon size={17} /><span>{n.label}</span>{n.badge ? <b className="nav-count">{n.badge}</b> : n.id === 'tasks' && running ? <i className="nav-live" /> : null}</button>)}</nav>
    <div className="sidebar-bottom"><div className="security-note"><ShieldCheck size={18} /><div><strong>Private by design</strong><span>Company-scoped access, audited actions</span></div></div>
      <div className="profile-row"><div className="avatar">{(session.user?.name || 'U').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()}</div><div className="profile-info"><strong>{session.user?.name}</strong><small>{session.user?.email}</small></div><button className="icon-button" title="Sign out" onClick={logout}><LogOut size={16} /></button></div></div></aside>
    <main className="main-panel"><header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{nav.find((n) => n.id === view)?.label}</strong></div><div className="top-actions"><span className="live-status"><i /> {d.agent?.planner?.mode === 'llm' ? 'AI planner ready' : 'Rules planner ready'}</span><button className="icon-button" title="Refresh" onClick={load}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button></div></header>
      <div className="page-content">{notice && <div className={`toast toast-${notice.type}`}><span>{notice.text}</span><button onClick={() => setNotice(null)}><X size={15} /></button></div>}
        {view === 'overview' && <Overview overview={d.overview} company={company} onOpenTask={openTask} go={setView} setNotice={setNotice} />}
        {view === 'tasks' && <Tasks tasks={d.tasks} selectedId={selectedId} setSelectedId={setSelectedId} reload={reloadAfterWork} role={role} go={setView} setNotice={setNotice} />}
        {view === 'invoices' && <Invoices invoices={d.invoices} query={query} setQuery={setQuery} reload={load} uploadFile={uploadFile} uploading={uploading} askAbout={askAbout} setNotice={setNotice} />}
        {view === 'finance' && <Finance bills={d.bills} reload={load} />}
        {view === 'employees' && <Employees employees={d.employees} />}
        {view === 'outbox' && <Outbox messages={d.outbox} />}
        {view === 'settings' && <Settings policies={d.policies} agent={d.agent} role={role} reload={load} setNotice={setNotice} />}
      </div><footer className="app-footer"><span>ALIGNWORK <b>·</b> COMPANY AI WORKER</span><span><ShieldCheck size={13} /> Verified outcomes <i /> {d.agent?.planner?.mode === 'llm' ? `Gemini ${d.agent.planner.model}` : 'Deterministic planner'}</span></footer></main></div>;
}
