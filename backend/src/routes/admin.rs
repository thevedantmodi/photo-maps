//! Admin API, behind Basic Auth: uploads, photo management, custom places, cache purge.

use std::sync::Arc;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{Map, Value, json};
use uuid::Uuid;

use super::{json_body, parse_id};
use crate::db::{self, CustomPlace, PlaceRow};
use crate::error::{ApiError, ApiResult};
use crate::gps::{self, is_valid_lat, is_valid_lon};
use crate::share_store::{self, CardJob};
use crate::share_version::share_card_key;
use crate::state::AppState;
use crate::{base_url, cdn, exif, imaging, js};

/// A truthy string field, or None when the field is falsy. Truthy non-strings are refused.
fn opt_string(obj: &Map<String, Value>, key: &str) -> Result<Option<String>, ()> {
    match obj.get(key) {
        Some(v) if !js::truthy(v) => Ok(None),
        None => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(()),
    }
}

fn as_object(v: Value) -> Map<String, Value> {
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

// ---- Upload ---------------------------------------------------------------------------------

/// POST /api/upload: a presigned URL the browser PUTs the original to.
pub async fn upload_url(State(st): State<Arc<AppState>>, body: Bytes) -> ApiResult<Json<Value>> {
    let body = as_object(json_body(&body)?);
    let required = || ApiError::bad_request("key and contentType required");
    let key = opt_string(&body, "key").map_err(|_| required())?.ok_or_else(required)?;
    let content_type = opt_string(&body, "contentType").map_err(|_| required())?.ok_or_else(required)?;
    let upload_url = st.r2.upload_url(&key, &content_type).await.map_err(|e| ApiError::internal("upload", e))?;
    Ok(Json(json!({ "uploadUrl": upload_url, "key": key })))
}

/// POST /api/admin/process: turn an uploaded original into a published photo.
///
/// Downloads the original, decodes it (HEIC included), makes the 300px thumbnail and
/// 1600px large JPEGs, reads EXIF GPS and date, uploads both renditions, deletes the
/// original, upserts the row as published, and precomputes the share card.
pub async fn process(State(st): State<Arc<AppState>>, headers: HeaderMap, body: Bytes) -> ApiResult<Json<Value>> {
    let body = as_object(json_body(&body)?);
    let required = || ApiError::bad_request("key and friendly_name required");
    let key = opt_string(&body, "key").map_err(|_| required())?.ok_or_else(required)?;
    let friendly_name = opt_string(&body, "friendly_name").map_err(|_| required())?.ok_or_else(required)?;
    let original_name = match body.get("original_name") {
        None | Some(Value::Null) => key.clone(),
        Some(Value::String(s)) => s.clone(),
        Some(_) => return Err(ApiError::bad_request("original_name must be a string")),
    };
    let caption = opt_string(&body, "caption").map_err(|_| ApiError::bad_request("caption must be a string"))?;

    // Coordinates pinned in the admin UI win over whatever EXIF says. When the operator
    // deliberately emptied a prefilled location, gps_cleared keeps the EXIF fallback from
    // putting it back.
    let (lat, lon) = (body.get("lat"), body.get("lon"));
    let gps_cleared = body.get("gps_cleared").is_some_and(js::truthy);
    let pinned = gps::coerce_pair(lat, lon);
    let given = |v: Option<&Value>| v.is_some_and(|v| !v.is_null());
    if pinned.is_none() && (given(lat) || given(lon)) && !gps_cleared {
        return Err(ApiError::bad_request(
            "lat and lon must both be given, with lat in [-90, 90] and lon in [-180, 180]",
        ));
    }

    // Typed in the admin UI; only used when the photo carries no date of its own.
    let manual_date = match body.get("date") {
        Some(v) if js::truthy(v) => {
            Some(js::parse_js_date(v).ok_or_else(|| ApiError::bad_request("date must be a valid date"))?)
        }
        _ => None,
    };

    let fail = |e: anyhow::Error| ApiError::internal("process error", e);
    let original = st.r2.get(&key).await.map_err(fail)?;
    let original_len = original.len();
    let (renditions, meta) = tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
        let img = imaging::decode_photo(&original)?;
        Ok((imaging::renditions(&img)?, exif::read(&original)))
    })
    .await
    .map_err(|e| fail(e.into()))?
    .map_err(fail)?;

    let gps = pinned.or(if gps_cleared { None } else { meta.gps });
    let date_taken = meta.date.or(manual_date);
    tracing::info!(
        "[process] key={key} gps={gps:?} date={} bufLen={original_len}",
        date_taken.map(|d| js::to_iso_string(&d)).unwrap_or_else(|| "null".into())
    );

    let thumb_name = format!("{friendly_name}_thumb.jpg");
    let large_name = format!("{friendly_name}_large.jpg");
    let large = renditions.large.clone();
    tokio::try_join!(
        st.r2.put(&thumb_name, renditions.thumb, "image/jpeg"),
        st.r2.put(&large_name, renditions.large, "image/jpeg"),
        st.r2.delete(&key),
    )
    .map_err(fail)?;

    // On re-upload under an existing slug the row keeps its original_name; RETURNING it
    // means the share card is rendered (and versioned) from what the row actually holds.
    let (stored_original_name,): (String,) = sqlx::query_as(
        "INSERT INTO photos (friendly_name, thumb_name, large_name, original_name, caption, lat, lon, date, status) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published') \
         ON CONFLICT (friendly_name) DO UPDATE SET \
           thumb_name = EXCLUDED.thumb_name, large_name = EXCLUDED.large_name, caption = EXCLUDED.caption, \
           lat = EXCLUDED.lat, lon = EXCLUDED.lon, date = EXCLUDED.date, status = 'published' \
         RETURNING original_name",
    )
    .bind(&friendly_name)
    .bind(&thumb_name)
    .bind(&large_name)
    .bind(&original_name)
    .bind(&caption)
    .bind(gps.map(|g| g.latitude))
    .bind(gps.map(|g| g.longitude))
    .bind(date_taken)
    .fetch_one(&st.db)
    .await
    .map_err(|e| ApiError::internal("process error", e))?;

    share_store::spawn(
        &st,
        CardJob {
            friendly_name,
            caption,
            original_name: stored_original_name,
            date: date_taken,
            large_name,
            large_jpeg: Some(large),
            base: base_url::resolve(&st.config.base_url, &headers),
        },
    );

    Ok(Json(json!({
        "ok": true,
        "lat": gps.map(|g| g.latitude),
        "lon": gps.map(|g| g.longitude),
    })))
}

