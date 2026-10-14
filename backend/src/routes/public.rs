//! Public API: data for the map and photo pages, share cards, the RSS feed, the email
//! signup, and the weekly digest cron.

use std::sync::Arc;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::db::{self, CustomPlace, Photo};
use crate::emails::{self, Digest, DigestPhoto};
use crate::error::{ApiError, ApiResult};
use crate::share_card::CardInput;
use crate::share_version::share_card_key;
use crate::state::AppState;
use crate::{base_url, js, subscribe};

const SHARE_CACHE_CONTROL: &str = "public, s-maxage=86400, stale-while-revalidate=604800";
const FEED_CACHE_CONTROL: &str = "public, s-maxage=900, stale-while-revalidate=3600";

const FEED_TITLE: &str = "Photos by Vedant Modi";
const FEED_DESCRIPTION: &str = "Photos! Mapped!";
const FEED_ITEM_LIMIT: i64 = 50;

const DIGEST_WINDOW: chrono::Duration = chrono::Duration::days(7);
const DIGEST_MAX_PHOTOS: usize = 12;

pub async fn health() -> &'static str {
    "ok"
}

/// GET /api/photos: every published photo, for the map.
pub async fn photos(State(st): State<Arc<AppState>>) -> ApiResult<Json<Vec<Photo>>> {
    let rows = db::published_photos(&st.db).await?;
    Ok(Json(rows.into_iter().map(|r| Photo::from_row(r, &st.config)).collect()))
}

/// GET /api/photos/{slug}: one published photo, for its page.
pub async fn photo(State(st): State<Arc<AppState>>, Path(slug): Path<String>) -> ApiResult<Json<Photo>> {
    let row = db::published_photo_by_slug(&st.db, &slug).await?.ok_or_else(ApiError::not_found)?;
    Ok(Json(Photo::from_row(row, &st.config)))
}

/// GET /api/places: custom place labels, for the sidebar and search.
pub async fn places(State(st): State<Arc<AppState>>) -> ApiResult<Json<Vec<CustomPlace>>> {
    Ok(Json(db::places(&st.db).await?))
}

fn png(bytes: Vec<u8>) -> Response {
    ([(header::CONTENT_TYPE, "image/png"), (header::CACHE_CONTROL, SHARE_CACHE_CONTROL)], bytes).into_response()
}

fn text(status: StatusCode, body: &'static str) -> Response {
    (status, [(header::CONTENT_TYPE, "text/plain;charset=UTF-8")], body).into_response()
}

