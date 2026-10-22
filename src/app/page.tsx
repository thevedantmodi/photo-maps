export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';

import Landing, { type RecentPhoto } from './components/Landing';
import { getPublishedPhotos } from '@/lib/photos';
import { photoTitle } from '@/lib/alt';
import { focusFor, objectPosition } from '@/lib/landingPhoto';
import { getLandingPhoto } from '@/lib/landingPhotoStore';
import { RSS_ALTERNATE, SITE_DESCRIPTION, SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  alternates: { canonical: '/', types: RSS_ALTERNATE },
  openGraph: {
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    type: 'website',
    url: '/',
  },
};

const RECENT_COUNT = 8;

export default async function Home() {
  const [photos, landing] = await Promise.all([getPublishedPhotos(), getLandingPhoto()]);

  // Newest uploads first. The one pinned in the admin, or else the newest, stands in front
  // of the title; the newest hang below.
  const byUpload = [...photos].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  const recent: RecentPhoto[] = byUpload.slice(0, RECENT_COUNT).map((p) => ({
    slug: p.friendly_name,
    title: photoTitle(p),
    year: p.date ? new Date(p.date).getFullYear() : null,
    url: p.large_url,
  }));

  const years = photos
    .map((p) => (p.date ? new Date(p.date).getFullYear() : NaN))
    .filter((y) => Number.isFinite(y));
  const span =
    years.length > 0
      ? { from: Math.min(...years), to: Math.max(...years) }
      : null;

  // A pinned photo since deleted or unpublished gives way to the newest.
  const featured = (landing.photoId && photos.find((p) => p.id === landing.photoId)) || byUpload[0];
  const photo = featured
    ? { url: featured.large_url, position: objectPosition(focusFor(landing, featured.id)) }
    : null;

  return <Landing photo={photo} years={span} recent={recent} />;
}
