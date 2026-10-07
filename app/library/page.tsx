'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BookOpen, Download, Eye, Search } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Loading } from '@/components/feedback';
import { formatBytes } from '@/lib/validation';

interface Book {
  id: string; title: string; author: string; subject: string; description: string;
  mime: string; size: number; downloadCount: number; createdAt: string;
}

export default function LibraryPage() {
  const router = useRouter();
  const { t, te } = useT();
  const [items, setItems] = useState<Book[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (q.trim()) p.set('q', q.trim());
      if (subject) p.set('subject', subject);
      const r = await fetch(`/api/library?${p.toString()}`, { cache: 'no-store' });
      if (r.status === 401) {
        router.replace('/login');
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.error === 'The library is currently disabled.') setDisabled(true);
        setItems([]);
        setSubjects([]);
        return;
      }
      setDisabled(false);
      setItems(j.books || []);
      setSubjects(j.subjects || []);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, subject]);

  if (loading) return <Loading label={t('loading')} />;

  if (disabled) {
    return (
      <div className="center-wrap">
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="logo-big" style={{ marginInline: 'auto' }}>
            <BookOpen size={28} />
          </div>
          <h2>{t('library')}</h2>
          <p className="muted">{t('errLibraryDisabled')}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="space">
        <div>
          <h1 style={{ margin: 0 }}>{t('library')}</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>{t('librarySub')}</p>
        </div>
      </div>
      <div className="row mt">
        <Search size={15} />
        <input
          className="input"
          placeholder={t('bookSearchPh')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('bookSearchPh')}
        />
      </div>
      {subjects.length > 0 && (
        <div className="row mt">
          <button
            type="button"
            className={`btn btn-sm ${!subject ? 'btn-primary' : ''}`}
            onClick={() => setSubject('')}
          >
            {t('allSubjects')}
          </button>
          {subjects.map((s) => (
            <button
              key={s}
              type="button"
              className={`btn btn-sm ${subject === s ? 'btn-primary' : ''}`}
              onClick={() => setSubject(subject === s ? '' : s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-2 mt">
        {items.length === 0 ? (
          <div className="card">
            <b>{t('noBooks')}</b>
            <p className="muted small">{t('noBooksHint')}</p>
          </div>
        ) : (
          items.map((b) => (
            <div key={b.id} className="card">
              <div className="space" style={{ margin: 0 }}>
                <span className="stat-ic">
                  <BookOpen size={20} />
                </span>
                <div className="grow">
                  <b dir="auto">{b.title}</b>
                  <div className="small muted" dir="auto">
                    {b.author || '—'}{b.subject ? ` · ${b.subject}` : ''}
                  </div>
                </div>
              </div>
              {b.description && <p className="small muted" dir="auto">{b.description}</p>}
              <p className="small muted" style={{ margin: '6px 0 0' }} dir="ltr">
                {formatBytes(b.size)} · {b.downloadCount} {t('lbDownloads')}
              </p>
              <div className="row mt">
                {b.mime === 'application/pdf' && (
                  <a className="btn btn-sm" href={`/api/library/${b.id}/download`} target="_blank" rel="noopener">
                    <Eye size={14} /> {t('view')}
                  </a>
                )}
                <a className="btn btn-sm btn-primary" href={`/api/library/${b.id}/download`}>
                  <Download size={14} /> {t('download')}
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
