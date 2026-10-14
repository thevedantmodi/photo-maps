export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';

import MapWrapper from './components/MapWrapper';
import { getPublishedPhotos } from '@/lib/photos';
import { getPlaces } from '@/lib/places';
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

export default async function Home() {
  const [photos, places] = await Promise.all([getPublishedPhotos(), getPlaces()]);
  return (
    <main style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'fixed' }}>
      <h1 className="visually-hidden">{SITE_NAME}</h1>
      <MapWrapper photos={photos} places={places} />
    </main>
  );
}
