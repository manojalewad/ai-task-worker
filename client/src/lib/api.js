import { useEffect, useRef, useState } from 'react';
const BASE = import.meta.env.VITE_API_BASE || '';
export async function api(path, options = {}) {
  const token = localStorage.getItem('caw_token');
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) };
  let response;
  try { response = await fetch(`${BASE}/api${path}`, { ...options, headers }); }
  catch { throw new Error('Cannot reach the server. Is the backend running?'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) { localStorage.removeItem('caw_token'); window.dispatchEvent(new Event('caw-logout')); }
    throw new Error(data?.error?.message || `Request failed (${response.status})`);
  }
  return data;
}
export async function openPdf(id) {
  const token = localStorage.getItem('caw_token');
  const r = await fetch(`${BASE}/api/invoices/${id}/file`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error('Could not open the PDF.');
  window.open(URL.createObjectURL(await r.blob()), '_blank', 'noopener');
}
export const ACTIVE = ['queued', 'running', 'verifying'];
export const PAUSED = ['needs_input', 'waiting_for_approval'];
export const formatDate = (v) => (v ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(v)) : '—');
export const formatTime = (v) => (v ? new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(new Date(v)) : '');
export const money = (amount, currency = '') => (amount === undefined || amount === null ? '—' : `${currency || ''} ${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim());
export const statusLabel = (s) => ({ needs_input: 'needs your input', waiting_for_approval: 'awaiting approval' }[s] || (s || '').replace('_', ' '));
export const statusTone = (s) => (s === 'completed' ? 'green' : ['failed', 'cancelled'].includes(s) ? 'red' : ACTIVE.includes(s) ? 'blue' : PAUSED.includes(s) ? 'orange' : 'neutral');

// Polls one task while it is running; stops when it pauses or finishes. `bump()` forces a refetch after the user acts.
export function useTask(id, onChange) {
  const [data, setData] = useState({ task: null, logs: [] }); const [err, setErr] = useState('');
  const timer = useRef(); const alive = useRef(true); const cb = useRef(onChange); cb.current = onChange;
  const load = async () => {
    if (!id) return;
    try { const d = await api(`/tasks/${id}`); if (!alive.current) return; setData(d); setErr(''); cb.current?.(d.task); if (ACTIVE.includes(d.task.status)) timer.current = setTimeout(load, 1100); }
    catch (e) { if (alive.current) setErr(e.message); }
  };
  useEffect(() => { alive.current = true; setData({ task: null, logs: [] }); clearTimeout(timer.current); load(); return () => { alive.current = false; clearTimeout(timer.current); }; }, [id]); // eslint-disable-line
  return { ...data, error: err, bump: () => { clearTimeout(timer.current); load(); } };
}
