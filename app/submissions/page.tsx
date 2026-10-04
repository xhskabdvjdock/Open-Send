'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FolderOpen, Download } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Loading } from '@/components/feedback';
import { formatBytes } from '@/lib/validation';

export default function MySubmissionsPage() {
  const router = useRouter();
  const { t } = useT();
  const [subs, setSubs] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const m = await fetch('/api/auth/me', { cache: 'no-store' });
        if (m.status === 401) {
          router.replace('/login');
          return;
        }
        const r = await fetch('/api/submissions/mine', { cache: 'no-store' });
        const j = await r.json();
        setSubs(j.submissions || []);
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) return <Loading label={t('loading')} />;

  return (
    <div>
      <h2>{t('mySubmissions')} ({subs.length})</h2>
      <div className="grid">
        {subs.map((s) => (
          <div key={String(s.id)} className="card">
            <div className="space">
              <div>
                <b>{String(s.folderName)}</b>
                <div className="small muted">{t('teacherRole')}: {String(s.teacherName)} · {t('submissionNum')} #{String(s.submissionNumber)}</div>
              </div>
              <span className="status status-accepted">{String(s.status) === 'current' ? t('current') : t('replaced')}</span>
            </div>
            <p className="small muted">
              {String(s.createdAt).slice(0, 16).replace('T', ' ')} · {Number(s.isLate) ? t('late') : t('onTime')} · {String(s.fileCount)} {t('filesCount')} · {formatBytes(Number(s.totalBytes))}
            </p>
            <div className="row">
              <Link href={`/folders/${String(s.folderId)}`} className="btn btn-sm"><FolderOpen size={13} /> {t('view')}</Link>
              <Link href={`/api/submissions/${String(s.id)}`} className="btn btn-sm btn-ghost" onClick={(e) => e.preventDefault()} style={{ display: 'none' }}>
                <Download size={13} />
              </Link>
            </div>
          </div>
        ))}
      </div>
      {subs.length === 0 && <div className="card mt"><p className="muted small">{t('noSentHint')}</p></div>}
    </div>
  );
}
