import MapWrapper from './components/MapWrapper';
import { Photo } from './types';
import { db } from '@/db';
import { photos } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getPublicUrl } from '@/lib/r2';

async function getPhotos(): Promise<Photo[]> {
  try {
    const rows = await db.select().from(photos).where(eq(photos.status, 'published'));
    return rows.map(row => ({
      ...row,
      date: row.date?.toISOString() ?? null,
      created_at: row.created_at?.toISOString() ?? null,
      thumb_url: getPublicUrl(row.thumb_name),
      large_url: getPublicUrl(row.large_name),
    }));
  } catch {
    return [];
  }
}

export default async function Home() {
  const photos = await getPhotos();
  return (
    <main style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <MapWrapper photos={photos} />
    </main>
  );
}
