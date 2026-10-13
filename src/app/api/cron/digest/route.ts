import { NextResponse } from 'next/server';

import { getBaseUrl } from '@/lib/baseUrl';
import { getPublishedPhotosSince } from '@/lib/photos';
import { FROM, resend, segmentId } from '@/lib/subscribe';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PHOTOS = 12;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  const items = shown
    .map((p) => {
      const title = escapeHtml(p.caption || p.original_name);
      const link = escapeHtml(`${base}/p/${encodeURIComponent(p.friendly_name)}`);
      return (
        `<p><a href="${link}"><img src="${escapeHtml(p.thumb_url)}" alt="${title}" width="300" style="max-width:100%;border-radius:4px" /></a><br />` +
        `<a href="${link}">${title}</a></p>`
      );
    })
    .join('');

  const subject =
    photos.length === 1 ? '1 new photo on the map' : `${photos.length} new photos on the map`;
  const html =
    `<p>New this week on Photos by Vedant Modi:</p>${items}` +
    (more > 0 ? `<p>…and ${more} more.</p>` : '') +
    `<p><a href="${escapeHtml(base)}/">Open the map</a></p>` +
    `<p style="font-size:12px;color:#888">You're getting this because you subscribed on the map. ` +
    `<a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a></p>`;

  // Create and send separately: a failed `send: true` still leaves a draft behind, and a
  // week with no subscribers would add one every run. Drop the draft if the send fails.
  const { data: draft, error: createError } = await resend.broadcasts.create({
    name: `Weekly digest ${new Date().toISOString().slice(0, 10)}`,
    from: FROM,
    subject,
    html,
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
