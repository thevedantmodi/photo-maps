import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin sign in',
  robots: { index: false, follow: false },
  manifest: '/admin-app.webmanifest',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
