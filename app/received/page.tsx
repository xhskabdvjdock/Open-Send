'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import { useT, type TKey } from '@/lib/i18n';
import { StatusBadge } from '@/components/StatusBadge';
import { Empty, Loading } from '@/components/feedback';
import { formatBytes } from '@/lib/validation';

interface T {
  id: string; status: string; message: string; createdAt: string;
  senderUsername: string; senderName: string; senderClass: string | null;
  fileCount: number; totalBytes: number; firstFileName: string | null;
}

const FILTERS: { v: string; label: TKey }[] = [
  { v: '', label: 'all' },
  { v: 'PENDING', label: 'pending' },
  { v: 'ACCEPTED', label: 'accepted' },
  { v: 'DECLINED', label: 'declined' },
  { v: 'EXPIRED', label: 'expired' },
  { v: 'DOWNLOADED', label: 'downloaded' },
  { v: 'CANCELLED', label: 'cancelled' },
];

export default function ReceivedPage() {
  const router = useRouter();
  const { t } = useT();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  async function load(f = filter) {
    setLoading(true);
    try {
      const r = await fetch(`/api/transfers/mine?type=received${f ? `&status=${f}` : ''}&limit=200`, { cache: 'no-store' });
      if (r.status === 401) {
        router.replace('/login');
        return;
      }
      const j = await r.json();
      setItems(j.transfers || []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ maxWidth: 760, marginInline: 'auto' }}>
      <div className="space">
        <h2 style={{ margin: 0 }}>{t('receivedFiles')}</h2>
      </div>
      <div className="row mt" role="tablist" aria-label="filters">
        {FILTERS.map((f) => (
          <button
            key={f.v || 'all'}
            className={`btn btn-sm ${filter === f.v ? 'btn-primary' : ''}`}
            onClick={() => { setFilter(f.v); load(f.v); }}
          >
            {t(f.label)}
          </button>
        ))}
      </div>
      <div className="grid mt">
        {loading ? <Loading label={t('loading')} /> : items.length === 0 ? (
          <div className="card"><Empty icon={<Inbox size={26} />} title={t('noReceived')} hint={t('noReceivedHint')} /></div>
        ) : items.map((x) => (
          <Link key={x.id} href={`/transfers/${x.id}`} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="space">
              <b className="ellipsis">{x.fileCount > 1 ? `${x.fileCount} files` : x.firstFileName || 'Files'}</b>
              <StatusBadge status={x.status} />
            </div>
            <div className="small muted mt">
              {t('from')}: {x.senderName} · {x.senderClass || '—'} · @{x.senderUsername}
            </div>
            <div className="small muted">{formatBytes(x.totalBytes)} · {new Date(x.createdAt).toLocaleString()}</div>
            {x.status === 'PENDING' && <div className="small mt" style={{ color: 'var(--warn)' }}>{t('waitingApproval')}</div>}
          </Link>
        ))}
      </div>
    </div>
  );
}
