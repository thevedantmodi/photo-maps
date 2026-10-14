//! JavaScript semantics the original TypeScript backend leaned on implicitly.
//!
//! Request bodies are loosely typed JSON, and the old routes coerced them with `Number(x)`,
//! truthiness checks and `new Date(x)`. The admin UI and any stored data were built against
//! those rules, so they are reproduced here rather than replaced with stricter parsing.
//! Values JavaScript would have accepted only by accident (arrays coerced to numbers,
//! free-form date strings) are rejected instead.

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use serde_json::Value;

/// JavaScript's `WhiteSpace` and `LineTerminator` code points: what `String.prototype.trim`
/// strips and what `\s` matches in a JS regex. Differs from Rust's `char::is_whitespace`
/// (which includes U+0085 but not U+FEFF).
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'..='\u{000D}'
            | ' '
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

/// `String.prototype.trim`.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// `Boolean(value)` for a JSON value.
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `value == null || value === ''` — the "blank" test the routes used before `Number()`.
pub fn is_blank(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.is_empty(),
        _ => false,
    }
}

/// `Number(value)` for scalar JSON values. Arrays and objects, which JavaScript coerces
/// through `toString()` (so `Number([])` is `0`), yield NaN and are rejected by callers.
pub fn to_number(v: &Value) -> f64 {
    match v {
        Value::Null => 0.0,
        Value::Bool(b) => f64::from(u8::from(*b)),
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => string_to_number(s),
        Value::Array(_) | Value::Object(_) => f64::NAN,
    }
}

/// `Number(string)`: StringToNumber from the ECMAScript spec.
pub fn string_to_number(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(digits) = t.strip_prefix(prefix) {
            if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
                return f64::NAN;
            }
            // Accumulate as f64 so very long literals round like JS instead of overflowing.
            return digits.chars().fold(0.0, |acc, c| acc * f64::from(radix) + f64::from(c.to_digit(radix).unwrap()));
        }
    }
    if is_decimal_literal(t) { t.parse::<f64>().unwrap_or(f64::NAN) } else { f64::NAN }
}

/// `StrDecimalLiteral`: optional sign, digits with an optional fraction (either side of the
/// dot may be empty, not both), optional exponent. Rust's `f64::from_str` is laxer (it takes
/// "inf" and "nan"), so the shape is checked first.
fn is_decimal_literal(t: &str) -> bool {
    let b = t.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let int_digits = i - int_start;
    let mut frac_digits = 0;
    if i < b.len() && b[i] == b'.' {
        i += 1;
        let frac_start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        frac_digits = i - frac_start;
    }
    if int_digits == 0 && frac_digits == 0 {
        return false;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        let exp_start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == exp_start {
            return false;
        }
    }
    i == b.len()
}

/// Largest magnitude a JavaScript `Date` can hold, in milliseconds.
const MAX_DATE_MS: f64 = 8.64e15;

/// `new Date(value)` for the values the admin UI sends: a `datetime-local` string
/// ("2024-03-19T14:30"), an ISO 8601 string, an RFC 2822 string, or epoch milliseconds.
///
/// Strings without an offset are local time in JavaScript; the old backend ran in UTC, so
/// they are read as UTC here. Returns `None` where JavaScript would give an Invalid Date, and
/// also for free-form strings ("March 7, 2024") whose parsing in V8 is implementation-defined.
pub fn parse_js_date(v: &Value) -> Option<DateTime<Utc>> {
    match v {
        Value::Number(n) => {
            let ms = n.as_f64()?;
            if !ms.is_finite() || ms.abs() > MAX_DATE_MS {
                return None;
            }
            Utc.timestamp_millis_opt(ms.trunc() as i64).single()
        }
        Value::String(s) => parse_date_string(s),
        _ => None,
    }
}

fn parse_date_string(raw: &str) -> Option<DateTime<Utc>> {
    let s = js_trim(raw);
    if let Some(dt) = parse_iso(s) {
        return Some(truncate_to_millis(dt));
    }
    DateTime::parse_from_rfc2822(s).ok().map(|d| d.with_timezone(&Utc))
}

