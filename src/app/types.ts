
export interface Photo {
    id: number;
    friendly_name: string;
    lat: number;
    lon: number;
    thumb_name: string;
    large_name: string;
    original_name: string;
    caption?: string;
    date?: string;
}