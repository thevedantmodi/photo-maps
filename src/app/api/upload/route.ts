import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { neon } from "@neondatabase/serverless";
import sharp from "sharp";
import exifr from 'exifr';

const sql = neon(process.env.DATABASE_URL!);

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
    },
})

/* gets exactly one image and exactly one matching caption  */
export async function POST(req: NextRequest) {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const caption = formData.get("caption") as string | null;

    if (!file) {
        return NextResponse.json({ error: "No file" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const originalName = file.name;
    const friendlyName = originalName.replace(/\.[^.]+$/, '');

    const thumbName = `${friendlyName}_thumb.jpeg`;
    const largeName = `${friendlyName}_large.jpeg`;

    const [thumb, large, exif] = await Promise.all([
        sharp(buffer).resize(400).jpeg({ quality: 80 }).toBuffer(),
        sharp(buffer).resize(1600).jpeg({ quality: 85 }).toBuffer(),
        exifr.parse(buffer, {
            pick: ['DateTimeOriginal', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef', 'ImageDescription']
        }),
    ]);

    if (!exif?.GPSLatitude || !exif?.GPSLongitude) {
        return NextResponse.json(
            { error: 'Photo must have GPS data' },
            { status: 400 }
        );
    }

    const dmsToNumeric = (dms: number[], ref: string) => {
        const numeric = (dms[2] / 3600) + (dms[1] / 60) + dms[0]
        return ref === "W" || ref === "S" ? -numeric : numeric;
    }


    await Promise.all([
        r2.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET!,
            Key: thumbName,
            Body: thumb,
            ContentType: 'image/jpeg',
        })),
        r2.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET!,
            Key: largeName,
            Body: large,
            ContentType: 'image/jpeg',
        })),
    ]);

    try {
        await sql`
    INSERT INTO photos
      (friendly_name, thumb_name, large_name, original_name, lat, lon, caption, date)
    VALUES (
      ${friendlyName},
      ${thumbName},
      ${largeName},
      ${originalName},
      ${dmsToNumeric(exif.GPSLatitude, exif.GPSLatitudeRef)},
      ${dmsToNumeric(exif.GPSLongitude, exif.GPSLongitudeRef)},
      ${caption || exif?.ImageDescription || null},
      ${exif?.DateTimeOriginal ?? null}
    )
  `;
    } catch (e: any) {
        if (e.message.includes('photos_friendly_name_unique')) {
            return NextResponse.json({ error: 'Photo with this name already exists' }, { status: 409 });
        }
        throw e;
    }



    return NextResponse.json({ ok: true, captionSource: caption ? 'user' : exif?.ImageDescription ? 'exif' : 'none' });
}