// ---- Photos ---------------------------------------------------------------------------------

/// GET /api/admin/photos: every photo, oldest first, for the Manage tab.
pub async fn list_photos(State(st): State<Arc<AppState>>) -> ApiResult<Json<Value>> {
    let rows = db::all_photos(&st.db).await?;
    let out: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "friendly_name": r.friendly_name,
                "caption": r.caption,
                "status": r.status,
                "thumb_url": st.config.public_url(&r.thumb_name),
                "thumb_name": r.thumb_name,
                "large_name": r.large_name,
                "date": r.date.as_ref().map(js::to_iso_string),
                "lat": r.lat,
                "lon": r.lon,
            })
        })
        .collect();
    Ok(Json(Value::Array(out)))
}

/// The fields an edit may set. Each is present only when the body named it.
#[derive(Default)]
struct PhotoUpdate {
    caption: Option<Option<String>>,
    lat: Option<Option<f64>>,
    lon: Option<Option<f64>>,
    date: Option<Option<chrono::DateTime<chrono::Utc>>>,
}

fn parse_coordinate(v: &Value, valid: fn(f64) -> bool, message: &str) -> ApiResult<Option<f64>> {
    if js::is_blank(Some(v)) {
        return Ok(None);
    }
    let n = js::to_number(v);
    if valid(n) { Ok(Some(n)) } else { Err(ApiError::bad_request(message)) }
}

