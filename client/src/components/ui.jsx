import React from 'react';
import { LoaderCircle, CheckCircle2, X, MessageSquareText, ShieldQuestion } from 'lucide-react';
export const Badge = ({ children, tone = 'neutral' }) => <span className={`badge badge-${tone}`}>{children}</span>;
export const Spinner = ({ small = false }) => <LoaderCircle className="spin" size={small ? 15 : 19} />;
export const Empty = ({ icon: Icon, title, text, action }) => <div className="empty-state"><span className="empty-icon"><Icon size={24} /></span><strong>{title}</strong><p>{text}</p>{action}</div>;
export function TaskIcon({ status, size = 17 }) {
  if (status === 'completed') return <CheckCircle2 size={size} />;
  if (['running', 'queued', 'verifying'].includes(status)) return <LoaderCircle size={size} className="spin" />;
  if (['failed', 'cancelled'].includes(status)) return <X size={size} />;
  if (status === 'waiting_for_approval') return <ShieldQuestion size={size} />;
  return <MessageSquareText size={size} />;
}
export const Stat = ({ icon: Icon, label, value, tone, onClick }) => <button type="button" className="stat-card stat-click" onClick={onClick}><span className={`stat-icon ${tone}`}><Icon size={18} /></span><div><span>{label}</span><strong>{value}</strong></div></button>;
