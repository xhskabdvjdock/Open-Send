'use client';

import { useT } from '@/lib/i18n';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useT();
  return (
    <div className="center-wrap">
      <div className="card" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 44, margin: '0 0 6px' }}>500</h1>
        <h2>{t('errTitle')}</h2>
        <p className="muted small">{error?.message || t('errFailed')}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={reset}>{t('retry')}</button>
          <a className="btn" href="/">{t('home')}</a>
        </div>
      </div>
    </div>
  );
}