fn parse_photo_update(body: &Map<String, Value>) -> ApiResult<PhotoUpdate> {
    let mut u = PhotoUpdate::default();
    if let Some(v) = body.get("caption") {
        u.caption = Some(match v {
            Value::Null => None,
            Value::String(s) => Some(s.clone()),
            _ => return Err(ApiError::bad_request("caption must be a string")),
        });
    }
    if let Some(v) = body.get("lat") {
        u.lat = Some(parse_coordinate(v, is_valid_lat, "lat must be between -90 and 90")?);
    }
    if let Some(v) = body.get("lon") {
        u.lon = Some(parse_coordinate(v, is_valid_lon, "lon must be between -180 and 180")?);
    }
    if let Some(v) = body.get("date") {
        u.date = Some(if js::truthy(v) {
            Some(js::parse_js_date(v).ok_or_else(|| ApiError::bad_request("date must be a valid date"))?)
        } else {
            None
        });
    }
    Ok(u)
}

/// PATCH /api/admin/photos/{id}: edit caption, location, or date.
pub async fn update_photo(
    State(st): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    let id = parse_id(&id)?;
    let row = db::photo_by_id(&st.db, id).await?.ok_or_else(ApiError::not_found)?;
    let update = parse_photo_update(&as_object(json_body(&body)?))?;

    let mut q = sqlx::QueryBuilder::<sqlx::Postgres>::new("UPDATE photos SET ");
    let mut set = q.separated(", ");
    if let Some(v) = &update.caption {
        set.push("caption = ").push_bind_unseparated(v.clone());
    }
    if let Some(v) = update.lat {
        set.push("lat = ").push_bind_unseparated(v);
    }
    if let Some(v) = update.lon {
        set.push("lon = ").push_bind_unseparated(v);
    }
    if let Some(v) = update.date {
        set.push("date = ").push_bind_unseparated(v);
    }
    if update.caption.is_none() && update.lat.is_none() && update.lon.is_none() && update.date.is_none() {
        return Err(ApiError::bad_request("No fields to update"));
    }
    q.push(" WHERE id = ").push_bind(id);
    q.build().execute(&st.db).await?;

    // Only caption and date feed the share version; location edits don't change the card.
    if update.caption.is_some() || update.date.is_some() {
        share_store::spawn(
            &st,
            CardJob {
                caption: update.caption.unwrap_or(row.caption),
                date: update.date.unwrap_or(row.date),
                friendly_name: row.friendly_name,
                original_name: row.original_name,
                large_name: row.large_name,
                large_jpeg: None,
                base: base_url::resolve(&st.config.base_url, &headers),
            },
        );
    }
    Ok(Json(json!({ "ok": true })))
}

/// DELETE /api/admin/photos/{id}: remove the renditions and share card, then the row.
pub async fn delete_photo(State(st): State<Arc<AppState>>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let id = parse_id(&id)?;
    let row = db::photo_by_id(&st.db, id).await?.ok_or_else(ApiError::not_found)?;
    let card_key = share_card_key(&row.friendly_name);
    tokio::try_join!(st.r2.delete(&row.thumb_name), st.r2.delete(&row.large_name), st.r2.delete(&card_key),)
        .map_err(|e| ApiError::internal("delete", e))?;
    sqlx::query("DELETE FROM photos WHERE id = $1").bind(id).execute(&st.db).await?;
    Ok(Json(json!({ "ok": true })))
}

/// POST /api/admin/photos/{id}/rotate: rotate both renditions in place.
pub async fn rotate_photo(
    State(st): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    let id = parse_id(&id)?;
    let row = db::photo_by_id(&st.db, id).await?.ok_or_else(ApiError::not_found)?;
    let body = as_object(json_body(&body)?);
    let angle = js::to_number(body.get("degrees").unwrap_or(&Value::Null));
    if ![90.0, 180.0, 270.0, -90.0].contains(&angle) {
        return Err(ApiError::bad_request("degrees must be 90, 180, or 270"));
    }

    let fail = |e: anyhow::Error| ApiError::internal("rotate error", e);
    let large = st.r2.get(&row.large_name).await.map_err(fail)?;
    let renditions = tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
        let rotated = imaging::rotate(&imaging::decode_jpeg(&large)?, angle as i32);
        imaging::renditions(&rotated)
    })
    .await
    .map_err(|e| fail(e.into()))?
    .map_err(fail)?;

    let new_large = renditions.large.clone();
    tokio::try_join!(
        st.r2.put(&row.thumb_name, renditions.thumb, "image/jpeg"),
        st.r2.put(&row.large_name, renditions.large, "image/jpeg"),
    )
    .map_err(fail)?;

    share_store::spawn(
        &st,
        CardJob {
            friendly_name: row.friendly_name,
            caption: row.caption,
            original_name: row.original_name,
            date: row.date,
            large_name: row.large_name,
            large_jpeg: Some(new_large),
            base: base_url::resolve(&st.config.base_url, &headers),
        },
    );
    Ok(Json(json!({ "ok": true })))
}

