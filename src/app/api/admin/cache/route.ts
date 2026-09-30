import { NextResponse } from 'next/server';
import { purgeR2Cache } from '@/lib/cdnCache';

export async function DELETE() {
  try {
    await purgeR2Cache();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[cache] purge failed', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
