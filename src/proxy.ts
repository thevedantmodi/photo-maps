import { NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE, safeEqual, verifySession } from '@/lib/adminSession';

export function proxy(req: NextRequest) {
    // The cookie from /admin-login covers the installed iOS app, which can't show the
    // Basic Auth prompt; browsers can still sign in with the prompt.
    if (verifySession(req.cookies.get(SESSION_COOKIE)?.value)) {
        return NextResponse.next();
    }

    const basicAuth = req.headers.get('authorization');

    if (basicAuth) {
        const [, encoded] = basicAuth.split(' ');
        const [user, ...rest] = atob(encoded).split(':');
        const pass = rest.join(':');
        if (
            process.env.ADMIN_USER &&
            process.env.ADMIN_PASS &&
            safeEqual(user, process.env.ADMIN_USER) &&
            safeEqual(pass, process.env.ADMIN_PASS)
        ) {
            return NextResponse.next();
        }
    }

    // A page visit from the installed app goes to the sign-in form; the prompt would be
    // invisible there. Everything else (API calls, fetches) gets the plain 401.
    if (req.method === 'GET' && req.headers.get('sec-fetch-mode') === 'navigate' && req.nextUrl.pathname.startsWith('/admin')) {
        return NextResponse.redirect(new URL('/admin-login', req.url));
    }

    return new NextResponse('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Admin"' },
    });
}

export const config = {
    matcher: ['/admin/:path*', '/api/upload/:path*', '/api/admin/:path*'],
};
