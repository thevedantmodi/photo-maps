import os
import json
import shutil
from pathlib import Path
from PIL import Image, ExifTags
import pillow_heif

# Register HEIC opener
pillow_heif.register_heif_opener()

BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "photos"
PUBLIC_PHOTOS_DIR = BASE_DIR / "public" / "photos"
DATA_FILE = BASE_DIR / "public" / "data.json"

def get_decimal_from_dms(dms, ref):
    degrees = dms[0]
    minutes = dms[1]
    seconds = dms[2]
    
    decimal = degrees + (minutes / 60.0) + (seconds / 3600.0)
    
    if ref in ['S', 'W']:
        decimal = -decimal
        
    return decimal

def get_gps_details(image):
    exif = image.getexif()
    if not exif:
        return None
    GPSINFO = 0x8825
    gps_info = exif.get_ifd(GPSINFO)
    if not gps_info:
        return None

    gps_latitude = gps_info.get(2)
    gps_latitude_ref = gps_info.get(1)
    gps_longitude = gps_info.get(4)
    gps_longitude_ref = gps_info.get(3)

    if gps_latitude and gps_latitude_ref and gps_longitude and gps_longitude_ref:
        lat = get_decimal_from_dms(gps_latitude, gps_latitude_ref)
        lng = get_decimal_from_dms(gps_longitude, gps_longitude_ref)
        return lat, lng
        
    return None

def get_caption(image):
    exif = image.getexif()
    if not exif:
        return None
    
    # Try ImageDescription (0x010E)
    caption = exif.get(0x010E)
    if caption:
        # Decode if bytes, though usually string in getexif()
        if isinstance(caption, bytes):
            try:
                return caption.decode('utf-8').strip()
            except:
                pass
        return str(caption).strip()
        
    # Try UserComment (0x9286) - often complex structure, but let's try simple get
    # Note: UserComment is often in Exif IFD, not main IFD
    exif_ifd = exif.get_ifd(0x8769)
    if exif_ifd:
        user_comment = exif_ifd.get(0x9286)
        if user_comment:
             if isinstance(user_comment, bytes):
                # UserComment starts with 8-byte encoding ID
                # often b'ASCII\x00\x00\x00'
                try:
                    if user_comment.startswith(b'ASCII\0\0\0'):
                        return user_comment[8:].decode('utf-8').strip()
                    elif user_comment.startswith(b'UNICODE\0'):
                        return user_comment[8:].decode('utf-16').strip()
                    else:
                        # Try utf-8 blindly
                        return user_comment.decode('utf-8', errors='ignore').strip()
                except:
                    pass
             return str(user_comment).strip()

    return None

def process_photos():
    if not RAW_DIR.exists():
        print(f"Directory {RAW_DIR} does not exist.")
        return

    # Ensure output directory exists
    PUBLIC_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

    photos = []
    files = [f for f in RAW_DIR.iterdir() if f.is_file() and not f.name.startswith('.')]
    
    print(f"Found {len(files)} files in {RAW_DIR}")

    for file_path in files:
        ext = file_path.suffix.lower()
        if ext not in ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.dng']:
            continue

        print(f"Processing {file_path.name}...")

        try:
            # Open image
            with Image.open(file_path) as img:
                # Extract GPS
                # Note: For HEIC, pillow-heif handles opening, but EXIF might need care.
                # Image.open() with pillow-heif should preserve EXIF.
                
                lat_lng = get_gps_details(img)
                
                if not lat_lng:
                    print(f"No GPS data found for {file_path.name}. Skipping.")
                    continue
                
                lat, lng = lat_lng
                
                # Extract Caption
                caption = get_caption(img)
                
                # Generate filenames
                file_id = file_path.stem
                thumb_name = f"{file_id}_thumb.jpg"
                large_name = f"{file_id}_large.jpg"
                
                # Resize and save Thumbnail
                img_thumb = img.copy()
                img_thumb.thumbnail((300, 300))
                # Convert to RGB if necessary (e.g. from RGBA or CMYK)
                if img_thumb.mode in ('RGBA', 'P'):
                    img_thumb = img_thumb.convert('RGB')
                
                img_thumb.save(PUBLIC_PHOTOS_DIR / thumb_name, "JPEG", quality=80)
                
                # Resize and save Large
                img_large = img.copy()
                img_large.thumbnail((1600, 1600))
                if img_large.mode in ('RGBA', 'P'):
                    img_large = img_large.convert('RGB')
                    
                img_large.save(PUBLIC_PHOTOS_DIR / large_name, "JPEG", quality=85)
                
                photos.append({
                    "id": file_id,
                    "lat": lat,
                    "lng": lng,
                    "thumb": f"/photos/{thumb_name}",
                    "large": f"/photos/{large_name}",
                    "originalName": file_path.name,
                    "caption": caption or "" 
                })
                
                print(f"Processed {file_path.name}: {lat}, {lng}")

        except Exception as e:
            print(f"Error processing {file_path.name}: {e}")

    with open(DATA_FILE, 'w') as f:
        json.dump(photos, f, indent=2)
        
    print(f"Done! Processed {len(photos)} photos. Metadata saved to {DATA_FILE}")

if __name__ == "__main__":
    process_photos()
