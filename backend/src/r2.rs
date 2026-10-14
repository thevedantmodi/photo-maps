//! Cloudflare R2 through its S3-compatible API.

use std::time::Duration;

use anyhow::{Context, Result};
use aws_credential_types::Credentials;
use aws_sdk_s3::Client;
use aws_sdk_s3::config::{BehaviorVersion, Region, RequestChecksumCalculation, ResponseChecksumValidation};
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::ByteStream;

use crate::config::R2Config;

/// How long a presigned upload URL stays valid.
const UPLOAD_URL_TTL: Duration = Duration::from_secs(300);

#[derive(Clone)]
pub struct R2 {
    client: Client,
    bucket: String,
}

impl R2 {
    pub fn new(cfg: &R2Config) -> Self {
        let conf = aws_sdk_s3::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new("auto"))
            .endpoint_url(&cfg.endpoint)
            .credentials_provider(Credentials::new(
                &cfg.access_key_id,
                &cfg.secret_access_key,
                None,
                None,
                "photo-maps-env",
            ))
            // Only send checksums S3 requires. The SDK otherwise adds CRC headers to every
            // PutObject, which a presigned browser upload cannot reproduce.
            .request_checksum_calculation(RequestChecksumCalculation::WhenRequired)
            .response_checksum_validation(ResponseChecksumValidation::WhenRequired)
            .force_path_style(cfg.force_path_style)
            .build();
        R2 { client: Client::from_conf(conf), bucket: cfg.bucket.clone() }
    }

    /// A URL the browser can PUT the original to directly, with this Content-Type.
    pub async fn upload_url(&self, key: &str, content_type: &str) -> Result<String> {
        let req = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .presigned(PresigningConfig::expires_in(UPLOAD_URL_TTL)?)
            .await
            .with_context(|| format!("presign PUT {key}"))?;
        Ok(req.uri().to_owned())
    }

    pub async fn get(&self, key: &str) -> Result<Vec<u8>> {
        let obj = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("GET {key}"))?;
        let body = obj.body.collect().await.with_context(|| format!("read {key}"))?;
        Ok(body.into_bytes().to_vec())
    }

    pub async fn put(&self, key: &str, body: Vec<u8>, content_type: &str) -> Result<()> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .body(ByteStream::from(body))
            .content_type(content_type)
            .send()
            .await
            .with_context(|| format!("PUT {key}"))?;
        Ok(())
    }

    pub async fn delete(&self, key: &str) -> Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("DELETE {key}"))?;
        Ok(())
    }
}
