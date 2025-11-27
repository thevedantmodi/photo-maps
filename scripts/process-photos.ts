import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import exifr from 'exifr';
import heicConvert from 'heic-convert';

const RAW_DIR = path.join(process.cwd(), 'photos');
const PUBLIC_PHOTOS_DIR = path.join(process.cwd(), 'public', 'photos');
const DATA_FILE = path.join(process.cwd(), 'public', 'data.json');

async function processPhotos() {
    try {
        await fs.access(RAW_DIR);
    } catch {
        console.error(`Directory ${RAW_DIR} does not exist. Please create it and add photos.`);
        return;
    }

    // Ensure output directory exists
    try {
        await fs.access(PUBLIC_PHOTOS_DIR);
    } catch {
        await fs.mkdir(PUBLIC_PHOTOS_DIR, { recursive: true });
    }

    const files = await fs.readdir(RAW_DIR);
    const photos = [];

    console.log(`Found ${files.length} files in ${RAW_DIR}`);

    for (const file of files) {
        if (file.startsWith('.')) continue; // Skip hidden files

        const filePath = path.join(RAW_DIR, file);
        const ext = path.extname(file).toLowerCase();

        if (!['.jpg', '.jpeg', '.png', '.webp', '.heic', '.dng'].includes(ext)) {
            console.log(`Skipping non-image file: ${file}`);
            continue;
        }

        console.log(`Processing ${file}...`);

        try {
            let inputBuffer: Buffer | string = filePath;
            let exifInput: Buffer | string = filePath;

            if (ext === '.heic') {
                try {
                    const inputBufferRaw = await fs.readFile(filePath);
                    // Convert to JPEG for both EXIF and Sharp
                    // heic-convert returns a JPEG buffer which should contain EXIF if we are lucky, 
                    // but heic-convert might STRIP exif. 
                    // Wait, heic-convert usually just decodes the image data.
                    // If heic-convert strips EXIF, we need to read EXIF from the original HEIC buffer.

                    // Let's try reading EXIF from the original HEIC buffer first.
                    // If exifr fails on file path, maybe it works on buffer?

                    // If exifr fails on HEIC buffer too, then we have a problem.
                    // But let's assume exifr works on buffer better than path for some reason, 
                    // OR we use the converted JPEG if exifr supports extracting from the converted one (unlikely if stripped).

                    // Actually, let's try reading EXIF from the original buffer.
                    exifInput = inputBufferRaw;

                    // And prepare buffer for sharp
                    inputBuffer = await heicConvert({
                        buffer: inputBufferRaw,
                        format: 'JPEG',
                        quality: 1
                    }) as Buffer;

                } catch (e) {
                    console.error(`Failed to convert HEIC ${file}:`, e);
                    continue;
                }
            }

            // Extract EXIF
            // We pass the original buffer for HEIC, or filepath for others
            const gps = await exifr.gps(exifInput);

            if (!gps) {
                console.warn(`No GPS data found for ${file}. Skipping map placement.`);
                continue;
            }

            const { latitude, longitude } = gps;

            // Generate filenames
            const id = path.basename(file, ext);
            const thumbName = `${id}_thumb.jpg`;
            const largeName = `${id}_large.jpg`;

            // Process images
            // Thumbnail
            await sharp(inputBuffer)
                .resize(300, 300, { fit: 'cover' })
                .jpeg({ quality: 80 })
                .toFile(path.join(PUBLIC_PHOTOS_DIR, thumbName));

            // Large version
            await sharp(inputBuffer)
                .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toFile(path.join(PUBLIC_PHOTOS_DIR, largeName));

            photos.push({
                id,
                lat: latitude,
                lng: longitude,
                thumb: `/photos/${thumbName}`,
                large: `/photos/${largeName}`,
                originalName: file
            });

            console.log(`Processed ${file}: ${latitude}, ${longitude}`);

        } catch (error) {
            console.error(`Error processing ${file}:`, error);
        }
    }

    await fs.writeFile(DATA_FILE, JSON.stringify(photos, null, 2));
    console.log(`Done! processed ${photos.length} photos. Metadata saved to ${DATA_FILE}`);
}

processPhotos();
