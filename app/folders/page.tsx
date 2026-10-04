'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FolderOpen, Clock, Lock, User } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Loading } from '@/components/feedback';

interface Folder {
  id: string; name: string; description: string; deadline: string | null;
  teacherName: string; effectiveStatus: string; mySubmissions: number; status: string;
}

export default function StudentFoldersPage() {
  const router = useRouter();
  const { t } = useT();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const m = await fetch('/api/auth/me', { cache: 'no-store' });
        if (m.status === 401) {
          router.replace('/login');
          return;
        }
        const r = await fetch('/api/folders', { cache: 'no-store' });
        const j = await r.json();
        setFolders(j.folders || []);
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) return <Loading label={t('loading')} />;

  return (
    <div>
      <h2><FolderOpen size={19} /> {t('teacherFolders')} ({folders.length})</h2>
      <div className="grid grid-2">
        {folders.map((f) => (
          <Link key={f.id} href={`/folders/${f.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="card">
              <div className="space">
                <b>{f.name}</b>
                {f.effectiveStatus === 'active'
                  ? <span className="status status-accepted">{t('activeF')}</span>
                  : <span className="status status-declined"><Lock size={12} /> {f.effectiveStatus === 'expired' ? t('expiredF') : t('closed')}</span>}
              </div>
              <p className="small muted"><User size={12} /> {f.teacherName}</p>
              <p className="small muted">{f.description?.slice(0, 120) || ''}</p>
              <p className="small">
                <Clock size={12} /> {t('deadline')}: {f.deadline ? String(f.deadline).slice(0, 16).replace('T', ' ') : '—'}
              </p>
              {f.mySubmissions > 0 && <p className="small"><span className="status status-downloaded">{t('submitted')} × {f.mySubmissions}</span></p>}
            </div>
          </Link>
        ))}
      </div>
      {folders.length === 0 && <div className="card mt"><p className="muted small">{t('noReceivedHint')}</p></div>}
    </div>
  );
}
