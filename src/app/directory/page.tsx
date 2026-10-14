export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';

import Directory from '../components/Directory';
import { getPublishedPhotos } from '@/lib/photos';
import { getPlaces } from '@/lib/places';

export const metadata: Metadata = {
  title: 'Directory — Photos by Vedant Modi',
};

export default async function DirectoryPage() {
  const [photos, places] = await Promise.all([getPublishedPhotos(), getPlaces()]);
  return <Directory photos={photos} places={places} />;
}
