'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Save, KeyRound } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Loading } from '@/components/feedback';

export default function ProfilePage() {
  const router = useRouter();
  const { t } = useT();
  const [me, setMe] = useState<{ displayName: string; username: string; className: string | null; classId: string | null } | null>(null);
  const [allowClassChange, setAllowClassChange] = useState(false);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [classId, setClassId] = useState('');
  const [msg, setMsg] = useState('');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwMsg, setPwMsg] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { cache: 'no-store' });
        if (r.status === 401) {
          router.replace('/login');
          return;
        }
        const j = await r.json();
        setMe(j.user);
        setDisplayName(j.user.displayName);
        setClassId(j.user.classId || '');
        setAllowClassChange(!!j.allowClassChange);
        if (j.allowClassChange) {
          const c = await fetch('/api/classes', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ classes: [] }));
          setClasses(c.classes || []);
        }
      } catch {}
      setLoading(false);
    })();
  }, [router]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const r = await fetch('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, ...(allowClassChange ? { classId } : {}) }),
    });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? t('saved') : j.error || 'Failed.');
  }

  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg('');
    const r = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pw),
    });
    const j = await r.json().catch(() => ({}));
    setPwMsg(r.ok ? t('pwChanged') : j.error || 'Failed.');
    if (r.ok) setPw({ currentPassword: '', newPassword: '' });
  }

  if (loading) return <Loading label={t('loading')} />;

  return (
    <div className="grid" style={{ maxWidth: 620, marginInline: 'auto' }}>
      <div className="card">
        <h2>{t('accountInfo')}</h2>
        <dl className="kv">
          <dt>{t('displayName')}</dt><dd>{me?.displayName}</dd>
          <dt>{t('username')}</dt><dd>@{me?.username}</dd>
          <dt>{t('class')}</dt><dd>{me?.className || '—'}</dd>
        </dl>
        <form onSubmit={saveProfile} className="mt">
          <label className="lbl">{t('displayName')}</label>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} minLength={2} />
          {allowClassChange && (
            <>
              <label className="lbl">{t('class')}</label>
              <select className="select" value={classId} onChange={(e) => setClassId(e.target.value)}>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </>
          )}
          {msg && <p className="small mt">{msg}</p>}
          <button className="btn btn-primary mt"><Save size={16} /> {t('save')}</button>
        </form>
      </div>
      <div className="card">
        <h3><KeyRound size={16} /> {t('changePassword')}</h3>
        <form onSubmit={changePw}>
          <label className="lbl">{t('currentPassword')}</label>
          <input className="input" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
          <label className="lbl">{t('newPassword')}</label>
          <input className="input" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required minLength={6} />
          {pwMsg && <p className="small mt">{pwMsg}</p>}
          <button className="btn mt">{t('save')}</button>
        </form>
      </div>
    </div>
  );
}
