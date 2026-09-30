'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Download, Check, X, Ban, FileText, Image as ImageIcon, File as FileIcon } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { StatusBadge } from '@/components/StatusBadge';
import { Loading } from '@/components/feedback';
import { formatBytes } from '@/lib/validation';

interface DetailFile { id: string; originalName: string; mime: string; size: number; createdAt: string }
interface Person { id: string; username: string; displayName: string; className: string | null }

export default function TransferDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { t, te } = useT();
  const [data, setData] = useState<{
    transfer: { id: string; status: string; message: string; createdAt: string; expiresAt: string | null; downloadCount: number };
    files: DetailFile[];
    sender: Person;
    recipient: Person;
    isSender: boolean;
    isRecipient: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/transfers/${params.id}`, { cache: 'no-store' });
      if (r.status === 401) {
        router.replace('/login');
        return;
      }
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ? te(j.error) : t('errFailed'));
        return;
      }
      setData(j);
    } catch {
      setError(t('errOffline'));
    } finally {
      setLoading(false);
    }
  }, [params.id, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function action(kind: 'accept' | 'decline' | 'cancel') {
    setBusy(kind);
    setError('');
    try {
      const r = await fetch(`/api/transfers/${params.id}/${kind}`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ? te(j.error) : t('errFailed'));
        return;
      }
      await load();
    } catch {
      setError(t('errOffline'));
    } finally {
      setBusy('');
    }
  }

  if (loading) return <Loading label={t('loading')} />;
  if (error && !data) return <div className="card"><p className="error-box">{error}</p></div>;
  if (!data) return null;

  const { transfer, files, sender, recipient, isSender, isRecipient } = data;
  const canDownload = isRecipient && (transfer.status === 'ACCEPTED' || transfer.status === 'DOWNLOADED');

  function fileIcon(mime: string) {
    if (mime.startsWith('image/')) return <ImageIcon size={18} />;
    if (mime.includes('pdf') || mime.startsWith('text/')) return <FileText size={18} />;
    return <FileIcon size={18} />;
  }

  function isPreviewable(f: DetailFile): boolean {
    return f.mime.startsWith('image/') || f.mime === 'application/pdf' || f.mime.startsWith('text/');
  }

  return (
    <div className="grid" style={{ maxWidth: 720, marginInline: 'auto' }}>
      <div className="card">
        <div className="space">
          <h2 style={{ margin: 0 }}>{files.length > 1 ? `${files.length} ${t('filesCount')}` : files[0]?.originalName || 'Transfer'}</h2>
          <StatusBadge status={transfer.status} />
        </div>
        {error && <p className="error-box mt">{error}</p>}

        {isRecipient && transfer.status === 'PENDING' && (
          <div className="card mt" style={{ background: 'var(--bg-soft)' }}>
            <b>{sender.displayName} {t('wantsToSend')}:</b>
            <div className="small muted">{files.map((f) => `${f.originalName} (${formatBytes(f.size)})`).join(', ')}</div>
            {transfer.message && <p className="small">“{transfer.message}”</p>}
            <div className="row mt">
              <button className="btn btn-success" disabled={!!busy} onClick={() => action('accept')}>
                {busy === 'accept' ? <span className="spinner" /> : <Check size={17} />} {t('accept')}
              </button>
              <button className="btn btn-danger" disabled={!!busy} onClick={() => action('decline')}>
                {busy === 'decline' ? <span className="spinner" /> : <X size={17} />} {t('decline')}
              </button>
            </div>
          </div>
        )}

        <dl className="kv mt">
          <dt>{t('sender')}</dt><dd>{sender.displayName} · {sender.className || '—'} · @{sender.username}</dd>
          <dt>{t('to')}</dt><dd>{recipient.displayName} · {recipient.className || '—'} · @{recipient.username}</dd>
          <dt>{t('dateSent')}</dt><dd>{new Date(transfer.createdAt).toLocaleString()}</dd>
          <dt>{t('status')}</dt><dd>{transfer.status}</dd>
          {transfer.message && (<><dt>{t('message')}</dt><dd>{transfer.message}</dd></>)}
          <dt>{t('downloads')}</dt><dd>{transfer.downloadCount}</dd>
        </dl>

        {isSender && transfer.status === 'PENDING' && (
          <button className="btn btn-danger mt" disabled={!!busy} onClick={() => action('cancel')}>
            {busy === 'cancel' ? <span className="spinner" /> : <Ban size={16} />} {t('cancelTransfer')}
          </button>
        )}
      </div>

      <div className="card">
        <h3>{t('files')}</h3>
        <div className="grid">
          {files.map((f) => (
            <div key={f.id} className="file-item">
              {fileIcon(f.mime)}
              <div className="grow">
                <div className="ellipsis"><b>{f.originalName}</b></div>
                <div className="small muted">{formatBytes(f.size)} · {f.mime}</div>
                {canDownload && isPreviewable(f) && f.mime.startsWith('image/') && (
                  // Preview via authenticated endpoint: use <img> with same download URL (browser sends cookies).
                  // Safe: only images/PDF/text previewed; never executed.
                  <img
                    src={`/api/files/${f.id}/download`}
                    alt={f.originalName}
                    style={{ maxWidth: '100%', borderRadius: 10, marginTop: 8 }}
                    loading="lazy"
                  />
                )}
              </div>
              {canDownload ? (
                <a className="btn btn-sm btn-primary" href={`/api/files/${f.id}/download`}>
                  <Download size={15} /> {t('download')}
                </a>
              ) : (
                <span className="small muted">{transfer.status === 'PENDING' ? t('waitingApproval') : transfer.status}</span>
              )}
            </div>
          ))}
        </div>
        {!canDownload && isRecipient && transfer.status === 'PENDING' && (
          <p className="hint mt">{t('downloadHint')}</p>
        )}
      </div>
    </div>
  );
}
