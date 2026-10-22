export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';

import Directory from '../components/Directory';
import { getPublishedPhotos } from '@/lib/photos';
import { getPlaces } from '@/lib/places';
import { RSS_ALTERNATE } from '@/lib/site';
import { parseYear, yearOf } from '@/lib/yearParam';

export const metadata: Metadata = {
  title: 'Directory',
  alternates: { canonical: '/directory', types: RSS_ALTERNATE },
};

type Props = { searchParams: Promise<{ year?: string | string[] }> };

export default async function DirectoryPage({ searchParams }: Props) {
  const [photos, places, params] = await Promise.all([getPublishedPhotos(), getPlaces(), searchParams]);
  const year = parseYear(params.year);
  const initialYear = year !== null && photos.some((p) => yearOf(p) === year) ? year : null;
  return <Directory photos={photos} places={places} initialYear={initialYear} />;
}
