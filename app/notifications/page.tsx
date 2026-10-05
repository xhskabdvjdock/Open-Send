'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { useT, translateNotification } from '@/lib/i18n';
import { Empty, Loading } from '@/components/feedback';

interface N { id: string; kind: string; title: string; body: string; transferId: string | null; isRead: number; createdAt: string }

export default function NotificationsPage() {
  const router = useRouter();
  const { t, lang } = useT();
  const [items, setItems] = useState<N[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/notifications', { cache: 'no-store' });
      if (r.status === 401) {
        router.replace('/login');
        return;
      }
      const j = await r.json();
      setItems(j.notifications || []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function markAll() {
    await fetch('/api/notifications/read-all', { method: 'POST' });
    load();
  }

  async function markOne(id: string) {
    await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
    setItems((p) => p.map((n) => (n.id === id ? { ...n, isRead: 1 } : n)));
  }

  if (loading) return <Loading label={t('loading')} />;

  return (
    <div style={{ maxWidth: 720, marginInline: 'auto' }}>
      <div className="space">
        <h2 style={{ margin: 0 }}>{t('notifications')}</h2>
        {items.some((n) => !n.isRead) && <button className="btn btn-sm" onClick={markAll}>{t('markAllRead')}</button>}
      </div>
      <div className="grid mt">
        {items.length === 0 && <div className="card"><Empty icon={<Bell size={26} />} title={t('noNotifications')} hint={t('noNotificationsHint')} /></div>}
        {items.map((n) => {
          const nt = translateNotification(n.title, n.body, lang, n.kind);
          return (
          <div key={n.id} className={n.isRead ? 'card' : 'card card-unread'}>
            <div className="space">
              <b>{nt.title}</b>
              {!n.isRead && <span className="status status-accepted">{t('unread')}</span>}
            </div>
            {nt.body && <p className="small muted">{nt.body}</p>}
            <div className="row mt">
              <span className="small muted">{new Date(n.createdAt).toLocaleString()}</span>
              {n.transferId && <Link href={`/transfers/${n.transferId}`} className="btn btn-sm">{t('view')}</Link>}
              {!n.isRead && <button className="btn btn-sm btn-ghost" onClick={() => markOne(n.id)}>✓</button>}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
