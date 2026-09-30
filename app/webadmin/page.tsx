'use client';

/* Hidden administration console. Reachable ONLY by manually entering /webadmin.
   No link to this route exists anywhere in the student UI. Protected by its own
   admin session + server-side authorization on every /api/admin endpoint. */

import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Users, Shapes, ArrowLeftRight, HardDrive, Settings as SettingsIcon,
  ScrollText, Server, LogOut, ShieldAlert, Plus, Pencil, Trash2, KeyRound, Upload, RefreshCw,
} from 'lucide-react';
import { formatBytes } from '@/lib/validation';
import { useT, type TKey, translateError } from '@/lib/i18n';
import { useConfirm, usePrompt } from '@/components/dialogs';

type Tab = 'overview' | 'students' | 'classes' | 'transfers' | 'storage' | 'settings' | 'logs' | 'system';

const TABS: { id: Tab; labelKey: TKey; icon: React.ReactNode }[] = [
  { id: 'overview', labelKey: 'tabOverview', icon: <LayoutDashboard size={15} /> },
  { id: 'students', labelKey: 'tabStudents', icon: <Users size={15} /> },
  { id: 'classes', labelKey: 'tabClasses', icon: <Shapes size={15} /> },
  { id: 'transfers', labelKey: 'tabTransfers', icon: <ArrowLeftRight size={15} /> },
  { id: 'storage', labelKey: 'tabStorage', icon: <HardDrive size={15} /> },
  { id: 'settings', labelKey: 'tabSettings', icon: <SettingsIcon size={15} /> },
  { id: 'logs', labelKey: 'tabLogs', icon: <ScrollText size={15} /> },
  { id: 'system', labelKey: 'tabSystem', icon: <Server size={15} /> },
];

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, { cache: 'no-store', ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(translateError(j.error || `Request failed (${r.status})`));
  return j;
}

