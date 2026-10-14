//! The upload pipeline against what the TypeScript backend produced for the same files.
//!
//! Expected metadata is what `exifr` returned (through `extractGps`/`extractExifDate`), and
//! expected pixels were sampled from `sharp(...).rotate().resize(300, 300, { fit: 'inside' })`
//! (after `heic-convert` for HEIC). Fixtures were made with PIL, exiftool and heif-enc.

use photo_maps_backend::{exif, imaging, js};

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!("{}/tests/fixtures/images/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

fn metadata(name: &str) -> (Option<(f64, f64)>, Option<String>) {
    let m = exif::read(&fixture(name));
    (m.gps.map(|g| (g.latitude, g.longitude)), m.date.map(|d| js::to_iso_string(&d)))
}

#[test]
fn metadata_matches_exifr() {
    type Case = (&'static str, Option<(f64, f64)>, Option<&'static str>);
    let cases: &[Case] = &[
        ("exif_full.jpg", Some((40.7128, -74.006)), Some("2024-03-19T14:30:05.000Z")),
        ("southwest.jpg", Some((-33.8688, 151.20929999999998)), None),
        ("exif_png.png", Some((-10.5, 20.25)), Some("2020-05-06T07:08:09.000Z")),
        ("exif.heic", Some((48.8584, 2.2944999999999998)), Some("2025-08-09T10:11:12.000Z")),
        ("noref.jpg", Some((12.5, 45.25)), None),
        ("createdate.jpg", None, Some("2023-12-31T23:59:59.000Z")),
        ("gpsdate_only_day.jpg", None, Some("2022-07-04T00:00:00.000Z")),
        ("base.jpg", None, None),
        ("alpha.png", None, None),
        ("plain.avif", None, None),
    ];
    for (name, gps, date) in cases {
        let (got_gps, got_date) = metadata(name);
        assert_eq!(got_gps, *gps, "{name} gps");
        assert_eq!(got_date.as_deref(), *date, "{name} date");
    }
}

/// Where this port deliberately reads more than the TypeScript version did.
#[test]
fn metadata_fixes_over_exifr() {
    // XMP coordinates in the spec's "DDD,MM.mmk" form: exifr returned the strings and
    // `dmsRationalToDecimal` could not parse them, so these photos lost their location.
    let lat = 38.0 + 15.34366667 / 60.0;
    let lon = 122.0 + 30.16666667 / 60.0;
    let (gps, _) = metadata("xmp_gps.png");
    let (la, lo) = gps.unwrap();
    assert!((la + lat).abs() < 1e-9 && (lo - lon).abs() < 1e-9, "{gps:?}");
    let (gps, date) = metadata("lightroom.jpg");
    let (la, lo) = gps.unwrap();
    assert!((la - lat).abs() < 1e-9 && (lo + lon).abs() < 1e-9, "{gps:?}");
    // EXIF still wins over XMP for the date, as with exifr.
    assert_eq!(date.as_deref(), Some("2024-01-02T03:04:05.000Z"));

    // GPS time of day: exifr returned it as a string the old code ignored, so it stored
    // midnight. The time is kept (seconds floored).
    assert_eq!(metadata("gpsdate.jpg").1.as_deref(), Some("2022-07-04T13:45:30.000Z"));
}

/// (file, sharp's thumbnail size, [(x, y, [r, g, b])] sampled from sharp's thumbnail).
type Sample = (&'static str, (u32, u32), &'static [(u32, u32, [u8; 3])]);

const SHARP_SAMPLES: &[Sample] = &[
    // EXIF orientation 6: stored landscape, shown portrait.
    (
        "exif_full.jpg",
        (225, 300),
        &[(10, 10, [8, 242, 127]), (112, 150, [127, 125, 42]), (215, 290, [246, 10, 30]), (33, 240, [202, 217, 30])],
    ),
    // Orientation 3: upside down.
    (
        "southwest.jpg",
        (300, 225),
        &[(10, 10, [245, 242, 29]), (150, 112, [127, 127, 116]), (290, 215, [8, 11, 128]), (45, 180, [215, 50, 30])],
    ),
    // Display P3 profile, converted to sRGB.
    (
        "p3.jpg",
        (300, 225),
        &[(10, 10, [255, 0, 0]), (150, 112, [0, 255, 100]), (290, 215, [0, 130, 255]), (45, 180, [255, 0, 197])],
    ),
    (
        "exif.heic",
        (300, 225),
        &[(10, 10, [7, 12, 129]), (150, 112, [128, 126, 35]), (290, 215, [246, 243, 28]), (45, 180, [38, 204, 128])],
    ),
    (
        "plain.avif",
        (300, 225),
        &[(10, 10, [9, 11, 126]), (150, 112, [127, 131, 39]), (290, 215, [248, 244, 32]), (45, 180, [38, 204, 128])],
    ),
    // 50% red over nothing: flattened onto black as libvips does for JPEG output.
    ("alpha.png", (300, 150), &[(10, 10, [128, 0, 0]), (150, 75, [128, 0, 0])]),
];

#[test]
fn pixels_match_sharp() {
    for (name, size, samples) in SHARP_SAMPLES {
        let img = imaging::decode_photo(&fixture(name)).unwrap_or_else(|e| panic!("{name}: {e:#}"));
        let thumb = imaging::resize_inside(&img, 300, 300);
        assert_eq!(thumb.dimensions(), *size, "{name} size");
        for (x, y, want) in *samples {
            let got = thumb.get_pixel(*x, *y).0;
            let close = got.iter().zip(want).all(|(g, w)| g.abs_diff(*w) <= 6);
            assert!(close, "{name} at ({x},{y}): got {got:?}, sharp {want:?}");
        }
    }
}

#[test]
fn renditions_are_decodable_jpegs_of_the_right_size() {
    let img = imaging::decode_photo(&fixture("exif_full.jpg")).unwrap();
    let r = imaging::renditions(&img).unwrap();
    assert_eq!(imaging::decode_jpeg(&r.thumb).unwrap().dimensions(), (225, 300));
    // Enlarged, as sharp's `fit: 'inside'` does without `withoutEnlargement`.
    assert_eq!(imaging::decode_jpeg(&r.large).unwrap().dimensions(), (1200, 1600));
}

#[test]
fn garbage_is_an_error_not_a_panic() {
    assert!(imaging::decode_photo(b"definitely not an image").is_err());
    assert!(imaging::decode_photo(&[]).is_err());
    let mut truncated = fixture("exif.heic");
    truncated.truncate(200);
    assert!(imaging::decode_photo(&truncated).is_err());
    assert_eq!(exif::read(b"nothing here"), exif::PhotoMetadata::default());
}
