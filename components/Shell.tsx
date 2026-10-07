'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Bell, User, Settings as SettingsIcon, SendHorizonal, MessageCircle, Files, BookOpen, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useT();
  const [unread, setUnread] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [libraryEnabled, setLibraryEnabled] = useState(true);
  const [maintenance, setMaintenance] = useState(false);

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
      try {
        const c = await fetch('/api/chat/status', { cache: 'no-store' });
        if (c.ok && alive) {
          const j = await c.json();
          setChatUnread(j.unreadTotal || 0);
          if (typeof j.enabled === 'boolean') setChatEnabled(j.enabled);
        }
      } catch {}
      try {
        const p = await fetch('/api/settings/public', { cache: 'no-store' });
        if (p.ok && alive) {
          const j = await p.json();
          if (j.settings && typeof j.settings.libraryEnabled === 'boolean') {
            setLibraryEnabled(j.settings.libraryEnabled);
          }
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
    { href: '/files', label: t('files'), icon: <Files size={18} /> },
    ...(libraryEnabled ? [{ href: '/library', label: t('library'), icon: <BookOpen size={18} /> }] : []),
    ...(chatEnabled ? [{ href: '/chat', label: t('chat'), icon: <MessageCircle size={18} />, badge: chatUnread }] : []),
    { href: '/notifications', label: t('notifications'), icon: <Bell size={18} />, badge: unread },
    { href: '/profile', label: t('profile'), icon: <User size={18} /> },
    { href: '/settings', label: t('settings'), icon: <SettingsIcon size={18} /> },
  ];
  // Mobile bottom bar stays compact: profile lives inside the Settings page.
  const mobileLinks = links.filter((l) => l.href !== '/profile');

  // Maintenance mode: any STUDENT page shows the maintenance notice instead of
  // its content. Auth pages, /webadmin and /teacher/* are never gated, so
  // login, admins and teachers keep working. Logged-out visitors fall through
  // (pages redirect to login as usual).
  useEffect(() => {
    if (isAuthPage || isAdminArea || isTeacherArea) {
      setMaintenance(false);
      return;
    }
    let alive = true;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) {
          setMaintenance(false);
          return;
        }
        const j = await r.json().catch(() => ({}));
        setMaintenance(!!j.maintenanceMode);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname, isAuthPage, isAdminArea, isTeacherArea]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand" style={{ textDecoration: 'none' }}>
            <span className="brand-mark">
              <SendHorizonal size={20} />
            </span>
            <span>
              <span className="brand-name">
                {t('brand')} <span className="beta-badge">beta</span>
              </span>
              <small>{t('tagline')}</small>
            </span>
          </Link>
          <nav className="nav" aria-label="Main">
            {!isAuthPage && !isAdminArea && !isTeacherArea &&
              links.map((l) => (
                <Link key={l.href} href={l.href} className={pathname === l.href ? 'active' : ''} aria-label={l.label}>
                  {l.icon}
                  <span className="nav-label">{l.label}</span>
                  {typeof l.badge === 'number' && l.badge > 0 && <span className="badge-count">{l.badge > 99 ? '99+' : l.badge}</span>}
                </Link>
              ))}
          </nav>
        </div>
        <style>{`@media (max-width: 859px){ .topbar .nav{ display:none; } }`}</style>
      </header>
      <main className="container page">
        {maintenance ? (
          <div className="center-wrap">
            <div className="card" style={{ textAlign: 'center' }}>
              <div className="logo-big" style={{ marginInline: 'auto' }}>
                <Wrench size={28} />
              </div>
              <h2>{t('maintenanceTitle')}</h2>
              <p className="muted">{t('maintenanceSub')}</p>
              <button className="btn" onClick={() => location.reload()}>
                {t('retry')}
              </button>
            </div>
          </div>
        ) : (
          children
        )}
      </main>
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