export default function WebAdminPage() {
  const { t } = useT();
  const [admin, setAdmin] = useState<{ username: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [login, setLogin] = useState({ username: '', password: '' });
  const [loginErr, setLoginErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/admin/me', { cache: 'no-store' })
      .then(async (r) => {
        if (r.ok) {
          const j = await r.json();
          setAdmin(j.admin);
        }
      })
      .finally(() => setChecking(false));
  }, []);

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginErr('');
    setBusy(true);
    try {
      const j = await api('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(login),
      });
      setAdmin(j.admin);
    } catch (e) {
      setLoginErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    setAdmin(null);
  }

  if (checking) return <div className="card">{t('loading')}</div>;

  if (!admin) {
    return (
      <div className="center-wrap">
        <div className="card">
          <div className="logo-big"><ShieldAlert size={28} /></div>
          <h2 style={{ margin: '0 0 4px' }}>{t('admTitle')}</h2>
          <p className="muted small">{t('adminLoginNote')}</p>
          {loginErr && <p className="error-box">{loginErr}</p>}
          <form onSubmit={doLogin}>
            <label className="lbl">{t('username')}</label>
            <input className="input" value={login.username} onChange={(e) => setLogin({ ...login, username: e.target.value })} autoComplete="username" required />
            <label className="lbl">{t('password')}</label>
            <input className="input" type="password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} autoComplete="current-password" required />
            <button className="btn btn-primary btn-block mt" disabled={busy}>
              {busy ? <span className="spinner" /> : null} {t('admLoginBtn')}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="space">
        <div>
          <h1 style={{ margin: 0 }}>{t('admTitle')}</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>{t('admSignedInAs')} <b>{admin.username}</b> · {t('admHidden')}</p>
        </div>
        <button className="btn btn-sm" onClick={logout}><LogOut size={15} /> {t('logout')}</button>
      </div>

      <div className="admin-tabs" role="tablist">
        {TABS.map((tb) => (
          <button key={tb.id} role="tab" className={tab === tb.id ? 'active' : ''} onClick={() => setTab(tb.id)}>
            {tb.icon} {t(tb.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview />}
      {tab === 'students' && <Students />}
      {tab === 'classes' && <Classes />}
      {tab === 'transfers' && <Transfers />}
      {tab === 'storage' && <Storage />}
      {tab === 'settings' && <SettingsPanel />}
      {tab === 'logs' && <Logs />}
      {tab === 'system' && <System />}
    </div>
  );
}

function Overview() {
  const { t } = useT();
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    api('/api/admin/stats').then((j) => setStats(j.stats)).catch(() => {});
  }, []);
  if (!stats) return <div className="card">{t('loading')}</div>;
  const cards: [TKey, number][] = [
    ['ovStudents', stats.students],
    ['ovClasses', stats.classes],
    ['ovTransfers', stats.transfers],
    ['ovTransfersToday', stats.transfersToday],
    ['ovPending', stats.pending],
    ['ovFilesToday', stats.filesToday],
  ];
  return (
    <div className="grid grid-3">
      {cards.map(([k, v]) => (
        <div key={k} className="card stat">
          <div><b>{v}</b><span>{t(k)}</span></div>
        </div>
      ))}
      <div className="card">
        <b>{t('ovStorageUsed')}</b>
        <div className="muted">{formatBytes(stats.storageUsed || 0)}</div>
      </div>
    </div>
  );
}

function Students() {
  const { t } = useT();
  const { dialog: confirmDialog, ask: askConfirm } = useConfirm();
  const { dialog: promptDialog, ask: askPrompt } = usePrompt();
  const [items, setItems] = useState<Record<string, string | number | null>[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const [msg, setMsg] = useState('');
  const [create, setCreate] = useState({ username: '', password: '', displayName: '', classId: '' });
  const [csv, setCsv] = useState('username,password,name,class\n');
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ displayName: '', classId: '', enabled: true });

  async function load() {
    setMsg('');
    try {
      const j = await api(`/api/admin/students?q=${encodeURIComponent(q)}&classId=${encodeURIComponent(classId)}`);
      setItems(j.students);
      const c = await api('/api/admin/classes');
      setClasses(c.classes);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createStudent(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/api/admin/students', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(create) });
      setCreate({ username: '', password: '', displayName: '', classId: '' });
      setMsg(t('saved'));
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function importCsv() {
    try {
      const j = await api('/api/admin/students/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) });
      setMsg(`${t('stCreate')}: ${j.created}، ${t('stStatus')}: ${j.skipped}. ${(j.errors || []).join(' | ')}`);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function saveEdit(id: string) {
    try {
      await api(`/api/admin/students/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: editForm.displayName, classId: editForm.classId || null, enabled: editForm.enabled }),
      });
      setEditing(null);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function remove(id: string, username: string) {
    const ok = await askConfirm({ title: `@${username}`, message: t('delStudentHint'), okLabel: t('del'), danger: true });
    if (!ok) return;
    try {
      await api(`/api/admin/students/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function resetPw(id: string) {
    const np = await askPrompt({ title: t('changePassword'), placeholder: t('tmpPwPh'), okLabel: t('save'), minLength: 6, isPassword: true });
    if (!np) return;
    try {
      await api(`/api/admin/students/${id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: np }),
      });
      setMsg(t('pwChanged'));
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="grid">
      {confirmDialog}
      {promptDialog}
      {msg && <div className="card"><span className="small">{msg}</span></div>}
      <div className="card">
        <div className="row">
          <input className="input" style={{ maxWidth: 260 }} placeholder={t('stSearchPh')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select" style={{ maxWidth: 220 }} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">{t('allClasses')}</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn btn-sm btn-primary" onClick={load}>{t('stSearch')}</button>
        </div>
        <div className="table-wrap mt">
          <table className="tbl">
            <thead><tr><th>{t('stName')}</th><th>{t('stUsername')}</th><th>{t('stClass')}</th><th>{t('stStatus')}</th><th>{t('stCreated')}</th><th>{t('stLastLogin')}</th><th>{t('stActions')}</th></tr></thead>
            <tbody>
              {items.map((u) => (
                <tr key={String(u.id)}>
                  <td>{editing === u.id ? <input className="input" value={editForm.displayName} onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })} /> : String(u.displayName)}</td>
                  <td dir="ltr">@{String(u.username)}</td>
                  <td>
                    {editing === u.id ? (
                      <select className="select" value={editForm.classId} onChange={(e) => setEditForm({ ...editForm, classId: e.target.value })}>
                        <option value="">—</option>
                        {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : (u.className as string) || '—'}
                  </td>
                  <td>
                    {editing === u.id ? (
                      <select className="select" value={editForm.enabled ? '1' : '0'} onChange={(e) => setEditForm({ ...editForm, enabled: e.target.value === '1' })}>
                        <option value="1">{t('stEnabled')}</option>
                        <option value="0">{t('stDisabled')}</option>
                      </select>
                    ) : (u.enabled ? t('stEnabled') : t('stDisabled'))}
                  </td>
                  <td className="small">{String(u.createdAt).slice(0, 16).replace('T', ' ')}</td>
                  <td className="small">{u.lastLoginAt ? String(u.lastLoginAt).slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td>
                    <div className="row">
                      {editing === u.id ? (
                        <>
                          <button className="btn btn-sm btn-primary" onClick={() => saveEdit(String(u.id))}>{t('save')}</button>
                          <button className="btn btn-sm" onClick={() => setEditing(null)}>{t('stCancel')}</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-sm" onClick={() => { setEditing(String(u.id)); setEditForm({ displayName: String(u.displayName), classId: String(u.classId || ''), enabled: !!u.enabled }); }}><Pencil size={13} /></button>
                          <button className="btn btn-sm" title={t('changePassword')} onClick={() => resetPw(String(u.id))}><KeyRound size={13} /></button>
                          <button className="btn btn-sm" onClick={() => remove(String(u.id), String(u.username))}><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3><Plus size={15} /> {t('stCreate')}</h3>
          <form onSubmit={createStudent}>
            <label className="lbl">{t('username')}</label>
            <input className="input" value={create.username} onChange={(e) => setCreate({ ...create, username: e.target.value })} required />
            <label className="lbl">{t('password')}</label>
            <input className="input" type="password" value={create.password} onChange={(e) => setCreate({ ...create, password: e.target.value })} required />
            <label className="lbl">{t('displayName')}</label>
            <input className="input" value={create.displayName} onChange={(e) => setCreate({ ...create, displayName: e.target.value })} required />
            <label className="lbl">{t('class')}</label>
            <select className="select" value={create.classId} onChange={(e) => setCreate({ ...create, classId: e.target.value })}>
              <option value="">—</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn btn-primary mt">{t('stCreateBtn')}</button>
          </form>
        </div>
        <div className="card">
          <h3><Upload size={15} /> {t('stImport')}</h3>
          <p className="hint">{t('stImportHint')}</p>
          <textarea className="textarea" rows={7} value={csv} onChange={(e) => setCsv(e.target.value)} dir="ltr" />
          <button className="btn mt" onClick={importCsv}>{t('stImportBtn')}</button>
        </div>
      </div>
    </div>
  );
}

function Classes() {
  const { t } = useT();
  const { dialog: confirmDialog, ask: askConfirm } = useConfirm();
  const [items, setItems] = useState<{ id: string; name: string; enabled: number; studentCount: number }[]>([]);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [rename, setRename] = useState('');
  const [reassign, setReassign] = useState<Record<string, string>>({});

  async function load() {
    try {
      const j = await api('/api/admin/classes');
      setItems(j.classes);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/api/admin/classes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      setName('');
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function toggle(c: { id: string; enabled: number }) {
    await api(`/api/admin/classes/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !c.enabled }) });
    load();
  }

  async function doRename(id: string) {
    if (!rename.trim()) return;
    try {
      await api(`/api/admin/classes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: rename }) });
      setRename('');
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function remove(id: string, count: number) {
    if (count > 0 && !reassign[id]) {
      setMsg(t('needTarget'));
      return;
    }
    const ok = await askConfirm({ title: t('tabClasses'), message: t('delClassMsg'), okLabel: t('del'), danger: true });
    if (!ok) return;
    if (count > 0) {
      const target = reassign[id];
      try {
        await fetch(`/api/admin/classes/${id}?reassignTo=${encodeURIComponent(target)}`, { method: 'DELETE' }).then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
        });
        load();
      } catch (e) {
        setMsg(translateError((e as Error).message));
      }
      return;
    }
    try {
      await api(`/api/admin/classes/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="grid">
      {confirmDialog}
      {msg && <div className="card"><span className="small">{msg}</span></div>}
      <div className="card">
        <form onSubmit={create} className="row">
          <input className="input" style={{ maxWidth: 320 }} placeholder={t('clNewPh')} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-primary btn-sm">{t('clCreate')}</button>
        </form>
      </div>
      <div className="grid grid-2">
        {items.map((c) => (
          <div key={c.id} className="card">
            <div className="space">
              <b>{c.name}</b>
              <span className={`status ${c.enabled ? 'status-downloaded' : 'status-expired'}`}>{c.enabled ? t('clEnabled') : t('clDisabled')}</span>
            </div>
            <p className="muted small">{c.studentCount} {t('clStudents')} · ID: {c.id.slice(0, 8)}</p>
            {c.studentCount > 0 && (
              <select
                className="select"
                style={{ maxWidth: 220 }}
                value={reassign[c.id] || ''}
                onChange={(e) => setReassign({ ...reassign, [c.id]: e.target.value })}
              >
                <option value="">{t('needTarget')}</option>
                {items.filter((x) => x.id !== c.id).map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            )}
            <div className="row">
              <input className="input" style={{ maxWidth: 200 }} placeholder={t('clRename')} value={rename} onChange={(e) => setRename(e.target.value)} />
              <button className="btn btn-sm" onClick={() => doRename(c.id)}>{t('clRename')}</button>
              <button className="btn btn-sm" onClick={() => toggle(c)}>{c.enabled ? t('clDisable') : t('clEnable')}</button>
              <button className="btn btn-sm" onClick={() => remove(c.id, c.studentCount)}><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Transfers() {
  const { t } = useT();
  const { dialog: confirmDialog, ask: askConfirm } = useConfirm();
  const [items, setItems] = useState<Record<string, string | number | null>[]>([]);
  const [f, setF] = useState({ sender: '', recipient: '', status: '', date: '', fileType: '' });
  const [msg, setMsg] = useState('');
  const [detail, setDetail] = useState<{ transfer: Record<string, unknown>; files: { id: string; originalName: string; mime: string; size: number }[] } | null>(null);

  async function load() {
    try {
      const p = new URLSearchParams(f as Record<string, string>).toString();
      const j = await api(`/api/admin/transfers?${p}`);
      setItems(j.transfers);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(id: string, action: string) {
    try {
      await api(`/api/admin/transfers/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      load();
      setDetail(null);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function del(id: string) {
    const ok = await askConfirm({ title: t('tabTransfers'), message: t('delTransferMsg'), okLabel: t('del'), danger: true });
    if (!ok) return;
    try {
      await api(`/api/admin/transfers/${id}`, { method: 'DELETE' });
      load();
      setDetail(null);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function open(id: string) {
    try {
      const j = await api(`/api/admin/transfers/${id}`);
      setDetail(j);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function delFile(fileId: string) {
    const ok = await askConfirm({ title: t('trFiles'), message: t('delFileMsg'), okLabel: t('del'), danger: true });
    if (!ok) return;
    try {
      await api(`/api/admin/files/${fileId}`, { method: 'DELETE' });
      setDetail(null);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="grid">
      {confirmDialog}
      {msg && <div className="card"><span className="small">{msg}</span></div>}
      <div className="card">
        <div className="row">
          <input className="input" style={{ maxWidth: 170 }} placeholder={t('trSender')} value={f.sender} onChange={(e) => setF({ ...f, sender: e.target.value })} />
          <input className="input" style={{ maxWidth: 170 }} placeholder={t('trRecipient')} value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })} />
          <select className="select" style={{ maxWidth: 150 }} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">{t('trAllStatuses')}</option>
            {['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'DOWNLOADED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="input" style={{ maxWidth: 150 }} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <button className="btn btn-sm btn-primary" onClick={load}>{t('trFilter')}</button>
        </div>
        <div className="table-wrap mt">
          <table className="tbl">
            <thead><tr><th>{t('trRoute')}</th><th>{t('trFiles')}</th><th>{t('trStatus')}</th><th>{t('trDate')}</th><th>{t('trActions')}</th></tr></thead>
            <tbody>
              {items.map((x) => (
                <tr key={String(x.id)}>
                  <td className="small" dir="ltr">{String(x.senderUsername)} → {String(x.recipientUsername)}</td>
                  <td className="small">{String(x.fileCount)} · {formatBytes(Number(x.totalBytes))}</td>
                  <td><span className="status status-pending">{String(x.status)}</span></td>
                  <td className="small">{String(x.createdAt).slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    <div className="row">
                      <button className="btn btn-sm" onClick={() => open(String(x.id))}>{t('trView')}</button>
                      <button className="btn btn-sm" onClick={() => act(String(x.id), 'cancel')}>{t('trCancel')}</button>
                      <button className="btn btn-sm" onClick={() => act(String(x.id), 'expire')}>{t('trExpire')}</button>
                      <button className="btn btn-sm" onClick={() => del(String(x.id))}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {detail && (
        <div className="card">
          <h3>{t('trMeta')}</h3>
          {detail.files.map((fl) => (
            <div key={fl.id} className="file-item">
              <div className="grow"><b>{fl.originalName}</b><div className="small muted">{formatBytes(fl.size)} · {fl.mime}</div></div>
              <button className="btn btn-sm" onClick={() => delFile(fl.id)}><Trash2 size={13} /> {t('del')}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Storage() {
  const { t } = useT();
  const [info, setInfo] = useState<Record<string, number> | null>(null);
  const [msg, setMsg] = useState('');
  async function load() {
    try {
      const j = await api('/api/admin/storage');
      setInfo(j.storage);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function cleanup() {
    try {
      const j = await api('/api/admin/cleanup', { method: 'POST' });
      setMsg(`${t('sgCleanup')}: ${j.filesRemoved}، ${j.expired}.`);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  if (!info) return <div className="card">{t('loading')}</div>;
  return (
    <div className="grid">
      {msg && <div className="card"><span className="small">{msg}</span></div>}
      <div className="grid grid-3">
        <div className="card"><b>{t('sgUsed')}</b><div>{formatBytes(info.used)}</div></div>
        <div className="card"><b>{t('sgFree')}</b><div>{info.total ? formatBytes(info.free) : '؟'}</div></div>
        <div className="card"><b>{t('sgFiles')}</b><div>{info.fileCount}</div></div>
        <div className="card"><b>{t('sgPending')}</b><div>{info.pending}</div></div>
        <div className="card"><b>{t('sgExpired')}</b><div>{info.expired}</div></div>
        <div className="card"><b>{t('sgDb')}</b><div>{formatBytes(info.dbSize)}</div></div>
      </div>
      <div className="card">
        <button className="btn btn-primary" onClick={cleanup}><RefreshCw size={15} /> {t('sgCleanup')}</button>
        <p className="hint">{t('sgHint')}</p>
      </div>
    </div>
  );
}

function SettingsPanel() {
  const { t } = useT();
  const [s, setS] = useState<Record<string, string | boolean | number>>({});
  const [restrictions, setRestrictions] = useState('{}');
  const [msg, setMsg] = useState('');
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api('/api/admin/settings').then((j) => {
      setS(j.settings);
      setRestrictions(typeof j.settings.classRestrictions === 'string' ? j.settings.classRestrictions : JSON.stringify(j.settings.classRestrictions || {}));
    }).catch(() => {});
    api('/api/admin/classes').then((j) => setClasses(j.classes)).catch(() => {});
  }, []);

  async function save() {
    try {
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(restrictions || '{}');
      } catch {
        setMsg('classRestrictions JSON؟');
        return;
      }
      const j = await api('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...s, classRestrictions: parsed }),
      });
      setS(j.settings);
      setMsg(t('saved'));
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  const bool = (k: string) => (
    <select className="select" value={String(!!s[k])} onChange={(e) => setS({ ...s, [k]: e.target.value === 'true' })}>
      <option value="true">{t('seOn')}</option>
      <option value="false">{t('seOff')}</option>
    </select>
  );
  const num = (k: string) => (
    <input className="input" type="number" value={String(s[k] ?? '')} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} />
  );
  const txt = (k: string) => (
    <input className="input" value={String(s[k] ?? '')} onChange={(e) => setS({ ...s, [k]: e.target.value })} dir="ltr" />
  );

  return (
    <div className="grid">
      {msg && <div className="card"><span className="small">{msg}</span></div>}
      <div className="card">
        <h3>{t('seGeneral')}</h3>
        <label className="lbl">{t('seRegistration')}</label>{bool('registrationEnabled')}
        <label className="lbl">{t('seMaintenance')}</label>{bool('maintenanceMode')}
        <label className="lbl">{t('seAllowClass')}</label>{bool('allowClassChange')}
        <label className="lbl">{t('seMaxSize')}</label>{num('maxFileSizeMB')}
        <label className="lbl">{t('seMaxFiles')}</label>{num('maxFilesPerTransfer')}
        <label className="lbl">{t('seAllowExt')}</label>{txt('allowedExtensions')}
        <label className="lbl">{t('seBlockExt')}</label>{txt('blockedExtensions')}
        <label className="lbl">{t('seExpiry')}</label>{num('defaultExpiryHours')}
        <label className="lbl">{t('seMultiDl')}</label>{bool('allowMultipleDownloads')}
        <label className="lbl">{t('seMaxDl')}</label>{num('maxDownloads')}
      </div>
      <div className="card">
        <h3>{t('seClassRestr')}</h3>
        <label className="lbl">{t('seSendScope')}</label>
        <select className="select" value={String(s.sendScope || 'anyone')} onChange={(e) => setS({ ...s, sendScope: e.target.value })}>
          <option value="anyone">{t('seScopeAnyone')}</option>
          <option value="same-class">{t('seScopeSame')}</option>
          <option value="selected">{t('seScopeSelected')}</option>
        </select>
        <p className="hint">{t('seRestrHint')}</p>
        <p className="hint" dir="ltr">{classes.map((c) => `${c.name} = ${c.id}`).join(' · ') || '—'}</p>
        <textarea className="textarea" rows={5} value={restrictions} onChange={(e) => setRestrictions(e.target.value)} dir="ltr" />
      </div>
      <div className="card">
        <h3>{t('seStorage')}</h3>
        <label className="lbl">{t('seRetDeclined')}</label>{num('retentionDeclinedDays')}
        <label className="lbl">{t('seRetCancelled')}</label>{num('retentionCancelledDays')}
        <label className="lbl">{t('seRetExpired')}</label>{num('retentionExpiredDays')}
        <label className="lbl">{t('seRetCompleted')}</label>{num('retentionCompletedDays')}
        <label className="lbl">{t('seAutoDel')}</label>{bool('autoDeleteExpired')}
        <label className="lbl">{t('seAdminPreview')}</label>{bool('adminCanPreview')}
        <button className="btn btn-primary mt" onClick={save}>{t('seSave')}</button>
      </div>
    </div>
  );
}

function Logs() {
  const { t } = useT();
  const [items, setItems] = useState<Record<string, string | number>[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [f, setF] = useState({ action: '', actor: '', date: '' });
  useEffect(() => {
    api('/api/admin/logs').then((j) => { setItems(j.logs); setActions(j.actions); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function load() {
    const p = new URLSearchParams(f as Record<string, string>).toString();
    const j = await api(`/api/admin/logs?${p}`);
    setItems(j.logs);
    setActions(j.actions);
  }
  return (
    <div className="card">
      <div className="row">
        <select className="select" style={{ maxWidth: 220 }} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
          <option value="">{t('lgAllActions')}</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input className="input" style={{ maxWidth: 200 }} placeholder={t('lgUser')} value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} />
        <input className="input" style={{ maxWidth: 160 }} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <button className="btn btn-sm btn-primary" onClick={load}>{t('lgFilter')}</button>
      </div>
      <div className="table-wrap mt">
        <table className="tbl">
          <thead><tr><th>{t('lgDate')}</th><th>{t('lgActor')}</th><th>{t('lgAction')}</th><th>{t('lgDetails')}</th><th>{t('lgIp')}</th></tr></thead>
          <tbody>
            {items.map((l) => (
              <tr key={String(l.id)}>
                <td className="small">{String(l.createdAt).slice(0, 19).replace('T', ' ')}</td>
                <td className="small">{String(l.actorType)}:{String(l.actorName)}</td>
                <td className="small"><b>{String(l.action)}</b></td>
                <td className="small">{String(l.details).slice(0, 140)}</td>
                <td className="small">{String(l.ip)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function System() {
  const { t } = useT();
  const { dialog: confirmDialog, ask: askConfirm } = useConfirm();
  const [sys, setSys] = useState<Record<string, string | number> | null>(null);
  const [net, setNet] = useState<{ localUrl: string; lanUrls: string[]; primaryUrl: string; port: number; status: string } | null>(null);
  const [backups, setBackups] = useState<{ name: string; size: number; createdAt: string }[]>([]);
  const [msg, setMsg] = useState('');
  const [includeFiles, setIncludeFiles] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [qrUrl, setQrUrl] = useState('');

  async function load() {
    try {
      const [a, b, c] = await Promise.all([api('/api/admin/system'), api('/api/admin/network'), api('/api/admin/backup')]);
      setSys(a.system);
      setNet(b);
      setBackups(c.backups);
      setQrUrl((prev) => prev || b.primaryUrl || '');
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function backup() {
    try {
      const j = await api('/api/admin/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ includeFiles }) });
      setMsg(`${t('syCreateBackup')}: ${j.file}`);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function restore(name: string) {
    const ok = await askConfirm({ title: name, message: t('restoreMsg'), okLabel: t('syRestore'), danger: true });
    if (!ok) return;
    try {
      await api('/api/admin/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: name }) });
      setMsg(t('saved'));
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/api/admin/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pw) });
      setMsg(t('pwChanged'));
      setPw({ currentPassword: '', newPassword: '' });
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="grid">
      {confirmDialog}
      {msg && <div className="card"><span className="small">{msg}</span></div>}
      <div className="grid grid-2">
        <div className="card">
          <h3><Server size={15} /> {t('syServer')}</h3>
          {sys ? (
            <dl className="kv">
              <dt>{t('syStatus')}</dt><dd>{String(sys.status)}</dd>
              <dt>{t('syVersion')}</dt><dd>{String(sys.appVersion)}</dd>
              <dt>{t('syDb')}</dt><dd>{formatBytes(Number(sys.dbSize))}</dd>
              <dt>{t('syStorage')}</dt><dd>{formatBytes(Number(sys.storageUsed))}</dd>
              <dt>{t('syUsers')}</dt><dd>{String(sys.users)}</dd>
              <dt>{t('syClasses')}</dt><dd>{String(sys.classes)}</dd>
              <dt>{t('syTransfers')}</dt><dd>{String(sys.transfers)}</dd>
              <dt>{t('syUptime')}</dt><dd>{Math.floor(Number(sys.uptimeSeconds) / 60)} {t('syMin')}</dd>
            </dl>
          ) : t('loading')}
        </div>
        <div className="card">
          <h3>{t('syNetwork')}</h3>
          {net ? (
            <>
              <p className="small">{t('syStatus')}: <b dir="ltr">{net.localUrl}</b></p>
              {net.lanUrls.map((u) => <p key={u} className="small">LAN: <b dir="ltr">{u}</b></p>)}
              <label className="lbl">{t('syQrLabel')}</label>
              <select className="select" value={qrUrl} onChange={(e) => setQrUrl(e.target.value)} dir="ltr">
                {net.lanUrls.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <div className="qr-box mt">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {qrUrl && <img src={`/api/admin/qr?text=${encodeURIComponent(qrUrl)}`} alt="LAN QR" width={180} height={180} />}
              </div>
              <p className="hint">{t('syQrHint')}</p>
            </>
          ) : t('loading')}
        </div>
      </div>

      <div className="card">
        <h3>{t('syBackup')}</h3>
        <div className="row">
          <label className="small"><input type="checkbox" checked={includeFiles} onChange={(e) => setIncludeFiles(e.target.checked)} /> {t('syIncludeFiles')}</label>
          <button className="btn btn-sm btn-primary" onClick={backup}>{t('syCreateBackup')}</button>
        </div>
        <div className="table-wrap mt">
          <table className="tbl">
            <thead><tr><th>{t('syFile')}</th><th>{t('sySize')}</th><th>{t('syCreated')}</th><th>{t('syActions')}</th></tr></thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.name}>
                  <td className="small" dir="ltr">{b.name}</td>
                  <td className="small">{formatBytes(b.size)}</td>
                  <td className="small">{b.createdAt.slice(0, 19).replace('T', ' ')}</td>
                  <td>
                    <div className="row">
                      <a className="btn btn-sm" href={`/api/admin/backup/download?file=${encodeURIComponent(b.name)}`}>{t('syDownload')}</a>
                      <button className="btn btn-sm" onClick={() => restore(b.name)}>{t('syRestore')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">{t('syBackupHint')}</p>
      </div>

      <div className="card">
        <h3><KeyRound size={15} /> {t('syChangePw')}</h3>
        <form onSubmit={changePw} className="row">
          <input className="input" style={{ maxWidth: 220 }} type="password" placeholder={t('currentPassword')} value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
          <input className="input" style={{ maxWidth: 220 }} type="password" placeholder={t('syNew')} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required minLength={8} />
          <button className="btn btn-sm btn-primary">{t('syChange')}</button>
        </form>
      </div>
    </div>
  );
}
