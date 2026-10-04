'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, FolderOpen, Users, ScrollText, User, LogOut, GraduationCap } from 'lucide-react';
import { useT } from '@/lib/i18n';

export function TeacherNav({ name }: { name?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useT();
  const links = [
    { href: '/teacher', label: t('teacherDash'), icon: <LayoutDashboard size={16} /> },
    { href: '/teacher/folders', label: t('myFolders'), icon: <FolderOpen size={16} /> },
    { href: '/teacher/students', label: t('students'), icon: <Users size={16} /> },
    { href: '/teacher/activity', label: t('activity'), icon: <ScrollText size={16} /> },
    { href: '/teacher/profile', label: t('profile'), icon: <User size={16} /> },
  ];
  async function logout() {
    await fetch('/api/teacher/logout', { method: 'POST' });
    router.push('/teacher/login');
  }
  if (pathname === '/teacher/login') return null;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="space">
        <div className="row">
          <span className="brand-mark" style={{ width: 32, height: 32 }}><GraduationCap size={18} /></span>
          <div>
            <b>Open Send <span className="beta-badge">beta</span> · {t('teacherRole')}</b>
            {name && <div className="small muted">{name}</div>}
          </div>
        </div>
        <button className="btn btn-sm" onClick={logout}><LogOut size={14} /> {t('logout')}</button>
      </div>
      <div className="admin-tabs" style={{ marginBottom: 0 }}>
        {links.map((l) => (
          <Link key={l.href} href={l.href} style={{ textDecoration: 'none' }}>
            <button type="button" className={pathname === l.href ? 'active' : ''} style={{ pointerEvents: 'none' }}>
              {l.icon} {l.label}
            </button>
          </Link>
        ))}
      </div>
    </div>
  );
}
