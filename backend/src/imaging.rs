//! Decoding, orienting, resizing and encoding photos: what `sharp` (and `heic-convert` in
//! front of it) did in the TypeScript backend.
//!
//! Behaviors kept from sharp, since stored images were produced by it:
//! * EXIF orientation is applied and all metadata is stripped from the output.
//! * Embedded ICC profiles are converted to sRGB (iPhone JPEGs are Display P3).
//! * Transparency is flattened onto black, as libvips does when saving a JPEG.
//! * `fit: 'inside'` scales up as well as down, and rounds the free dimension.
//! * JPEGs are baseline with 4:2:0 chroma subsampling and optimized Huffman tables.

use std::io::Cursor;

use anyhow::{Context, Result, anyhow, bail};
use fast_image_resize::images::Image as FirImage;
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use image::{DynamicImage, ImageDecoder, ImageReader, RgbImage, RgbaImage};

/// Brands that mean the image is HEVC-coded (HEIC). AVIF shares the HEIF container and is
/// detected separately.
const HEVC_BRANDS: [&[u8; 4]; 6] = [b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis"];
const AV1_BRANDS: [&[u8; 4]; 2] = [b"avif", b"avis"];

/// The brands an ISO-BMFF `ftyp` box declares (major first, then compatible).
fn ftyp_brands(buf: &[u8]) -> Vec<[u8; 4]> {
    if buf.len() < 16 || &buf[4..8] != b"ftyp" {
        return Vec::new();
    }
    let box_end = (u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize).min(buf.len());
    let mut brands = vec![[buf[8], buf[9], buf[10], buf[11]]];
    // Compatible brands start after the major brand (4) and minor version (4).
    let mut i = 16;
    while i + 4 <= box_end {
        brands.push([buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]);
        i += 4;
    }
    brands
}

/// True when the buffer's ftyp box declares an HEVC brand (major or compatible).
pub fn is_heic(buf: &[u8]) -> bool {
    ftyp_brands(buf).iter().any(|b| HEVC_BRANDS.contains(&b))
}

fn is_avif(buf: &[u8]) -> bool {
    !is_heic(buf) && ftyp_brands(buf).iter().any(|b| AV1_BRANDS.contains(&b))
}

/// Decodes an uploaded original into upright sRGB pixels.
pub fn decode_photo(buf: &[u8]) -> Result<RgbImage> {
    if is_heic(buf) {
        // heic-convert handed sharp an already-upright JPEG with no ICC profile, so the
        // container's transforms apply and its colour profile is ignored, as before.
        return decode_heif(buf, false);
    }
    if is_avif(buf) {
        return decode_heif(buf, true);
    }
    decode_with_image_crate(buf)
}

fn decode_with_image_crate(buf: &[u8]) -> Result<RgbImage> {
    let reader = ImageReader::new(Cursor::new(buf)).with_guessed_format().context("read image")?;
    if reader.format().is_none() {
        bail!("unsupported image format");
    }
    let mut decoder = reader.into_decoder().context("unsupported image format")?;
    let icc = decoder.icc_profile().ok().flatten();
    let orientation = decoder.orientation().ok();
    let mut img = DynamicImage::from_decoder(decoder).context("decode image")?;
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    let mut rgb = flatten_onto_black(img);
    if let Some(icc) = icc {
        to_srgb(&mut rgb, &icc);
    }
    Ok(rgb)
}

fn decode_heif(buf: &[u8], apply_icc: bool) -> Result<RgbImage> {
    use libheif_rs::{ColorSpace, HeifContext, LibHeif, RgbChroma};

    let lib = LibHeif::new();
    let ctx = HeifContext::read_from_bytes(buf).context("read HEIF")?;
    let handle = ctx.primary_image_handle().context("HEIF primary image")?;
    let icc = if apply_icc { handle.color_profile_raw().map(|p| p.data) } else { None };
    // Default decoding options apply the container's rotation and mirroring.
    let image = lib.decode(&handle, ColorSpace::Rgb(RgbChroma::Rgb), None).context("decode HEIF")?;
    let planes = image.planes();
    let plane = planes.interleaved.ok_or_else(|| anyhow!("HEIF decode returned no interleaved plane"))?;
    let (w, h, stride) = (plane.width, plane.height, plane.stride);
    let row_bytes = w as usize * 3;
    let mut pixels = Vec::with_capacity(row_bytes * h as usize);
    for y in 0..h as usize {
        pixels.extend_from_slice(&plane.data[y * stride..y * stride + row_bytes]);
    }
    let mut rgb = RgbImage::from_raw(w, h, pixels).ok_or_else(|| anyhow!("HEIF plane size mismatch"))?;
    if let Some(icc) = icc {
        to_srgb(&mut rgb, &icc);
    }
    Ok(rgb)
}

/// Drops alpha the way libvips does when saving a JPEG: composited over black.
fn flatten_onto_black(img: DynamicImage) -> RgbImage {
    if !img.color().has_alpha() {
        return img.into_rgb8();
    }
    if img.color().bytes_per_pixel() / img.color().channel_count() > 1 {
        // 16-bit and float: flatten at full precision before narrowing.
        let rgba = img.into_rgba32f();
        let (w, h) = rgba.dimensions();
        let mut out = RgbImage::new(w, h);
        for (src, dst) in rgba.pixels().zip(out.pixels_mut()) {
            let a = src[3].clamp(0.0, 1.0);
            for c in 0..3 {
                dst[c] = (src[c].clamp(0.0, 1.0) * a * 255.0).round() as u8;
            }
        }
        return out;
    }
    let rgba: RgbaImage = img.into_rgba8();
    let (w, h) = rgba.dimensions();
    let mut out = RgbImage::new(w, h);
    for (src, dst) in rgba.pixels().zip(out.pixels_mut()) {
        let a = u32::from(src[3]);
        for c in 0..3 {
            dst[c] = ((u32::from(src[c]) * a + 127) / 255) as u8;
        }
    }
    out
}

/// Converts pixels from their embedded profile to sRGB. Profiles that are not RGB (a grey
/// or CMYK profile left on converted pixels) or that fail to load are skipped.
fn to_srgb(img: &mut RgbImage, icc: &[u8]) {
    use lcms2::{ColorSpaceSignature, Intent, PixelFormat, Profile, Transform};

    let Ok(src) = Profile::new_icc(icc) else {
        tracing::warn!("ignoring unreadable ICC profile");
        return;
    };
    if src.color_space() != ColorSpaceSignature::RgbData {
        return;
    }
    let srgb = Profile::new_srgb();
    match Transform::<[u8; 3], [u8; 3]>::new(&src, PixelFormat::RGB_8, &srgb, PixelFormat::RGB_8, Intent::Perceptual) {
        Ok(t) => {
            let raw: &mut [u8] = img.as_mut();
            let (pixels, _) = raw.as_chunks_mut::<3>();
            t.transform_in_place(pixels);
        }
        Err(e) => tracing::warn!("ignoring ICC profile: {e}"),
    }
}

/// sharp's `fit: 'inside'` output size: one shrink factor for both axes, chosen so the
/// image fits the box; it enlarges too. The free dimension is rounded.
pub fn fit_inside(w: u32, h: u32, max_w: u32, max_h: u32) -> (u32, u32) {
    let hshrink = f64::from(w) / f64::from(max_w);
    let vshrink = f64::from(h) / f64::from(max_h);
    let shrink = hshrink.max(vshrink);
    let out = |dim: u32| ((f64::from(dim) / shrink.min(f64::from(dim))).round() as u32).max(1);
    (out(w), out(h))
}

/// Lanczos3, as sharp's default kernel, in gamma-encoded sRGB as sharp resizes.
pub fn resize(img: &RgbImage, w: u32, h: u32) -> RgbImage {
    resize_cropped(img, w, h, None)
}

fn resize_cropped(img: &RgbImage, w: u32, h: u32, crop: Option<(f64, f64, f64, f64)>) -> RgbImage {
    if crop.is_none() && img.dimensions() == (w, h) {
        return img.clone();
    }
    let src = FirImage::from_vec_u8(img.width(), img.height(), img.as_raw().clone(), PixelType::U8x3)
        .expect("buffer matches dimensions");
    let mut dst = FirImage::new(w, h, PixelType::U8x3);
    let mut options = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3));
    if let Some((left, top, cw, ch)) = crop {
        options = options.crop(left, top, cw, ch);
    }
    Resizer::new().resize(&src, &mut dst, &options).expect("pixel types match");
    RgbImage::from_raw(w, h, dst.into_vec()).expect("buffer matches dimensions")
}

