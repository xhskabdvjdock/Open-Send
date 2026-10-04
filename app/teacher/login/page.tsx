'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogIn, GraduationCap } from 'lucide-react';
import { useT } from '@/lib/i18n';

export default function TeacherLoginPage() {
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
      const r = await fetch('/api/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ? te(j.error) : t('errFailed'));
        return;
      }
      router.push('/teacher');
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
        <div className="logo-big"><GraduationCap size={28} /></div>
        <h2 style={{ margin: '0 0 4px' }}>{t('teacherLogin')}</h2>
        <p className="muted small" style={{ marginTop: 0 }}>{t('teacherLoginSub')}</p>
        {error && <p className="error-box">{error}</p>}
        <form onSubmit={submit}>
          <label className="lbl" htmlFor="tu">{t('username')}</label>
          <input id="tu" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <label className="lbl" htmlFor="tp">{t('password')}</label>
          <input id="tp" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="btn btn-primary btn-block mt" disabled={busy}>
            {busy ? <span className="spinner" /> : <LogIn size={17} />} {t('Login')}
          </button>
        </form>
      </div>
    </div>
  );
}
