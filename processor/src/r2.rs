use worker::{Bucket, HttpMetadata, Object, Result};

pub async fn get_original(bucket: &Bucket, key: &str) -> Result<Option<Object>> {
    bucket.get(key).execute().await
}

pub async fn put_variant(
    bucket: &Bucket,
    key: &str,
    body: Vec<u8>,
    metadata: HttpMetadata,
) -> Result<()> {
    bucket
        .put(key, body)
        .http_metadata(metadata)
        .execute()
        .await?;
    Ok(())
}
