import { notFound } from 'next/navigation';

import PhotoView from '@/app/components/PhotoView';
import { getPhotoBySlug } from '@/lib/photos';
import { getPlaces } from '@/lib/places';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ friendly_name: string }> };

/** The photo page, drawn over the map after a click there (see app/map/layout.tsx). */
export default async function PhotoOverMap({ params }: Props) {
  const { friendly_name } = await params;
  const [photo, places] = await Promise.all([getPhotoBySlug(friendly_name), getPlaces()]);
  if (!photo) notFound();

  return <PhotoView photo={photo} places={places} mode="overlay" />;
}
