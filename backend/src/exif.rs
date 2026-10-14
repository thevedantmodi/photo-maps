//! Where and when a photo was taken, from its own metadata.
//!
//! Mirrors what the TypeScript backend got from `exifr` with `{ gps, xmp, exif, tiff }`:
//!
//! * GPS from the EXIF GPS IFD; failing that, from XMP (`exif:GPSLatitude`), which is where
//!   Lightroom puts it for PNG exports.
//! * Date from EXIF `DateTimeOriginal`, then `CreateDate` (DateTimeDigitized), then the GPS
//!   date stamp. Camera dates are wall-clock times with no zone; exifr revived them in the
//!   server's zone, which was UTC, so they are stored as UTC. XMP dates were never used.

use std::io::Cursor;

use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use exif::{Field, In, Tag, Value};
use regex::Regex;

use crate::gps::{Coordinates, is_valid_lat, is_valid_lon};

#[derive(Debug, Default, PartialEq)]
pub struct PhotoMetadata {
    pub gps: Option<Coordinates>,
    pub date: Option<DateTime<Utc>>,
}

pub fn read(buf: &[u8]) -> PhotoMetadata {
    let exif = exif::Reader::new().read_from_container(&mut Cursor::new(buf)).ok();
    let xmp = find_xmp(buf);

    let gps = exif.as_ref().and_then(exif_gps).or_else(|| xmp.as_deref().and_then(xmp_gps));
    let date = exif.as_ref().and_then(exif_date);
    PhotoMetadata { gps, date }
}

fn field(exif: &exif::Exif, tag: Tag) -> Option<&Field> {
    exif.get_field(tag, In::PRIMARY)
}

fn ascii(f: &Field) -> Option<String> {
    match &f.value {
        Value::Ascii(parts) => {
            let s = String::from_utf8_lossy(parts.first()?).into_owned();
            Some(s.trim_end_matches('\0').trim().to_owned())
        }
        _ => None,
    }
}

fn rationals(f: &Field) -> Option<Vec<f64>> {
    match &f.value {
        Value::Rational(v) if !v.is_empty() => Some(v.iter().map(|r| r.num as f64 / r.denom as f64).collect()),
        _ => None,
    }
}

/// exifr's `ConvertDMSToDD`: degrees + minutes/60 + seconds/3600, negated for S/W.
fn dms_to_decimal(dms: &[f64], reference: Option<&str>) -> f64 {
    let d = dms.first().copied().unwrap_or(0.0);
    let m = dms.get(1).copied().unwrap_or(0.0);
    let s = dms.get(2).copied().unwrap_or(0.0);
    let dd = d + (m / 60.0) + (s / (60.0 * 60.0));
    if matches!(reference, Some("S" | "W")) { -dd } else { dd }
}

fn exif_gps(exif: &exif::Exif) -> Option<Coordinates> {
    let lat = rationals(field(exif, Tag::GPSLatitude)?)?;
    let lon = rationals(field(exif, Tag::GPSLongitude)?)?;
    let lat_ref = field(exif, Tag::GPSLatitudeRef).and_then(ascii);
    let lon_ref = field(exif, Tag::GPSLongitudeRef).and_then(ascii);
    let latitude = dms_to_decimal(&lat, lat_ref.as_deref());
    let longitude = dms_to_decimal(&lon, lon_ref.as_deref());
    // A zero denominator gives NaN or infinity; treat that as no GPS rather than store it.
    (is_valid_lat(latitude) && is_valid_lon(longitude)).then_some(Coordinates { latitude, longitude })
}

/// exifr's `reviveDate`: "YYYY:MM:DD HH:MM:SS" (any of `-`, `:`, space as separators).
/// The time is optional. Out-of-range parts make it no date at all.
fn parse_exif_date(s: &str) -> Option<DateTime<Utc>> {
    let nums: Vec<&str> = s.trim().split(['-', ':', ' ']).collect();
    let num = |i: usize| -> Option<u32> { nums.get(i)?.parse().ok() };
    let date = NaiveDate::from_ymd_opt(nums.first()?.parse().ok()?, num(1)?, num(2)?)?;
    let time = match (num(3), num(4), nums.get(5).and_then(|s| s.parse::<f64>().ok())) {
        (Some(h), Some(m), Some(sec)) => chrono::NaiveTime::from_hms_opt(h, m, sec.trunc() as u32)?,
        _ => chrono::NaiveTime::MIN,
    };
    Some(Utc.from_utc_datetime(&date.and_time(time)))
}

