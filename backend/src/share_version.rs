//! `shareVersion`: a short fingerprint of everything that changes what a share card shows.
//!
//! The browser computes the same value (`src/lib/shareVersion.ts`) to build card URLs, and
//! existing rows store versions computed by the old TypeScript backend, so this must agree
//! with it bit for bit: FNV-1a over UTF-16 code units, printed in base 36.

pub struct Versioned<'a> {
    pub caption: Option<&'a str>,
    pub original_name: &'a str,
    /// `toISOString()` of the photo date, if any.
    pub date: Option<&'a str>,
    pub large_name: &'a str,
}

pub fn share_version(p: &Versioned) -> String {
    let mut hash: u32 = 0x811c_9dc5;
    let parts = [p.caption.unwrap_or(""), p.original_name, p.date.unwrap_or(""), p.large_name];
    for (i, part) in parts.iter().enumerate() {
        if i > 0 {
            hash ^= 0; // the '\u0000' separator
            hash = hash.wrapping_mul(0x0100_0193);
        }
        for unit in part.encode_utf16() {
            hash ^= u32::from(unit);
            hash = hash.wrapping_mul(0x0100_0193);
        }
    }
    to_base36(hash)
}

fn to_base36(mut n: u32) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}

/// R2 key for a photo's precomputed share card, next to `_thumb.jpg` and `_large.jpg`.
pub fn share_card_key(friendly_name: &str) -> String {
    format!("{friendly_name}_share.png")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Expected values printed by the TypeScript `shareVersion` in `src/lib/shareVersion.ts`.
    #[test]
    fn matches_typescript() {
        let cases = [
            (
                Some("Sunset over the bay"),
                "IMG_1234.HEIC",
                Some("2024-03-19T14:30:05.000Z"),
                "sunset_large.jpg",
                "1g7t3u8",
            ),
            (None, "IMG_1234.HEIC", None, "sunset_large.jpg", "1a5in5j"),
            (Some(""), "", None, "", "kq2j7b"),
            (Some("Café 🌅 — naïve"), "x.jpg", Some("1999-12-31T23:59:59.999Z"), "x_large.jpg", "tspo3r"),
        ];
        for (caption, original_name, date, large_name, want) in cases {
            let v = Versioned { caption, original_name, date, large_name };
            assert_eq!(share_version(&v), want, "{caption:?}");
        }
    }

    #[test]
    fn base36() {
        assert_eq!(to_base36(0), "0");
        assert_eq!(to_base36(35), "z");
        assert_eq!(to_base36(36), "10");
        assert_eq!(to_base36(u32::MAX), "1z141z3");
    }
}
