import { NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE, SESSION_SECONDS, createSession, safeEqual } from '@/lib/adminSession';

// Outside /api/admin on purpose: proxy.ts protects that prefix, and this has to be reachable
// before anyone has signed in.
export async function POST(req: NextRequest) {
  const { user, pass } = await req.json().catch(() => ({}));
  const ok =
    !!process.env.ADMIN_USER &&
    !!process.env.ADMIN_PASS &&
    typeof user === 'string' &&
    typeof pass === 'string' &&
    safeEqual(user, process.env.ADMIN_USER) &&
    safeEqual(pass, process.env.ADMIN_PASS);
  if (!ok) return NextResponse.json({ error: 'Wrong username or password' }, { status: 401 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_SECONDS,
  });
  return res;
}
