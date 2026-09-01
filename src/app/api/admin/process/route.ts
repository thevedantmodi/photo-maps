import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2 } from '@/lib/r2';
import { db } from '@/db';
import { photos } from '@/db/schema';
import sharp from 'sharp';
import exifr from 'exifr';
import { EXIF_PARSE_OPTIONS, coercePair, extractGps } from '@/lib/gps';

export const maxDuration = 60;

// GPS timestamps are UTC; used as last-resort fallback when EXIF/XMP dates are stripped (e.g. by Photoshop).
function extractGpsDate(exifData: Record<string, unknown> | null): Date | null {
  if (!exifData) return null;
  const stamp = exifData.GPSDateStamp;
  if (typeof stamp !== 'string') return null;
  const datePart = stamp.replace(/:/g, '-');
  const time = exifData.GPSTimeStamp;
  if (Array.isArray(time) && time.length === 3) {
    const [h, m, s] = time as number[];
    return new Date(`${datePart}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}Z`);
  }
  return new Date(`${datePart}T00:00:00Z`);
}

export async function POST(req: NextRequest) {
  const { key, friendly_name, original_name, caption, lat, lon, gps_cleared } = await req.json();

  if (!key || !friendly_name) {
    return NextResponse.json({ error: 'key and friendly_name required' }, { status: 400 });
  }

  // Coordinates pinned in the admin UI win over whatever EXIF says. When the
  // operator deliberately emptied a prefilled location, gps_cleared keeps the
  // EXIF fallback from putting it back.
  const pinnedGps = coercePair(lat, lon);
  if (pinnedGps === null && (lat != null || lon != null) && !gps_cleared) {
    return NextResponse.json(
      { error: 'lat and lon must both be given, with lat in [-90, 90] and lon in [-180, 180]' },
      { status: 400 },
    );
  }

  const BUCKET = process.env.R2_BUCKET!;

  try {
    const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of obj.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const thumbName = `${friendly_name}_thumb.jpg`;
    const largeName = `${friendly_name}_large.jpg`;

    const [thumbBuf, largeBuf, exifData] = await Promise.all([
      sharp(buffer).rotate().resize(300, 300, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer(),
      sharp(buffer).rotate().resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer(),
      exifr.parse(buffer, EXIF_PARSE_OPTIONS)
        .catch((e) => { console.error('[exifr error]', e); return null; }),
    ]);

    const gps = pinnedGps ?? (gps_cleared ? null : extractGps(exifData));
    const dateTaken: Date | null =
      exifData?.DateTimeOriginal instanceof Date ? exifData.DateTimeOriginal
      : exifData?.CreateDate instanceof Date ? exifData.CreateDate
      : extractGpsDate(exifData);

    console.log(`[process] key=${key} gps=${JSON.stringify(gps)} date=${dateTaken} bufLen=${buffer.length}`);

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
      date: dateTaken,
      status: 'published',
    }).onConflictDoUpdate({
      target: photos.friendly_name,
      set: {
        thumb_name: thumbName,
        large_name: largeName,
        caption: caption || null,
        lat: gps?.latitude ?? null,
        lon: gps?.longitude ?? null,
        date: dateTaken,
        status: 'published',
      },
    });

    return NextResponse.json({ ok: true, lat: gps?.latitude ?? null, lon: gps?.longitude ?? null });
  } catch (e) {
    console.error('[process error]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
