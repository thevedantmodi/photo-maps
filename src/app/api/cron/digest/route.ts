import { NextResponse } from 'next/server';

import type { Photo } from '@/app/types';
import type { DigestPhoto } from '@/emails/DigestEmail';
import { renderDigestEmail } from '@/emails/render';
import { getBaseUrl } from '@/lib/baseUrl';
import { getPublishedPhotosSince } from '@/lib/photos';
import { FROM, resend, segmentId } from '@/lib/subscribe';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PHOTOS = 12;

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Weekly, from the cron in vercel.json. Vercel sends CRON_SECRET as a bearer token.
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const photos = await getPublishedPhotosSince(new Date(Date.now() - WEEK_MS));
  if (photos.length === 0) return NextResponse.json({ sent: false, reason: 'no new photos' });

  const base = await getBaseUrl(req.headers);
  const shown = photos.slice(0, MAX_PHOTOS);
  const more = photos.length - shown.length;

  const toDigest = (p: Photo, imageUrl: string): DigestPhoto => ({
    title: p.caption || p.original_name,
    url: `${base}/p/${encodeURIComponent(p.friendly_name)}`,
    imageUrl,
    date: formatDate(p.date),
  });
  const [first, ...others] = shown;
  const { html, text } = await renderDigestEmail({
    baseUrl: base,
    hero: toDigest(first, first.large_url),
    rest: others.map((p) => toDigest(p, p.thumb_url)),
    more,
    // Resend swaps this for each recipient's own link when the broadcast goes out.
    unsubscribeUrl: '{{{RESEND_UNSUBSCRIBE_URL}}}',
  });

  const subject =
    photos.length === 1 ? '1 new photo on the map' : `${photos.length} new photos on the map`;

  // Create and send separately: a failed `send: true` still leaves a draft behind, and a
  // week with no subscribers would add one every run. Drop the draft if the send fails.
  const { data: draft, error: createError } = await resend.broadcasts.create({
    name: `Weekly digest ${new Date().toISOString().slice(0, 10)}`,
    from: FROM,
    subject,
    html,
    text,
    segmentId: segmentId(),
  });
  if (createError || !draft) {
    console.error('[digest] broadcast create failed', createError);
    return NextResponse.json({ error: createError?.message ?? 'create failed' }, { status: 502 });
  }

  const { error: sendError } = await resend.broadcasts.send(draft.id);
  if (sendError) {
    await resend.broadcasts.remove(draft.id);
    // Nobody subscribed (or everyone unsubscribed) is a quiet week, not a failure.
    if (/no contacts/i.test(sendError.message)) {
      return NextResponse.json({ sent: false, reason: 'no subscribers' });
    }
    console.error('[digest] broadcast send failed', sendError);
    return NextResponse.json({ error: sendError.message }, { status: 502 });
  }

  return NextResponse.json({ sent: true, broadcast: draft.id, photos: photos.length });
}
