import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2 } from '@/lib/r2';
import { db } from '@/db';
import { photos } from '@/db/schema';
import sharp from 'sharp';
import exifr from 'exifr';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { key, friendly_name, original_name, caption } = await req.json();

  if (!key || !friendly_name) {
    return NextResponse.json({ error: 'key and friendly_name required' }, { status: 400 });
  }

  const BUCKET = process.env.R2_BUCKET!;

  const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of obj.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);

  const thumbName = `${friendly_name}_thumb.jpg`;
  const largeName = `${friendly_name}_large.jpg`;

  const [thumbBuf, largeBuf, gps, dateTaken] = await Promise.all([
    sharp(buffer).resize(300, 300, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer(),
    sharp(buffer).resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer(),
    exifr.gps(buffer).catch(() => null),
    exifr.parse(buffer, ['DateTimeOriginal']).catch(() => null),
  ]);

  await Promise.all([
    r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: thumbName, Body: thumbBuf, ContentType: 'image/jpeg' })),
    r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: largeName, Body: largeBuf, ContentType: 'image/jpeg' })),
    r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })),
  ]);

  await db.insert(photos).values({
    friendly_name,
    thumb_name: thumbName,
    large_name: largeName,
    original_name: original_name ?? key,
    caption: caption || null,
    lat: gps?.latitude ?? null,
    lon: gps?.longitude ?? null,
    date: dateTaken?.DateTimeOriginal ?? null,
    status: 'published',
  }).onConflictDoUpdate({
    target: photos.friendly_name,
    set: {
      thumb_name: thumbName,
      large_name: largeName,
      caption: caption || null,
      lat: gps?.latitude ?? null,
      lon: gps?.longitude ?? null,
      date: dateTaken?.DateTimeOriginal ?? null,
      status: 'published',
    },
  });

  return NextResponse.json({ ok: true, lat: gps?.latitude ?? null, lon: gps?.longitude ?? null });
}
