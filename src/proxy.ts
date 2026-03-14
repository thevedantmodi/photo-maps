import { NextRequest, NextResponse } from 'next/server';

export function proxy(req: NextRequest) {
    const basicAuth = req.headers.get('authorization');

    if (basicAuth) {
        const [, encoded] = basicAuth.split(' ');
        const [user, pass] = atob(encoded).split(':');
        if (
            user === process.env.ADMIN_USER &&
            pass === process.env.ADMIN_PASS
        ) {
            return NextResponse.next();
        }
    }

    return new NextResponse('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Admin"' },
    });
}

export const config = {
    matcher: ['/admin/:path*', '/api/upload/:path*'],
};