import type { Metadata } from 'next';

// The admin page itself is a client component, so its title lives here. robots.txt already
// keeps crawlers out; noindex covers a link to it turning up somewhere.
export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
