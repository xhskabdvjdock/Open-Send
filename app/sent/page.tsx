'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FolderUp } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { StatusBadge } from '@/components/StatusBadge';
import { Empty, Loading } from '@/components/feedback';
import { formatBytes } from '@/lib/validation';

interface T {
  id: string; status: string; createdAt: string;
  recipientUsername: string; recipientName: string; recipientClass: string | null;
  fileCount: number; totalBytes: number; firstFileName: string | null;
}

export default function SentPage() {
  const router = useRouter();
  const { t } = useT();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/transfers/mine?type=sent&limit=200', { cache: 'no-store' });
        if (r.status === 401) {
          router.replace('/login');
          return;
        }
        const j = await r.json();
        setItems(j.transfers || []);
      } catch {}
      setLoading(false);
    })();
  }, [router]);

  return (
    <div style={{ maxWidth: 760, marginInline: 'auto' }}>
      <h2 style={{ margin: 0 }}>{t('sentFiles')}</h2>
      <div className="grid mt">
        {loading ? <Loading label={t('loading')} /> : items.length === 0 ? (
          <div className="card"><Empty icon={<FolderUp size={26} />} title={t('noSent')} hint={t('noSentHint')} /></div>
        ) : items.map((x) => (
          <Link key={x.id} href={`/transfers/${x.id}`} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="space">
              <b className="ellipsis">{x.fileCount > 1 ? `${x.fileCount} files` : x.firstFileName || 'Files'}</b>
              <StatusBadge status={x.status} />
            </div>
            <div className="small muted mt">
              {t('to')}: {x.recipientName} · {x.recipientClass || '—'} · @{x.recipientUsername}
            </div>
            <div className="small muted">{formatBytes(x.totalBytes)} · {new Date(x.createdAt).toLocaleString()}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