/// GPS stamps are real UTC: the date stamp plus the time stamp when there is one.
///
/// (The TypeScript version expected exifr to return the time as an array, but exifr returns
/// a string, so it always fell back to midnight. The time is used here as intended.)
fn gps_date(exif: &exif::Exif) -> Option<DateTime<Utc>> {
    let stamp = ascii(field(exif, Tag::GPSDateStamp)?)?;
    let mut parts = stamp.split(':');
    let date = NaiveDate::from_ymd_opt(
        parts.next()?.trim().parse().ok()?,
        parts.next()?.trim().parse().ok()?,
        parts.next()?.trim().parse().ok()?,
    )?;
    let time = field(exif, Tag::GPSTimeStamp)
        .and_then(rationals)
        .filter(|t| t.len() == 3 && t.iter().all(|v| v.is_finite() && *v >= 0.0))
        .and_then(|t| chrono::NaiveTime::from_hms_opt(t[0] as u32, t[1] as u32, t[2].floor() as u32))
        .unwrap_or(chrono::NaiveTime::MIN);
    Some(Utc.from_utc_datetime(&date.and_time(time)))
}

fn exif_date(exif: &exif::Exif) -> Option<DateTime<Utc>> {
    let tag_date = |tag| field(exif, tag).and_then(ascii).and_then(|s| parse_exif_date(&s));
    tag_date(Tag::DateTimeOriginal).or_else(|| tag_date(Tag::DateTimeDigitized)).or_else(|| gps_date(exif))
}

