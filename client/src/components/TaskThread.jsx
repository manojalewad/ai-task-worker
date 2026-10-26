import React, { useState, useEffect } from 'react';
import { Activity, Bot, Check, CheckCircle2, CircleDot, FileUp, RefreshCw, RotateCcw, Send, ShieldQuestion, Sparkles, StopCircle, User, X, XCircle, MinusCircle } from 'lucide-react';
import { api, formatTime, statusLabel, statusTone, useTask } from '../lib/api';
import { Badge, Spinner } from './ui';

function PlanList({ plan, status }) {
  if (!plan?.length) return null;
  const icon = (s) => s === 'done' ? <CheckCircle2 size={16} className="ok" /> : s === 'failed' ? <XCircle size={16} className="bad" /> : s === 'active' ? <Spinner small /> : s === 'blocked' ? <CircleDot size={16} className="warn" /> : <MinusCircle size={16} className="dim" />;
  return <div className="plan-card"><div className="mini-title">PLAN</div>{plan.map((s) => <div key={s.id} className={`plan-row plan-${s.status}`}>{icon(s.status === 'active' && !['running', 'queued'].includes(status) ? 'pending' : s.status)}<span>{s.title}</span></div>)}</div>;
}

function Verification({ v }) {
  if (!v) return null;
  return <div className={`verify-card ${v.passed ? 'verify-ok' : 'verify-bad'}`}><div className="verify-head">{v.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}<strong>{v.passed ? 'Independently verified' : 'Verification failed'}</strong><span>{v.reason}</span></div>
    {v.checks?.length > 0 && <table className="verify-table"><thead><tr><th>Field</th><th>Source invoice</th><th>Finance system</th><th /></tr></thead><tbody>{v.checks.map((c) => <tr key={c.field}><td>{c.field}</td><td>{String(c.expected ?? '—')}</td><td>{String(c.actual ?? '—')}</td><td>{c.ok ? <Check size={14} className="ok" /> : <X size={14} className="bad" />}</td></tr>)}</tbody></table>}</div>;
}

function Question({ task, onDone, setNotice }) {
  const p = task.pending; const [vals, setVals] = useState({}); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { setVals(Object.fromEntries((p.fields || []).map((f) => [f.key, f.type === 'date' && f.value ? String(f.value).slice(0, 10) : (f.value ?? '')]))); setText(''); }, [task._id, p.question]); // eslint-disable-line
  const send = async (body) => { setBusy(true); try { await api(`/tasks/${task._id}/reply`, { method: 'POST', body: JSON.stringify(body) }); setText(''); onDone(); } catch (e) { setNotice({ type: 'error', text: e.message }); } finally { setBusy(false); } };
  const upload = async (file) => { if (!file) return; setBusy(true); try { const fd = new FormData(); fd.append('file', file); const d = await api('/invoices/upload', { method: 'POST', body: fd }); await api(`/tasks/${task._id}/reply`, { method: 'POST', body: JSON.stringify({ documentId: d.document._id, message: `Uploaded ${file.name}` }) }); onDone(); } catch (e) { setNotice({ type: 'error', text: e.message }); } finally { setBusy(false); } };
  const filled = (p.fields || []).filter((f) => String(vals[f.key] ?? '').trim() !== '');
  return <div className="q-card"><div className="q-head"><span className="q-icon"><Sparkles size={15} /></span><div><div className="mini-title">THE WORKER NEEDS YOUR INPUT</div><p>{p.question}</p></div></div>
    {p.expects === 'fields' && p.fields?.length > 0 && <div className="q-fields">{p.fields.map((f) => <label key={f.key}>{f.label}<input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} step="any" value={vals[f.key] ?? ''} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} placeholder={f.label} /></label>)}
      <button className="button button-primary" disabled={busy || !filled.length} onClick={() => send({ fields: Object.fromEntries(filled.map((f) => [f.key, vals[f.key]])) })}>{busy ? <Spinner small /> : <Check size={15} />} Save &amp; continue</button></div>}
    {p.expects === 'choice' && p.options?.length > 0 && <div className="q-options">{p.options.map((o, i) => <button key={i} className="option-btn" disabled={busy} onClick={() => send({ documentId: o.documentId, message: o.label })}>{o.label}</button>)}</div>}
    {p.expects === 'upload' && <div className="q-upload"><label className="button button-light"><FileUp size={15} /> Upload the PDF<input type="file" accept="application/pdf,.pdf" hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} /></label>{p.suggestions?.length > 0 && <span className="muted-small">or pick a supplier: {p.suggestions.map((s) => <button key={s} className="chip" disabled={busy} onClick={() => send({ message: s })}>{s}</button>)}</span>}</div>}
    <div className="q-reply"><input value={text} placeholder={p.expects === 'fields' ? 'Or just type it, e.g. “amount is USD 1,440”' : 'Type your answer…'} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) send({ message: text.trim() }); }} /><button className="button button-light" disabled={busy || !text.trim()} onClick={() => send({ message: text.trim() })}><Send size={14} /> Reply</button><button className="button button-ghost" disabled={busy} onClick={() => send({ message: 'cancel' })}>Cancel task</button></div></div>;
}

