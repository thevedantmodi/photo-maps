use fast_image_resize as fr;
use fast_image_resize::images::Image;
use image::{DynamicImage, RgbaImage};

pub fn apply_orientation(img: DynamicImage, orientation: u32) -> DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

// Mirrors sharp's `.resize(w, h, { fit: 'inside' })`: scale to fit within the
// box, never upscale, preserve aspect ratio.
pub fn resize_and_encode(img: &DynamicImage, max_w: u32, max_h: u32, quality: u8) -> Vec<u8> {
    let (src_w, src_h) = (img.width(), img.height());
    let scale = (max_w as f64 / src_w as f64)
        .min(max_h as f64 / src_h as f64)
        .min(1.0);
    let dst_w = ((src_w as f64 * scale).round() as u32).max(1);
    let dst_h = ((src_h as f64 * scale).round() as u32).max(1);

    let resized = resize_simd(img, dst_w, dst_h);

    let mut buf = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
    encoder
        .encode_image(&resized)
        .expect("jpeg encode should not fail for a valid RgbaImage");
    buf
}

// SIMD resize via fast_image_resize, Lanczos3 to match sharp/libvips' default kernel.
// The crate's "image" feature gives RgbaImage/DynamicImage direct IntoImageView(Mut)
// impls, so no manual buffer plumbing is needed.
fn resize_simd(img: &DynamicImage, dst_w: u32, dst_h: u32) -> DynamicImage {
    let src = img.to_rgba8();
    let mut dst = Image::new(dst_w, dst_h, fr::PixelType::U8x4);

    let options =
        fr::ResizeOptions::new().resize_alg(fr::ResizeAlg::Convolution(fr::FilterType::Lanczos3));

    let mut resizer = fr::Resizer::new();
    resizer
        .resize(&src, &mut dst, &options)
        .expect("resize should not fail for valid images");

    let out = RgbaImage::from_raw(dst_w, dst_h, dst.into_vec())
        .expect("dst buffer matches dst dimensions");
    DynamicImage::ImageRgba8(out)
}
