export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';

import MapWrapper from '../components/MapWrapper';
import { getPublishedPhotos } from '@/lib/photos';
import { getPlaces } from '@/lib/places';
import { getHomeView } from '@/lib/homeViewStore';
import { RSS_ALTERNATE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Map',
  alternates: { canonical: '/map', types: RSS_ALTERNATE },
};

export default async function MapPage() {
  const [photos, places, home] = await Promise.all([getPublishedPhotos(), getPlaces(), getHomeView()]);
  return (
    <>
      <h1 className="sr-only">Map</h1>
      <MapWrapper photos={photos} places={places} home={home} />
    </>
  );
}
