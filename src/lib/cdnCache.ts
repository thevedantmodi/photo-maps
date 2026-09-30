/**
 * Purges Cloudflare's edge cache for the R2 public bucket.
 *
 * R2 objects are served from a custom domain (NEXT_PUBLIC_R2_PUBLIC_URL), so Cloudflare
 * caches them at the edge. Rotating a photo overwrites the same key, and the edge keeps
 * serving the old bytes until the entry expires — this clears it on demand.
 *
 * Purges by hostname, not purge_everything, so the rest of the zone keeps its cache.
 * Needs CLOUDFLARE_ZONE_ID and a CLOUDFLARE_API_TOKEN with the Zone › Cache Purge permission.
 */
export async function purgeR2Cache(): Promise<void> {
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!zone || !token) throw new Error('CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN must be set');

  const host = new URL(process.env.NEXT_PUBLIC_R2_PUBLIC_URL!).host;

  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hosts: [host] }),
  });
  const data = (await res.json().catch(() => null)) as
    | { success: boolean; errors?: { message: string }[] }
    | null;

  if (!res.ok || !data?.success) {
    const detail = data?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare purge failed: ${detail}`);
  }
}
