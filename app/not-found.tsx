'use client';

import { useT } from '@/lib/i18n';

export default function NotFound() {
  const { t } = useT();
  return (
    <div className="center-wrap">
      <div className="card" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 52, margin: '0 0 6px' }}>404</h1>
        <h2>{t('nfTitle')}</h2>
        <p className="muted">{t('nfSub')}</p>
        <a className="btn btn-primary" href="/">{t('home')}</a>
      </div>
    </div>
  );
}
