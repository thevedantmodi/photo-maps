import io
import os
from pathlib import Path
from PIL import Image, ExifTags
from datetime import datetime
import pillow_heif
import boto3
import psycopg2
from dotenv import load_dotenv

pillow_heif.register_heif_opener()

BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "photos"

load_dotenv(BASE_DIR / ".env.local")

ENDPOINT = os.environ["R2_ENDPOINT"]
BUCKET = os.environ["R2_BUCKET"]
ACCESS_KEY = os.environ["R2_ACCESS_KEY_ID"]
SECRET_KEY = os.environ["R2_SECRET_ACCESS_KEY"]
DATABASE_URL = os.environ["DATABASE_URL_UNPOOLED"]

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



def fix_encoding(s):
    if not isinstance(s, str):
        return s
    try:
        return s.encode('latin-1').decode('utf-8')
    except:
        return s

def get_caption(image):
    exif = image.getexif()
    if not exif:
        return None

    ImageDescription = 0x010E
    caption = exif.get(ImageDescription)
    if caption:
        # Decode if bytes, though usually string in getexif()
        if isinstance(caption, bytes):
            try:
                return caption.decode('utf-8').strip()
            except:
                pass
        return fix_encoding(str(caption).strip())

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
             return fix_encoding(str(user_comment).strip())


    return None

def get_date_taken(image):
    exif = image.getexif()
    if not exif:
        return None

    date_str = exif.get(36867) or exif.get(36868) or exif.get(306)

    if not date_str:
         exif_ifd = exif.get_ifd(0x8769)
         if exif_ifd:
             date_str = exif_ifd.get(36867) or exif_ifd.get(36868) or exif_ifd.get(306)

    if date_str:
        # Clean up null bytes or whitespace
        date_str = str(date_str).strip().replace('\0', '')
        try:
            # Standardize to ISO format
            # EXIF dates are typically YYYY:MM:DD HH:MM:SS
            dt = datetime.strptime(date_str, '%Y:%m:%d %H:%M:%S')
            return dt.isoformat()
        except ValueError:
            pass

    return None

def process_photos():
    if not RAW_DIR.exists():
        print(f"Directory {RAW_DIR} does not exist.")
        return

    s3 = boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        region_name="auto",
    )

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    missing_gps = []
    files = [f for f in RAW_DIR.iterdir() if f.is_file() and not f.name.startswith('.')]

    print(f"Found {len(files)} files in {RAW_DIR}")

    for file_path in files:
        ext = file_path.suffix.lower()
        if ext not in ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.dng']:
            continue

        try:
            with Image.open(file_path) as img:
                lat_lng = get_gps_details(img)

                if not lat_lng:
                    print(f"No GPS data found for {file_path.name}. Skipping.")
                    missing_gps.append(str(file_path))
                    continue

                lat, lng = lat_lng

                caption = get_caption(img)
                date_taken = get_date_taken(img)

                file_id = file_path.stem
                thumb_name = f"{file_id}_thumb.jpg"
                large_name = f"{file_id}_large.jpg"

                img_thumb = img.copy()
                img_thumb.thumbnail((300, 300))
                if img_thumb.mode in ('RGBA', 'P'):
                    img_thumb = img_thumb.convert('RGB')

                buf_thumb = io.BytesIO()
                img_thumb.save(buf_thumb, "JPEG", quality=80)
                s3.put_object(Bucket=BUCKET, Key=thumb_name, Body=buf_thumb.getvalue(), ContentType="image/jpeg")

                img_large = img.copy()
                img_large.thumbnail((1600, 1600))
                if img_large.mode in ('RGBA', 'P'):
                    img_large = img_large.convert('RGB')

                buf_large = io.BytesIO()
                img_large.save(buf_large, "JPEG", quality=85)
                s3.put_object(Bucket=BUCKET, Key=large_name, Body=buf_large.getvalue(), ContentType="image/jpeg")

                cur.execute(
                    """
                    INSERT INTO photos
                        (friendly_name, thumb_name, large_name, original_name, lat, lon, caption, date, status)
                    VALUES
                        (%s, %s, %s, %s, %s, %s, %s, %s, 'published')
                    ON CONFLICT (friendly_name) DO UPDATE SET
                        thumb_name    = EXCLUDED.thumb_name,
                        large_name    = EXCLUDED.large_name,
                        original_name = EXCLUDED.original_name,
                        lat           = EXCLUDED.lat,
                        lon           = EXCLUDED.lon,
                        caption       = EXCLUDED.caption,
                        date          = EXCLUDED.date,
                        status        = 'published'
                    """,
                    (
                        file_id,
                        thumb_name,
                        large_name,
                        file_path.name,
                        lat,
                        lng,
                        caption or None,
                        date_taken or None,
                    ),
                )

                print(f"Processed {file_path.name}: {lat}, {lng}")

        except Exception as e:
            print(f"Error processing {file_path.name}: {e}")

    conn.commit()
    cur.close()
    conn.close()

    print("-" * 40)
    if missing_gps:
        print(f"Missing GPS data for {len(missing_gps)} photos:")
        for name in missing_gps:
            print(name)
    print("-" * 40)
    print(f"Done! Processed {len(files) - len(missing_gps)} photos.")

if __name__ == "__main__":
    process_photos()