/// GET /api/share/{slug}: the 1080×1920 share card.
///
/// Served from the precomputed copy in R2 when its version matches the photo's current
/// content, rendered live otherwise. Proxied rather than redirected, so link-preview
/// crawlers that don't follow redirects on og:image still get bytes at this URL. Callers
/// add `?v=<version>`, so the long CDN lifetime never serves a stale card.
pub async fn share_card(State(st): State<Arc<AppState>>, Path(slug): Path<String>, headers: HeaderMap) -> Response {
    let base = base_url::resolve(&st.config.base_url, &headers);
    let row = match db::published_photo_by_slug(&st.db, &slug).await {
        Ok(Some(row)) => row,
        Ok(None) => return text(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => {
            tracing::error!("[share] lookup failed for {slug}: {e}");
            return text(StatusCode::NOT_FOUND, "Not found");
        }
    };

    if row.share_card_version.as_deref() == Some(row.share_version().as_str()) {
        // Read from the bucket, not the public CDN: the card is rewritten under the same key,
        // and the CDN may still hold the previous version.
        match st.r2.get(&share_card_key(&slug)).await {
            Ok(bytes) => return png(bytes),
            // Version matched but the object is missing (deleted out of band, etc.).
            Err(e) => tracing::warn!("[share] stored card unavailable for {slug}: {e:#}"),
        }
    }

    let input = CardInput {
        friendly_name: row.friendly_name.clone(),
        caption: row.caption.clone(),
        original_name: row.original_name.clone(),
        date: row.date,
    };
    let rendered = async {
        let large = st.r2.get(&row.large_name).await?;
        st.cards.render(&input, large, &base).await
    }
    .await;
    match rendered {
        Ok(bytes) => png(bytes),
        Err(e) => {
            tracing::error!("[share] live render failed for {slug}: {e:#}");
            text(StatusCode::BAD_GATEWAY, "Photo unavailable")
        }
    }
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// GET /feed.xml: RSS for the 50 most recently published photos.
pub async fn feed(State(st): State<Arc<AppState>>, headers: HeaderMap) -> ApiResult<Response> {
    let base = base_url::resolve(&st.config.base_url, &headers);
    // A DB failure is a 500, not an empty feed: readers treat an empty feed as "nothing new"
    // and a cached one would hide photos until it expires.
    let rows = db::recent_published_photos(&st.db, FEED_ITEM_LIMIT).await?;

    let mut items = String::new();
    for row in &rows {
        let title = row.title();
        let link = format!("{base}/p/{}", js::encode_uri_component(&row.friendly_name));
        let thumb_url = st.config.public_url(&row.thumb_name);
        let taken = row.date.as_ref().map(js::format_long_date);
        // created_at is when the photo was published, which is what "new" means to a
        // subscriber; the date taken goes in the body instead.
        let pub_date = row.created_at.as_ref().map(js::to_utc_string);
        let mut body = format!(
            r#"<p><a href="{}"><img src="{}" alt="{}" /></a></p><p>{}</p>"#,
            escape_xml(&link),
            escape_xml(&thumb_url),
            escape_xml(title),
            escape_xml(title)
        );
        if let Some(t) = &taken {
            body.push_str(&format!("<p>{}</p>", escape_xml(t)));
        }
        items.push_str("<item>");
        items.push_str(&format!("<title>{}</title>", escape_xml(title)));
        items.push_str(&format!("<link>{}</link>", escape_xml(&link)));
        items.push_str(&format!(r#"<guid isPermaLink="false">{}</guid>"#, escape_xml(&row.id.to_string())));
        if let Some(d) = &pub_date {
            items.push_str(&format!("<pubDate>{d}</pubDate>"));
        }
        items.push_str(&format!("<description>{}</description>", escape_xml(&body)));
        items.push_str(&format!(r#"<media:thumbnail url="{}" />"#, escape_xml(&thumb_url)));
        items.push_str("</item>");
    }

    let last_build = js::to_utc_string(&rows.first().and_then(|r| r.created_at).unwrap_or_else(Utc::now));
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <rss version=\"2.0\" xmlns:atom=\"http://www.w3.org/2005/Atom\" xmlns:media=\"http://search.yahoo.com/mrss/\">\
         <channel>\
         <title>{}</title>\
         <link>{}/</link>\
         <description>{}</description>\
         <language>en-us</language>\
         <lastBuildDate>{last_build}</lastBuildDate>\
         <atom:link href=\"{}/feed.xml\" rel=\"self\" type=\"application/rss+xml\" />\
         {items}\
         </channel></rss>",
        escape_xml(FEED_TITLE),
        escape_xml(&base),
        escape_xml(FEED_DESCRIPTION),
        escape_xml(&base),
    );
    Ok((
        [
            (header::CONTENT_TYPE, HeaderValue::from_static("application/rss+xml; charset=utf-8")),
            (header::CACHE_CONTROL, HeaderValue::from_static(FEED_CACHE_CONTROL)),
        ],
        xml,
    )
        .into_response())
}

fn resend(st: &AppState) -> ApiResult<&crate::resend::Resend> {
    st.resend
        .as_ref()
        .ok_or_else(|| ApiError::internal("subscribe", "RESEND_API_KEY and RESEND_EMAIL_DOMAIN must be set"))
}

/// POST /api/subscribe: email a double opt-in link.
pub async fn subscribe(State(st): State<Arc<AppState>>, headers: HeaderMap, body: Bytes) -> ApiResult<Json<Value>> {
    let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);

    // Honeypot: a field people never see. Bots that fill it get the same reply as everyone
    // else, so there is nothing to learn from probing.
    if body.get("website").is_some_and(js::truthy) {
        return Ok(Json(json!({ "ok": true })));
    }
    let email = subscribe::normalize_email(body.get("email").unwrap_or(&Value::Null))
        .ok_or_else(|| ApiError::bad_request("Enter a valid email address"))?;

    let resend = resend(&st)?;
    let base = base_url::resolve(&st.config.base_url, &headers);
    let now = Utc::now().timestamp_millis();
    let token = subscribe::create_confirm_token(&resend.config().api_key, &email, now);
    let link = format!("{base}/subscribe/confirm?token={}", js::encode_uri_component(&token));
    let message = emails::confirm_email(&link);

    // At most one confirmation per address per hour. The token differs on every request, so
    // a repeat inside the window is a different payload under the same key and Resend
    // answers 409 without sending, which caps how often anyone can mail a stranger here.
    let slot = now.div_euclid(60 * 60 * 1000);
    let key = format!("subscribe-confirm/{}/{slot}", subscribe::hash_email(&email));
    let sent = resend
        .send_email(&email, "Confirm your subscription to Photos by Vedant Modi", &message.html, &message.text, &key)
        .await;

    match sent {
        Ok(_) => {
            // Same reply whether or not the address is already subscribed, so the form
            // can't be used to check who is on the list.
            Ok(Json(json!({ "ok": true })))
        }
        Err(e)
            if e.status == Some(409) || {
                let t = format!("{} {}", e.name, e.message).to_lowercase();
                t.contains("idempotency") || t.contains("409")
            } =>
        {
            // Say so rather than claim a fresh email went out. This reveals only that a link
            // was requested recently, not whether the address is subscribed.
            Ok(Json(json!({ "ok": true, "alreadySent": true })))
        }
        Err(e) => {
            tracing::error!("[subscribe] send failed: {e}");
            Err(ApiError::new(StatusCode::BAD_GATEWAY, "Couldn't send the confirmation email, try again later"))
        }
    }
}

#[derive(Deserialize)]
pub struct TokenQuery {
    token: Option<String>,
}

/// GET /api/subscribe/confirm?token=: whether a confirmation link is still good, so the
/// page can show the Confirm button or an "expired" message.
pub async fn confirm_status(State(st): State<Arc<AppState>>, Query(q): Query<TokenQuery>) -> Json<Value> {
    let valid = match (&st.resend, q.token) {
        (Some(r), Some(t)) => {
            subscribe::verify_confirm_token(&r.config().api_key, &t, Utc::now().timestamp_millis()).is_some()
        }
        _ => false,
    };
    Json(json!({ "valid": valid }))
}

/// POST /api/subscribe/confirm: subscribe the address in a confirmation token.
///
/// Confirming takes a button press on the page rather than happening when the link is
/// opened: mail scanners fetch every link in an email, and a GET that subscribed would opt
/// people in unasked.
pub async fn confirm(State(st): State<Arc<AppState>>, body: Bytes) -> Json<Value> {
    let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let token = body.get("token").and_then(Value::as_str).unwrap_or("");
    let status = match &st.resend {
        None => {
            tracing::error!("[subscribe] confirm failed: RESEND_API_KEY and RESEND_EMAIL_DOMAIN must be set");
            "error"
        }
        Some(r) => match subscribe::verify_confirm_token(&r.config().api_key, token, Utc::now().timestamp_millis()) {
            None => "invalid",
            Some(email) => match r.add_subscriber(&email).await {
                Ok(()) => "confirmed",
                Err(e) => {
                    tracing::error!("[subscribe] confirm failed: {e:#}");
                    "error"
                }
            },
        },
    };
    Json(json!({ "status": status }))
}

/// GET /api/cron/digest: the weekly email, sent only when there are new photos. The cron
/// presents CRON_SECRET as a bearer token.
pub async fn digest(State(st): State<Arc<AppState>>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let authorized = st.config.cron_secret.as_deref().is_some_and(|secret| {
        headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) == Some(&format!("Bearer {secret}"))
    });
    if !authorized {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Unauthorized"));
    }

    let rows = db::published_photos_since(&st.db, Utc::now() - DIGEST_WINDOW).await?;
    if rows.is_empty() {
        return Ok(Json(json!({ "sent": false, "reason": "no new photos" })));
    }

    let resend = resend(&st)?;
    let segment = resend
        .config()
        .segment_id
        .clone()
        .ok_or_else(|| ApiError::internal("digest", "RESEND_SEGMENT_ID is not set"))?;
    let base = base_url::resolve(&st.config.base_url, &headers);

    let shown = &rows[..rows.len().min(DIGEST_MAX_PHOTOS)];
    let more = rows.len() - shown.len();
    let to_digest = |r: &db::PhotoRow, image_url: String| DigestPhoto {
        title: r.title().to_owned(),
        url: format!("{base}/p/{}", js::encode_uri_component(&r.friendly_name)),
        image_url,
        date: r.date.as_ref().map(js::format_long_date),
    };
    let hero = to_digest(&shown[0], st.config.public_url(&shown[0].large_name));
    let rest: Vec<DigestPhoto> = shown[1..].iter().map(|r| to_digest(r, st.config.public_url(&r.thumb_name))).collect();
    let message = emails::digest_email(&Digest {
        base_url: &base,
        hero: &hero,
        rest: &rest,
        more,
        // Resend swaps this for each recipient's own link when the broadcast goes out.
        unsubscribe_url: "{{{RESEND_UNSUBSCRIBE_URL}}}",
    });
    let subject = if rows.len() == 1 {
        "1 new photo on the map".to_owned()
    } else {
        format!("{} new photos on the map", rows.len())
    };

    // Create and send separately: a failed `send: true` still leaves a draft behind, and a
    // week with no subscribers would add one every run. Drop the draft if the send fails.
    let name = format!("Weekly digest {}", Utc::now().format("%Y-%m-%d"));
    let id = resend.create_broadcast(&name, &segment, &subject, &message.html, &message.text).await.map_err(|e| {
        tracing::error!("[digest] broadcast create failed: {e}");
        ApiError::new(StatusCode::BAD_GATEWAY, e.message)
    })?;

    if let Err(e) = resend.send_broadcast(&id).await {
        if let Err(cleanup) = resend.remove_broadcast(&id).await {
            tracing::warn!("[digest] could not remove draft {id}: {cleanup}");
        }
        // Nobody subscribed (or everyone unsubscribed) is a quiet week, not a failure.
        if e.message.to_lowercase().contains("no contacts") {
            return Ok(Json(json!({ "sent": false, "reason": "no subscribers" })));
        }
        tracing::error!("[digest] broadcast send failed: {e}");
        return Err(ApiError::new(StatusCode::BAD_GATEWAY, e.message));
    }

    Ok(Json(json!({ "sent": true, "broadcast": id, "photos": rows.len() })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xml_escaping() {
        assert_eq!(escape_xml(r#"a&b<c>"d'"#), "a&amp;b&lt;c&gt;&quot;d&apos;");
    }
}
