export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';

import MapWrapper from '../components/MapWrapper';
import { getPublishedPhotos } from '@/lib/photos';
import { getPlaces } from '@/lib/places';
import { RSS_ALTERNATE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Galleries',
  alternates: { canonical: '/map', types: RSS_ALTERNATE },
};

export default async function MapPage() {
  const [photos, places] = await Promise.all([getPublishedPhotos(), getPlaces()]);
  return (
    <>
      <h1 className="sr-only">Galleries</h1>
      <MapWrapper photos={photos} places={places} />
    </>
  );
}
