'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Plus, FolderOpen, Archive, Lock, Clock } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Loading } from '@/components/feedback';
import { TeacherNav } from '@/components/TeacherNav';
import { formatBytes } from '@/lib/validation';

interface Folder {
  id: string; name: string; description: string; status: string; deadline: string | null;
  submissionCount: number; studentCount: number; totalBytes: number;
  classes: { id: string; name: string }[];
}

export default function TeacherFoldersPage() {
  const router = useRouter();
  const { t, te } = useT();
  const [me, setMe] = useState<{ displayName: string } | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '', description: '', classIds: [] as string[], deadline: '',
    maxFileSizeMB: 50, maxFiles: 5, maxTotalSizeMB: 500, allowedExtensions: '',
    allowMultiple: true, allowReplace: true, allowDeleteOwn: false,
    lateMode: 'marked', requireMessage: false,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const m = await fetch('/api/teacher/me', { cache: 'no-store' });
      if (m.status === 401) {
        router.replace('/teacher/login');
        return;
      }
      const mj = await m.json();
      setMe(mj.teacher);
      setClasses(mj.teacher.classes || []);
      const r = await fetch(`/api/teacher/folders${filter ? `?status=${filter}` : ''}`, { cache: 'no-store' });
      const j = await r.json();
      setFolders(j.folders || []);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  function toggleClass(id: string) {
    setForm((f) => ({ ...f, classIds: f.classIds.includes(id) ? f.classIds.filter((x) => x !== id) : [...f.classIds, id] }));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await fetch('/api/teacher/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          deadline: form.deadline || null,
          allowLate: form.lateMode !== 'blocked',
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error ? te(j.error) : t('errFailed'));
        return;
      }
      setShowCreate(false);
      setForm({
        name: '', description: '', classIds: [], deadline: '',
        maxFileSizeMB: 50, maxFiles: 5, maxTotalSizeMB: 500, allowedExtensions: '',
        allowMultiple: true, allowReplace: true, allowDeleteOwn: false,
        lateMode: 'marked', requireMessage: false,
      });
      load();
    } catch {
      setErr(t('errOffline'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading label={t('loading')} />;

  return (
    <div>
      <TeacherNav name={me?.displayName} />
      <div className="space">
        <h2 style={{ margin: 0 }}><FolderOpen size={19} /> {t('myFolders')} ({folders.length})</h2>
        <div className="row">
          <select className="select" style={{ maxWidth: 170 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">{t('allFilter')}</option>
            <option value="active">{t('activeF')}</option>
            <option value="closed">{t('closed')}</option>
            <option value="archived">{t('archived')}</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(!showCreate)}><Plus size={15} /> {t('createFolder')}</button>
        </div>
      </div>

      {showCreate && (
        <form onSubmit={create} className="card mt">
          <h3>{t('createFolder')}</h3>
          {err && <p className="error-box">{err}</p>}
          <label className="lbl">{t('folderName')}</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={120} />
          <label className="lbl">{t('folderDesc')}</label>
          <textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
          <label className="lbl">{t('class')}</label>
          <div className="row">
            {classes.map((c) => (
              <label key={c.id} className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
                <input type="checkbox" checked={form.classIds.includes(c.id)} onChange={() => toggleClass(c.id)} /> {c.name}
              </label>
            ))}
            {classes.length === 0 && <span className="small muted">—</span>}
          </div>
          <div className="grid grid-2 mt">
            <div>
              <label className="lbl">{t('deadline')}</label>
              <input className="input" type="datetime-local" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} dir="ltr" />
            </div>
            <div>
              <label className="lbl">{t('maxFileSize')}</label>
              <input className="input" type="number" min={1} max={2048} value={form.maxFileSizeMB} onChange={(e) => setForm({ ...form, maxFileSizeMB: Number(e.target.value) })} dir="ltr" />
            </div>
            <div>
              <label className="lbl">{t('maxFiles')}</label>
              <input className="input" type="number" min={1} max={20} value={form.maxFiles} onChange={(e) => setForm({ ...form, maxFiles: Number(e.target.value) })} dir="ltr" />
            </div>
            <div>
              <label className="lbl">{t('allowedTypes')}</label>
              <input className="input" placeholder="pdf, docx, zip, png..." value={form.allowedExtensions} onChange={(e) => setForm({ ...form, allowedExtensions: e.target.value })} dir="ltr" />
            </div>
          </div>
          <div className="grid grid-2 mt">
            <label className="small"><input type="checkbox" checked={form.allowMultiple} onChange={(e) => setForm({ ...form, allowMultiple: e.target.checked })} /> {t('allowMultiple')}</label>
            <label className="small"><input type="checkbox" checked={form.allowReplace} onChange={(e) => setForm({ ...form, allowReplace: e.target.checked })} /> {t('allowReplace')}</label>
            <label className="small"><input type="checkbox" checked={form.allowDeleteOwn} onChange={(e) => setForm({ ...form, allowDeleteOwn: e.target.checked })} /> {t('allowDeleteOwn')}</label>
            <label className="small"><input type="checkbox" checked={form.requireMessage} onChange={(e) => setForm({ ...form, requireMessage: e.target.checked })} /> {t('requireMsg')}</label>
          </div>
          <label className="lbl">{t('allowLate')}</label>
          <select className="select" value={form.lateMode} onChange={(e) => setForm({ ...form, lateMode: e.target.value })}>
            <option value="blocked">{t('lateBlocked')}</option>
            <option value="allowed">{t('lateAllowed')}</option>
            <option value="marked">{t('lateMarked')}</option>
          </select>
          <button className="btn btn-primary mt" disabled={busy}>{busy ? <span className="spinner" /> : null} {t('createFolder')}</button>
        </form>
      )}

      <div className="grid grid-2 mt">
        {folders.map((f) => (
          <Link key={f.id} href={`/teacher/folders/${f.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="card">
              <div className="space">
                <b>{f.name}</b>
                <span className={`status ${f.status === 'active' ? 'status-accepted' : f.status === 'closed' ? 'status-declined' : 'status-expired'}`}>
                  {f.status === 'active' ? <Clock size={12} /> : f.status === 'closed' ? <Lock size={12} /> : <Archive size={12} />}
                  {f.status === 'active' ? t('activeF') : f.status === 'closed' ? t('closed') : t('archived')}
                </span>
              </div>
              <p className="small muted">{f.description?.slice(0, 120) || '—'}</p>
              <p className="small">{f.classes?.map((c) => c.name).join(' · ') || '—'}</p>
              <p className="small muted">
                {t('submissions')}: <b>{f.submissionCount}</b> · {t('students')}: <b>{f.studentCount}</b> · {formatBytes(f.totalBytes || 0)}
                {f.deadline ? ` · ${t('deadline')}: ${String(f.deadline).slice(0, 16).replace('T', ' ')}` : ''}
              </p>
            </div>
          </Link>
        ))}
      </div>
      {folders.length === 0 && <div className="card mt"><p className="muted">{t('myFolders')} — 0</p></div>}
    </div>
  );
}
