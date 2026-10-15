import { notFound } from 'next/navigation';

import PhotoView from '@/app/components/PhotoView';
import { getPhotoBySlug, getPublishedPhotos } from '@/lib/photos';
import { getPlaces } from '@/lib/places';
import { photoNeighbours } from '@/lib/photoSequence';
import { parseYear } from '@/lib/yearParam';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ friendly_name: string }>;
  searchParams: Promise<{ year?: string | string[] }>;
};

/** The photo page, drawn over the map after a click there (see app/map/layout.tsx). */
export default async function PhotoOverMap({ params, searchParams }: Props) {
  const [{ friendly_name }, query] = await Promise.all([params, searchParams]);
  const [photo, places, all] = await Promise.all([
    getPhotoBySlug(friendly_name),
    getPlaces(),
    getPublishedPhotos(),
  ]);
  if (!photo) notFound();

  const year = parseYear(query.year);
  const steps = photoNeighbours(all, friendly_name, year);
  return <PhotoView key={photo.id} photo={photo} places={places} mode="overlay" prev={steps.prev} next={steps.next} year={steps.year} />;
}
