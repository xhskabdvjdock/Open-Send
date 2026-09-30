import React from 'react';

export function Empty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="empty-ic">{icon}</div>
      <div style={{ fontWeight: 800, color: 'var(--text)' }}>{title}</div>
      {hint && <div className="small mt" style={{ maxWidth: 420, marginInline: 'auto' }}>{hint}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="card" aria-busy="true">
      <div className="row">
        <span className="spinner dark" /> <b>{label}</b>
      </div>
      <div className="grid mt">
        <div className="skeleton" style={{ height: 54 }}>&nbsp;</div>
        <div className="skeleton" style={{ height: 54 }}>&nbsp;</div>
        <div className="skeleton" style={{ height: 54 }}>&nbsp;</div>
      </div>
    </div>
  );
}
