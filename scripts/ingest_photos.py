import os
import sys
import subprocess
from pathlib import Path
from PIL import Image
import pillow_heif
import piexif

# Register HEIC opener
pillow_heif.register_heif_opener()

BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "photos"

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
    gps_info = exif.get_ifd(0x8825)
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

def get_date_taken(image):
    exif = image.getexif()
    if not exif:
        return None
    # 36867 = DateTimeOriginal, 306 = DateTime
    return exif.get(36867) or exif.get(306)

def has_exiftool():
    try:
        subprocess.run(["exiftool", "-ver"], capture_output=True, check=True)
        return True
    except:
        return False

def set_caption(file_path, caption):
    # Method 1: Use exiftool (Best for all formats, especially HEIC)
    if has_exiftool():
        try:
            # -overwrite_original prevents creating _original backup files
            subprocess.run([
                "exiftool", 
                "-overwrite_original",
                f"-ImageDescription={caption}",
                f"-UserComment={caption}", # Set both for compatibility
                str(file_path)
            ], check=True, capture_output=True)
            return True
        except subprocess.CalledProcessError as e:
            print(f"  [Error] exiftool failed: {e}")
            return False

    # Method 2: Use piexif (JPEG only)
    if file_path.suffix.lower() in ['.jpg', '.jpeg']:
        try:
            exif_dict = piexif.load(str(file_path))
            # 0x010E is ImageDescription
            exif_dict['0th'][piexif.ImageIFD.ImageDescription] = caption.encode('utf-8')
            exif_bytes = piexif.dump(exif_dict)
            piexif.insert(exif_bytes, str(file_path))
            return True
        except Exception as e:
            print(f"  [Error] piexif failed: {e}")
            return False
            
    print("  [Warning] No suitable tool found to write metadata for this file type.")
    print("  Please install 'exiftool' for HEIC support: brew install exiftool")
    return False

def ingest():
    if not RAW_DIR.exists():
        print(f"Directory {RAW_DIR} does not exist.")
        return

    print("--- Photo Ingest Workflow ---")
    if has_exiftool():
        print("✓ exiftool detected (Full support)")
    else:
        print("! exiftool not found. HEIC writing will be skipped. Install with 'brew install exiftool'")

    files = [f for f in RAW_DIR.iterdir() if f.is_file() and not f.name.startswith('.')]
    files.sort()
    
    count = 0
    for file_path in files:
        if file_path.suffix.lower() not in ['.jpg', '.jpeg', '.png', '.heic', '.dng']:
            continue
            
        print(f"\n[{count+1}/{len(files)}] {file_path.name}")
        try:
            with Image.open(file_path) as img:
                date = get_date_taken(img)
                gps = get_gps_details(img)
                
                print(f"  Date: {date or 'Unknown'}")
                print(f"  GPS:  {gps or 'Unknown'}")
                
                # Check for existing caption
                exif = img.getexif()
                existing = exif.get(0x010E)
                if existing:
                    # Decode if bytes
                    if isinstance(existing, bytes):
                        existing = existing.decode('utf-8', errors='ignore')
                    print(f"  Current Caption: {existing}")
                
        except Exception as e:
            print(f"  [Error] Reading metadata: {e}")
            # Continue anyway to allow tagging
            
        caption = input("  Enter New Caption (Press Enter to keep/skip): ").strip()
        if caption:
            if set_caption(file_path, caption):
                print("  ✓ Saved caption to EXIF")
            else:
                print("  ✗ Failed to save")
        
        count += 1

if __name__ == "__main__":
    ingest()
