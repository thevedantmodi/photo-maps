export const dynamic = 'force-dynamic';

import MapWrapper from './components/MapWrapper';
import { getPlaces, getPublishedPhotos } from '@/lib/backend';

export default async function Home() {
  const [photos, places] = await Promise.all([getPublishedPhotos(), getPlaces()]);
  return (
    <main style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'fixed' }}>
      <MapWrapper photos={photos} places={places} />
    </main>
  );
}
