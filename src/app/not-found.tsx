import type { Metadata } from 'next';
import Link from 'next/link';

import SiteHeader from './components/SiteHeader';
import styles from './not-found.module.css';

export const metadata: Metadata = {
  title: 'Not found',
  robots: { index: false },
};

// Any unknown address, and a photo link whose photo has gone.
export default function NotFound() {
  return (
    <main className={styles.page}>
      <SiteHeader current="landing" />
      <div className={styles.card}>
        <p className={`label ${styles.kicker}`}>404</p>
        <h1 className={styles.title}>Nothing hangs here</h1>
        <p className={styles.body}>
          This page doesn&rsquo;t exist, or the photo it showed has been taken down.
        </p>
        <div className={styles.links}>
          <Link className={`${styles.link} ul`} href="/map">
            Enter the galleries →
          </Link>
          <Link className={`${styles.link} ul`} href="/directory">
            Directory
          </Link>
        </div>
      </div>
    </main>
  );
}
