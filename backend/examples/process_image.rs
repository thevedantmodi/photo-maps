//! Runs the upload pipeline on a local file: decode, renditions, metadata. For checking how
//! a particular photo will come out without uploading it.
//!
//! cargo run --example process_image -- <original> <out-dir>

use anyhow::{Context, Result};
use photo_maps_backend::{exif, imaging, js};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [src, out_dir] = args.as_slice() else {
        anyhow::bail!("usage: process_image <original> <out-dir>");
    };
    let buf = std::fs::read(src).with_context(|| format!("read {src}"))?;
    let img = imaging::decode_photo(&buf)?;
    let r = imaging::renditions(&img)?;
    let stem = std::path::Path::new(src).file_stem().and_then(|s| s.to_str()).unwrap_or("photo");
    std::fs::create_dir_all(out_dir)?;
    std::fs::write(format!("{out_dir}/{stem}_thumb.jpg"), r.thumb)?;
    std::fs::write(format!("{out_dir}/{stem}_large.jpg"), r.large)?;
    let meta = exif::read(&buf);
    println!(
        "{}",
        serde_json::json!({
            "file": stem,
            "gps": meta.gps.map(|g| serde_json::json!({ "latitude": g.latitude, "longitude": g.longitude })),
            "date": meta.date.map(|d| js::to_iso_string(&d)),
        })
    );
    Ok(())
}
