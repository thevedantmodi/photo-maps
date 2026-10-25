// A signed cookie that stands in for the Basic Auth password prompt, which iOS home-screen
// apps never show. The token is `<expiry>.<hmac>`, keyed on ADMIN_PASS, so changing the
// password signs everyone out.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'admin-session';
export const SESSION_SECONDS = 60 * 60 * 24 * 30;

const sign = (exp: string) => createHmac('sha256', process.env.ADMIN_PASS ?? '').update(exp).digest('hex');

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createSession() {
  const exp = String(Date.now() + SESSION_SECONDS * 1000);
  return `${exp}.${sign(exp)}`;
}

export function verifySession(token: string | undefined) {
  if (!token || !process.env.ADMIN_PASS) return false;
  const [exp, mac] = token.split('.');
  return !!exp && !!mac && Number(exp) > Date.now() && safeEqual(mac, sign(exp));
}
