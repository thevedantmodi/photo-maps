use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use tokio_util::task::TaskTracker;

use crate::config::Config;
use crate::r2::R2;
use crate::resend::Resend;
use crate::share_card::ShareCardRenderer;

pub struct AppState {
    pub config: Config,
    pub db: PgPool,
    pub r2: R2,
    pub http: reqwest::Client,
    pub resend: Option<Resend>,
    pub cards: Arc<ShareCardRenderer>,
    /// Work that outlives its request (share card precompute), awaited on shutdown.
    pub tasks: TaskTracker,
}

impl AppState {
    pub fn new(config: Config, db: PgPool) -> Result<Arc<Self>> {
        let http = reqwest::Client::builder()
            .user_agent("photo-maps-backend")
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .context("HTTP client")?;
        Ok(Arc::new(AppState {
            r2: R2::new(&config.r2),
            resend: config.resend.clone().map(|c| Resend::new(http.clone(), c)),
            cards: Arc::new(ShareCardRenderer::new(http.clone())?),
            http,
            db,
            config,
            tasks: TaskTracker::new(),
        }))
    }
}

/// A pool that connects on first use, so the service starts even while the database is
/// waking up (Neon suspends idle compute).
pub fn connect_lazy(url: &str) -> Result<PgPool> {
    PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(15))
        .idle_timeout(Duration::from_secs(300))
        .connect_lazy(url)
        .context("DATABASE_URL is not a valid Postgres URL")
}
