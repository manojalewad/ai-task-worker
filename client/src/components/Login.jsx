import React, { useState } from 'react';
import { ArrowUpRight, Bot, CheckCircle2, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Spinner } from './ui';
export default function Login({ onLogin }) {
  const [form, setForm] = useState({ email: 'admin@acme.demo', password: 'DemoPass123!', companySlug: 'acme' }); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const submit = async (e) => { e.preventDefault(); setLoading(true); setError(''); try { const d = await api('/auth/login', { method: 'POST', body: JSON.stringify(form) }); localStorage.setItem('caw_token', d.token); onLogin(d); } catch (err) { setError(err.message); } finally { setLoading(false); } };
  const pick = (slug) => setForm({ email: `admin@${slug}.demo`, password: 'DemoPass123!', companySlug: slug });
  return <div className="login-shell"><div className="login-art"><div className="brand"><span className="brand-mark"><Bot size={22} /></span><span>alignwork<span className="brand-dot">.</span></span></div>
    <div className="art-copy"><Badge tone="violet">AUTONOMOUS TASK WORKER</Badge><h1>Tell it the outcome.<br /><em>It does the work.</em></h1><p>Finds the right document, uses the right tools, asks you only when it must, and proves the result by reading it back.</p>
      <div className="art-points"><span><CheckCircle2 size={16} /> Plans, acts, observes, adapts</span><span><CheckCircle2 size={16} /> Pauses for your input or approval — then resumes</span><span><CheckCircle2 size={16} /> Verifies every write independently</span></div></div><div className="art-footer">BUILT FOR WORK THAT ACTUALLY GETS DONE</div></div>
    <div className="login-panel"><form className="login-card" onSubmit={submit}><div className="eyebrow">WELCOME BACK</div><h2>Sign in to your workspace</h2><p className="muted">Use a demo account or your own.</p>
      {error && <div className="alert alert-error">{error}</div>}
      <label>Email address<input type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
      <label>Company workspace<select value={form.companySlug} onChange={(e) => pick(e.target.value)}><option value="acme">Acme Operations</option><option value="globex">Globex Services</option></select></label>
      <button className="button button-primary button-wide" disabled={loading}>{loading ? <><Spinner small /> Signing in…</> : <>Sign in <ArrowUpRight size={16} /></>}</button>
      <div className="demo-hint"><ShieldCheck size={16} /><div><strong>Demo credentials are pre-filled</strong><br />admin@acme.demo / DemoPass123!<br /><span>Switch to Globex to see tenant isolation.</span></div></div></form></div></div>;
}
