import React, { useState } from 'react';
import { Activity, Plus, RefreshCw } from 'lucide-react';
import TaskThread from '../components/TaskThread';
import { Badge, Empty, TaskIcon } from '../components/ui';
import { formatDate, statusLabel, statusTone } from '../lib/api';
export default function Tasks({ tasks, selectedId, setSelectedId, reload, role, go, setNotice }) {
  const [filter, setFilter] = useState('all');
  const shown = tasks.filter((t) => filter === 'all' || (filter === 'attention' ? ['needs_input', 'waiting_for_approval'].includes(t.status) : t.status === filter));
  return <>
    <div className="page-heading"><div><div className="eyebrow">EXECUTION HISTORY</div><h1>Tasks</h1><p>Watch the worker plan, act and verify — and answer when it asks.</p></div><button className="button button-primary" onClick={() => go('overview')}><Plus size={16} /> New task</button></div>
    <div className="filter-row"><div className="filter-tabs">{['all', 'attention', 'running', 'completed', 'failed'].map((f) => <button key={f} className={filter === f ? 'selected' : ''} onClick={() => setFilter(f)}>{f === 'attention' ? 'needs me' : f}</button>)}</div><button className="icon-button" onClick={reload}><RefreshCw size={15} /></button></div>
    <div className="tasks-layout"><div className="task-list">{shown.length ? shown.map((t) => <button className={`task-row ${selectedId === t._id ? 'task-selected' : ''}`} key={t._id} onClick={() => setSelectedId(t._id)}><span className={`task-status-icon status-${t.status}`}><TaskIcon status={t.status} /></span><span className="task-row-main"><strong>{t.request}</strong><small>{formatDate(t.createdAt)} · {String(t.intent || '').replace('_', ' ')}</small></span><Badge tone={statusTone(t.status)}>{statusLabel(t.status)}</Badge></button>) : <Empty icon={Activity} title="No tasks here" text="Submit a task from the Overview page." />}</div>
      <div className="task-pane">{selectedId ? <TaskThread key={selectedId} id={selectedId} role={role} onChange={reload} setNotice={setNotice} /> : <Empty icon={Activity} title="Select a task" text="Pick a task to see its plan, conversation and evidence." />}</div></div></>;
}
