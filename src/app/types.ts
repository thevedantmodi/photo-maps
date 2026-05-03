
export interface Photo {
  id: string;
  friendly_name: string;
  thumb_name: string;
  large_name: string;
  original_name: string;
  lat: number | null;
  lon: number | null;
  caption: string | null;
  date: string | null;
  status: string;
  created_at: string;
  thumb_url: string;
  large_url: string;
}