/// The XMP packet, wherever the container keeps it (JPEG APP1, PNG iTXt, TIFF, HEIF item):
/// it is plain XML in all of them, so a byte search finds it.
fn find_xmp(buf: &[u8]) -> Option<String> {
    let start = find(buf, b"<x:xmpmeta")?;
    let end_tag = b"</x:xmpmeta>";
    let end = find(&buf[start..], end_tag)? + start + end_tag.len();
    Some(String::from_utf8_lossy(&buf[start..end]).into_owned())
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// A property as an attribute (`exif:GPSLatitude="..."`) or an element
/// (`<exif:GPSLatitude>...</exif:GPSLatitude>`), under any namespace prefix.
fn xmp_property(xmp: &str, name: &str) -> Option<String> {
    let attr = Regex::new(&format!(r#"\b[\w-]+:{name}\s*=\s*(?:"([^"]*)"|'([^']*)')"#)).ok()?;
    if let Some(c) = attr.captures(xmp) {
        return c.get(1).or_else(|| c.get(2)).map(|m| m.as_str().trim().to_owned());
    }
    let elem = Regex::new(&format!(r"<[\w-]+:{name}>([^<]*)</[\w-]+:{name}>")).ok()?;
    elem.captures(xmp).map(|c| c[1].trim().to_owned())
}

fn xmp_gps(xmp: &str) -> Option<Coordinates> {
    let latitude = parse_xmp_coordinate(&xmp_property(xmp, "GPSLatitude")?, xmp_property(xmp, "GPSLatitudeRef"))?;
    let longitude = parse_xmp_coordinate(&xmp_property(xmp, "GPSLongitude")?, xmp_property(xmp, "GPSLongitudeRef"))?;
    (is_valid_lat(latitude) && is_valid_lon(longitude)).then_some(Coordinates { latitude, longitude })
}

/// XMP coordinates come in two shapes:
///
/// * The XMP spec's "DDD,MM,SSk" / "DDD,MM.mmk", direction letter attached. (The TypeScript
///   version could not read these, so photos tagged this way lost their location.)
/// * Raw rationals, "38/1 15/1 2062/100", with the direction in a separate Ref property.
fn parse_xmp_coordinate(raw: &str, reference: Option<String>) -> Option<f64> {
    let s = raw.trim();
    let last = s.chars().last()?;
    if matches!(last.to_ascii_uppercase(), 'N' | 'S' | 'E' | 'W') && s.contains(',') {
        let parts: Vec<f64> =
            s[..s.len() - 1].split(',').map(|p| p.trim().parse::<f64>()).collect::<Result<_, _>>().ok()?;
        if parts.is_empty() || parts.len() > 3 {
            return None;
        }
        let dir = last.to_ascii_uppercase().to_string();
        return Some(dms_to_decimal(&parts, Some(&dir)));
    }
    dms_rational_to_decimal(s, reference.as_deref())
}

/// `dmsRationalToDecimal` from `src/lib/gps.ts`.
fn dms_rational_to_decimal(dms: &str, reference: Option<&str>) -> Option<f64> {
    let parts: Vec<&str> = dms.split_whitespace().collect();
    if parts.len() != 3 {
        return None;
    }
    let vals: Vec<f64> = parts
        .iter()
        .map(|p| {
            let mut it = p.split('/');
            let n = crate::js::string_to_number(it.next().unwrap_or(""));
            match it.next().map(crate::js::string_to_number) {
                Some(d) if d != 0.0 && !d.is_nan() => n / d,
                _ => n,
            }
        })
        .collect();
    let decimal = vals[0] + vals[1] / 60.0 + vals[2] / 3600.0;
    let reference = reference.map(|r| r.trim().chars().next().map(|c| c.to_ascii_uppercase()));
    Some(if matches!(reference, Some(Some('S' | 'W'))) { -decimal } else { decimal })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exif_dates() {
        let d = |s| parse_exif_date(s).map(|d| crate::js::to_iso_string(&d));
        assert_eq!(d("2024:03:19 14:30:05").as_deref(), Some("2024-03-19T14:30:05.000Z"));
        assert_eq!(d("2024-03-19 14:30:05").as_deref(), Some("2024-03-19T14:30:05.000Z"));
        assert_eq!(d("2024:03:19").as_deref(), Some("2024-03-19T00:00:00.000Z"));
        assert_eq!(d("0000:00:00 00:00:00"), None);
        assert_eq!(d("    :  :     :  :  "), None);
        assert_eq!(d(""), None);
    }

    #[test]
    fn xmp_coordinates() {
        assert_eq!(parse_xmp_coordinate("38,15.5N", None), Some(38.0 + 15.5 / 60.0));
        assert_eq!(parse_xmp_coordinate("122,30,10W", None), Some(-(122.0 + 30.0 / 60.0 + 10.0 / 3600.0)));
        assert_eq!(parse_xmp_coordinate("38/1 15/1 2062/100", Some("S".into())), Some(-(38.0 + 0.25 + 20.62 / 3600.0)));
        assert_eq!(parse_xmp_coordinate("38/1 15/1 2062/100", None), Some(38.0 + 0.25 + 20.62 / 3600.0));
        assert_eq!(parse_xmp_coordinate("garbage", None), None);
    }

    #[test]
    fn xmp_properties() {
        let attr = r#"<x:xmpmeta><rdf:Description exif:GPSLatitude="38,15.34366667N" exif:GPSLatitudeRef="N" exif:GPSLongitude='122,30.16666667W'/></x:xmpmeta>"#;
        assert_eq!(xmp_property(attr, "GPSLatitude").as_deref(), Some("38,15.34366667N"));
        assert_eq!(xmp_property(attr, "GPSLongitude").as_deref(), Some("122,30.16666667W"));
        let elem = "<x:xmpmeta><exif:GPSLatitudeRef>S</exif:GPSLatitudeRef><exif:GPSLatitude>1/1 0/1 0/1</exif:GPSLatitude></x:xmpmeta>";
        assert_eq!(xmp_property(elem, "GPSLatitude").as_deref(), Some("1/1 0/1 0/1"));
        assert_eq!(xmp_property(elem, "GPSLatitudeRef").as_deref(), Some("S"));
    }
}
