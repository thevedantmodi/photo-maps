import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import SiteHeader from '@/app/components/SiteHeader';
import { addSubscriber, verifyConfirmToken } from '@/lib/subscribe';
import styles from '../subscribe.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Confirm subscription',
  robots: { index: false },
};

type Props = { searchParams: Promise<{ token?: string; status?: string }> };

async function confirm(formData: FormData) {
  'use server';
  const email = verifyConfirmToken(String(formData.get('token') ?? ''));
  if (!email) redirect('/subscribe/confirm?status=invalid');
  try {
    await addSubscriber(email);
  } catch (e) {
    console.error('[subscribe] confirm failed', e);
    redirect('/subscribe/confirm?status=error');
  }
  redirect('/subscribe/confirm?status=confirmed');
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.body}>{body}</p>
    </>
  );
}

// Confirming takes a button press rather than happening on page load: mail scanners
// fetch every link in an email, and a GET that subscribed would opt people in unasked.
export default async function ConfirmPage({ searchParams }: Props) {
  const { token, status } = await searchParams;
  const valid = token ? verifyConfirmToken(token) !== null : false;

  let content: React.ReactNode;
  if (status === 'confirmed') {
    content = (
      <Message
        title="You're subscribed"
        body="You'll get an email when new photos go up, at most once a week. Every email has an unsubscribe link."
      />
    );
  } else if (status === 'error') {
    content = <Message title="Something went wrong" body="Your subscription wasn't saved. Open the link from your email to try again." />;
  } else if (!valid) {
    content = (
      <>
        <Message
          title="This link has expired"
          body="Confirmation links work for 48 hours. Sign up again to get a new one."
        />
        <Link className={styles.button} href="/subscribe">
          Sign up again
        </Link>
      </>
    );
  } else {
    content = (
      <>
        <Message title="Confirm your subscription" body="Get an email when new photos go up, at most once a week." />
        <form action={confirm}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className={styles.button}>
            Confirm
          </button>
        </form>
      </>
    );
  }

  return (
    <main className={styles.page}>
      <SiteHeader current="subscribe" />
      <div className={styles.card}>
        {content}
        <Link className={`${styles.link} ul`} href="/map">
          Back to the map →
        </Link>
      </div>
    </main>
  );
}
