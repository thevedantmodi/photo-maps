import { NextRequest, NextResponse, after } from 'next/server';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2, getPublicUrl } from '@/lib/r2';
import { db } from '@/db';
import { photos } from '@/db/schema';
import sharp from 'sharp';
import exifr from 'exifr';
import { EXIF_PARSE_OPTIONS, coercePair, extractExifDate, extractGps } from '@/lib/gps';
import { getBaseUrl } from '@/lib/baseUrl';
import { generateAndStoreShareCard } from '@/lib/shareCardStore';
import { toSharpInput } from '@/lib/heic';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { key, friendly_name, original_name, caption, lat, lon, gps_cleared, date } = await req.json();

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

  // Typed in the admin UI; only used when the photo carries no date of its own.
  const manualDate = date ? new Date(date) : null;
  if (manualDate && Number.isNaN(manualDate.getTime())) {
    return NextResponse.json({ error: 'date must be a valid date' }, { status: 400 });
  }

  const BUCKET = process.env.R2_BUCKET!;

  try {
    const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of obj.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const thumbName = `${friendly_name}_thumb.jpg`;
    const largeName = `${friendly_name}_large.jpg`;

    const imageBuf = await toSharpInput(buffer);
    const [thumbBuf, largeBuf, exifData] = await Promise.all([
      sharp(imageBuf).rotate().resize(300, 300, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer(),
      sharp(imageBuf).rotate().resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer(),
      exifr.parse(buffer, EXIF_PARSE_OPTIONS)
        .catch((e) => { console.error('[exifr error]', e); return null; }),
    ]);

    const gps = pinnedGps ?? (gps_cleared ? null : extractGps(exifData));
    const dateTaken = extractExifDate(exifData)?.date ?? manualDate;

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

    const base = await getBaseUrl(req.headers);
    after(() =>
      generateAndStoreShareCard(
        {
          friendly_name,
          caption: caption || null,
          original_name: original_name ?? key,
          date: dateTaken?.toISOString() ?? null,
          large_name: largeName,
          large_url: getPublicUrl(largeName),
        },
        base
      )
    );

    return NextResponse.json({ ok: true, lat: gps?.latitude ?? null, lon: gps?.longitude ?? null });
  } catch (e) {
    console.error('[process error]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
