export const dynamic = 'force-dynamic';

import MapWrapper from './components/MapWrapper';
import { getPublishedPhotos } from '@/lib/photos';

export default async function Home() {
  const photos = await getPublishedPhotos();
  return (
    <main style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'fixed' }}>
      <MapWrapper photos={photos} />
    </main>
  );
}
