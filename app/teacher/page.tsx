'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FolderOpen, Inbox, Clock, Users, HardDrive, Bell } from 'lucide-react';
import { useT, translateNotification } from '@/lib/i18n';
import { Loading } from '@/components/feedback';
import { TeacherNav } from '@/components/TeacherNav';
import { formatBytes } from '@/lib/validation';

export default function TeacherDashboard() {
  const router = useRouter();
  const { t, lang } = useT();
  const [me, setMe] = useState<{ displayName: string; username: string } | null>(null);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [notifs, setNotifs] = useState<{ id: string; title: string; body: string; createdAt: string; folderName?: string }[]>([]);
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
        const [s, n] = await Promise.all([
          fetch('/api/teacher/stats', { cache: 'no-store' }).then((x) => x.json()).catch(() => null),
          fetch('/api/teacher/notifications?unread=1', { cache: 'no-store' }).then((x) => x.json()).catch(() => null),
        ]);
        if (s?.stats) setStats(s.stats);
        if (n?.notifications) setNotifs(n.notifications.slice(0, 8));
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) return <Loading label={t('loading')} />;

  return (
    <div>
      <TeacherNav name={me ? `${me.displayName} (@${me.username})` : undefined} />
      <div className="hero">
        <div className="card hero-main">
          <h1>{t('hello')}, {me?.displayName || ''}</h1>
          <p>{t('teacherDash')}</p>
          <div className="row mt">
            <Link href="/teacher/folders" className="btn" style={{ background: '#fff', borderColor: '#fff', color: 'var(--primary-600)' }}>
              <FolderOpen size={17} /> {t('myFolders')}
            </Link>
            <Link href="/teacher/students" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.4)' }}>
              <Users size={17} /> {t('students')}
            </Link>
          </div>
        </div>
        <div className="grid">
          <div className="card stat"><span className="stat-ic"><FolderOpen size={20} /></span><div><b>{stats?.myFolders ?? '—'}</b><span>{t('myFolders')}</span></div></div>
          <div className="card stat"><span className="stat-ic"><Inbox size={20} /></span><div><b>{stats?.totalSubmissions ?? '—'}</b><span>{t('totalSubmissions')}</span></div></div>
          <div className="card stat"><span className="stat-ic"><Clock size={20} /></span><div><b>{stats?.pendingSubmissions ?? '—'}</b><span>{t('pendingSubmissions')}</span></div></div>
          <div className="card stat"><span className="stat-ic"><Users size={20} /></span><div><b>{stats?.students ?? '—'}</b><span>{t('students')}</span></div></div>
        </div>
      </div>
      <div className="grid grid-2">
        <div className="card">
          <h3><HardDrive size={16} /> {t('storageUsed')}</h3>
          <p><b>{formatBytes(stats?.storageUsed || 0)}</b></p>
          <p className="small muted">{t('late')}: {stats?.lateSubmissions ?? 0}</p>
        </div>
        <div className="card">
          <h3><Bell size={16} /> {t('notifications')} {stats && stats.unread > 0 ? <span className="badge-count">{stats.unread}</span> : null}</h3>
          {notifs.length === 0 ? <p className="muted small">{t('noNotifications')}</p> : (
            <div className="grid">
              {notifs.map((n) => {
                const nt = translateNotification(n.title, n.body || '', lang, 'teacher');
                return (
                <div key={n.id} className="file-item">
                  <div className="grow">
                    <b>{nt.title}</b>
                    <div className="small muted">{nt.body?.slice(0, 120)} · {String(n.createdAt).slice(0, 16).replace('T', ' ')}</div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
          <Link href="/teacher/activity" className="btn btn-sm mt">{t('activity')}</Link>
        </div>
      </div>
    </div>
  );
}
