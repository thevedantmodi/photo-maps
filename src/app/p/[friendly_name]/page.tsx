import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getPhotoBySlug } from '@/lib/photos';
import { CARD } from '@/lib/shareTokens';
import styles from './photo.module.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ friendly_name: string }> };

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { friendly_name } = await params;
  const photo = await getPhotoBySlug(friendly_name);
  if (!photo) return { title: 'Photo not found' };

  const title = photo.caption || photo.original_name;
  const base = process.env.NEXT_PUBLIC_BASE_URL;

  return {
    ...(base ? { metadataBase: new URL(base) } : {}),
    title: `${title} — Photos by Vedant Modi`,
    description: 'Photos! Mapped!',
    openGraph: {
      title,
      description: 'Photos! Mapped!',
      type: 'article',
      images: [
        {
          url: `/api/share/${friendly_name}`,
          width: CARD.width,
          height: CARD.height,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      images: [`/api/share/${friendly_name}`],
    },
  };
}

export default async function PhotoPage({ params }: Props) {
  const { friendly_name } = await params;
  const photo = await getPhotoBySlug(friendly_name);
  if (!photo) notFound();

  const date = formatDate(photo.date);

  return (
    <main className={styles.page}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={styles.photo}
        src={photo.large_url}
        alt={photo.caption || photo.original_name}
      />
      <div className={styles.caption}>
        <span>{photo.caption || photo.original_name}</span>
        {date && <span className={styles.date}>{date}</span>}
      </div>
      <a className={styles.mapLink} href={`/#${encodeURIComponent(photo.friendly_name)}`}>
        Open on the map
      </a>
    </main>
  );
}
