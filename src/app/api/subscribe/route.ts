import { NextResponse } from 'next/server';

import { renderConfirmEmail } from '@/emails/render';
import { getBaseUrl } from '@/lib/baseUrl';
import { createConfirmToken, FROM, hashEmail, normalizeEmail, resend } from '@/lib/subscribe';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  // Honeypot: a field people never see. Bots that fill it get the same reply as everyone
  // else, so there is nothing to learn from probing.
  if (body?.website) return NextResponse.json({ ok: true });

  const email = normalizeEmail(body?.email);
  if (!email) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });

  const base = await getBaseUrl(req.headers);
  const link = `${base}/subscribe/confirm?token=${encodeURIComponent(createConfirmToken(email))}`;
  const { html, text } = await renderConfirmEmail({ confirmUrl: link });

  // At most one confirmation per address per hour. The token differs on every request, so
  // a repeat inside the window is a different payload under the same key and Resend
  // answers 409 without sending, which caps how often anyone can mail a stranger here.
  const slot = Math.floor(Date.now() / (60 * 60 * 1000));
  const { error } = await resend.emails.send(
    {
      from: FROM,
      to: [email],
      subject: 'Confirm your subscription to Photos by Vedant Modi',
      html,
      text,
    },
    { idempotencyKey: `subscribe-confirm/${hashEmail(email)}/${slot}` },
  );

  if (error && /idempotency|409/i.test(`${error.name} ${error.message}`)) {
    // Say so rather than claim a fresh email went out. This reveals only that a link was
    // requested recently, not whether the address is subscribed.
    return NextResponse.json({ ok: true, alreadySent: true });
  }
  if (error) {
    console.error('[subscribe] send failed', error);
    return NextResponse.json({ error: "Couldn't send the confirmation email, try again later" }, { status: 502 });
  }

  // Same reply whether or not the address is already subscribed, so the form can't be
  // used to check who is on the list.
  return NextResponse.json({ ok: true });
}