// ---- Places ---------------------------------------------------------------------------------

struct PlaceInput {
    name: String,
    lat: f64,
    lon: f64,
    radius_km: f64,
}

/// Checks a create/update body; returns the clean fields or an error message.
fn parse_place_body(body: &Map<String, Value>) -> Result<PlaceInput, String> {
    let name = match body.get("name") {
        Some(Value::String(s)) => js::js_trim(s).to_owned(),
        _ => String::new(),
    };
    if name.is_empty() {
        return Err("name is required".into());
    }
    let lat = js::to_number(body.get("lat").unwrap_or(&Value::Null));
    if js::is_blank(body.get("lat")) || !is_valid_lat(lat) {
        return Err("lat must be between -90 and 90".into());
    }
    let lon = js::to_number(body.get("lon").unwrap_or(&Value::Null));
    if js::is_blank(body.get("lon")) || !is_valid_lon(lon) {
        return Err("lon must be between -180 and 180".into());
    }
    let radius_km = js::to_number(body.get("radius_km").unwrap_or(&Value::Null));
    if !gps::is_valid_radius(radius_km) {
        return Err("radius_km must be between 0.1 and 500".into());
    }
    Ok(PlaceInput { name, lat, lon, radius_km })
}

fn place_input(body: &Bytes) -> ApiResult<PlaceInput> {
    parse_place_body(&as_object(json_body(body)?)).map_err(ApiError::bad_request)
}

/// GET /api/admin/places. Unlike the public listing, a failed query is an error here
/// rather than an empty list.
pub async fn list_places(State(st): State<Arc<AppState>>) -> ApiResult<Json<Vec<CustomPlace>>> {
    Ok(Json(db::places(&st.db).await?))
}

pub async fn create_place(State(st): State<Arc<AppState>>, body: Bytes) -> ApiResult<Response> {
    let p = place_input(&body)?;
    let row: PlaceRow = sqlx::query_as(
        "INSERT INTO places (name, lat, lon, radius_km) VALUES ($1, $2, $3, $4) RETURNING id, name, lat, lon, radius_km",
    )
    .bind(&p.name)
    .bind(p.lat)
    .bind(p.lon)
    .bind(p.radius_km)
    .fetch_one(&st.db)
    .await?;
    Ok((StatusCode::CREATED, Json(CustomPlace::from(row))).into_response())
}

pub async fn update_place(
    State(st): State<Arc<AppState>>,
    Path(id): Path<String>,
    body: Bytes,
) -> ApiResult<Json<CustomPlace>> {
    let p = place_input(&body)?;
    let id: Uuid = parse_id(&id)?;
    let row: Option<PlaceRow> = sqlx::query_as(
        "UPDATE places SET name = $1, lat = $2, lon = $3, radius_km = $4 WHERE id = $5 \
         RETURNING id, name, lat, lon, radius_km",
    )
    .bind(&p.name)
    .bind(p.lat)
    .bind(p.lon)
    .bind(p.radius_km)
    .bind(id)
    .fetch_optional(&st.db)
    .await?;
    Ok(Json(row.ok_or_else(ApiError::not_found)?.into()))
}

pub async fn delete_place(State(st): State<Arc<AppState>>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let id = parse_id(&id)?;
    let deleted = sqlx::query("DELETE FROM places WHERE id = $1").bind(id).execute(&st.db).await?;
    if deleted.rows_affected() == 0 {
        return Err(ApiError::not_found());
    }
    Ok(Json(json!({ "ok": true })))
}

