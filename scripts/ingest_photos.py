import os
import sys
import subprocess
import base64
from io import BytesIO
from pathlib import Path
from PIL import Image
import pillow_heif
import piexif

# Register HEIC opener
pillow_heif.register_heif_opener()

BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "photos"

def print_iterm_image(path):
    """Displays image in iTerm2 using inline image protocol"""
    try:
        with Image.open(path) as img:
            # Create a thumbnail for display to keep it snappy
            display_img = img.copy()
            display_img.thumbnail((500, 500))
            
            if display_img.mode != 'RGB':
                display_img = display_img.convert('RGB')
            
            bio = BytesIO()
            display_img.save(bio, format='JPEG', quality=80)
            content = bio.getvalue()
            
            encoded = base64.b64encode(content).decode('utf-8')
            
            # Print OSC code
            print(f"\033]1337;File=inline=1;width=auto;height=auto:{encoded}\a")
            print() # Add a newline
            
    except Exception as e:
        pass

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
            
    print("  [Warning] No suitable tool found to write metadata for this file type.")
    print("  Please install 'exiftool' for HEIC support: brew install exiftool")
    return False

def ingest():
    if not RAW_DIR.exists():
        print(f"Directory {RAW_DIR} does not exist.")
        return

    print("--- Photo Ingest Workflow ---")
    if not has_exiftool():
        print("! exiftool not found. HEIC writing will be skipped. Install with 'brew install exiftool'")
        sys.exit(1)

    files = [f for f in RAW_DIR.iterdir() if f.is_file() and not f.name.startswith('.')]
    files.sort()
    
    for i, file_path in enumerate(files):
        if file_path.suffix.lower() not in ['.jpg', '.jpeg', '.png', '.heic', '.dng']:
            continue
            
        try:
            with Image.open(file_path) as img:
                date = get_date_taken(img)
                gps = get_gps_details(img)
                
                # Check for existing caption
                existing_caption = get_caption(img)
                if existing_caption:
                    print(f"[{i+1}/{len(files)}] Skipping {file_path.name} (Has caption: {existing_caption[:30]}...)")
                    continue

                print(f"\n[{i+1}/{len(files)}] {file_path.name}")
                print_iterm_image(file_path)
                print(f"  Date: {date or 'Unknown'}")
                print(f"  GPS:  {gps or 'Unknown'}")
                
        except Exception as e:
            print(f"  [Error] Reading metadata: {e}")
            # Continue anyway to allow tagging
            
        caption = input("  Enter New Caption (Press Enter to keep/skip): ").strip()
        if caption:
            if set_caption(file_path, caption):
                print("  ✓ Saved caption to EXIF")
            else:
                print("  ✗ Failed to save")

if __name__ == "__main__":
    ingest()
