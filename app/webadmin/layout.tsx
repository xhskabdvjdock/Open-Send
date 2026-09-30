import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin — Open Send',
  robots: { index: false, follow: false },
};

export default function WebAdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