// ---- Cache ----------------------------------------------------------------------------------

/// DELETE /api/admin/cache: purge Cloudflare's cache for the image domain.
pub async fn purge_cache(State(st): State<Arc<AppState>>) -> ApiResult<Json<Value>> {
    cdn::purge_r2_cache(&st.http, &st.config).await.map_err(|e| {
        tracing::error!("[cache] purge failed: {e:#}");
        ApiError::new(StatusCode::BAD_GATEWAY, format!("{e:#}"))
    })?;
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(v: Value) -> Map<String, Value> {
        as_object(v)
    }

    #[test]
    fn place_validation_messages() {
        let ok = parse_place_body(&obj(json!({ "name": "  Reef ", "lat": "-16.5", "lon": 146, "radius_km": "60" })))
            .unwrap();
        assert_eq!((ok.name.as_str(), ok.lat, ok.lon, ok.radius_km), ("Reef", -16.5, 146.0, 60.0));

        let err = |v: Value| parse_place_body(&obj(v)).err().unwrap();
        assert_eq!(err(json!({ "name": " ", "lat": 1, "lon": 1, "radius_km": 1 })), "name is required");
        assert_eq!(err(json!({ "name": 5, "lat": 1, "lon": 1, "radius_km": 1 })), "name is required");
        assert_eq!(err(json!({ "name": "a", "lat": "", "lon": 1, "radius_km": 1 })), "lat must be between -90 and 90");
        assert_eq!(err(json!({ "name": "a", "lon": 1, "radius_km": 1 })), "lat must be between -90 and 90");
        assert_eq!(
            err(json!({ "name": "a", "lat": 0, "lon": 181, "radius_km": 1 })),
            "lon must be between -180 and 180"
        );
        assert_eq!(err(json!({ "name": "a", "lat": 0, "lon": 0 })), "radius_km must be between 0.1 and 500");
        assert_eq!(
            err(json!({ "name": "a", "lat": 0, "lon": 0, "radius_km": 0.05 })),
            "radius_km must be between 0.1 and 500"
        );
        assert_eq!(err(json!([])), "name is required");
    }

    #[test]
    fn photo_update_fields() {
        let u =
            parse_photo_update(&obj(json!({ "caption": null, "lat": "", "lon": "12.5", "date": "2024-03-19T14:30" })))
                .unwrap();
        assert_eq!(u.caption, Some(None));
        assert_eq!(u.lat, Some(None));
        assert_eq!(u.lon, Some(Some(12.5)));
        assert_eq!(u.date.unwrap().map(|d| js::to_iso_string(&d)).as_deref(), Some("2024-03-19T14:30:00.000Z"));

        let u = parse_photo_update(&obj(json!({ "caption": "", "date": "" }))).unwrap();
        assert_eq!(u.caption, Some(Some(String::new())));
        assert_eq!(u.date, Some(None));
        assert!(u.lat.is_none() && u.lon.is_none());

        assert_eq!(
            parse_photo_update(&obj(json!({ "lat": 100 }))).err().unwrap().message,
            "lat must be between -90 and 90"
        );
        assert_eq!(
            parse_photo_update(&obj(json!({ "lon": "x" }))).err().unwrap().message,
            "lon must be between -180 and 180"
        );
        assert_eq!(
            parse_photo_update(&obj(json!({ "date": "garbage" }))).err().unwrap().message,
            "date must be a valid date"
        );
    }

    #[test]
    fn optional_strings_follow_truthiness() {
        let b = obj(json!({ "a": "", "b": "x", "c": 0, "d": 7, "e": null }));
        assert_eq!(opt_string(&b, "a"), Ok(None));
        assert_eq!(opt_string(&b, "b"), Ok(Some("x".into())));
        assert_eq!(opt_string(&b, "c"), Ok(None));
        assert_eq!(opt_string(&b, "d"), Err(()));
        assert_eq!(opt_string(&b, "e"), Ok(None));
        assert_eq!(opt_string(&b, "missing"), Ok(None));
    }
}
