'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Download, Eye, FileText, Image as ImageIcon, File as FileIcon, Search, Archive, Lock, Unlock, Trash2, Settings as SettingsIcon } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Loading } from '@/components/feedback';
import { TeacherNav } from '@/components/TeacherNav';
import { formatBytes } from '@/lib/validation';
import { useConfirm, usePrompt } from '@/components/dialogs';

interface FolderDetail {
  id: string; name: string; description: string; status: string; effectiveStatus: string;
  deadline: string | null; maxFileSizeMB: number; maxFiles: number; allowedExtensions: string;
  allowMultiple: number; allowReplace: number; allowDeleteOwn: number; allowLate: number; lateMode: string;
  requireMessage: number; classIds: string[]; teacherName?: string;
}

export default function TeacherFolderDetail({ params }: { params: { id: string } }) {
  const id = (params as { id: string }).id;
  const router = useRouter();
  const { t, te } = useT();
  const { dialog: confirmDialog, ask: askConfirm } = useConfirm();
  const { dialog: promptDialog, ask: askPrompt } = usePrompt();
  const [folder, setFolder] = useState<FolderDetail | null>(null);
  const [subs, setSubs] = useState<Record<string, unknown>[]>([]);
  const [missing, setMissing] = useState<Record<string, unknown>[]>([]);
  const [progress, setProgress] = useState({ submitted: 0, total: 0, percent: 0 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [selFiles, setSelFiles] = useState<{ id: string; originalName: string; mime: string; size: number }[]>([]);
  const [selHistory, setSelHistory] = useState<Record<string, unknown>[]>([]);
  const [preview, setPreview] = useState<{ kind: string; text?: string; url?: string; meta?: { originalName: string; size: number; mime: string } } | null>(null);
  const [zipBusy, setZipBusy] = useState(false);
  const [zipFile, setZipFile] = useState<{ file: string; zipName: string } | null>(null);
  const [zipOpts, setZipOpts] = useState({ includeMessages: false, includeHistory: false, includeDates: true });
  const [showSettings, setShowSettings] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      const r = await fetch(`/api/teacher/folders/${id}`, { cache: 'no-store' });
      if (r.status === 401) {
        router.replace('/teacher/login');
        return;
      }
      if (!r.ok) {
        const j = await r.json();
        setMsg(j.error ? te(j.error) : t('errFailed'));
        setLoading(false);
        return;
      }
      const j = await r.json();
      setFolder(j.folder);
      setSubs(j.submissions || []);
      setMissing(j.missing || []);
      setProgress(j.progress || { submitted: 0, total: 0, percent: 0 });
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function search() {
    const p = new URLSearchParams({ q, status: statusF }).toString();
    const r = await fetch(`/api/teacher/folders/${id}/submissions?${p}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      setSubs(j.submissions || []);
    }
  }

  async function openSubmission(sid: string) {
    const r = await fetch(`/api/teacher/submissions/${sid}`, { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    setSelected(j.submission);
    setSelFiles(j.files || []);
    setSelHistory(j.history || []);
    setPreview(null);
  }

  async function doPreview(fileId: string) {
    setPreview(null);
    const m = await fetch(`/api/teacher/files/${fileId}/preview?meta=1`, { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
    const kind = m?.preview || m?.file?.preview || 'none';
    if (kind === 'pdf' || kind === 'image') {
      setPreview({ kind, url: `/api/teacher/files/${fileId}/preview`, meta: m.file });
    } else if (kind === 'text') {
      const full = await fetch(`/api/teacher/files/${fileId}/preview`, { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
      setPreview({ kind: 'text', text: full?.text || '', meta: m?.file });
    } else {
      setPreview({ kind, meta: m?.file });
    }
  }

  async function setStatus(status: string) {
    await fetch(`/api/teacher/folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function removeFolder() {
    const name = await askPrompt({ title: t('deleteFolderConfirm'), placeholder: folder?.name || '', okLabel: t('del') });
    if (name === null) return;
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ');
    if (norm(name) !== norm(String(folder?.name || ''))) {
      setMsg(te('Type the folder name to confirm deletion.'));
      return;
    }
    const r = await fetch(`/api/teacher/folders/${id}?permanent=1&confirm=${encodeURIComponent(name.trim())}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(j.error ? te(j.error) : t('errFailed'));
      return;
    }
    router.push('/teacher/folders');
  }

  async function archive() {
    const ok = await askConfirm({ title: folder?.name || '', message: t('archiveFolder'), okLabel: t('dlgConfirm') });
    if (!ok) return;
    await fetch(`/api/teacher/folders/${id}`, { method: 'DELETE' });
    load();
  }

  async function generateZip() {
    setZipBusy(true);
    setZipFile(null);
    try {
      const r = await fetch(`/api/teacher/folders/${id}/zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(zipOpts),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg(j.error ? te(j.error) : t('errFailed'));
        return;
      }
      setZipFile({ file: j.file, zipName: j.zipName });
    } finally {
      setZipBusy(false);
    }
  }

  function fileIcon(mime: string, name: string) {
    if (mime.startsWith('image/')) return <ImageIcon size={18} />;
    if (mime === 'application/pdf' || name.endsWith('.pdf')) return <FileText size={18} />;
    return <FileIcon size={18} />;
  }

  if (loading) return <Loading label={t('loading')} />;
  if (!folder) return <div className="card">{msg || t('errNotFound')}</div>;

  const filteredSubs = subs;

  return (
    <div>
      <TeacherNav />
      {confirmDialog}
      {promptDialog}
      {msg && <div className="card"><span className="small">{msg}</span></div>}
      <div className="card">
        <div className="space">
          <div>
            <h2 style={{ margin: 0 }}>{folder.name}</h2>
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              {t('deadline')}: {folder.deadline ? String(folder.deadline).slice(0, 16).replace('T', ' ') : '—'} · {t('status')}: <b>{folder.effectiveStatus}</b>
            </p>
            {folder.description && <p className="small">{folder.description}</p>}
          </div>
          <div className="row">
            <button className="btn btn-sm" onClick={() => setShowSettings(!showSettings)}><SettingsIcon size={14} /> {t('folderSettings')}</button>
            {folder.status === 'active' && <button className="btn btn-sm" onClick={() => setStatus('closed')}><Lock size={14} /> {t('closed')}</button>}
            {folder.status === 'closed' && <button className="btn btn-sm" onClick={() => setStatus('active')}><Unlock size={14} /> {t('restoreFolder')}</button>}
            {folder.status !== 'archived' && <button className="btn btn-sm" onClick={archive}><Archive size={14} /> {t('archiveFolder')}</button>}
            <button className="btn btn-sm" onClick={removeFolder}><Trash2 size={14} /> {t('del')}</button>
          </div>
        </div>
        <div className="mt">
          <div className="row">
            <b className="small">{t('progress')}: {progress.submitted} / {progress.total} ({progress.percent}%)</b>
          </div>
          <div className="progress mt"><div style={{ width: `${progress.percent}%` }} /></div>
        </div>
        {showSettings && <FolderSettings folder={folder} onSaved={load} />}
      </div>

      <div className="card mt">
        <h3><Download size={16} /> {t('downloadFolder')}</h3>
        <div className="row">
          <label className="small"><input type="checkbox" checked={zipOpts.includeDates} onChange={(e) => setZipOpts({ ...zipOpts, includeDates: e.target.checked })} /> {t('includeDates')}</label>
          <label className="small"><input type="checkbox" checked={zipOpts.includeMessages} onChange={(e) => setZipOpts({ ...zipOpts, includeMessages: e.target.checked })} /> {t('includeMessages')}</label>
          <label className="small"><input type="checkbox" checked={zipOpts.includeHistory} onChange={(e) => setZipOpts({ ...zipOpts, includeHistory: e.target.checked })} /> {t('includeHistory')}</label>
          <button className="btn btn-sm btn-primary" onClick={generateZip} disabled={zipBusy}>
            {zipBusy ? <span className="spinner" /> : <Download size={14} />} {zipBusy ? t('preparingZip') : t('downloadFolder')}
          </button>
        </div>
        {zipFile && (
          <p className="mt">
            <span className="ok-box">{t('zipReady')} </span>{' '}
            <a className="btn btn-sm btn-primary" href={`/api/teacher/folders/${id}/zip?file=${encodeURIComponent(zipFile.file)}`}>
              <Download size={14} /> {zipFile.zipName}
            </a>
          </p>
        )}
      </div>

      <div className="card mt">
        <div className="row">
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={16} style={{ position: 'absolute', insetInlineStart: 12, top: 13, color: 'var(--muted)' }} />
            <input className="input" style={{ paddingInlineStart: 34 }} placeholder={t('searchPh')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
          </div>
          <select className="select" style={{ maxWidth: 170 }} value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="">{t('allFilter')}</option>
            <option value="current">{t('current')}</option>
            <option value="replaced">{t('replaced')}</option>
            <option value="late">{t('late')}</option>
          </select>
          <button className="btn btn-sm btn-primary" onClick={search}>{t('stSearch')}</button>
        </div>
        <div className="table-wrap mt">
          <table className="tbl">
            <thead><tr><th>{t('students')}</th><th>{t('class')}</th><th>{t('status')}</th><th>{t('dateSent')}</th><th>{t('files')}</th><th></th></tr></thead>
            <tbody>
              {filteredSubs.map((s) => (
                <tr key={String(s.id)}>
                  <td><b>{String(s.studentName)}</b><div className="small muted" dir="ltr">@{String(s.studentUsername)}</div></td>
                  <td className="small">{String((s.className as string) || '—')}</td>
                  <td>
                    <span className="status status-accepted">{String(s.status) === 'current' ? t('current') : t('replaced')}</span>{' '}
                    {s.isLate ? <span className="status status-declined">{t('late')}</span> : <span className="status status-downloaded">{t('onTime')}</span>}
                  </td>
                  <td className="small">{String(s.createdAt).slice(0, 16).replace('T', ' ')}</td>
                  <td className="small">{String(s.fileCount)} · {formatBytes(Number(s.totalBytes))}</td>
                  <td><button className="btn btn-sm" onClick={() => openSubmission(String(s.id))}><Eye size={13} /> {t('view')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {missing.length > 0 && (
          <div className="mt">
            <h4>{t('missing')} ({missing.length})</h4>
            <div className="row">
              {missing.map((m) => (
                <span key={String(m.id)} className="status status-expired">{String(m.displayName)} · {String((m.className as string) || '')}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div className="card mt">
          <h3>{t('viewSubmission')}: {String(selected.studentName)} — #{String(selected.submissionNumber)}</h3>
          <p className="small muted">
            {t('dateSent')}: {String(selected.createdAt).slice(0, 16).replace('T', ' ')} · {selected.isLate ? t('late') : t('onTime')} · {String(selected.status) === 'current' ? t('current') : t('replaced')}
          </p>
          {selected.message ? <p className="small"><b>{t('message')}:</b> {String(selected.message)}</p> : null}
          <div className="grid">
            {selFiles.map((f) => (
              <div key={f.id} className="file-item">
                {fileIcon(f.mime, f.originalName)}
                <div className="grow">
                  <b>{f.originalName}</b>
                  <div className="small muted">{formatBytes(f.size)} · {f.mime}</div>
                </div>
                <button className="btn btn-sm" onClick={() => doPreview(f.id)}><Eye size={13} /> {t('preview')}</button>
                <a className="btn btn-sm btn-primary" href={`/api/teacher/files/${f.id}/download`}><Download size={13} /> {t('download')}</a>
              </div>
            ))}
          </div>
          {preview && (
            <div className="card mt">
              <h4>{t('preview')}</h4>
              {preview.kind === 'pdf' || preview.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                preview.kind === 'image' ? <img src={preview.url} alt="preview" style={{ maxWidth: '100%', borderRadius: 10 }} /> : <iframe src={preview.url} style={{ width: '100%', height: 480, border: '1px solid var(--border)', borderRadius: 10 }} title="preview" />
              ) : preview.kind === 'text' ? (
                <pre dir="ltr" style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto', background: 'var(--bg-soft)', padding: 12, borderRadius: 10 }}>{preview.text}</pre>
              ) : (
                <p className="small muted">{t('noPreview')} ({preview.meta?.originalName} · {formatBytes(preview.meta?.size || 0)})</p>
              )}
            </div>
          )}
          {selHistory.length > 1 && (
            <div className="mt">
              <h4>{t('mySubmissions')}</h4>
              {selHistory.map((h) => (
                <div key={String(h.id)} className="small">
                  #{String(h.submissionNumber)} · {String(h.createdAt).slice(0, 16).replace('T', ' ')} · {String(h.status) === 'current' ? t('current') : t('replaced')} · {Number(h.fileCount)} {t('filesCount')}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FolderSettings({ folder, onSaved }: { folder: FolderDetail; onSaved: () => void }) {
  const { t, te } = useT();
  const [f, setF] = useState({
    name: folder.name, description: folder.description, deadline: folder.deadline ? String(folder.deadline).slice(0, 16) : '',
    maxFileSizeMB: folder.maxFileSizeMB, maxFiles: folder.maxFiles, allowedExtensions: folder.allowedExtensions,
    allowMultiple: folder.allowMultiple === 1, allowReplace: folder.allowReplace === 1,
    allowDeleteOwn: folder.allowDeleteOwn === 1, lateMode: folder.lateMode, requireMessage: folder.requireMessage === 1,
    status: folder.status,
  });
  const [msg, setMsg] = useState('');
  async function save() {
    setMsg('');
    const r = await fetch(`/api/teacher/folders/${folder.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...f, deadline: f.deadline || null }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(j.error ? te(j.error) : t('errFailed'));
      return;
    }
    setMsg(t('saved'));
    onSaved();
  }
  return (
    <div className="card mt">
      <h3>{t('folderSettings')}</h3>
      {msg && <p className="small">{msg}</p>}
      <label className="lbl">{t('general')}</label>
      <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <textarea className="textarea mt" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <div className="grid grid-2 mt">
        <div>
          <label className="lbl">{t('deadline')}</label>
          <input className="input" type="datetime-local" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} dir="ltr" />
        </div>
        <div>
          <label className="lbl">{t('status')}</label>
          <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">{t('activeF')}</option>
            <option value="closed">{t('closed')}</option>
            <option value="archived">{t('archived')}</option>
          </select>
        </div>
        <div>
          <label className="lbl">{t('maxFileSize')}</label>
          <input className="input" type="number" value={f.maxFileSizeMB} onChange={(e) => setF({ ...f, maxFileSizeMB: Number(e.target.value) })} dir="ltr" />
        </div>
        <div>
          <label className="lbl">{t('maxFiles')}</label>
          <input className="input" type="number" value={f.maxFiles} onChange={(e) => setF({ ...f, maxFiles: Number(e.target.value) })} dir="ltr" />
        </div>
      </div>
      <label className="lbl">{t('allowedTypes')}</label>
      <input className="input" value={f.allowedExtensions} onChange={(e) => setF({ ...f, allowedExtensions: e.target.value })} dir="ltr" placeholder="pdf, docx, zip" />
      <label className="lbl">{t('rules')}</label>
      <div className="grid grid-2">
        <label className="small"><input type="checkbox" checked={f.allowMultiple} onChange={(e) => setF({ ...f, allowMultiple: e.target.checked })} /> {t('allowMultiple')}</label>
        <label className="small"><input type="checkbox" checked={f.allowReplace} onChange={(e) => setF({ ...f, allowReplace: e.target.checked })} /> {t('allowReplace')}</label>
        <label className="small"><input type="checkbox" checked={f.allowDeleteOwn} onChange={(e) => setF({ ...f, allowDeleteOwn: e.target.checked })} /> {t('allowDeleteOwn')}</label>
        <label className="small"><input type="checkbox" checked={f.requireMessage} onChange={(e) => setF({ ...f, requireMessage: e.target.checked })} /> {t('requireMsg')}</label>
      </div>
      <label className="lbl">{t('allowLate')}</label>
      <select className="select" value={f.lateMode} onChange={(e) => setF({ ...f, lateMode: e.target.value })}>
        <option value="blocked">{t('lateBlocked')}</option>
        <option value="allowed">{t('lateAllowed')}</option>
        <option value="marked">{t('lateMarked')}</option>
      </select>
      <button className="btn btn-primary mt" onClick={save}>{t('save')}</button>
    </div>
  );
}
