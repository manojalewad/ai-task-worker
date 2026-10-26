import React, { useRef, useState } from 'react';
import { Bot, FileText, MessageSquareText, Paperclip, Send, UploadCloud, X } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Spinner } from './ui';
export default function Composer({ onCreated, setNotice, prefill }) {
  const [request, setRequest] = useState(prefill?.text || ''); const [doc, setDoc] = useState(prefill?.doc || null); const [busy, setBusy] = useState(false); const [up, setUp] = useState(false); const [drag, setDrag] = useState(false); const ref = useRef();
  const upload = async (file) => {
    if (!file) return; if (!/pdf$/i.test(file.name)) return setNotice({ type: 'error', text: 'Please choose a PDF file.' });
    setUp(true); try { const fd = new FormData(); fd.append('file', file); const d = await api('/invoices/upload', { method: 'POST', body: fd }); setDoc(d.document); if (!request.trim()) setRequest('Process the invoice I just uploaded and register it in the finance system.'); setNotice({ type: d.duplicate ? 'info' : 'success', text: d.message }); } catch (e) { setNotice({ type: 'error', text: e.message }); } finally { setUp(false); }
  };
  const run = async () => { if (!request.trim()) return; setBusy(true); try { const d = await api('/tasks', { method: 'POST', body: JSON.stringify({ request: request.trim(), ...(doc ? { documentId: doc._id } : {}) }) }); setRequest(''); setDoc(null); onCreated(d.task._id); } catch (e) { setNotice({ type: 'error', text: e.message }); } finally { setBusy(false); } };
  return <section className={`composer-card ${drag ? 'drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files?.[0]); }}>
    <div className="composer-top"><div className="composer-icon"><MessageSquareText size={18} /></div><div><strong>Describe the outcome you want</strong><span>Drop a PDF anywhere on this card to attach it</span></div><Badge>Natural language</Badge></div>
    <textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={3} placeholder="e.g. Find the latest invoice from Northstar Supplies, extract the amount and due date, enter it in the finance system and tell me when it's done." onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } }} />
    {doc && <div className="attached"><FileText size={14} /> <b>{doc.fileName}</b> <span>{doc.extractedFields?.supplier || 'supplier unknown'} · {doc.extractedFields?.invoiceNumber || 'no number'}</span><button onClick={() => setDoc(null)}><X size={13} /></button></div>}
    <div className="composer-bottom"><div className="composer-attach"><label className="attach-button">{up ? <Spinner small /> : <Paperclip size={15} />} {up ? 'Reading PDF…' : 'Attach invoice PDF'}<input ref={ref} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} /></label><span className="hint">Enter to run · Shift+Enter for a new line</span></div>
      <button className="button button-primary" disabled={busy || !request.trim()} onClick={run}>{busy ? <Spinner small /> : <Send size={15} />} Run task</button></div></section>;
}