pub fn resize_inside(img: &RgbImage, max_w: u32, max_h: u32) -> RgbImage {
    let (w, h) = fit_inside(img.width(), img.height(), max_w, max_h);
    resize(img, w, h)
}

/// sharp's `fit: 'cover'`: scale to fill the box, then crop the overflow from the centre.
pub fn resize_cover(img: &RgbImage, w: u32, h: u32) -> RgbImage {
    let (sw, sh) = (f64::from(img.width()), f64::from(img.height()));
    let scale = (f64::from(w) / sw).max(f64::from(h) / sh);
    let (cw, ch) = ((f64::from(w) / scale).min(sw), (f64::from(h) / scale).min(sh));
    resize_cropped(img, w, h, Some(((sw - cw) / 2.0, (sh - ch) / 2.0, cw, ch)))
}

/// Clockwise rotation by a multiple of 90 degrees.
pub fn rotate(img: &RgbImage, degrees: i32) -> RgbImage {
    match degrees.rem_euclid(360) {
        90 => image::imageops::rotate90(img),
        180 => image::imageops::rotate180(img),
        270 => image::imageops::rotate270(img),
        _ => img.clone(),
    }
}

/// Baseline JPEG the way sharp writes one by default: libjpeg-turbo settings (mozjpeg's
/// "fastest" profile, standard tables, no trellis), 4:2:0 chroma, optimized Huffman coding.
pub fn encode_jpeg(img: &RgbImage, quality: u8) -> Result<Vec<u8>> {
    let (w, h) = img.dimensions();
    std::panic::catch_unwind(|| -> std::io::Result<Vec<u8>> {
        let mut c = mozjpeg::Compress::new(mozjpeg::ColorSpace::JCS_RGB);
        c.set_fastest_defaults();
        c.set_size(w as usize, h as usize);
        c.set_quality(f32::from(quality));
        c.set_optimize_coding(true);
        let mut started = c.start_compress(Vec::new())?;
        started.write_scanlines(img.as_raw())?;
        started.finish()
    })
    .map_err(|_| anyhow!("JPEG encoder failed"))?
    .context("encode JPEG")
}