export default function TaskThread({ id, role, onChange, setNotice }) {
  const { task, logs, error, bump } = useTask(id, onChange);
  const [busy, setBusy] = useState(false);
  if (error && !task) return <div className="alert alert-error">{error}</div>;
  if (!task) return <div className="empty-inline"><Spinner /> Loading task…</div>;
  const act = async (path, body) => { setBusy(true); try { await api(`/tasks/${task._id}/${path}`, { method: 'POST', body: JSON.stringify(body || {}) }); bump(); onChange?.(); } catch (e) { setNotice({ type: 'error', text: e.message }); } finally { setBusy(false); } };
  const live = ['queued', 'running', 'verifying'].includes(task.status);
  const result = task.result; const evidence = Array.isArray(result?.evidence) ? result.evidence : [];
  return <section className="thread">
    <div className="thread-head"><div><div className="eyebrow">TASK</div><h3>{task.request}</h3></div>
      <div className="detail-actions"><Badge tone={statusTone(task.status)}>{live && <Spinner small />} {statusLabel(task.status)}</Badge>
        {task.decider && <Badge tone="purple">{task.decider === 'llm' ? 'AI planner' : task.decider === 'rules' ? 'Rules planner' : 'AI → rules fallback'}</Badge>}
        {live && <button className="button button-light button-small" disabled={busy} onClick={() => act('cancel')}><StopCircle size={13} /> Stop</button>}
        {task.status === 'failed' && <button className="button button-primary button-small" disabled={busy} onClick={() => act('retry')}><RotateCcw size={13} /> Continue / retry</button>}
        <button className="icon-button" onClick={bump} title="Refresh"><RefreshCw size={15} /></button></div></div>

    <PlanList plan={task.plan} status={task.status} />

    <div className="messages">{(task.messages || []).map((m, i) => <div key={i} className={`msg msg-${m.role}`}><span className="msg-avatar">{m.role === 'user' ? <User size={14} /> : m.role === 'agent' ? <Bot size={14} /> : <ShieldQuestion size={14} />}</span><div className="msg-body"><div className="msg-meta">{m.role === 'user' ? 'You' : m.role === 'agent' ? 'Worker' : 'System'} · {formatTime(m.at)}</div><p>{m.text}</p></div></div>)}
      {live && <div className="msg msg-agent"><span className="msg-avatar"><Bot size={14} /></span><div className="msg-body typing"><Spinner small /> Working… {logs.at(-1)?.summary ? <em>{logs.at(-1).summary}</em> : null}</div></div>}</div>

    {task.status === 'needs_input' && task.pending?.kind === 'question' && <Question task={task} onDone={() => { bump(); onChange?.(); }} setNotice={setNotice} />}
    {task.status === 'waiting_for_approval' && <div className="q-card approval"><div className="q-head"><span className="q-icon"><ShieldQuestion size={15} /></span><div><div className="mini-title">APPROVAL REQUIRED</div><p>{task.pending?.message || 'Company policy requires approval before this action.'}</p><code className="args">{task.pending?.tool}({JSON.stringify(task.pending?.args)})</code></div></div>
      {role === 'admin' ? <div className="q-reply"><button className="button button-primary" disabled={busy} onClick={() => act('approve')}><Check size={15} /> Approve &amp; resume</button><button className="button button-light" disabled={busy} onClick={() => act('reject')}>Reject</button></div> : <p className="muted-small">An administrator needs to approve this. You'll see it continue automatically.</p>}</div>}

    {['completed', 'failed'].includes(task.status) && result?.verification && <Verification v={result.verification} />}
    {result?.summary && task.status === 'completed' && <div className="summary-strip"><span><b>{result.summary.steps}</b> tool calls</span><span><b>{result.summary.retries}</b> retries</span><span>tools: {result.summary.toolsUsed.join(', ') || '—'}</span></div>}
    {evidence.length > 0 && <details className="evidence"><summary>Evidence ({evidence.length})</summary><pre>{JSON.stringify(evidence, null, 2)}</pre></details>}

    <div className="timeline-heading"><h4><Activity size={13} /> Execution timeline</h4><span>{logs.length} events</span></div>
    {logs.length ? <div className="timeline">{logs.map((l, i) => <div className="timeline-item" key={l._id || i}><span className={`timeline-dot ${['error', 'failed'].includes(l.status) ? 'dot-error' : ['warning', 'waiting', 'needs_input'].includes(l.status) ? 'dot-warn' : ['success', 'completed', 'approved'].includes(l.status) ? 'dot-success' : ''}`}>{['success', 'completed', 'approved'].includes(l.status) ? <Check size={12} /> : <Activity size={12} />}</span>
      <div className="timeline-content"><div><strong>{(l.toolName && ['tool_start', 'tool_result'].includes(l.action) ? `${l.toolName} · ${l.action === 'tool_start' ? 'call' : 'result'}` : l.action).replaceAll('_', ' ')}</strong><small>{formatTime(l.createdAt)}{l.durationMs ? ` · ${l.durationMs}ms` : ''}</small></div><p>{l.summary}</p>{l.errorCode && <Badge tone="red">{l.errorCode}</Badge>}</div></div>)}</div> : <div className="empty-inline">Waiting for the first event…</div>}
  </section>;
}