/// JavaScript dates carry millisecond precision.
fn truncate_to_millis(dt: DateTime<Utc>) -> DateTime<Utc> {
    Utc.timestamp_millis_opt(dt.timestamp_millis()).single().unwrap_or(dt)
}

/// ECMAScript's Date Time String Format, plus the space separator V8 also accepts.
fn parse_iso(s: &str) -> Option<DateTime<Utc>> {
    let (date_part, rest) = match s.find(['T', 't', ' ']) {
        Some(i) => (&s[..i], Some(&s[i + 1..])),
        None => (s, None),
    };
    let date = parse_iso_date(date_part)?;
    let Some(rest) = rest else {
        // Date-only forms are UTC.
        return Some(Utc.from_utc_datetime(&date.and_time(NaiveTime::MIN)));
    };

    let (time_part, offset_secs) = split_offset(rest)?;
    let (time, next_day) = parse_iso_time(time_part)?;
    let date = if next_day { date.succ_opt()? } else { date };
    let naive = NaiveDateTime::new(date, time);
    Some(Utc.from_utc_datetime(&naive) - chrono::Duration::seconds(offset_secs.unwrap_or(0)))
}

/// "YYYY", "YYYY-MM", "YYYY-MM-DD", or the extended "±YYYYYY-MM-DD" forms.
fn parse_iso_date(s: &str) -> Option<NaiveDate> {
    let (year, rest) = if let Some(r) = s.strip_prefix(['+', '-']) {
        let digits = r.get(..6)?;
        if !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let mut y: i32 = digits.parse().ok()?;
        if s.starts_with('-') {
            if y == 0 {
                return None; // "-000000" is explicitly invalid.
            }
            y = -y;
        }
        (y, &r[6..])
    } else {
        let digits = s.get(..4)?;
        if !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        (digits.parse().ok()?, &s[4..])
    };

    let mut month = 1;
    let mut day = 1;
    let mut rest = rest;
    if !rest.is_empty() {
        month = two_digits(rest.strip_prefix('-')?)?;
        rest = &rest[3..];
        if !rest.is_empty() {
            day = two_digits(rest.strip_prefix('-')?)?;
            rest = &rest[3..];
        }
    }
    if !rest.is_empty() {
        return None;
    }
    NaiveDate::from_ymd_opt(year, month, day)
}

fn two_digits(s: &str) -> Option<u32> {
    let d = s.get(..2)?;
    if d.bytes().all(|b| b.is_ascii_digit()) { d.parse().ok() } else { None }
}

/// Splits "HH:mm:ss.sss±HH:mm" into the time and its offset in seconds (None = local).
fn split_offset(s: &str) -> Option<(&str, Option<i64>)> {
    if let Some(t) = s.strip_suffix(['Z', 'z']) {
        return Some((t, Some(0)));
    }
    if let Some(i) = s.rfind(['+', '-']) {
        let (t, off) = s.split_at(i);
        let sign = if off.starts_with('-') { -1 } else { 1 };
        let off = &off[1..];
        let (h, m) = match off.len() {
            5 if off.as_bytes()[2] == b':' => (&off[..2], &off[3..]),
            4 => (&off[..2], &off[2..]),
            _ => return None,
        };
        let h: i64 = h.parse().ok()?;
        let m: i64 = m.parse().ok()?;
        if h > 23 || m > 59 {
            return None;
        }
        return Some((t, Some(sign * (h * 3600 + m * 60))));
    }
    Some((s, None))
}

