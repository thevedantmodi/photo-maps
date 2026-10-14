export const dynamic = 'force-dynamic';

import Landing from './components/Landing';
import { getPublishedPhotos } from '@/lib/photos';

export default async function Home() {
  const photos = await getPublishedPhotos();

  // The newest upload stands in front of the title; the years span every dated photo.
  const newest = [...photos].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
  const years = photos
    .map((p) => (p.date ? new Date(p.date).getFullYear() : NaN))
    .filter((y) => Number.isFinite(y));
  const span =
    years.length > 0
      ? { from: Math.min(...years), to: Math.max(...years) }
      : null;

  return <Landing photoUrl={newest?.large_url ?? null} years={span} />;
}
