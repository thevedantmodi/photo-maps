export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';

import MapWrapper from '../components/MapWrapper';
import { getPublishedPhotos } from '@/lib/photos';
import { getPlaces } from '@/lib/places';

export const metadata: Metadata = {
  title: 'Galleries — Photos by Vedant Modi',
};

export default async function MapPage() {
  const [photos, places] = await Promise.all([getPublishedPhotos(), getPlaces()]);
  return <MapWrapper photos={photos} places={places} />;
}
