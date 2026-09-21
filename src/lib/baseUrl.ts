import { headers } from 'next/headers';

/**
 * The origin a share card's QR and a page's OG tags should point at.
 *
 * Preview deployments and tunnels each get a different hostname, so no fixed env value is
 * right for them — the incoming request is. Production is the exception: a card reached
 * through a *.vercel.app alias should still advertise the canonical domain, so an explicit
 * NEXT_PUBLIC_BASE_URL wins there.
 *
 * Deriving from Host means a spoofed header changes what the QR encodes. That only affects
 * the response to that same request, so it is not a route to poisoning anyone else's card.
 */
function fromHost(h: Headers): string | null {
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return null;
  const proto =
    h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function getBaseUrl(requestHeaders?: Headers): Promise<string> {
  const explicit = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (explicit && process.env.VERCEL_ENV === 'production') return explicit;

  const derived = fromHost(requestHeaders ?? (await headers()));
  if (derived) return derived;

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return explicit ?? 'http://localhost:3000';
}
