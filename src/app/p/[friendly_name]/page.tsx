import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import PhotoView from '@/app/components/PhotoView';
import type { Photo } from '@/app/types';
import { photoAlt, photoTitle } from '@/lib/alt';
import { getBaseUrl } from '@/lib/baseUrl';
import { getPhotoBySlug } from '@/lib/photos';
import { getPlaces } from '@/lib/places';
import { CARD } from '@/lib/shareTokens';
import { AUTHOR, RSS_ALTERNATE, SITE_NAME } from '@/lib/site';
import { shareCardPath, shareVersion } from '@/lib/shareVersion';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ friendly_name: string }> };

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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
  // Link previews can't know the viewer's theme; the dark card reads best in most apps.
  const card = shareCardPath(friendly_name, shareVersion(photo), 'dark');

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
  const [photo, places] = await Promise.all([getPhotoBySlug(friendly_name), getPlaces()]);
  if (!photo) notFound();

  const base = await getBaseUrl();
  // Escape "<" so a caption containing "</script>" can't close the tag early.
  const ld = JSON.stringify(jsonLd(photo, base)).replace(/</g, '\\u003c');

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <PhotoView photo={photo} places={places} mode="page" />
    </>
  );
}
