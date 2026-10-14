import type { Metadata } from 'next';
import Link from 'next/link';

import SubscribeForm from '@/app/components/SubscribeForm';
import { RSS_ALTERNATE, SITE_NAME } from '@/lib/site';
import styles from './subscribe.module.css';

const TITLE = `Subscribe to ${SITE_NAME}`;
const DESCRIPTION = 'Get an email when new photos go up, at most once a week.';

// og/twitter are spelled out because this is the page that gets pasted into chats, and the
// layout's site-wide preview would otherwise stand in for it.
export const metadata: Metadata = {
  title: 'Subscribe',
  description: DESCRIPTION,
  alternates: { canonical: '/subscribe', types: RSS_ALTERNATE },
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/subscribe', siteName: SITE_NAME, type: 'website' },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
};

// A standalone version of the map's subscribe popover, so there's a link to hand people.
export default function SubscribePage() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Get new photos by email</h1>
        <p className={styles.body}>
          A weekly email from {SITE_NAME}, only when there are new photos. Your address is stored with Resend and
          used for nothing else. Unsubscribe from any email.
        </p>
        <div className={styles.form}>
          <SubscribeForm />
        </div>
        <a className={styles.link} href="/feed.xml">
          Or follow the RSS feed
        </a>
        <Link className={styles.link} href="/">
          See the map
        </Link>
      </div>
    </main>
  );
}
