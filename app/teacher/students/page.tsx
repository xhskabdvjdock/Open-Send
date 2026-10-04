'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Search, Users, Eye } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Loading } from '@/components/feedback';
import { TeacherNav } from '@/components/TeacherNav';

export default function TeacherStudentsPage() {
  const router = useRouter();
  const { t } = useT();
  const [students, setStudents] = useState<Record<string, unknown>[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{ student: Record<string, unknown>; submissions: Record<string, unknown>[] } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/teacher/students?q=${encodeURIComponent(q)}&classId=${encodeURIComponent(classId)}`, { cache: 'no-store' });
      if (r.status === 401) {
        router.replace('/teacher/login');
        return;
      }
      const j = await r.json();
      setStudents(j.students || []);
      if (j.classes) setClasses(j.classes);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch('/api/teacher/me', { cache: 'no-store' }).then((r) => {
      if (r.status === 401) router.replace('/teacher/login');
    });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function open(id: string) {
    const r = await fetch(`/api/teacher/students/${id}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      setDetail(j);
    }
  }

  if (loading) return <Loading label={t('loading')} />;

  return (
    <div>
      <TeacherNav />
      <div className="card">
        <h2><Users size={18} /> {t('students')} ({students.length})</h2>
        <div className="row">
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={16} style={{ position: 'absolute', insetInlineStart: 12, top: 13, color: 'var(--muted)' }} />
            <input className="input" style={{ paddingInlineStart: 34 }} placeholder={t('searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
          </div>
          <select className="select" style={{ maxWidth: 200 }} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">{t('allClasses')}</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn btn-sm btn-primary" onClick={load}>{t('stSearch')}</button>
        </div>
        <div className="table-wrap mt">
          <table className="tbl">
            <thead><tr><th>{t('stName')}</th><th>{t('stUsername')}</th><th>{t('stClass')}</th><th>{t('submissions')}</th><th></th></tr></thead>
            <tbody>
              {students.map((s) => (
                <tr key={String(s.id)}>
                  <td><b>{String(s.displayName)}</b></td>
                  <td dir="ltr">@{String(s.username)}</td>
                  <td className="small">{String((s.className as string) || '—')}</td>
                  <td className="small">{String(s.submissionCount)}</td>
                  <td><button className="btn btn-sm" onClick={() => open(String(s.id))}><Eye size={13} /> {t('view')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {detail && (
        <div className="card mt">
          <h3>{String(detail.student.displayName)} (@{String(detail.student.username)})</h3>
          <p className="small muted">{t('class')}: {String((detail.student.className as string) || '—')}</p>
          <h4>{t('submissions')} ({detail.submissions.length})</h4>
          {detail.submissions.map((s) => (
            <div key={String(s.id)} className="small">
              {String(s.folderName)} — #{String(s.submissionNumber)} · {String(s.status)} · {Number(s.isLate) ? t('late') : t('onTime')} · {String(s.createdAt).slice(0, 16).replace('T', ' ')}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
