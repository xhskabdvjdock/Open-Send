'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useT } from '@/lib/i18n';

export type Theme = 'light' | 'dark';

const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'dark', toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Dark is the default theme for new visitors.
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('opensend-theme') as Theme | null;
      const initial = saved === 'dark' || saved === 'light' ? saved : 'dark';
      setTheme(initial);
      document.documentElement.dataset.theme = initial;
    } catch {}
  }, []);

  const toggle = () => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem('opensend-theme', next);
      } catch {}
      document.documentElement.dataset.theme = next;
      return next;
    });
  };

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  return useContext(Ctx);
}

export function ThemeToggle(): React.JSX.Element {
  const { theme, toggle } = useTheme();
  const { t } = useT();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? t('themeLight') : t('themeDark')}
      aria-label={dark ? t('themeLight') : t('themeDark')}
      className="theme-toggle"
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
