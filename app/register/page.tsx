'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { UserPlus, SendHorizonal } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface ClassItem { id: string; name: string }

export default function RegisterPage() {
  const router = useRouter();
  const { t, te } = useT();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [form, setForm] = useState({ username: '', password: '', confirmPassword: '', displayName: '', classId: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [c, s] = await Promise.all([
          fetch('/api/classes', { cache: 'no-store' }).then((r) => r.json()),
          fetch('/api/settings/public', { cache: 'no-store' }).then((r) => r.json()),
        ]);
        setClasses(c.classes || []);
        setRegistrationEnabled(s.settings?.registrationEnabled !== false);
      } catch {}
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) {
      setError(t('errPwMatch'));
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="center-wrap">
      <div className="card">
        <div className="logo-big"><SendHorizonal size={28} /></div>
        <h2 style={{ margin: '0 0 4px' }}>{t('registerTitle')}</h2>
        <p className="muted small" style={{ marginTop: 0 }}>{t('registerSub')}</p>
        {!registrationEnabled ? (
          <p className="error-box">{t('registrationDisabled')}</p>
        ) : (
          <>
            {error && <p className="error-box">{error}</p>}
            <form onSubmit={submit}>
              <label className="lbl">{t('username')}</label>
              <input className="input" value={form.username} onChange={set('username')} required minLength={3} autoComplete="username" />
              <label className="lbl">{t('displayName')}</label>
              <input className="input" value={form.displayName} onChange={set('displayName')} required minLength={2} autoComplete="name" />
              <label className="lbl">{t('class')}</label>
              <select className="select" value={form.classId} onChange={set('classId')} required>
                <option value="">—</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <label className="lbl">{t('password')}</label>
              <input className="input" type="password" value={form.password} onChange={set('password')} required minLength={6} autoComplete="new-password" />
              <label className="lbl">{t('confirmPassword')}</label>
              <input className="input" type="password" value={form.confirmPassword} onChange={set('confirmPassword')} required minLength={6} autoComplete="new-password" />
              <button className="btn btn-primary btn-block mt" disabled={busy}>
                {busy ? <span className="spinner" /> : <UserPlus size={17} />} {t('register')}
              </button>
            </form>
          </>
        )}
        <p className="small mt"><Link href="/login">{t('login')}</Link></p>
      </div>
    </div>
  );
}
