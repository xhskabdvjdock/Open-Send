'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { User, KeyRound } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Loading } from '@/components/feedback';
import { TeacherNav } from '@/components/TeacherNav';
import { LanguageSwitcher } from '@/lib/i18n';
import { ThemeToggle } from '@/lib/theme';

export default function TeacherProfilePage() {
  const router = useRouter();
  const { t, te } = useT();
  const [me, setMe] = useState<{ displayName: string; username: string; classes?: { id: string; name: string }[] } | null>(null);
  const [name, setName] = useState('');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/teacher/me', { cache: 'no-store' });
        if (r.status === 401) {
          router.replace('/teacher/login');
          return;
        }
        const j = await r.json();
        setMe(j.teacher);
        setName(j.teacher.displayName || '');
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const r = await fetch('/api/teacher/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(j.error ? te(j.error) : t('errFailed'));
      return;
    }
    setMsg(t('saved'));
  }

  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const r = await fetch('/api/teacher/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pw) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(j.error ? te(j.error) : t('errFailed'));
      return;
    }
    setMsg(t('pwChanged'));
    setPw({ currentPassword: '', newPassword: '' });
  }

  if (loading) return <Loading label={t('loading')} />;

  return (
    <div>
      <TeacherNav name={me?.displayName} />
      {msg && <div className="card"><span className="small">{msg}</span></div>}
      <div className="grid grid-2">
        <div className="card">
          <h3><User size={16} /> {t('accountInfo')}</h3>
          <p className="small">@{me?.username}</p>
          <p className="small muted">{t('assignedClasses')}: {(me?.classes || []).map((c) => c.name).join(' · ') || '—'}</p>
          <form onSubmit={saveName}>
            <label className="lbl">{t('displayName')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            <button className="btn btn-primary mt">{t('save')}</button>
          </form>
        </div>
        <div className="card">
          <h3><KeyRound size={16} /> {t('changePassword')}</h3>
          <form onSubmit={changePw}>
            <label className="lbl">{t('currentPassword')}</label>
            <input className="input" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
            <label className="lbl">{t('newPassword')}</label>
            <input className="input" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required minLength={6} />
            <button className="btn mt">{t('save')}</button>
          </form>
          <div className="mt">
            <label className="lbl">{t('language')}</label>
            <LanguageSwitcher />
            <div className="mt"><ThemeToggle /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
