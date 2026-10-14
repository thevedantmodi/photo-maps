//! Precomputed share cards in R2.
//!
//! Cards are rendered after upload, caption/date edits and rotation, off the request path,
//! and stored at `<slug>_share.png`. The version baked into the stored card is recorded on
//! the row so `/api/share/<slug>` can tell a fresh card from a stale one. The R2 write
//! happens before the version update, so a crash between the two leaves the version stale
//! rather than pointing at a half-written object; the live-render fallback covers the gap.

use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Utc};

use crate::db;
use crate::js::to_iso_string;
use crate::share_card::CardInput;
use crate::share_version::{Versioned, share_card_key, share_version};
use crate::state::AppState;

pub struct CardJob {
    pub friendly_name: String,
    pub caption: Option<String>,
    pub original_name: String,
    pub date: Option<DateTime<Utc>>,
    pub large_name: String,
    /// The large rendition's bytes when the caller just produced them; read from R2 when
    /// None. Either way the source is the bucket, never the CDN, which may still hold a
    /// pre-rotation copy.
    pub large_jpeg: Option<Vec<u8>>,
    pub base: String,
}

/// Renders and stores the card in the background. Failures are logged, never surfaced:
/// the request that triggered this has already been answered.
pub fn spawn(state: &Arc<AppState>, job: CardJob) {
    let state = Arc::clone(state);
    state.tasks.clone().spawn(async move {
        let slug = job.friendly_name.clone();
        if let Err(e) = generate_and_store(&state, job).await {
            tracing::error!("[share-card] generation failed for {slug}: {e:#}");
        }
    });
}

async fn generate_and_store(state: &AppState, job: CardJob) -> Result<()> {
    let large = match job.large_jpeg {
        Some(bytes) => bytes,
        None => state.r2.get(&job.large_name).await?,
    };
    let input = CardInput {
        friendly_name: job.friendly_name.clone(),
        caption: job.caption.clone(),
        original_name: job.original_name.clone(),
        date: job.date,
    };
    let png = state.cards.render(&input, large, &job.base).await?;
    state.r2.put(&share_card_key(&job.friendly_name), png, "image/png").await?;

    let date = job.date.as_ref().map(to_iso_string);
    let version = share_version(&Versioned {
        caption: job.caption.as_deref(),
        original_name: &job.original_name,
        date: date.as_deref(),
        large_name: &job.large_name,
    });
    db::set_share_card_version(&state.db, &job.friendly_name, &version).await?;
    Ok(())
}
