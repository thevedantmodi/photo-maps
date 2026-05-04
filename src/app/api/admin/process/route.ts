import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2 } from '@/lib/r2';
import { db } from '@/db';
import { photos } from '@/db/schema';
import sharp from 'sharp';
import exifr from 'exifr';

export const maxDuration = 60;

// Parse GPS rational DMS string like "38/1 15/1 2062/100" to decimal degrees.
// Ref is "N"/"S" for lat, "E"/"W" for lon; absent Ref = positive.
function dmsRationalToDecimal(dms: string, ref?: string): number | null {
  const parts = dms.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const vals = parts.map((p) => {
    const [n, d] = p.split('/').map(Number);
    return d ? n / d : n;
  });
  const decimal = vals[0] + vals[1] / 60 + vals[2] / 3600;
  return ref === 'S' || ref === 'W' ? -decimal : decimal;
}

function extractGps(exifData: Record<string, unknown> | null): { latitude: number; longitude: number } | null {
  if (!exifData) return null;

  // Standard path: exifr already computed decimal coords (works for JPEG)
  if (typeof exifData.latitude === 'number' && typeof exifData.longitude === 'number') {
    return { latitude: exifData.latitude, longitude: exifData.longitude };
  }

  // Fallback: parse raw DMS rational strings (PNG/XMP export from Lightroom)
  const rawLat = exifData.GPSLatitude;
  const rawLon = exifData.GPSLongitude;
  if (typeof rawLat !== 'string' || typeof rawLon !== 'string') return null;

  const latRef = typeof exifData.GPSLatitudeRef === 'string' ? exifData.GPSLatitudeRef : undefined;
  const lonRef = typeof exifData.GPSLongitudeRef === 'string' ? exifData.GPSLongitudeRef : undefined;

  const latitude = dmsRationalToDecimal(rawLat, latRef);
  const longitude = dmsRationalToDecimal(rawLon, lonRef);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

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
  const { key, friendly_name, original_name, caption } = await req.json();

  if (!key || !friendly_name) {
    return NextResponse.json({ error: 'key and friendly_name required' }, { status: 400 });
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
      exifr.parse(buffer, { gps: true, xmp: true, exif: true, tiff: true, translateValues: false })
        .catch((e) => { console.error('[exifr error]', e); return null; }),
    ]);

    const gps = extractGps(exifData);
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
