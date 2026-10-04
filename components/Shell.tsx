'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Send, Inbox, FolderUp, Bell, User, Settings as SettingsIcon, SendHorizonal, FolderOpen, ClipboardList } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useT();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const n = await fetch('/api/notifications/unread-count', { cache: 'no-store' });
        if (n.ok && alive) {
          const j = await n.json();
          setUnread(j.unread || 0);
        }
      } catch {}
    }
    load();
    const id = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pathname]);

  const isAuthPage = pathname === '/login' || pathname === '/register';
  const isAdminArea = pathname.startsWith('/webadmin');
  const isTeacherArea = pathname.startsWith('/teacher');
  // NOTE: /webadmin is intentionally never linked from student UI.

  const links = [
    { href: '/', label: t('home'), icon: <Home size={18} /> },
    { href: '/send', label: t('send'), icon: <Send size={18} /> },
    { href: '/folders', label: t('teacherFolders'), icon: <FolderOpen size={18} /> },
    { href: '/submissions', label: t('mySubmissions'), icon: <ClipboardList size={18} /> },
    { href: '/received', label: t('received'), icon: <Inbox size={18} /> },
    { href: '/sent', label: t('sent'), icon: <FolderUp size={18} /> },
    { href: '/notifications', label: t('notifications'), icon: <Bell size={18} />, badge: unread },
    { href: '/profile', label: t('profile'), icon: <User size={18} /> },
    { href: '/settings', label: t('settings'), icon: <SettingsIcon size={18} /> },
  ];
  // Mobile bottom bar stays compact: profile lives inside the Settings page.
  const mobileLinks = links.filter((l) => l.href !== '/profile');

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand" style={{ textDecoration: 'none' }}>
            <span className="brand-mark">
              <SendHorizonal size={20} />
            </span>
            <span>
              {t('brand')}
              <small>{t('tagline')}</small>
            </span>
          </Link>
          <nav className="nav" aria-label="Main">
            {!isAuthPage && !isAdminArea && !isTeacherArea &&
              links.map((l) => (
                <Link key={l.href} href={l.href} className={pathname === l.href ? 'active' : ''}>
                  {l.icon}
                  <span className="hide-mobile">{l.label}</span>
                  {typeof l.badge === 'number' && l.badge > 0 && <span className="badge-count">{l.badge > 99 ? '99+' : l.badge}</span>}
                </Link>
              ))}
          </nav>
        </div>
        <style>{`@media (max-width: 859px){ .hide-mobile{ display:none; } .nav a{ padding:9px 10px; } }`}</style>
      </header>
      <main className="container page">{children}</main>
      {!isAuthPage && !isAdminArea && !isTeacherArea && (
        <nav className="bottom-nav" aria-label="Mobile">
          {mobileLinks.map((l) => (
            <Link key={l.href} href={l.href} className={pathname === l.href ? 'active' : ''}>
              {l.icon}
              {l.label}
              {typeof l.badge === 'number' && l.badge > 0 && <span className="badge-count">{l.badge > 99 ? '99+' : l.badge}</span>}
            </Link>
          ))}
        </nav>
      )}
      <div className="container">
        <p className="footer-note">Open Send · {t('tagline')}</p>
      </div>
    </>
  );
}
