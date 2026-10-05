'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ScrollText, Bell } from 'lucide-react';
import { useT, translateNotification } from '@/lib/i18n';
import { Loading } from '@/components/feedback';
import { TeacherNav } from '@/components/TeacherNav';

export default function TeacherActivityPage() {
  const router = useRouter();
  const { t, lang } = useT();
  const [items, setItems] = useState<{ id: number; action: string; details: string; createdAt: string }[]>([]);
  const [notifs, setNotifs] = useState<{ id: string; title: string; body: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const m = await fetch('/api/teacher/me', { cache: 'no-store' });
        if (m.status === 401) {
          router.replace('/teacher/login');
          return;
        }
        const [a, n] = await Promise.all([
          fetch('/api/teacher/activity', { cache: 'no-store' }).then((x) => x.json()).catch(() => null),
          fetch('/api/teacher/notifications', { cache: 'no-store' }).then((x) => x.json()).catch(() => null),
        ]);
        if (a?.activity) setItems(a.activity);
        if (n?.notifications) {
          setNotifs(n.notifications);
          // mark read
          fetch('/api/teacher/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read-all' }) }).catch(() => {});
        }
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) return <Loading label={t('loading')} />;

  return (
    <div>
      <TeacherNav />
      <div className="grid grid-2">
        <div className="card">
          <h3><Bell size={16} /> {t('notifications')}</h3>
          {notifs.length === 0 ? <p className="muted small">{t('noNotifications')}</p> : (
            <div className="grid">
              {notifs.map((n) => {
                const nt = translateNotification(n.title, n.body || '', lang, 'teacher');
                return (
                <div key={n.id} className="file-item">
                  <div className="grow">
                    <b>{nt.title}</b>
                    <div className="small muted">{nt.body?.slice(0, 160)}</div>
                    <div className="small muted">{String(n.createdAt).slice(0, 16).replace('T', ' ')}</div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="card">
          <h3><ScrollText size={16} /> {t('activity')}</h3>
          {items.length === 0 ? <p className="muted small">—</p> : (
            <div className="grid">
              {items.map((l) => (
                <div key={l.id} className="file-item">
                  <div className="grow">
                    <b>{l.action}</b>
                    <div className="small muted">{l.details?.slice(0, 160)}</div>
                    <div className="small muted">{String(l.createdAt).slice(0, 19).replace('T', ' ')}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
