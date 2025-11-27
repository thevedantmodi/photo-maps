import fs from 'fs/promises';
import path from 'path';
import MapWrapper from './components/MapWrapper';

async function getPhotos() {
  try {
    const filePath = path.join(process.cwd(), 'public', 'data.json');
    const fileContent = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.warn('Error reading data.json (maybe no photos processed yet):', error);
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
