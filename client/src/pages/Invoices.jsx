import React, { useState } from 'react';
import { Eye, FileText, Pencil, RefreshCw, Search, Sparkles, UploadCloud, X } from 'lucide-react';
import { api, formatDate, money, openPdf } from '../lib/api';
import { Badge, Empty, Spinner } from '../components/ui';
function EditModal({ doc, onClose, onSaved, setNotice }) {
  const f = doc.extractedFields || {}; const [v, setV] = useState({ invoiceNumber: f.invoiceNumber || '', supplier: f.supplier || '', amount: f.amount ?? '', currency: f.currency || '', issueDate: f.issueDate ? f.issueDate.slice(0, 10) : '', dueDate: f.dueDate ? f.dueDate.slice(0, 10) : '' }); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { const body = Object.fromEntries(Object.entries(v).filter(([, x]) => String(x).trim() !== '')); await api(`/invoices/${doc._id}/fields`, { method: 'PATCH', body: JSON.stringify(body) }); setNotice({ type: 'success', text: 'Fields updated.' }); onSaved(); onClose(); } catch (e) { setNotice({ type: 'error', text: e.message }); } finally { setBusy(false); } };
  const L = { invoiceNumber: 'Invoice number', supplier: 'Supplier', amount: 'Amount', currency: 'Currency', issueDate: 'Issue date', dueDate: 'Due date' };
  return <div className="modal-back" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}><div className="modal-head"><h3>Edit extracted fields</h3><button className="icon-button" onClick={onClose}><X size={16} /></button></div><p className="muted-small">{doc.fileName}. Your edits are recorded as “user-provided”.</p>
    <div className="q-fields">{Object.keys(L).map((k) => <label key={k}>{L[k]}<input type={k.endsWith('Date') ? 'date' : k === 'amount' ? 'number' : 'text'} step="any" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>)}</div>
    <div className="modal-actions"><button className="button button-light" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy} onClick={save}>{busy ? <Spinner small /> : null} Save</button></div></div></div>;
}
export default function Invoices({ invoices, query, setQuery, reload, uploadFile, uploading, askAbout, setNotice }) {
  const [edit, setEdit] = useState(null); const [drag, setDrag] = useState(false);
  const open = async (id) => { try { await openPdf(id); } catch (e) { setNotice({ type: 'error', text: e.message }); } };
  return <>
    <div className="page-heading"><div><div className="eyebrow">COMPANY DOCUMENTS</div><h1>Invoice repository</h1><p>Upload PDFs, review what was extracted, or hand an invoice to the worker.</p></div><label className="button button-primary upload-cta">{uploading ? <Spinner small /> : <UploadCloud size={16} />} Upload invoice<input type="file" accept="application/pdf,.pdf" hidden disabled={uploading} onChange={(e) => { uploadFile(e.target.files?.[0]); e.target.value = ''; }} /></label></div>
    <div className={`dropzone ${drag ? 'drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); uploadFile(e.dataTransfer.files?.[0]); }}><UploadCloud size={18} /> Drop a PDF invoice here — text PDFs are parsed instantly{' '}<span>(scans need a Gemini key)</span></div>
    <div className="search-bar"><Search size={17} /><input placeholder="Search file name, invoice number, or supplier…" value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button onClick={() => setQuery('')}><X size={14} /></button>}</div>
    <div className="table-card"><div className="table-header"><div><h3>All invoices</h3><span>{invoices.length} document{invoices.length === 1 ? '' : 's'}</span></div><button className="icon-button" onClick={reload}><RefreshCw size={15} /></button></div>
      {invoices.length ? <div className="table-scroll"><table><thead><tr><th>Document</th><th>Supplier / invoice</th><th>Amount</th><th>Due</th><th>Status</th><th /></tr></thead><tbody>{invoices.map((d) => { const f = d.extractedFields || {}; return <tr key={d._id}>
        <td><div className="file-cell"><span className="pdf-icon"><FileText size={17} /></span><span><strong>{d.fileName}</strong><small>{formatDate(d.uploadDate)}</small></span></div></td>
        <td><strong>{f.supplier || 'Unknown supplier'}</strong><small className="table-sub">{f.invoiceNumber || 'Invoice number missing'}</small></td>
        <td className="amount-cell">{money(f.amount, f.currency)}</td><td>{formatDate(f.dueDate)}</td>
        <td><Badge tone={d.status === 'processed' ? 'green' : 'orange'}>{d.status.replace('_', ' ')}</Badge>{d.registered && <Badge tone="blue">in finance</Badge>}</td>
        <td><div className="row-actions"><button className="icon-button" title="View PDF" onClick={() => open(d._id)}><Eye size={15} /></button>{!d.registered && <button className="icon-button" title="Edit fields" onClick={() => setEdit(d)}><Pencil size={15} /></button>}<button className="button button-light button-small" onClick={() => askAbout(d)}><Sparkles size={12} /> {d.registered ? 'Ask AI' : 'Register with AI'}</button></div></td></tr>; })}</tbody></table></div>
        : <Empty icon={FileText} title="No invoices found" text="Upload a PDF invoice or try another search." />}</div>
    {edit && <EditModal doc={edit} onClose={() => setEdit(null)} onSaved={reload} setNotice={setNotice} />}</>;
}
