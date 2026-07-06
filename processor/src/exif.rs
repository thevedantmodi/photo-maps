use exif::{In, Reader, Tag, Value};
use std::io::Cursor;

pub struct ExifData {
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub date: Option<String>,
    pub orientation: u32,
}

pub fn parse(buf: &[u8]) -> ExifData {
    let Ok(exif) = Reader::new().read_from_container(&mut Cursor::new(buf)) else {
        return ExifData {
            lat: None,
            lon: None,
            date: None,
            orientation: 1,
        };
    };

    let lat = gps_coord(&exif, Tag::GPSLatitude, Tag::GPSLatitudeRef);
    let lon = gps_coord(&exif, Tag::GPSLongitude, Tag::GPSLongitudeRef);
    let date = extract_date(&exif);
    let orientation = exif
        .get_field(Tag::Orientation, In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .unwrap_or(1);

    ExifData {
        lat,
        lon,
        date,
        orientation,
    }
}

// Mirrors route.ts's dmsRationalToDecimal + extractGps: kamadak-exif has no
// precomputed decimal-degree helper like exifr does, so this is the only tier.
fn gps_coord(exif: &exif::Exif, coord_tag: Tag, ref_tag: Tag) -> Option<f64> {
    let field = exif.get_field(coord_tag, In::PRIMARY)?;
    let decimal = match &field.value {
        Value::Rational(vals) if vals.len() == 3 => {
            vals[0].to_f64() + vals[1].to_f64() / 60.0 + vals[2].to_f64() / 3600.0
        }
        _ => return None,
    };

    let is_negative = exif
        .get_field(ref_tag, In::PRIMARY)
        .map(|f| f.display_value().to_string())
        .map(|s| s.contains('S') || s.contains('W'))
        .unwrap_or(false);

    Some(if is_negative { -decimal } else { decimal })
}

// Mirrors route.ts lines 86-89: DateTimeOriginal -> CreateDate -> GPS fallback.
fn extract_date(exif: &exif::Exif) -> Option<String> {
    for tag in [Tag::DateTimeOriginal, Tag::DateTimeDigitized] {
        if let Some(field) = exif.get_field(tag, In::PRIMARY) {
            let raw = field.display_value().to_string();
            if let Some(iso) = reformat_exif_date(&raw) {
                return Some(iso);
            }
        }
    }
    gps_date_fallback(exif)
}

// "2024:06:15 14:30:00" -> "2024-06-15T14:30:00Z". Pure string reformatting,
// no calendar arithmetic needed (see plan decision 6).
fn reformat_exif_date(raw: &str) -> Option<String> {
    let (date_part, time_part) = raw.split_once(' ')?;
    let date_part = date_part.replace(':', "-");
    Some(format!("{}T{}Z", date_part, time_part))
}

// Mirrors route.ts's extractGpsDate: GPSDateStamp + GPSTimeStamp, UTC,
// defaults to 00:00:00 if no time array (route.ts lines 47-58).
fn gps_date_fallback(exif: &exif::Exif) -> Option<String> {
    let stamp = exif.get_field(Tag::GPSDateStamp, In::PRIMARY)?;
    let date_part = stamp.display_value().to_string().replace(':', "-");

    let time = exif.get_field(Tag::GPSTimeStamp, In::PRIMARY);
    let (h, m, s) = match time.map(|f| &f.value) {
        Some(Value::Rational(vals)) if vals.len() == 3 => (
            vals[0].to_f64() as u32,
            vals[1].to_f64() as u32,
            vals[2].to_f64() as u32, // matches Math.floor(s) in route.ts
        ),
        _ => (0, 0, 0),
    };

    Some(format!("{}T{:02}:{:02}:{:02}Z", date_part, h, m, s))
}
