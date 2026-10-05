'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogIn, SendHorizonal } from 'lucide-react';
import { useT } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const { t, te } = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ? te(j.error) : t('errFailed'));
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError(t('errOffline'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-wrap">
      <div className="card">
        <div className="logo-big"><SendHorizonal size={28} /></div>
        <h2 style={{ margin: '0 0 4px' }}>{t('loginTitle')}</h2>
        <p className="muted small" style={{ marginTop: 0 }}>{t('loginSub')}</p>
        {error && <p className="error-box">{error}</p>}
        <form onSubmit={submit}>
          <label className="lbl" htmlFor="u">{t('username')}</label>
          <input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <label className="lbl" htmlFor="p">{t('password')}</label>
          <input id="p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="btn btn-primary btn-block mt" disabled={busy}>
            {busy ? <span className="spinner" /> : <LogIn size={17} />} {t('Login')}
          </button>
        </form>
        <p className="small mt">
          <Link href="/register">{t('register')}</Link>
        </p>
        <p className="muted small mt" style={{ textAlign: 'center' }}>
          Open Send · {t('netLocalNet')} · <span dir="ltr">btec-send.local</span>
        </p>
      </div>
    </div>
  );
}
