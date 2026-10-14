//! Renders a share card locally, for checking design changes without deploying.
//!
//! cargo run --example share_card -- <large.jpg> <out.png> [caption] [date ISO] [slug]

use std::sync::Arc;

use anyhow::{Context, Result};
use photo_maps_backend::share_card::{CardInput, ShareCardRenderer};

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [src, out, rest @ ..] = args.as_slice() else {
        anyhow::bail!("usage: share_card <large.jpg> <out.png> [caption] [date ISO] [slug]");
    };
    let input = CardInput {
        friendly_name: rest.get(2).cloned().unwrap_or_else(|| "example".into()),
        caption: rest.first().filter(|c| !c.is_empty()).cloned(),
        original_name: "IMG_0001.jpg".into(),
        date: rest.get(1).filter(|d| !d.is_empty()).map(|d| d.parse()).transpose().context("date")?,
    };
    let renderer = Arc::new(ShareCardRenderer::new(reqwest::Client::new())?);
    let started = std::time::Instant::now();
    let png = renderer.render(&input, std::fs::read(src)?, "https://photos.vedantmodi.com").await?;
    eprintln!("rendered in {:?}", started.elapsed());
    std::fs::write(out, png)?;
    Ok(())
}
