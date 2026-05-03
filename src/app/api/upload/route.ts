import { NextRequest, NextResponse } from 'next/server';
import { getUploadUrl } from '@/lib/r2';

export async function POST(req: NextRequest) {
  const { key, contentType } = await req.json();
  if (!key || !contentType) {
    return NextResponse.json({ error: 'key and contentType required' }, { status: 400 });
  }
  const uploadUrl = await getUploadUrl(key, contentType);
  return NextResponse.json({ uploadUrl, key });
}
