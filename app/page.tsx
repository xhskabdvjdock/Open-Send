'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Send, Inbox, FolderUp, Clock, Bell, Wrench, FolderOpen } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Loading } from '@/components/feedback';

interface Me { id: string; username: string; displayName: string; classId: string | null; className: string | null }

export default function HomePage() {
  const router = useRouter();
  const { t } = useT();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [maintenance, setMaintenance] = useState(false);
  const [counts, setCounts] = useState({ pending: 0, sent: 0, received: 0, unread: 0 });
  const [folders, setFolders] = useState<{ id: string; name: string; teacherName: string; deadline: string | null; effectiveStatus: string }[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { cache: 'no-store' });
        if (r.status === 401) {
          router.replace('/login');
          return;
        }
        if (!r.ok) throw new Error('failed');
        const j = await r.json();
        setMe(j.user);
        if (j.maintenanceMode) {
          setMaintenance(true);
          setLoading(false);
          return;
        }
        const [a, b, c] = await Promise.all([
          fetch('/api/transfers/mine?type=received&status=PENDING&limit=1', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ transfers: [] })),
          fetch('/api/transfers/mine?type=sent&limit=1', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ transfers: [] })),
          fetch('/api/notifications/unread-count', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ unread: 0 })),
        ]);
        // Counts need real totals — fetch lightweight lists (limit 200 is fine for school scale)
        const [p, s, rc, fl] = await Promise.all([
          fetch('/api/transfers/mine?type=received&status=PENDING&limit=200', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ transfers: [] })),
          fetch('/api/transfers/mine?type=sent&limit=200', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ transfers: [] })),
          fetch('/api/transfers/mine?type=received&limit=200', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ transfers: [] })),
          fetch('/api/folders', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ folders: [] })),
        ]);
        setFolders((fl.folders || []).slice(0, 6));
        void a; void b; void c;
        setCounts({
          pending: (p.transfers || []).length,
          sent: (s.transfers || []).length,
          received: (rc.transfers || []).length,
          unread: c.unread || 0,
        });
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) return <Loading label={t('loading')} />;

  if (maintenance) {
    return (
      <div className="center-wrap">
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="logo-big" style={{ marginInline: 'auto' }}><Wrench size={28} /></div>
          <h2>{t('maintenanceTitle')}</h2>
          <p className="muted">{t('maintenanceSub')}</p>
          <button className="btn" onClick={() => location.reload()}>{t('retry')}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="hero">
        <div className="card hero-main">
          <h1>{t('hello')}, {me?.displayName || ''}</h1>
          <p>{t('class')}: {me?.className || '—'} · @{me?.username}</p>
          <div className="row mt">
            <Link href="/send" className="btn" style={{ background: '#fff', borderColor: '#fff', color: 'var(--primary-600)' }}>
              <Send size={17} /> {t('sendFile')}
            </Link>
            <Link href="/received" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.4)' }}>
              <Inbox size={17} /> {t('received')}
            </Link>
          </div>
        </div>
        <div className="grid">
          <div className="card stat"><span className="stat-ic"><Clock size={20} /></span><div><b>{counts.pending}</b><span>{t('pendingRequests')}</span></div></div>
          <div className="card stat"><span className="stat-ic"><FolderUp size={20} /></span><div><b>{counts.sent}</b><span>{t('sentFiles')}</span></div></div>
          <div className="card stat"><span className="stat-ic"><Inbox size={20} /></span><div><b>{counts.received}</b><span>{t('receivedFiles')}</span></div></div>
          <div className="card stat"><span className="stat-ic"><Bell size={20} /></span><div><b>{counts.unread}</b><span>{t('notifications')}</span></div></div>
        </div>
      </div>

      <div className="grid grid-2">
        <Link href="/send" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h3><Send size={17} style={{ verticalAlign: -3 }} /> {t('send')}</h3>
          <p className="muted small">{t('searchStudent')}</p>
        </Link>
        <Link href="/notifications" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h3><Bell size={17} style={{ verticalAlign: -3 }} /> {t('notifications')} {counts.unread > 0 && <span className="badge-count">{counts.unread}</span>}</h3>
          <p className="muted small">{t('unread')}</p>
        </Link>
      </div>

      <div className="card mt">
        <div className="space">
          <h3 style={{ margin: 0 }}><FolderOpen size={17} style={{ verticalAlign: -3 }} /> {t('teacherFolders')}</h3>
          <Link href="/folders" className="btn btn-sm">{t('view')}</Link>
        </div>
        {folders.length === 0 ? (
          <p className="muted small">{t('noReceivedHint')}</p>
        ) : (
          <div className="grid mt">
            {folders.map((f) => (
              <Link key={f.id} href={`/folders/${f.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="file-item">
                  <FolderOpen size={18} />
                  <div className="grow">
                    <b>{f.name}</b>
                    <div className="small muted">{f.teacherName} · {t('deadline')}: {f.deadline ? f.deadline.slice(0, 16).replace('T', ' ') : '—'}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
        <div className="row mt">
          <Link href="/submissions" className="btn btn-sm">{t('mySubmissions')}</Link>
        </div>
      </div>
    </div>
  );
}
