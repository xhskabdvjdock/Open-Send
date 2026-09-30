'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Search, UploadCloud, X, File as FileIcon, Check } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { formatBytes } from '@/lib/validation';

interface Student { id: string; username: string; displayName: string; classId: string | null; className: string | null }
interface ClassItem { id: string; name: string }

export default function SendPage() {
  const router = useRouter();
  const { t } = useT();
  const [q, setQ] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [results, setResults] = useState<Student[]>([]);
  const [searching, setSearching] = useState(false);
  const [recipient, setRecipient] = useState<Student | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [limits, setLimits] = useState({ maxFileSizeMB: 50, maxFilesPerTransfer: 5 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/classes', { cache: 'no-store' }).then((r) => r.json()).then((j) => setClasses(j.classes || [])).catch(() => {});
    fetch('/api/settings/public', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      if (j.settings) setLimits({ maxFileSizeMB: j.settings.maxFileSizeMB, maxFilesPerTransfer: j.settings.maxFilesPerTransfer });
    }).catch(() => {});
    fetch('/api/auth/me', { cache: 'no-store' }).then((r) => {
      if (r.status === 401) router.replace('/login');
    }).catch(() => {});
  }, [router]);

  useEffect(() => {
    const id = setTimeout(async () => {
      if (!q.trim() && !classFilter) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const r = await fetch(`/api/students/search?q=${encodeURIComponent(q)}&classId=${encodeURIComponent(classFilter)}`, { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          setResults(j.students || []);
        }
      } catch {}
      setSearching(false);
    }, 280);
    return () => clearTimeout(id);
  }, [q, classFilter]);

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    setFiles((prev) => [...prev, ...arr].slice(0, limits.maxFilesPerTransfer));
  }

  function send() {
    setError('');
    setOk('');
    if (!recipient) {
      setError(t('errRecipient'));
      return;
    }
    if (files.length === 0) {
      setError(t('errNoFiles'));
      return;
    }
    setBusy(true);
    setProgress(0);
    const fd = new FormData();
    fd.append('recipientId', recipient.id);
    fd.append('message', message);
    for (const f of files) fd.append('files', f);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/transfers/send');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setBusy(false);
      try {
        const j = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          setOk(t('sendSuccess'));
          setFiles([]);
          setMessage('');
          setProgress(100);
          setTimeout(() => router.push('/sent'), 900);
        } else {
          setError(j.error || 'Send failed.');
        }
      } catch {
        setError('Send failed.');
      }
    };
    xhr.onerror = () => {
      setBusy(false);
      setError('Server offline. Make sure you are on the school Wi-Fi.');
    };
    xhr.send(fd);
  }

  const total = files.reduce((a, f) => a + f.size, 0);

  return (
    <div className="grid" style={{ maxWidth: 720, marginInline: 'auto' }}>
      <div className="card">
        <h2>{t('sendFile')}</h2>
        {error && <p className="error-box">{error}</p>}
        {ok && <p className="ok-box">{ok}</p>}

        <label className="lbl">{t('recipient')}</label>
        {recipient ? (
          <div className="student-row">
            <span className="avatar">{recipient.displayName.slice(0, 1).toUpperCase()}</span>
            <div className="grow">
              <b>{recipient.displayName}</b>
              <div className="small muted">{recipient.className || '—'} · @{recipient.username}</div>
            </div>
            <button className="btn btn-sm" onClick={() => setRecipient(null)}><X size={15} /></button>
          </div>
        ) : (
          <>
            <div className="row">
              <div style={{ position: 'relative', flex: 1 }}>
                <Search size={16} style={{ position: 'absolute', insetInlineStart: 12, top: 13, color: 'var(--muted)' }} />
                <input
                  className="input"
                  style={{ paddingInlineStart: 34 }}
                  placeholder={t('searchPlaceholder')}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <select className="select" style={{ maxWidth: 190 }} value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                <option value="">{t('allClasses')}</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="grid mt">
              {searching && <div className="small muted">{t('loading')}</div>}
              {!searching && (q || classFilter) && results.length === 0 && <div className="small muted">{t('noStudentsFound')}</div>}
              {!q && !classFilter && <div className="small muted">{t('typeToSearch')}</div>}
              {results.map((s) => (
                <div key={s.id} className="student-row">
                  <span className="avatar">{s.displayName.slice(0, 1).toUpperCase()}</span>
                  <div className="grow">
                    <b>{s.displayName}</b>
                    <div className="small muted">{s.className || '—'} · @{s.username}</div>
                  </div>
                  <button className="btn btn-sm btn-primary" onClick={() => setRecipient(s)}>
                    <Check size={15} /> {t('select')}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <label className="lbl">{t('files')} <span className="hint">(max {limits.maxFilesPerTransfer} · {limits.maxFileSizeMB} MB each)</span></label>
        <div
          className={`drop ${dragOver ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <UploadCloud size={26} />
          <div style={{ fontWeight: 700, marginTop: 6 }}>{t('dragDrop')}</div>
          <div className="small">{t('chooseFiles')}</div>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
          />
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

        <label className="lbl" htmlFor="msg">{t('message')}</label>
        <textarea id="msg" className="textarea" placeholder={t('messagePlaceholder')} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} />

        {busy && (
          <div className="mt">
            <div className="progress"><div style={{ width: `${progress}%` }} /></div>
            <div className="small muted mt">{progress}%</div>
          </div>
        )}
        <button className="btn btn-primary btn-block mt" onClick={send} disabled={busy || !recipient || files.length === 0}>
          {busy ? <span className="spinner" /> : null} {t('sendButton')}
        </button>
      </div>
    </div>
  );
}
