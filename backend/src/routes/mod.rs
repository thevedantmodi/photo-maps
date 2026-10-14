use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::middleware;
use axum::routing::{delete, get, patch, post};
use serde_json::Value;
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::trace::TraceLayer;
use uuid::Uuid;

use crate::auth::require_admin;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

mod admin;
mod public;

/// Request bodies are small JSON documents; images go straight to R2.
const MAX_BODY_BYTES: usize = 1024 * 1024;

pub fn router(state: Arc<AppState>) -> Router {
    let admin = Router::new()
        .route("/api/upload", post(admin::upload_url))
        .route("/api/admin/process", post(admin::process))
        .route("/api/admin/photos", get(admin::list_photos))
        .route("/api/admin/photos/{id}", patch(admin::update_photo).delete(admin::delete_photo))
        .route("/api/admin/photos/{id}/rotate", post(admin::rotate_photo))
        .route("/api/admin/places", get(admin::list_places).post(admin::create_place))
        .route("/api/admin/places/{id}", patch(admin::update_place).delete(admin::delete_place))
        .route("/api/admin/cache", delete(admin::purge_cache))
        .route_layer(middleware::from_fn_with_state(Arc::clone(&state), require_admin));

    Router::new()
        .route("/healthz", get(public::health))
        .route("/api/photos", get(public::photos))
        .route("/api/photos/{slug}", get(public::photo))
        .route("/api/places", get(public::places))
        .route("/api/share/{slug}", get(public::share_card))
        .route("/api/subscribe", post(public::subscribe))
        .route("/api/subscribe/confirm", get(public::confirm_status).post(public::confirm))
        .route("/api/cron/digest", get(public::digest))
        .route("/feed.xml", get(public::feed))
        .merge(admin)
        .layer(axum::extract::DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(CatchPanicLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// The JSON body, regardless of Content-Type (the old routes never checked it).
fn json_body(body: &Bytes) -> ApiResult<Value> {
    serde_json::from_slice(body).map_err(|_| ApiError::bad_request("Request body must be JSON"))
}

/// Row ids are UUIDs; anything else cannot match a row.
fn parse_id(id: &str) -> ApiResult<Uuid> {
    Uuid::parse_str(id).map_err(|_| ApiError::not_found())
}
