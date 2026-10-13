import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Resend } from 'resend';

// Resend is provisioned through the Vercel Marketplace, which sets RESEND_API_KEY and
// RESEND_EMAIL_DOMAIN. RESEND_SEGMENT_ID is the segment confirmed subscribers join and
// the weekly digest broadcasts to.
export const resend = new Resend(process.env.RESEND_API_KEY);

export const FROM = `Photos by Vedant Modi <photos@${process.env.RESEND_EMAIL_DOMAIN}>`;

const TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

export function segmentId(): string {
  const id = process.env.RESEND_SEGMENT_ID;
  if (!id) throw new Error('RESEND_SEGMENT_ID is not set');
  return id;
}

/** Lowercased, trimmed address, or null if it doesn't look like one. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function hashEmail(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 32);
}

// Derived from the API key so confirmation links need no extra secret. Rotating the key
// invalidates links still in flight, which only costs those people a second signup.
function signingKey(): Buffer {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  return createHmac('sha256', apiKey).update('subscribe-confirm-token').digest();
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

/**
 * A stateless double opt-in token: the address and an expiry, signed. Nothing is stored
 * until the link is confirmed, so an unconfirmed signup never becomes a contact.
 */
export function createConfirmToken(email: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ e: email, x: now + TOKEN_TTL_MS })).toString(
    'base64url',
  );
  return `${payload}.${sign(payload)}`;
}

export function verifyConfirmToken(token: string, now = Date.now()): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const { e, x } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof x !== 'number' || x < now) return null;
    return normalizeEmail(e);
  } catch {
    return null;
  }
}

/**
 * Add a confirmed address to the subscriber segment. Safe to call twice: an existing
 * contact (including one who unsubscribed and has now opted in again) is resubscribed.
 */
export async function addSubscriber(email: string): Promise<void> {
  const segment = segmentId();
  const { data: existing } = await resend.contacts.get({ email });

  if (!existing) {
    const { error } = await resend.contacts.create({
      email,
      unsubscribed: false,
      segments: [{ id: segment }],
    });
    if (error) throw new Error(`contacts.create: ${error.message}`);
    return;
  }

  const { error: updateError } = await resend.contacts.update({ email, unsubscribed: false });
  if (updateError) throw new Error(`contacts.update: ${updateError.message}`);
  const { error: segmentError } = await resend.contacts.segments.add({ email, segmentId: segment });
  // Already in the segment is fine; anything else is a real failure.
  if (segmentError && !/already/i.test(segmentError.message)) {
    throw new Error(`contacts.segments.add: ${segmentError.message}`);
  }
}
