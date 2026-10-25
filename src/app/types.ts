
export interface Photo {
  id: string;
  friendly_name: string;
  thumb_name: string;
  large_name: string;
  original_name: string;
  lat: number | null;
  lon: number | null;
  caption: string | null;
  alt_text: string | null;
  date: string | null;
  camera: string | null;
  lens: string | null;
  focal_length_mm: number | null;
  f_number: number | null;
  exposure_s: number | null;
  iso: number | null;
  status: string;
  created_at: string | null;
  share_card_version: string | null;
  thumb_url: string;
  large_url: string;
}
