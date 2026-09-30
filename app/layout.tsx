import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import './globals.css';
import { LanguageProvider } from '@/lib/i18n';
import { ThemeProvider } from '@/lib/theme';
import { Shell } from '@/components/Shell';

// Self-hosted at build time: works fully offline at runtime.
// Primary Arabic face is خط ثمانية (Thamaniya) via @font-face in globals.css;
// this font is the automatic fallback until the licensed files are added.
const arabicFallback = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-arabic',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Open Send — School File Sharing',
  description: 'Private local-network file sharing for students. No cloud required.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0d0d0d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={arabicFallback.variable}>
      <body>
        <LanguageProvider>
          <ThemeProvider>
            <Shell>{children}</Shell>
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
