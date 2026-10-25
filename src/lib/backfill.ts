/**
 * Matching original files to published photos for the admin's camera backfill: the
 * originals were deleted at upload, so camera details for older photos can only come from
 * copies the owner still has. The browser reads each file's EXIF; this decides which photo
 * it belongs to and what it would fill in.
 */

import { CAMERA_FIELDS, hasCamera, type CameraDetails } from "@/lib/camera";
import { distanceKm } from "@/lib/gps";

export interface BackfillPhoto extends CameraDetails {
  id: string;
  friendly_name: string;
  original_name: string | null;
  date: string | null;
  lat: number | null;
  lon: number | null;
}

export interface ReadFile {
  name: string;
  camera: CameraDetails;
  /** When it was taken, as the datetime-local the server would store (see exifDateInputValue). */
  takenInput: string | null;
  gps: { latitude: number; longitude: number } | null;
}

export type MatchKind =
  | "name" // same filename, and nothing contradicts it
  | "stem" // same name but a different extension (an export: IMG_1234.HEIC → IMG_1234.jpg)
  | "time" // no name match, but taken at the same moment and place as one photo
  | "ambiguous" // several photos could be it
  | "none";

export interface Match {
  kind: MatchKind;
  photo: BackfillPhoto | null;
  candidates: BackfillPhoto[];
}

/** Within this, a file's time taken and a photo's date are the same moment. */
const SAME_TIME_MS = 2 * 60 * 1000;
/** Within this, a file's GPS and a photo's location are the same spot. */
const SAME_PLACE_KM = 1;

const stem = (name: string) => name.toLowerCase().replace(/\.[^.]+$/, "");
/** How a stored date compares with the file's: both are the server's UTC reading. */
const storedMs = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
const inputMs = (input: string | null) => (input ? Date.parse(`${input}:00Z`) : NaN);

/** Whether a file and a photo agree where both say: no date or location that contradicts. */
function agrees(file: ReadFile, photo: BackfillPhoto): boolean {
  const a = inputMs(file.takenInput);
  const b = storedMs(photo.date);
  if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > SAME_TIME_MS) return false;
  if (file.gps && photo.lat != null && photo.lon != null) {
    if (distanceKm(file.gps, { latitude: photo.lat, longitude: photo.lon }) > SAME_PLACE_KM) return false;
  }
  return true;
}

/** Narrows several same-named photos to the one the file's date and place agree with. */
function settle(file: ReadFile, found: BackfillPhoto[], kind: "name" | "stem"): Match {
  if (found.length === 1) {
    return agrees(file, found[0])
      ? { kind, photo: found[0], candidates: found }
      : { kind: "ambiguous", photo: null, candidates: found };
  }
  const agreeing = found.filter((p) => agrees(file, p));
  if (agreeing.length === 1) return { kind, photo: agreeing[0], candidates: found };
  return { kind: "ambiguous", photo: null, candidates: agreeing.length ? agreeing : found };
}

export function matchFile(file: ReadFile, photos: BackfillPhoto[]): Match {
  const lower = file.name.toLowerCase();
  const byName = photos.filter((p) => p.original_name?.toLowerCase() === lower);
  if (byName.length) return settle(file, byName, "name");

  const byStem = photos.filter((p) => p.original_name && stem(p.original_name) === stem(file.name));
  if (byStem.length) return settle(file, byStem, "stem");

  // Renamed on export: the same moment (and place, where both have one) as exactly one photo.
  const t = inputMs(file.takenInput);
  if (Number.isFinite(t)) {
    const sameTime = photos.filter((p) => {
      const d = storedMs(p.date);
      return Number.isFinite(d) && Math.abs(d - t) <= SAME_TIME_MS && agrees(file, p);
    });
    if (sameTime.length === 1) return { kind: "time", photo: sameTime[0], candidates: sameTime };
    if (sameTime.length > 1) return { kind: "ambiguous", photo: null, candidates: sameTime };
  }
  return { kind: "none", photo: null, candidates: [] };
}

export interface FillOptions {
  /** Replace camera details a photo already has, not just fill the empty ones. */
  overwrite: boolean;
  /** Also fill a photo's missing date and location from the file. */
  datesAndPlaces: boolean;
}

/** The PATCH body that would fill a photo from a file, or null when nothing would change. */
export function fillFor(file: ReadFile, photo: BackfillPhoto, opts: FillOptions): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  for (const key of CAMERA_FIELDS) {
    const value = file.camera[key];
    if (value == null) continue;
    if (photo[key] != null && !opts.overwrite) continue;
    if (photo[key] === value) continue;
    body[key] = value;
  }
  if (opts.datesAndPlaces) {
    if (!photo.date && file.takenInput) body.date = file.takenInput;
    if ((photo.lat == null || photo.lon == null) && file.gps) {
      body.lat = file.gps.latitude;
      body.lon = file.gps.longitude;
    }
  }
  return Object.keys(body).length ? body : null;
}

/** "Camera, lens, exposure, date, location": what a fill body would change, in words. */
export function describeFill(body: Record<string, unknown>): string {
  const parts: string[] = [];
  if ("camera" in body) parts.push("camera");
  if ("lens" in body) parts.push("lens");
  if (["focal_length_mm", "f_number", "exposure_s", "iso"].some((k) => k in body)) parts.push("exposure");
  if ("date" in body) parts.push("date");
  if ("lat" in body) parts.push("location");
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function missingCamera(photos: BackfillPhoto[]): BackfillPhoto[] {
  return photos.filter((p) => !hasCamera(p));
}
