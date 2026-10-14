//! Photo Maps backend: the HTTP API behind the Next.js frontend.

pub mod auth;
pub mod base_url;
pub mod cdn;
pub mod config;
pub mod db;
pub mod emails;
pub mod error;
pub mod exif;
pub mod gps;
pub mod imaging;
pub mod js;
pub mod r2;
pub mod resend;
pub mod routes;
pub mod share_card;
pub mod share_store;
pub mod share_version;
pub mod state;
pub mod subscribe;

/// Schema migrations, applied by `photo-maps-backend migrate`.
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
