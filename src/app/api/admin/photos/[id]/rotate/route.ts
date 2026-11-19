import { NextRequest, NextResponse, after } from 'next/server';
import { eq } from 'drizzle-orm';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2, getPublicUrl } from '@/lib/r2';
import { db } from '@/db';
import { photos } from '@/db/schema';
import sharp from 'sharp';
import { getBaseUrl } from '@/lib/baseUrl';
import { generateAndStoreShareCard } from '@/lib/shareCardStore';

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

    // New keys, not an in-place overwrite: the old public URLs may be cached by the browser/CDN.
    const version = Date.now().toString(36);
    const thumbName = `${row.friendly_name}_${version}_thumb.jpg`;
    const largeName = `${row.friendly_name}_${version}_large.jpg`;

    await Promise.all([
      r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: thumbName, Body: newThumb, ContentType: 'image/jpeg' })),
      r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: largeName, Body: newLarge, ContentType: 'image/jpeg' })),
    ]);

    await db.update(photos).set({ thumb_name: thumbName, large_name: largeName }).where(eq(photos.id, id));

    await Promise.all(
      [row.thumb_name, row.large_name].map((name) =>
        r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: name })).catch((e) =>
          console.error('[rotate] could not delete replaced object', name, e),
        ),
      ),
    );

    const base = await getBaseUrl(req.headers);
    after(() =>
      generateAndStoreShareCard(
        {
          friendly_name: row.friendly_name,
          caption: row.caption,
          original_name: row.original_name,
          date: row.date?.toISOString() ?? null,
          lat: row.lat,
          lon: row.lon,
          large_name: largeName,
          large_url: getPublicUrl(largeName),
          camera: row.camera,
          focal_length_mm: row.focal_length_mm,
          f_number: row.f_number,
          exposure_s: row.exposure_s,
          iso: row.iso,
          share_card_nonce: row.share_card_nonce,
        },
        base
      )
    );

    return NextResponse.json({
      ok: true,
      thumb_name: thumbName,
      large_name: largeName,
      thumb_url: getPublicUrl(thumbName),
      large_url: getPublicUrl(largeName),
    });
  } catch (e) {
    console.error('[rotate error]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
