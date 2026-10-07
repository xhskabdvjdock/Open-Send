'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { User, KeyRound, Camera } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Loading } from '@/components/feedback';
import { TeacherNav } from '@/components/TeacherNav';
import { LanguageSwitcher } from '@/lib/i18n';
import { ThemeToggle } from '@/lib/theme';
import { Avatar } from '@/components/Avatar';

export default function TeacherProfilePage() {
  const router = useRouter();
  const { t, te } = useT();
  const [me, setMe] = useState<{ id: string; displayName: string; username: string; classes?: { id: string; name: string }[] } | null>(null);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [allowAvatar, setAllowAvatar] = useState(false);
  const [allowUsername, setAllowUsername] = useState(false);
  const [maxAvatarMB, setMaxAvatarMB] = useState(2);
  const [hasAvatar, setHasAvatar] = useState(false);
  const [avatarTick, setAvatarTick] = useState(0);
  const [avatarMsg, setAvatarMsg] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

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
      const r = await fetch('/api/teacher/avatar', { method: 'POST', body: fd });
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
        const r = await fetch('/api/teacher/me', { cache: 'no-store' });
        if (r.status === 401) {
          router.replace('/teacher/login');
          return;
        }
        const j = await r.json();
        setMe(j.teacher);
        setName(j.teacher.displayName || '');
        setUsername(j.teacher.username || '');
        setAllowAvatar(!!j.allowAvatarUpload);
        setAllowUsername(!!j.allowUsernameChange);
        setMaxAvatarMB(Number(j.maxAvatarMB) || 2);
        setHasAvatar(!!j.hasAvatar);
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const r = await fetch('/api/teacher/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name, ...(allowUsername ? { username } : {}) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(j.error ? te(j.error) : t('errFailed'));
      return;
    }
    if (j.username) {
      setMe((p) => (p ? { ...p, username: j.username, displayName: name } : p));
      setUsername(j.username);
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
          <p className="small">@{me?.username}</p>
          <p className="small muted">{t('assignedClasses')}: {(me?.classes || []).map((c) => c.name).join(' · ') || '—'}</p>
          <form onSubmit={saveName}>
            <label className="lbl">{t('displayName')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            {allowUsername && (
              <>
                <label className="lbl">{t('username')}</label>
                <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={32} dir="ltr" autoComplete="username" />
              </>
            )}
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
