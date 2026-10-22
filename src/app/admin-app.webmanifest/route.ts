import { SITE_NAME } from '@/lib/site';

// The admin app's manifest. It lives outside /admin on purpose: browsers fetch manifests
// without credentials, so a path behind the Basic Auth in proxy.ts would 401. It holds
// only a name and icons. Only the admin layout links to it, so the install prompt appears
// to someone who has already signed in.
export function GET() {
  return Response.json(
    {
      name: `${SITE_NAME} — Admin`,
      short_name: 'Photo Admin',
      id: '/admin',
      start_url: '/admin',
      scope: '/admin',
      display: 'standalone',
      background_color: '#ededeb',
      theme_color: '#e8b04a',
      icons: [
        { src: '/icons/admin-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/admin-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/admin-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
}
