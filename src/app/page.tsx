import MapWrapper from './components/MapWrapper';
import { Photo } from './types';

async function getPhotos(): Promise<Photo[]> {
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : (process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000');
  try {
    const res = await fetch(`${base}/api/photos`, { cache: 'no-store' });
    if (!res.ok) return [];
    return res.json();
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