/// "HH:mm", "HH:mm:ss", or "HH:mm:ss.s+" (any number of fraction digits, truncated to ms).
/// The flag is set for "24:00", which the spec allows as midnight at the end of the day.
fn parse_iso_time(s: &str) -> Option<(NaiveTime, bool)> {
    let b = s.as_bytes();
    if b.len() < 5 || b[2] != b':' {
        return None;
    }
    let h = two_digits(&s[..2])?;
    let m = two_digits(&s[3..5])?;
    let mut sec = 0;
    let mut nanos = 0;
    let rest = &s[5..];
    if !rest.is_empty() {
        let rest = rest.strip_prefix(':')?;
        sec = two_digits(rest)?;
        let frac = &rest[2..];
        if !frac.is_empty() {
            let digits = frac.strip_prefix(['.', ','])?;
            if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let ms: String = digits.chars().chain("000".chars()).take(3).collect();
            nanos = ms.parse::<u32>().ok()? * 1_000_000;
        }
    }
    if h == 24 && m == 0 && sec == 0 && nanos == 0 {
        return Some((NaiveTime::MIN, true));
    }
    if h > 23 || m > 59 || sec > 59 {
        return None;
    }
    Some((NaiveTime::from_hms_nano_opt(h, m, sec, nanos)?, false))
}

/// `Date.prototype.toISOString`: always UTC with exactly three fractional digits.
pub fn to_iso_string(dt: &DateTime<Utc>) -> String {
    use chrono::Datelike;
    let year = dt.year();
    let y = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else if year < 0 {
        format!("-{:06}", -year)
    } else {
        format!("+{year:06}")
    };
    format!("{y}{}", dt.format("-%m-%dT%H:%M:%S%.3fZ"))
}

/// `Date.prototype.toUTCString`, e.g. "Tue, 19 Mar 2024 14:30:05 GMT".
pub fn to_utc_string(dt: &DateTime<Utc>) -> String {
    dt.format("%a, %d %b %Y %H:%M:%S GMT").to_string()
}

/// `toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })` in
/// UTC, the old server's zone: "March 19, 2024".
pub fn format_long_date(dt: &DateTime<Utc>) -> String {
    dt.format("%B %-d, %Y").to_string()
}

