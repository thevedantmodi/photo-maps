import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2 } from '@/lib/r2';
import { db } from '@/db';
import { photos } from '@/db/schema';
import sharp from 'sharp';

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [row] = await db.select().from(photos).where(eq(photos.id, id));
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { degrees } = await req.json();
  const angle = Number(degrees);
  if (![90, 180, 270, -90].includes(angle)) {
    return NextResponse.json({ error: 'degrees must be 90, 180, or 270' }, { status: 400 });
  }

  const BUCKET = process.env.R2_BUCKET!;

  try {
    const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: row.large_name }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of obj.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const largeBuf = Buffer.concat(chunks);

    const rotated = sharp(largeBuf).rotate(angle);

    const [newThumb, newLarge] = await Promise.all([
      rotated.clone().resize(300, 300, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer(),
      rotated.clone().resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer(),
    ]);

    await Promise.all([
      r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: row.thumb_name, Body: newThumb, ContentType: 'image/jpeg' })),
      r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: row.large_name, Body: newLarge, ContentType: 'image/jpeg' })),
    ]);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[rotate error]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
