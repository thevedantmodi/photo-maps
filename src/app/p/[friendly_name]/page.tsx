import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import PhotoView from '@/app/components/PhotoView';
import { getBaseUrl } from '@/lib/baseUrl';
import { getPhotoBySlug } from '@/lib/photos';
import { getPlaces } from '@/lib/places';
import { CARD } from '@/lib/shareTokens';
import { shareCardPath, shareVersion } from '@/lib/shareVersion';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ friendly_name: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { friendly_name } = await params;
  const photo = await getPhotoBySlug(friendly_name);
  if (!photo) return { title: 'Photo not found' };

  const title = photo.caption || photo.original_name;
  const base = await getBaseUrl();
  // Link previews can't know the viewer's theme; the dark card reads best in most apps.
  const card = shareCardPath(friendly_name, shareVersion(photo), 'dark');

  return {
    metadataBase: new URL(base),
    title: `${title} — Photos by Vedant Modi`,
    description: 'Photographs, mapped.',
    openGraph: {
      title,
      description: 'Photographs, mapped.',
      type: 'article',
      images: [
        {
          url: card,
          width: CARD.width,
          height: CARD.height,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      images: [card],
    },
  };
}

export default async function PhotoPage({ params }: Props) {
  const { friendly_name } = await params;
  const [photo, places] = await Promise.all([getPhotoBySlug(friendly_name), getPlaces()]);
  if (!photo) notFound();

  return <PhotoView photo={photo} places={places} mode="page" />;
}
