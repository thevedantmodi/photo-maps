import MapWrapper from './components/MapWrapper';

import { neon } from '@neondatabase/serverless';
import { Photo } from './types';


const sql = neon(process.env.DATABASE_URL!);

async function getPhotos(): Promise<Photo[]> {
  try {
    const rows = await sql`SELECT * FROM photos ORDER BY date DESC`;
    const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
    return (rows as unknown as Photo[]).map(photo => ({
      ...photo,
      thumb_name: `${base}/${photo.thumb_name}`,
      large_name: `${base}/${photo.large_name}`,
    }));
  } catch (error) {
    console.warn('Failed to fetch photos:', error);
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
