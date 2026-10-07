'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Save, KeyRound, Camera } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Loading } from '@/components/feedback';
import { Avatar } from '@/components/Avatar';

export default function ProfilePage() {
  const router = useRouter();
  const { t, te } = useT();
  const [me, setMe] = useState<{ id: string; displayName: string; username: string; className: string | null; classId: string | null } | null>(null);
  const [allowClassChange, setAllowClassChange] = useState(false);
  const [allowAvatar, setAllowAvatar] = useState(false);
  const [allowUsername, setAllowUsername] = useState(false);
  const [maxAvatarMB, setMaxAvatarMB] = useState(2);
  const [hasAvatar, setHasAvatar] = useState(false);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [classId, setClassId] = useState('');
  const [msg, setMsg] = useState('');
  const [avatarMsg, setAvatarMsg] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarTick, setAvatarTick] = useState(0);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwMsg, setPwMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  // Native-bound overlay picker (same proven pattern as chat/FileDropzone).
  const bindAvatarInput = useCallback((el: HTMLInputElement | null) => {
    avatarInputRef.current = el;
    if (!el || (el as unknown as { _bound?: boolean })._bound) return;
    (el as unknown as { _bound?: boolean })._bound = true;
    el.addEventListener('change', () => {
      const fl = el.files;
      const file = fl && fl.length > 0 ? fl[0] : null;
      el.value = '';
      if (file) uploadAvatar(file);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function uploadAvatar(file: File) {
    setAvatarMsg('');
    setAvatarBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const r = await fetch('/api/auth/avatar', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setHasAvatar(true);
        setAvatarTick((x) => x + 1);
        setAvatarMsg(t('saved'));
      } else {
        setAvatarMsg(j.error ? te(j.error) : t('errFailed'));
      }
    } catch {
      setAvatarMsg(t('errOffline'));
    } finally {
      setAvatarBusy(false);
    }
  }

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
        setUsername(j.user.username);
        setClassId(j.user.classId || '');
        setAllowClassChange(!!j.allowClassChange);
        setAllowAvatar(!!j.allowAvatarUpload);
        setAllowUsername(!!j.allowUsernameChange);
        setMaxAvatarMB(Number(j.maxAvatarMB) || 2);
        setHasAvatar(!!j.hasAvatar);
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
      body: JSON.stringify({ displayName, ...(allowUsername ? { username } : {}), ...(allowClassChange ? { classId } : {}) }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.username) {
      setMe((p) => (p ? { ...p, username: j.username, displayName } : p));
      setUsername(j.username);
    }
    setMsg(r.ok ? t('saved') : j.error ? te(j.error) : t('errFailed'));
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
    setPwMsg(r.ok ? t('pwChanged') : j.error ? te(j.error) : t('errFailed'));
    if (r.ok) setPw({ currentPassword: '', newPassword: '' });
  }

  if (loading) return <Loading label={t('loading')} />;

  return (
    <div className="grid" style={{ maxWidth: 620, marginInline: 'auto' }}>
      <div className="card">
        <h2>{t('accountInfo')}</h2>
        {allowAvatar && me && (
          <div className="row mt" style={{ alignItems: 'center' }}>
            <Avatar key={avatarTick} userId={me.id} name={me.displayName} size={72} hasAvatar={hasAvatar} />
            <div className="grow">
              <b>{t('chAvatar')}</b>
              <div className="small muted">{t('chAvatarHint')} ({maxAvatarMB} MB)</div>
              <span className="chat-attach-wrap mt" title={t('chooseFiles')}>
                <span className="btn btn-sm" aria-hidden>
                  <Camera size={15} /> {t('chooseFiles')}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="file-overlay"
                  ref={bindAvatarInput}
                  aria-label={t('chAvatar')}
                  disabled={avatarBusy}
                />
              </span>
              {avatarMsg && <p className="small mt">{avatarMsg}</p>}
            </div>
          </div>
        )}
        <dl className="kv mt">
          <dt>{t('displayName')}</dt><dd>{me?.displayName}</dd>
          <dt>{t('username')}</dt><dd>@{me?.username}</dd>
          <dt>{t('class')}</dt><dd>{me?.className || '—'}</dd>
        </dl>
        <form onSubmit={saveProfile} className="mt">
          <label className="lbl">{t('displayName')}</label>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} minLength={2} />
          {allowUsername && (
            <>
              <label className="lbl">{t('username')}</label>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={32} dir="ltr" autoComplete="username" />
            </>
          )}
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
