'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Send, Inbox, FolderUp, FolderOpen, ClipboardList } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Loading } from '@/components/feedback';

export default function FilesHubPage() {
  const router = useRouter();
  const { t } = useT();
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ pending: 0, sent: 0, folders: 0, submissions: 0 });

  useEffect(() => {
    (async () => {
      try {
        const me = await fetch('/api/auth/me', { cache: 'no-store' });
        if (me.status === 401) {
          router.replace('/login');
          return;
        }
        const [p, s, f, subs] = await Promise.all([
          fetch('/api/transfers/mine?type=received&status=PENDING&limit=200', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ transfers: [] })),
          fetch('/api/transfers/mine?type=sent&limit=200', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ transfers: [] })),
          fetch('/api/folders', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ folders: [] })),
          fetch('/api/submissions/mine?limit=200', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ submissions: [] })),
        ]);
        setCounts({
          pending: (p.transfers || []).length,
          sent: (s.transfers || []).length,
          folders: (f.folders || []).length,
          submissions: (subs.submissions || subs.items || []).length,
        });
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) return <Loading label={t('loading')} />;

  const cards = [
    { href: '/received', icon: <Inbox size={22} />, title: t('received'), count: counts.pending },
    { href: '/sent', icon: <FolderUp size={22} />, title: t('sent'), count: counts.sent },
    { href: '/folders', icon: <FolderOpen size={22} />, title: t('teacherFolders'), count: counts.folders },
    { href: '/submissions', icon: <ClipboardList size={22} />, title: t('mySubmissions'), count: counts.submissions },
  ];

  return (
    <div>
      <div className="space">
        <div>
          <h1 style={{ margin: 0 }}>{t('files')}</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>{t('filesHubSub')}</p>
        </div>
        <Link href="/send" className="btn btn-primary">
          <Send size={16} /> {t('sendFile')}
        </Link>
      </div>
      <div className="grid grid-2 mt">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="card stat">
              <span className="stat-ic">{c.icon}</span>
              <div>
                <b>{c.count}</b>
                <span>{c.title}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
