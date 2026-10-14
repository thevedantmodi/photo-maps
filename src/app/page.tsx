export const dynamic = 'force-dynamic';

import Landing, { type RecentPhoto } from './components/Landing';
import { getPublishedPhotos } from '@/lib/photos';

const RECENT_COUNT = 8;

export default async function Home() {
  const photos = await getPublishedPhotos();

  // Newest uploads first: the first stands in front of the title, the rest hang below.
  const byUpload = [...photos].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  const recent: RecentPhoto[] = byUpload.slice(0, RECENT_COUNT).map((p) => ({
    slug: p.friendly_name,
    title: p.caption || p.original_name,
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

  return <Landing photoUrl={byUpload[0]?.large_url ?? null} years={span} recent={recent} />;
}
