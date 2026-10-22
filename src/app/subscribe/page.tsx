import type { Metadata } from 'next';
import Link from 'next/link';

import RssIcon from '@/app/components/RssIcon';
import SiteHeader from '@/app/components/SiteHeader';
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

// The header's subscribe panel as a page of its own, so there's a link to hand people.
export default function SubscribePage() {
  return (
    <main className={styles.page}>
      <SiteHeader current="subscribe" />
      <div className={styles.card}>
        <h1 className={styles.title}>New photos by email</h1>
        <p className={styles.body}>
          At most once a week, only when there are new photos. Your address is kept by our email
          service and used for nothing else, and every email has an unsubscribe link.
        </p>
        <div className={styles.form}>
          <SubscribeForm />
        </div>
        <div className={styles.links}>
          <Link className={`${styles.link} ul`} href="/map">
            See the map →
          </Link>
          <a className={`${styles.link} ul`} href="/feed.xml">
            <RssIcon />
            RSS feed
          </a>
        </div>
      </div>
    </main>
  );
}
