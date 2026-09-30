'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Sun, Moon, LogOut, User, Check } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Loading } from '@/components/feedback';

export default function SettingsPage() {
  const router = useRouter();
  const { t, lang, setLang } = useT();
  const { theme, toggle } = useTheme();
  const [me, setMe] = useState<{ displayName: string; username: string; className: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => {
        if (r.status === 401) router.replace('/login');
        return r.ok ? r.json() : null;
      })
      .then((j) => {
        if (j) setMe(j.user);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [router]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  if (loading) return <Loading label={t('loading')} />;

  const setTheme = (want: 'light' | 'dark') => {
    if ((want === 'dark') !== (theme === 'dark')) toggle();
  };

  return (
    <div className="grid" style={{ maxWidth: 620, marginInline: 'auto' }}>
      <h2 style={{ margin: 0 }}>{t('settings')}</h2>

      <div className="card">
        <h3>{t('appearance')}</h3>
        <div className="row">
          <button
            type="button"
            className={`btn ${theme === 'light' ? 'btn-primary' : ''}`}
            onClick={() => setTheme('light')}
          >
            <Sun size={17} /> {t('themeLight')} {theme === 'light' && <Check size={15} />}
          </button>
          <button
            type="button"
            className={`btn ${theme === 'dark' ? 'btn-primary' : ''}`}
            onClick={() => setTheme('dark')}
          >
            <Moon size={17} /> {t('themeDark')} {theme === 'dark' && <Check size={15} />}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>{t('language')}</h3>
        <div className="row">
          <button
            type="button"
            className={`btn ${lang === 'ar' ? 'btn-primary' : ''}`}
            onClick={() => setLang('ar')}
          >
            العربية {lang === 'ar' && <Check size={15} />}
          </button>
          <button
            type="button"
            className={`btn ${lang === 'en' ? 'btn-primary' : ''}`}
            onClick={() => setLang('en')}
          >
            English {lang === 'en' && <Check size={15} />}
          </button>
        </div>
        <p className="hint mt">{t('autoSaved')}</p>
      </div>

      <div className="card">
        <h3>{t('account')}</h3>
        {me && (
          <dl className="kv">
            <dt>{t('displayName')}</dt><dd>{me.displayName}</dd>
            <dt>{t('username')}</dt><dd dir="ltr">@{me.username}</dd>
            <dt>{t('class')}</dt><dd>{me.className || '—'}</dd>
          </dl>
        )}
        <div className="row mt">
          <Link href="/profile" className="btn">
            <User size={16} /> {t('goProfile')}
          </Link>
          <button type="button" className="btn btn-danger" onClick={logout}>
            <LogOut size={16} /> {t('logout')}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>{t('aboutApp')}</h3>
        <p className="muted small" style={{ margin: 0 }}>Open Send · {t('tagline')} · v1.0.0</p>
      </div>
    </div>
  );
}