/// `encodeURIComponent`.
pub fn encode_uri_component(s: &str) -> String {
    const UNRESERVED: &[u8] = b"-_.!~*'()";
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || UNRESERVED.contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Length in UTF-16 code units, which is what `String.prototype.length` counts.
pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// `s.slice(0, n)` in UTF-16 units. A surrogate pair split by the cut is dropped whole
/// rather than leaving a lone surrogate, which Rust strings cannot hold.
pub fn utf16_prefix(s: &str, n: usize) -> &str {
    let mut units = 0;
    for (i, c) in s.char_indices() {
        let w = c.len_utf16();
        if units + w > n {
            return &s[..i];
        }
        units += w;
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn number_coercion_matches_js() {
        let cases: &[(Value, f64)] = &[
            (json!("40.7128"), 40.7128),
            (json!("  -74.006 \n"), -74.006),
            (json!(""), 0.0),
            (json!("   "), 0.0),
            (json!(null), 0.0),
            (json!(true), 1.0),
            (json!(false), 0.0),
            (json!(12.5), 12.5),
            (json!("1e3"), 1000.0),
            (json!(".5"), 0.5),
            (json!("5."), 5.0),
            (json!("+5"), 5.0),
            (json!("0x1A"), 26.0),
            (json!("0b101"), 5.0),
            (json!("0o17"), 15.0),
            (json!("Infinity"), f64::INFINITY),
            (json!("-Infinity"), f64::NEG_INFINITY),
            (json!("\u{FEFF}7\u{A0}"), 7.0),
        ];
        for (v, want) in cases {
            assert_eq!(to_number(v), *want, "Number({v})");
        }
        for v in [
            json!("abc"),
            json!("1,5"),
            json!("inf"),
            json!("NaN"),
            json!("infinity"),
            json!("-0x10"),
            json!("0x"),
            json!("1e"),
            json!("."),
            json!("1_000"),
            json!([1]),
            json!({}),
        ] {
            assert!(to_number(&v).is_nan(), "Number({v}) should be NaN");
        }
    }

    #[test]
    fn truthiness() {
        assert!(!truthy(&json!(null)));
        assert!(!truthy(&json!("")));
        assert!(!truthy(&json!(0)));
        assert!(!truthy(&json!(false)));
        assert!(truthy(&json!("0")));
        assert!(truthy(&json!([])));
        assert!(truthy(&json!(-1)));
    }

    fn date(v: Value) -> Option<String> {
        parse_js_date(&v).map(|d| to_iso_string(&d))
    }

    #[test]
    fn dates_parse_like_v8_in_utc() {
        assert_eq!(date(json!("2024-03-19T14:30")).as_deref(), Some("2024-03-19T14:30:00.000Z"));
        assert_eq!(date(json!("2024-03-19T14:30:05")).as_deref(), Some("2024-03-19T14:30:05.000Z"));
        assert_eq!(date(json!("2024-03-19")).as_deref(), Some("2024-03-19T00:00:00.000Z"));
        assert_eq!(date(json!("2024-03")).as_deref(), Some("2024-03-01T00:00:00.000Z"));
        assert_eq!(date(json!("2024")).as_deref(), Some("2024-01-01T00:00:00.000Z"));
        assert_eq!(date(json!("2024-03-19T14:30:05.123456Z")).as_deref(), Some("2024-03-19T14:30:05.123Z"));
        assert_eq!(date(json!("2024-03-19T14:30:05.1+02:00")).as_deref(), Some("2024-03-19T12:30:05.100Z"));
        assert_eq!(date(json!("2024-03-19T23:30-05:00")).as_deref(), Some("2024-03-20T04:30:00.000Z"));
        assert_eq!(date(json!("2024-03-19 14:30")).as_deref(), Some("2024-03-19T14:30:00.000Z"));
        assert_eq!(date(json!("Tue, 19 Mar 2024 14:30:05 GMT")).as_deref(), Some("2024-03-19T14:30:05.000Z"));
        assert_eq!(date(json!(1_710_858_605_123_i64)).as_deref(), Some("2024-03-19T14:30:05.123Z"));
        assert_eq!(date(json!("2024-12-31T24:00")).as_deref(), Some("2025-01-01T00:00:00.000Z"));
        // All of the above checked against V8. The two marked cases V8's legacy fallback
        // parser accepts ("2024-02-30" rolls over to March 1); they are refused here rather
        // than stored as some other date. The admin UI never sends either shape.
        for bad in [
            json!("nope"),
            json!("2024-13-01"),
            json!("2024-02-30"), // V8: 2024-03-01
            json!("2024-03-19T25:00"),
            json!("2024-3-19"), // V8: 2024-03-19 (legacy parser)
            json!(""),
            json!(true),
            json!(9e15),
        ] {
            assert_eq!(date(bad.clone()), None, "{bad}");
        }
    }

    #[test]
    fn iso_string_format() {
        let dt = Utc.with_ymd_and_hms(2024, 3, 19, 14, 30, 5).unwrap();
        assert_eq!(to_iso_string(&dt), "2024-03-19T14:30:05.000Z");
        assert_eq!(to_utc_string(&dt), "Tue, 19 Mar 2024 14:30:05 GMT");
        assert_eq!(format_long_date(&dt), "March 19, 2024");
        let d2 = Utc.with_ymd_and_hms(2026, 1, 5, 0, 0, 0).unwrap();
        assert_eq!(to_utc_string(&d2), "Mon, 05 Jan 2026 00:00:00 GMT");
        assert_eq!(format_long_date(&d2), "January 5, 2026");
    }

    #[test]
    fn uri_component() {
        assert_eq!(encode_uri_component("a b/c?d=é&'()*!~._-"), "a%20b%2Fc%3Fd%3D%C3%A9%26'()*!~._-");
        assert_eq!(encode_uri_component("x.y+z"), "x.y%2Bz");
    }

    #[test]
    fn utf16_helpers() {
        assert_eq!(utf16_len("a😀"), 3);
        assert_eq!(utf16_prefix("a😀b", 2), "a");
        assert_eq!(utf16_prefix("a😀b", 3), "a😀");
        assert_eq!(utf16_prefix("abc", 10), "abc");
    }
}
