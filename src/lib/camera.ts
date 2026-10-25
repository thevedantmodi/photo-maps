/**
 * Camera details from a photo's EXIF: the camera and lens, and the exposure (focal length,
 * aperture, shutter speed, ISO). Read at upload and by the admin backfill, both through
 * extractCamera, and shown on the photo page as two lines.
 */

export interface CameraDetails {
  camera: string | null;
  lens: string | null;
  focal_length_mm: number | null;
  f_number: number | null;
  exposure_s: number | null;
  iso: number | null;
}

export const CAMERA_FIELDS = ["camera", "lens", "focal_length_mm", "f_number", "exposure_s", "iso"] as const;

export const NO_CAMERA: CameraDetails = {
  camera: null,
  lens: null,
  focal_length_mm: null,
  f_number: null,
  exposure_s: null,
  iso: null,
};

// Makers whose EXIF name is shouty or corporate, as people say them.
const MAKES: Record<string, string> = {
  sony: "Sony",
  "nikon corporation": "Nikon",
  nikon: "Nikon",
  canon: "Canon",
  fujifilm: "Fujifilm",
  "olympus corporation": "Olympus",
  "olympus imaging corp.": "Olympus",
  "om digital solutions": "OM System",
  panasonic: "Panasonic",
  "ricoh imaging company, ltd.": "Ricoh",
  "pentax corporation": "Pentax",
  leica: "Leica",
  "leica camera ag": "Leica",
  apple: "Apple",
  google: "Google",
  samsung: "Samsung",
  hasselblad: "Hasselblad",
  dji: "DJI",
  gopro: "GoPro",
};

// DJI drones report a camera module code as the model.
const DJI_MODELS: Record<string, string> = {
  FC3170: "Mavic Air 2",
  FC3411: "Air 2S",
  FC3582: "Mini 3 Pro",
  FC8482: "Mini 4 Pro",
  L1D: "Mavic 2 Pro",
  "L2D-20C": "Mavic 3",
  FC4170: "Air 3",
};

