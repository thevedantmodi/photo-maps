import convert from 'heic-convert';

// Brands that mean the image is HEVC-coded. AVIF shares the HEIF container
// but sharp decodes it natively, so it must not match here.
const HEVC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis']);

/** True when the buffer's ftyp box declares an HEVC brand (major or compatible). */
export function isHeic(buf: Buffer): boolean {
  if (buf.length < 16 || buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  const boxEnd = Math.min(buf.readUInt32BE(0), buf.length);
  if (HEVC_BRANDS.has(buf.toString('ascii', 8, 12))) return true;
  // Compatible brands start after major brand (4) + minor version (4).
  for (let i = 16; i + 4 <= boxEnd; i += 4) {
    if (HEVC_BRANDS.has(buf.toString('ascii', i, i + 4))) return true;
  }
  return false;
}

/**
 * Prebuilt sharp ships libheif without an HEVC decoder, so HEIC must be decoded
 * here first. The output is already upright (libheif applies irot/imir) and has
 * no EXIF, so read EXIF from the original buffer.
 */
export async function toSharpInput(buf: Buffer): Promise<Buffer> {
  if (!isHeic(buf)) return buf;
  const jpeg = await convert({ buffer: buf, format: 'JPEG', quality: 0.95 });
  return Buffer.from(jpeg);
}
