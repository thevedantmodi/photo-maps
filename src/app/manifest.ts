import type { MetadataRoute } from 'next';

import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: 'Photo Maps',
    description: SITE_DESCRIPTION,
    id: '/',
    start_url: '/map',
    scope: '/',
    display: 'standalone',
    background_color: '#ededeb',
    theme_color: '#ededeb',
    categories: ['photo', 'travel'],
    lang: 'en',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [{ name: 'Directory', url: '/directory' }],
  };
}
