//! Rows, their JSON shapes, and the queries the routes run.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::Config;
use crate::js::to_iso_string;
use crate::share_version::{Versioned, share_version};

/// A `SELECT` of every photo column followed by the rest of the query, as a literal so
/// sqlx can see it is not built from runtime data.
macro_rules! select_photos {
    ($rest:literal) => {
        concat!(
            "SELECT id, friendly_name, thumb_name, large_name, original_name, lat, lon, caption, date, ",
            "status, share_card_version, created_at FROM photos ",
            $rest
        )
    };
}

#[derive(Clone, Debug, sqlx::FromRow)]
pub struct PhotoRow {
    pub id: Uuid,
    pub friendly_name: String,
    pub thumb_name: String,
    pub large_name: String,
    pub original_name: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub caption: Option<String>,
    pub date: Option<DateTime<Utc>>,
    pub status: String,
    pub share_card_version: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
}

impl PhotoRow {
    pub fn date_iso(&self) -> Option<String> {
        self.date.as_ref().map(to_iso_string)
    }

    /// The version a card rendered from this row's current content would carry.
    pub fn share_version(&self) -> String {
        let date = self.date_iso();
        share_version(&Versioned {
            caption: self.caption.as_deref(),
            original_name: &self.original_name,
            date: date.as_deref(),
            large_name: &self.large_name,
        })
    }

    /// Card title: the caption, or the uploaded file name when there is none.
    pub fn title(&self) -> &str {
        match self.caption.as_deref() {
            Some(c) if !c.is_empty() => c,
            _ => &self.original_name,
        }
    }
}

/// The `Photo` type in `src/app/types.ts`: a row plus public URLs, dates as ISO strings.
#[derive(Clone, Debug, Serialize)]
pub struct Photo {
    pub id: Uuid,
    pub friendly_name: String,
    pub thumb_name: String,
    pub large_name: String,
    pub original_name: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub caption: Option<String>,
    pub date: Option<String>,
    pub status: String,
    pub created_at: Option<String>,
    pub share_card_version: Option<String>,
    pub thumb_url: String,
    pub large_url: String,
}

impl Photo {
    pub fn from_row(row: PhotoRow, cfg: &Config) -> Self {
        Photo {
            thumb_url: cfg.public_url(&row.thumb_name),
            large_url: cfg.public_url(&row.large_name),
            date: row.date.as_ref().map(to_iso_string),
            created_at: row.created_at.as_ref().map(to_iso_string),
            id: row.id,
            friendly_name: row.friendly_name,
            thumb_name: row.thumb_name,
            large_name: row.large_name,
            original_name: row.original_name,
            lat: row.lat,
            lon: row.lon,
            caption: row.caption,
            status: row.status,
            share_card_version: row.share_card_version,
        }
    }
}

#[derive(Clone, Debug, sqlx::FromRow)]
pub struct PlaceRow {
    pub id: Uuid,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub radius_km: f64,
}

/// The `CustomPlace` type in `src/lib/customPlaces.ts`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomPlace {
    pub id: Uuid,
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    pub radius_km: f64,
}

impl From<PlaceRow> for CustomPlace {
    fn from(r: PlaceRow) -> Self {
        CustomPlace { id: r.id, name: r.name, latitude: r.lat, longitude: r.lon, radius_km: r.radius_km }
    }
}

pub async fn photo_by_id(db: &PgPool, id: Uuid) -> sqlx::Result<Option<PhotoRow>> {
    sqlx::query_as(select_photos!("WHERE id = $1")).bind(id).fetch_optional(db).await
}

pub async fn published_photo_by_slug(db: &PgPool, slug: &str) -> sqlx::Result<Option<PhotoRow>> {
    sqlx::query_as(select_photos!("WHERE status = 'published' AND friendly_name = $1 LIMIT 1"))
        .bind(slug)
        .fetch_optional(db)
        .await
}

/// Every published photo, oldest upload first.
pub async fn published_photos(db: &PgPool) -> sqlx::Result<Vec<PhotoRow>> {
    sqlx::query_as(select_photos!("WHERE status = 'published' ORDER BY created_at ASC NULLS LAST, id"))
        .fetch_all(db)
        .await
}

pub async fn recent_published_photos(db: &PgPool, limit: i64) -> sqlx::Result<Vec<PhotoRow>> {
    sqlx::query_as(select_photos!("WHERE status = 'published' ORDER BY created_at DESC LIMIT $1"))
        .bind(limit)
        .fetch_all(db)
        .await
}

pub async fn published_photos_since(db: &PgPool, since: DateTime<Utc>) -> sqlx::Result<Vec<PhotoRow>> {
    sqlx::query_as(select_photos!("WHERE status = 'published' AND created_at >= $1 ORDER BY created_at DESC"))
        .bind(since)
        .fetch_all(db)
        .await
}

/// Every photo regardless of status, for the admin Manage tab.
pub async fn all_photos(db: &PgPool) -> sqlx::Result<Vec<PhotoRow>> {
    sqlx::query_as(select_photos!("ORDER BY created_at")).fetch_all(db).await
}

pub async fn places(db: &PgPool) -> sqlx::Result<Vec<CustomPlace>> {
    let rows: Vec<PlaceRow> =
        sqlx::query_as("SELECT id, name, lat, lon, radius_km FROM places ORDER BY name ASC").fetch_all(db).await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn set_share_card_version(db: &PgPool, friendly_name: &str, version: &str) -> sqlx::Result<()> {
    sqlx::query("UPDATE photos SET share_card_version = $1 WHERE friendly_name = $2")
        .bind(version)
        .bind(friendly_name)
        .execute(db)
        .await?;
    Ok(())
}
