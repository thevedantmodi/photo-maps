//! Purges Cloudflare's edge cache for the R2 public bucket.
//!
//! R2 objects are served from a custom domain, so Cloudflare caches them at the edge.
//! Rotating a photo overwrites the same key, and the edge keeps serving the old bytes until
//! the entry expires; this clears it on demand.
//!
//! Purges by hostname, not purge_everything, so the rest of the zone keeps its cache.
//! Needs a CLOUDFLARE_API_TOKEN with the Zone › Cache Purge permission.

use anyhow::{Context, Result, anyhow, bail};
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;

use crate::config::Config;

#[derive(Deserialize)]
struct PurgeResponse {
    success: bool,
    #[serde(default)]
    errors: Vec<CfError>,
}

#[derive(Deserialize)]
struct CfError {
    message: String,
}

/// `new URL(x).host`: hostname plus a non-default port.
fn host_of(public_url: &str) -> Result<String> {
    let url = url::Url::parse(public_url).context("NEXT_PUBLIC_R2_PUBLIC_URL is not a valid URL")?;
    let host = url.host_str().ok_or_else(|| anyhow!("NEXT_PUBLIC_R2_PUBLIC_URL has no host"))?;
    Ok(match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_owned(),
    })
}

pub async fn purge_r2_cache(http: &Client, cfg: &Config) -> Result<()> {
    let Some(cf) = &cfg.cloudflare else {
        bail!("CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN must be set");
    };
    let host = host_of(&cfg.r2_public_url)?;

    let res = http
        .post(format!("{}/zones/{}/purge_cache", cf.api_base, cf.zone_id))
        .bearer_auth(&cf.api_token)
        .json(&json!({ "hosts": [host] }))
        .send()
        .await
        .context("Cloudflare purge request failed")?;
    let status = res.status();
    let data: Option<PurgeResponse> = res.json().await.ok();

    match data {
        Some(d) if status.is_success() && d.success => Ok(()),
        _ => {
            let detail = data
                .map(|d| d.errors.into_iter().map(|e| e.message).collect::<Vec<_>>().join("; "))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
            bail!("Cloudflare purge failed: {detail}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_keeps_non_default_port() {
        assert_eq!(host_of("https://img.example.com").unwrap(), "img.example.com");
        assert_eq!(host_of("https://img.example.com/").unwrap(), "img.example.com");
        assert_eq!(host_of("https://img.example.com:8443/x").unwrap(), "img.example.com:8443");
        assert_eq!(host_of("https://img.example.com:443").unwrap(), "img.example.com");
    }
}
