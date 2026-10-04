'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { UploadCloud, X, File as FileIcon, Send, Download, Trash2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Loading } from '@/components/feedback';
import { formatBytes } from '@/lib/validation';

export default function StudentFolderDetail({ params }: { params: { id: string } }) {
  const id = (params as { id: string }).id;
  const router = useRouter();
  const { t, te } = useT();
  const [folder, setFolder] = useState<Record<string, unknown> | null>(null);
  const [mySubs, setMySubs] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const r = await fetch(`/api/folders/${id}`, { cache: 'no-store' });
      if (r.status === 401) {
        router.replace('/login');
        return;
      }
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ? te(j.error) : t('errFailed'));
        setLoading(false);
        return;
      }
      setFolder(j.folder);
      setMySubs(j.mySubmissions || []);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function addFiles(list: FileList | File[]) {
    const max = Number((folder as { maxFiles?: number })?.maxFiles || 5);
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, max));
  }

  function submit() {
    setError('');
    setOk('');
    if (!folder) return;
    if (!(folder as { canSubmit?: boolean }).canSubmit) {
      setError(String((folder as { closedReason?: string }).closedReason || t('folderClosedMsg')));
      return;
    }
    if (files.length === 0) {
      setError(t('errNoFiles'));
      return;
    }
    if (Number((folder as Record<string, unknown>).requireMessage || 0) === 1 && !message.trim()) {
      setError(te('A message is required for this folder.'));
      return;
    }
    setBusy(true);
    setProgress(0);
    const fd = new FormData();
    fd.append('message', message);
    for (const f of files) fd.append('files', f);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/folders/${id}/submit`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setBusy(false);
      try {
        const j = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          setOk(t('submissionOk'));
          setFiles([]);
          setMessage('');
          setProgress(100);
          load();
        } else {
          setError(j.error ? te(j.error) : t('errFailed'));
        }
      } catch {
        setError(t('errFailed'));
      }
    };
    xhr.onerror = () => {
      setBusy(false);
      setError(t('errOffline'));
    };
    xhr.send(fd);
  }

  async function delSubmission(sid: string) {
    const r = await fetch(`/api/folders/${id}/submit?submissionId=${encodeURIComponent(sid)}`, { method: 'DELETE' });
    if (r.ok) load();
  }

  if (loading) return <Loading label={t('loading')} />;
  if (!folder) return <div className="card">{error || t('errNotFound')}</div>;

  const fRec = (folder || {}) as Record<string, unknown>;
  const canSubmit = !!fRec.canSubmit;
  const closedReason = String(fRec.closedReason || '');
  const teacherName = String(fRec.teacherName || '');
  const folderDesc = String((fRec.description as string) || '');
  const folderName = String(fRec.name || '');
  const folderDeadline = fRec.deadline ? String(fRec.deadline).slice(0, 16).replace('T', ' ') : '—';
  const maxFilesN = Number(fRec.maxFiles || 5);
  const maxSizeN = Number(fRec.maxFileSizeMB || 50);
  const requireMsg = Number(fRec.requireMessage || 0) === 1;
  const total = files.reduce((a, f) => a + f.size, 0);

  return (
    <div className="grid" style={{ maxWidth: 760, marginInline: 'auto' }}>
      <div className="card">
        <h2 style={{ marginBottom: 4 }}>{folderName}</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          {t('teacherRole')}: <b>{teacherName}</b> · {t('deadline')}: {folderDeadline}
        </p>
        {folderDesc && <p className="small">{folderDesc}</p>}
        {!canSubmit && <p className="error-box">{closedReason || t('folderClosedMsg')}</p>}
        {error && <p className="error-box">{error}</p>}
        {ok && <p className="ok-box">{ok}</p>}

        <p className="small muted">
          {t('yourSubmission')}: <b>{teacherName}</b> — <b>{folderName}</b>
        </p>

        <label className="lbl">{t('uploadFiles')} <span className="hint">(max {maxFilesN} · {maxSizeN} MB)</span></label>
        <div
          className="drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <UploadCloud size={26} />
          <div style={{ fontWeight: 700, marginTop: 6 }}>{t('dragDrop')}</div>
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        </div>
        <div className="grid mt">
          {files.map((f, i) => (
            <div key={i} className="file-item">
              <FileIcon size={18} />
              <div className="grow">
                <div className="ellipsis"><b>{f.name}</b></div>
                <div className="small muted">{formatBytes(f.size)} · {f.type || 'file'}</div>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}><X size={15} /></button>
            </div>
          ))}
        </div>
        {files.length > 0 && <p className="small muted">{t('totalSize')}: <b>{formatBytes(total)}</b></p>}
        <label className="lbl" htmlFor="smsg">{t('message')}{requireMsg ? ' *' : ''}</label>
        <textarea id="smsg" className="textarea" placeholder={t('messagePlaceholder')} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
        {busy && (
          <div className="mt">
            <div className="progress"><div style={{ width: `${progress}%` }} /></div>
            <div className="small muted mt">{progress}%</div>
          </div>
        )}
        <button className="btn btn-primary btn-block mt" onClick={submit} disabled={busy || !canSubmit || files.length === 0}>
          {busy ? <span className="spinner" /> : <Send size={16} />} {t('submitToFolder')}
        </button>
      </div>

      <div className="card">
        <h3>{t('mySubmissions')} ({mySubs.length})</h3>
        {mySubs.length === 0 ? <p className="muted small">{t('noSentHint')}</p> : (
          <div className="grid">
            {mySubs.map((s) => (
              <SubmissionCard key={String(s.id)} s={s} onDelete={delSubmission} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SubmissionCard({ s, onDelete }: { s: Record<string, unknown>; onDelete: (id: string) => void }) {
  const { t } = useT();
  const [files, setFiles] = useState<{ id: string; originalName: string; mime: string; size: number }[]>([]);
  const [open, setOpen] = useState(false);

  async function toggle() {
    if (!open && files.length === 0) {
      const r = await fetch(`/api/submissions/${String(s.id)}`, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        setFiles(j.files || []);
      }
    }
    setOpen(!open);
  }

  return (
    <div className="file-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div className="space" style={{ width: '100%' }}>
        <div>
          <b>{t('submissionNum')} #{String(s.submissionNumber)}</b>{' '}
          <span className="status status-accepted">{String(s.status) === 'current' ? t('current') : t('replaced')}</span>{' '}
          {Number(s.isLate) ? <span className="status status-declined">{t('late')}</span> : <span className="status status-downloaded">{t('onTime')}</span>}
          <div className="small muted">{t('dateSent')}: {String(s.createdAt).slice(0, 16).replace('T', ' ')} · {String(s.fileCount)} {t('filesCount')} · {formatBytes(Number(s.totalBytes))}</div>
          {s.message ? <div className="small">{String(s.message)}</div> : null}
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={toggle}>{t('view')}</button>
        </div>
      </div>
      {open && (
        <div className="grid" style={{ width: '100%' }}>
          {files.map((f) => (
            <div key={f.id} className="file-item">
              <FileIcon size={16} />
              <div className="grow">
                <b>{f.originalName}</b>
                <div className="small muted">{formatBytes(f.size)}</div>
              </div>
              <a className="btn btn-sm" href={`/api/submission-files/${f.id}/download`}><Download size={13} /> {t('download')}</a>
            </div>
          ))}
          {Boolean(s.deletable) && (
            <button className="btn btn-sm" onClick={() => onDelete(String(s.id))}><Trash2 size={13} /> {t('del')}</button>
          )}
        </div>
      )}
    </div>
  );
}