// Sony's EXIF gives model codes; the names on the camera are friendlier.
const SONY_MODELS: Record<string, string> = {
  "ILCE-7CM2": "α7C II",
  "ILCE-7CR": "α7CR",
  "ILCE-7C": "α7C",
  "ILCE-7M4": "α7 IV",
  "ILCE-7M3": "α7 III",
  "ILCE-7RM5": "α7R V",
  "ILCE-7RM4": "α7R IV",
  "ILCE-7RM4A": "α7R IVA",
  "ILCE-7RM3": "α7R III",
  "ILCE-7SM3": "α7S III",
  "ILCE-1": "α1",
  "ILCE-9M3": "α9 III",
  "ILCE-6700": "α6700",
  "ILCE-6600": "α6600",
  "ILCE-6400": "α6400",
  "ILCE-6100": "α6100",
  "ZV-E10": "ZV-E10",
  "ZV-E1": "ZV-E1",
  "DSC-RX100M7": "RX100 VII",
  "DSC-RX1RM2": "RX1R II",
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** "SONY" + "ILCE-7CM2" → "Sony α7C II"; "Canon" + "Canon EOS R5" → "Canon EOS R5". */
export function cameraName(make: unknown, model: unknown): string | null {
  const rawMake = str(make);
  let rawModel = str(model);
  const brand = rawMake ? (MAKES[rawMake.toLowerCase()] ?? rawMake) : null;
  if (brand === "Sony" && rawModel && SONY_MODELS[rawModel.toUpperCase()]) rawModel = SONY_MODELS[rawModel.toUpperCase()];
  if (brand === "DJI" && rawModel && DJI_MODELS[rawModel.toUpperCase()]) rawModel = DJI_MODELS[rawModel.toUpperCase()];
  if (!rawModel) return brand;
  if (!brand) return rawModel;
  // The model often repeats the make ("Canon EOS R5", "NIKON Z 6_2").
  const first = rawModel.split(" ")[0].toLowerCase();
  if (first === brand.toLowerCase() || (rawMake && first === rawMake.toLowerCase().split(" ")[0])) {
    return `${brand} ${rawModel.split(" ").slice(1).join(" ")}`.trim();
  }
  return `${brand} ${rawModel}`;
}

/** The camera details in parsed EXIF (exifr), as far as the file has them. */
export function extractCamera(exif: Record<string, unknown> | null | undefined): CameraDetails {
  if (!exif) return { ...NO_CAMERA };
  const lens = str(exif.LensModel) ?? str(exif.Lens) ?? str(exif.LensInfo);
  const iso = num(exif.ISO) ?? num(exif.ISOSpeedRatings) ?? num(exif.PhotographicSensitivity);
  return {
    camera: cameraName(exif.Make, exif.Model),
    lens,
    focal_length_mm: num(exif.FocalLength),
    f_number: num(exif.FNumber),
    exposure_s: num(exif.ExposureTime),
    iso: iso === null ? null : Math.round(iso),
  };
}

export function hasCamera(c: Partial<CameraDetails>): boolean {
  return CAMERA_FIELDS.some((k) => c[k] != null);
}

const trim = (n: number) => String(Math.round(n * 10) / 10);

/** 1/250 s, 1/8 s, 0.5 s, 2 s, 30 s. */
export function formatShutter(s: number): string {
  if (s >= 0.3) return `${trim(s)} s`;
  return `1/${Math.round(1 / s)} s`;
}

/** "Sony α7C II · FE 40mm F2.5 G", or whichever half is known; null for neither. */
export function cameraLine(c: Partial<CameraDetails>): string | null {
  const parts = [c.camera, c.lens].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(" · ") : null;
}

/** "40 mm · f/2.5 · 1/250 s · ISO 100", from whatever is known; null for none. */
export function exposureLine(c: Partial<CameraDetails>): string | null {
  const parts: string[] = [];
  if (c.focal_length_mm) parts.push(`${trim(c.focal_length_mm)} mm`);
  if (c.f_number) parts.push(`f/${trim(c.f_number)}`);
  if (c.exposure_s) parts.push(formatShutter(c.exposure_s));
  if (c.iso) parts.push(`ISO ${c.iso}`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * A shutter speed as typed in the admin: "1/250", "1/250 s", "0.5", "2s". Seconds, or
 * undefined if it can't be read (null for empty).
 */
export function parseShutter(input: string): number | null | undefined {
  const t = input.trim().replace(/\s*s(ec)?$/i, "");
  if (!t) return null;
  const frac = t.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const v = Number(frac[1]) / Number(frac[2]);
    return Number.isFinite(v) && v > 0 ? v : undefined;
  }
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

/**
 * Validates camera fields sent to an admin route: each may be absent (left alone), null or
 * "" (cleared), or a value of the right kind. Returns the update, or an error message.
 */
export function parseCameraUpdate(body: Record<string, unknown>): Partial<CameraDetails> | string {
  const out: Partial<CameraDetails> = {};
  for (const key of ["camera", "lens"] as const) {
    if (!(key in body)) continue;
    const v = body[key];
    if (v == null || v === "") out[key] = null;
    else if (typeof v === "string") out[key] = v.trim().slice(0, 120) || null;
    else return `${key} must be text`;
  }
  const ranges = {
    focal_length_mm: [0.5, 5000],
    f_number: [0.5, 128],
    exposure_s: [1 / 64000, 3600],
    iso: [1, 10_000_000],
  } as const;
  for (const key of ["focal_length_mm", "f_number", "exposure_s", "iso"] as const) {
    if (!(key in body)) continue;
    const v = body[key];
    if (v == null || v === "") {
      out[key] = null;
      continue;
    }
    const n = typeof v === "number" ? v : Number(v);
    const [lo, hi] = ranges[key];
    if (!Number.isFinite(n) || n < lo || n > hi) return `${key} must be a number from ${lo} to ${hi}`;
    out[key] = key === "iso" ? Math.round(n) : n;
  }
  return out;
}
