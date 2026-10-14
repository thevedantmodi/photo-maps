import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import type { Photo } from '@/app/types';
import { photoAlt } from '@/lib/alt';
import { getBaseUrl } from '@/lib/baseUrl';
import { getPhotoBySlug } from '@/lib/photos';
import { CARD } from '@/lib/shareTokens';
import { AUTHOR, RSS_ALTERNATE, SITE_NAME } from '@/lib/site';
import { shareCardPath, shareVersion } from '@/lib/shareVersion';
import styles from './photo.module.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ friendly_name: string }> };

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// original_name is the uploaded filename ("IMG_4021.HEIC"), so an uncaptioned photo is
// titled by when it was taken instead.
function photoTitle(photo: Photo): string {
  if (photo.caption) return photo.caption;
  const date = formatDate(photo.date);
  return date ? `Photo from ${date}` : 'Untitled photo';
}

function photoDescription(photo: Photo): string {
  const date = formatDate(photo.date);
  const caption = photo.caption?.trim();
  const sentence = caption && (/[.!?…]$/.test(caption) ? caption : `${caption}.`);
  const parts = [sentence, date && `Taken ${date}.`, `A photo by ${AUTHOR}, on the map.`];
  return parts.filter(Boolean).join(' ');
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { friendly_name } = await params;
  const photo = await getPhotoBySlug(friendly_name);
  if (!photo) return { title: 'Photo not found', robots: { index: false } };

  const title = photoTitle(photo);
  const description = photoDescription(photo);
  const path = `/p/${encodeURIComponent(friendly_name)}`;
  const card = shareCardPath(friendly_name, shareVersion(photo));

  return {
    title,
    description,
    alternates: { canonical: path, types: RSS_ALTERNATE },
    openGraph: {
      siteName: SITE_NAME,
      title,
      description,
      url: path,
      type: 'article',
      publishedTime: photo.created_at ?? undefined,
      authors: [AUTHOR],
      images: [
        {
          url: card,
          width: CARD.width,
          height: CARD.height,
          alt: photoAlt(photo),
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ url: card, alt: photoAlt(photo) }],
    },
  };
}

// schema.org ImageObject + Photograph. Google's image-metadata check needs contentUrl plus
// one of creator/creditText/copyrightNotice/license; the rest is for richer results.
function jsonLd(photo: Photo, base: string) {
  const author = { '@type': 'Person', name: AUTHOR, url: base };
  return {
    '@context': 'https://schema.org',
    '@type': ['ImageObject', 'Photograph'],
    name: photoTitle(photo),
    url: `${base}/p/${encodeURIComponent(photo.friendly_name)}`,
    contentUrl: photo.large_url,
    thumbnailUrl: photo.thumb_url,
    caption: photo.caption ?? undefined,
    description: photoAlt(photo),
    creator: author,
    author,
    creditText: AUTHOR,
    copyrightHolder: author,
    copyrightNotice: `© ${AUTHOR}`,
    dateCreated: photo.date ?? undefined,
    datePublished: photo.created_at ?? undefined,
    contentLocation:
      photo.lat != null && photo.lon != null
        ? {
            '@type': 'Place',
            geo: { '@type': 'GeoCoordinates', latitude: photo.lat, longitude: photo.lon },
          }
        : undefined,
  };
}

export default async function PhotoPage({ params }: Props) {
  const { friendly_name } = await params;
  const photo = await getPhotoBySlug(friendly_name);
  if (!photo) notFound();

  const date = formatDate(photo.date);
  const base = await getBaseUrl();
  // Escape "<" so a caption containing "</script>" can't close the tag early.
  const ld = JSON.stringify(jsonLd(photo, base)).replace(/</g, '\\u003c');

  return (
    <main className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.photo} src={photo.large_url} alt={photoAlt(photo)} />
      <div className={styles.caption}>
        <h1 className={styles.title}>{photoTitle(photo)}</h1>
        {date && <span className={styles.date}>{date}</span>}
      </div>
      <a className={styles.mapLink} href={`/#${encodeURIComponent(photo.friendly_name)}`}>
        Open on the map
      </a>
    </main>
  );
}