pub fn decode_jpeg(buf: &[u8]) -> Result<RgbImage> {
    let img = image::load_from_memory_with_format(buf, image::ImageFormat::Jpeg).context("decode JPEG")?;
    Ok(img.into_rgb8())
}

/// The thumbnail (300px, q80) and large (1600px, q85) renditions every photo gets.
pub struct Renditions {
    pub thumb: Vec<u8>,
    pub large: Vec<u8>,
}

pub fn renditions(img: &RgbImage) -> Result<Renditions> {
    Ok(Renditions {
        thumb: encode_jpeg(&resize_inside(img, 300, 300), 80)?,
        large: encode_jpeg(&resize_inside(img, 1600, 1600), 85)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sizes produced by sharp 0.34.5 for the same inputs.
    #[test]
    fn fit_inside_matches_sharp() {
        let cases = [
            ((640, 480), (300, 225), (1600, 1200)),
            ((641, 479), (300, 224), (1600, 1196)),
            ((4032, 3024), (300, 225), (1600, 1200)),
            ((3024, 4032), (225, 300), (1200, 1600)),
            ((1000, 1), (300, 1), (1600, 2)),
            ((7, 3), (300, 129), (1600, 686)),
        ];
        for ((w, h), thumb, large) in cases {
            assert_eq!(fit_inside(w, h, 300, 300), thumb, "{w}x{h} thumb");
            assert_eq!(fit_inside(w, h, 1600, 1600), large, "{w}x{h} large");
        }
    }

    #[test]
    fn brand_detection() {
        let ftyp = |major: &[u8; 4], compat: &[&[u8; 4]]| {
            let len = 16 + 4 * compat.len();
            let mut b = (len as u32).to_be_bytes().to_vec();
            b.extend_from_slice(b"ftyp");
            b.extend_from_slice(major);
            b.extend_from_slice(&[0, 0, 0, 0]);
            for c in compat {
                b.extend_from_slice(*c);
            }
            b.extend_from_slice(&[0; 16]);
            b
        };
        assert!(is_heic(&ftyp(b"heic", &[b"mif1"])));
        assert!(is_heic(&ftyp(b"mif1", &[b"miaf", b"heic"])));
        assert!(!is_heic(&ftyp(b"avif", &[b"mif1", b"miaf"])));
        assert!(is_avif(&ftyp(b"avif", &[b"mif1", b"miaf"])));
        assert!(!is_avif(&ftyp(b"mif1", &[b"heic", b"avif"])));
        assert!(!is_heic(b"\xff\xd8\xff\xe0 not a heif file at all"));
        assert!(!is_heic(&[]));
    }

    #[test]
    fn alpha_flattens_onto_black() {
        let mut rgba = RgbaImage::new(2, 1);
        rgba.put_pixel(0, 0, image::Rgba([255, 0, 0, 128]));
        rgba.put_pixel(1, 0, image::Rgba([10, 20, 30, 255]));
        let rgb = flatten_onto_black(DynamicImage::ImageRgba8(rgba));
        assert_eq!(rgb.get_pixel(0, 0).0, [128, 0, 0]);
        assert_eq!(rgb.get_pixel(1, 0).0, [10, 20, 30]);
    }

    #[test]
    fn rotation_is_clockwise() {
        let mut img = RgbImage::new(2, 1);
        img.put_pixel(0, 0, image::Rgb([255, 0, 0]));
        let r = rotate(&img, 90);
        assert_eq!(r.dimensions(), (1, 2));
        assert_eq!(r.get_pixel(0, 0).0, [255, 0, 0]);
        let l = rotate(&img, -90);
        assert_eq!(l.get_pixel(0, 1).0, [255, 0, 0]);
    }

    /// Encoded output must decode, in this crate and in resvg (both use zune-jpeg), to
    /// what went in, give or take compression error. A dimensions-only check once let a
    /// JPEG that zune-jpeg misread slip through.
    #[test]
    fn jpeg_round_trip_preserves_pixels() {
        let img = RgbImage::from_fn(400, 300, |x, y| {
            image::Rgb([
                (x * 255 / 400) as u8,
                (y * 255 / 300) as u8,
                if (x / 50 + y / 50) % 2 == 0 { 40 } else { 200 },
            ])
        });
        let jpg = encode_jpeg(&img, 85).unwrap();
        assert_eq!(&jpg[..3], &[0xFF, 0xD8, 0xFF]);
        let back = decode_jpeg(&jpg).unwrap();
        assert_eq!(back.dimensions(), (400, 300));
        let mean_abs_err: f64 =
            img.as_raw().iter().zip(back.as_raw()).map(|(a, b)| f64::from(a.abs_diff(*b))).sum::<f64>()
                / img.as_raw().len() as f64;
        assert!(mean_abs_err < 3.0, "mean abs error {mean_abs_err}");
    }
}
