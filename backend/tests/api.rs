//! End-to-end tests of every route against a real Postgres and in-process stand-ins for
//! R2 (S3), Resend and Cloudflare.
//!
//! Needs `TEST_DATABASE_URL` pointing at a Postgres server whose user may create
//! databases; each test gets a fresh database. Skipped (with a note) when it is unset:
//!
//!   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1/postgres cargo test

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, Request, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use base64::Engine as _;
use http_body_util::BodyExt;
use photo_maps_backend::config::{AdminCredentials, BaseUrlConfig, CloudflareConfig, Config, R2Config, ResendConfig};
use photo_maps_backend::state::AppState;
use photo_maps_backend::{MIGRATOR, imaging, routes, subscribe};
use serde_json::{Value, json};
use sqlx::{Connection, PgConnection, PgPool};
use tower::ServiceExt;

// ---- Stand-ins for external services ------------------------------------------------------

/// Objects by key, for a single bucket.
type Objects = Arc<Mutex<HashMap<String, (Vec<u8>, String)>>>;

async fn s3(
    State(objects): State<Objects>,
    method: Method,
    Path((_bucket, key)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let mut objects = objects.lock().unwrap();
    match method {
        Method::PUT => {
            let ct = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_owned();
            objects.insert(key, (body.to_vec(), ct));
            (StatusCode::OK, [(header::ETAG, "\"etag\"")]).into_response()
        }
        Method::GET => match objects.get(&key) {
            Some((bytes, ct)) => ([(header::CONTENT_TYPE, ct.clone())], bytes.clone()).into_response(),
            None => (
                StatusCode::NOT_FOUND,
                [(header::CONTENT_TYPE, "application/xml")],
                "<?xml version=\"1.0\"?><Error><Code>NoSuchKey</Code><Message>missing</Message></Error>",
            )
                .into_response(),
        },
        Method::DELETE => {
            objects.remove(&key);
            StatusCode::NO_CONTENT.into_response()
        }
        _ => StatusCode::METHOD_NOT_ALLOWED.into_response(),
    }
}

#[derive(Clone, Debug)]
struct Recorded {
    method: Method,
    path: String,
    headers: HeaderMap,
    body: Value,
}

/// Canned answers by "METHOD /path" prefix; anything unlisted gets 200 `{}`.
#[derive(Clone, Default)]
struct Mock {
    calls: Arc<Mutex<Vec<Recorded>>>,
    replies: Arc<Mutex<Vec<(String, u16, Value)>>>,
}

impl Mock {
    fn reply(&self, route: &str, status: u16, body: Value) {
        self.replies.lock().unwrap().insert(0, (route.to_owned(), status, body));
    }

    fn calls(&self) -> Vec<Recorded> {
        self.calls.lock().unwrap().clone()
    }
}

async fn mock_handler(State(mock): State<Mock>, req: Request<Body>) -> Response {
    let (parts, body) = req.into_parts();
    let bytes = body.collect().await.unwrap().to_bytes();
    let path = parts.uri.path().to_owned();
    mock.calls.lock().unwrap().push(Recorded {
        method: parts.method.clone(),
        path: path.clone(),
        headers: parts.headers.clone(),
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    });
    let key = format!("{} {}", parts.method, path);
    let replies = mock.replies.lock().unwrap();
    match replies.iter().find(|(route, _, _)| key.starts_with(route.as_str())) {
        Some((_, status, body)) => (StatusCode::from_u16(*status).unwrap(), axum::Json(body.clone())).into_response(),
        None => axum::Json(json!({})).into_response(),
    }
}

async fn serve(app: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

// ---- Harness --------------------------------------------------------------------------------

struct Harness {
    app: Router,
    state: Arc<AppState>,
    db: PgPool,
    objects: Objects,
    resend: Mock,
    cloudflare: Mock,
}

const ADMIN: (&str, &str) = ("admin", "s3cret:with:colons");
const RESEND_KEY: &str = "re_test_key";
const CRON_SECRET: &str = "cron-secret";

async fn harness() -> Option<Harness> {
    let Ok(admin_url) = std::env::var("TEST_DATABASE_URL") else {
        eprintln!("TEST_DATABASE_URL not set; skipping API integration test");
        return None;
    };
    let name = format!("photomaps_{}", uuid::Uuid::new_v4().simple());
    let mut conn = PgConnection::connect(&admin_url).await.expect("connect to TEST_DATABASE_URL");
    sqlx::query(sqlx::AssertSqlSafe(format!("CREATE DATABASE {name}"))).execute(&mut conn).await.unwrap();
    let mut db_url = url::Url::parse(&admin_url).unwrap();
    db_url.set_path(&name);
    let db = PgPool::connect(db_url.as_str()).await.unwrap();
    MIGRATOR.run(&db).await.unwrap();

    let objects: Objects = Arc::default();
    let s3_url = serve(Router::new().route("/{bucket}/{*key}", any(s3)).with_state(objects.clone())).await;
    let resend = Mock::default();
    let resend_url = serve(Router::new().fallback(mock_handler).with_state(resend.clone())).await;
    let cloudflare = Mock::default();
    let cloudflare_url = serve(Router::new().fallback(mock_handler).with_state(cloudflare.clone())).await;
    cloudflare.reply("POST /zones/zone1/purge_cache", 200, json!({ "success": true, "errors": [] }));

    let config = Config {
        database_url: db_url.to_string(),
        r2: R2Config {
            endpoint: s3_url,
            bucket: "photos".into(),
            access_key_id: "key".into(),
            secret_access_key: "secret".into(),
            force_path_style: true,
        },
        r2_public_url: "https://img.example".into(),
        admin: Some(AdminCredentials { user: ADMIN.0.into(), pass: ADMIN.1.into() }),
        cloudflare: Some(CloudflareConfig {
            zone_id: "zone1".into(),
            api_token: "cf-token".into(),
            api_base: cloudflare_url,
        }),
        resend: Some(ResendConfig {
            api_key: RESEND_KEY.into(),
            email_domain: "photos.example".into(),
            segment_id: Some("seg_1".into()),
            api_base: resend_url,
        }),
        cron_secret: Some(CRON_SECRET.into()),
        base_url: BaseUrlConfig::default(),
    };
    let state = AppState::new(config, db.clone()).unwrap();
    Some(Harness { app: routes::router(state.clone()), state, db, objects, resend, cloudflare })
}

struct Res {
    status: StatusCode,
    headers: HeaderMap,
    bytes: Bytes,
}

impl Res {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.bytes)
            .unwrap_or_else(|_| panic!("not JSON: {}", String::from_utf8_lossy(&self.bytes)))
    }

    fn text(&self) -> String {
        String::from_utf8(self.bytes.to_vec()).unwrap()
    }
}

fn basic(user: &str, pass: &str) -> String {
    format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pass}")))
}

impl Harness {
    async fn request(&self, method: &str, uri: &str, auth: Option<String>, body: Option<Value>) -> Res {
        let mut req = Request::builder().method(method).uri(uri).header(header::HOST, "photos.test");
        if let Some(a) = auth {
            req = req.header(header::AUTHORIZATION, a);
        }
        let body = match body {
            Some(v) => {
                req = req.header(header::CONTENT_TYPE, "application/json");
                Body::from(v.to_string())
            }
            None => Body::empty(),
        };
        let res = self.app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
        let status = res.status();
        let headers = res.headers().clone();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        Res { status, headers, bytes }
    }

    async fn admin(&self, method: &str, uri: &str, body: Option<Value>) -> Res {
        self.request(method, uri, Some(basic(ADMIN.0, ADMIN.1)), body).await
    }

    async fn public(&self, method: &str, uri: &str, body: Option<Value>) -> Res {
        self.request(method, uri, None, body).await
    }

    fn put_object(&self, key: &str, bytes: Vec<u8>) {
        self.objects.lock().unwrap().insert(key.to_owned(), (bytes, "application/octet-stream".into()));
    }

    fn object(&self, key: &str) -> Option<(Vec<u8>, String)> {
        self.objects.lock().unwrap().get(key).cloned()
    }

    /// Lets background share-card renders finish.
    async fn settle(&self) {
        for _ in 0..2400 {
            if self.state.tasks.is_empty() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("background tasks did not finish");
    }

    async fn share_card_version(&self, slug: &str) -> Option<String> {
        sqlx::query_scalar("SELECT share_card_version FROM photos WHERE friendly_name = $1")
            .bind(slug)
            .fetch_one(&self.db)
            .await
            .unwrap()
    }

    async fn upload(&self, fixture: &str, slug: &str, extra: Value) -> Res {
        let bytes = std::fs::read(format!("{}/tests/fixtures/images/{fixture}", env!("CARGO_MANIFEST_DIR"))).unwrap();
        let key = format!("originals/{slug}.{}", fixture.rsplit('.').next().unwrap());
        self.put_object(&key, bytes);
        let mut body = json!({
            "key": key, "friendly_name": slug, "original_name": fixture, "caption": "",
            "lat": null, "lon": null, "gps_cleared": false, "date": null,
        });
        for (k, v) in extra.as_object().unwrap() {
            body[k] = v.clone();
        }
        self.admin("POST", "/api/admin/process", Some(body)).await
    }
}

macro_rules! harness {
    () => {
        match harness().await {
            Some(h) => h,
            None => return,
        }
    };
}

fn jpeg_size(bytes: &[u8]) -> (u32, u32) {
    imaging::decode_jpeg(bytes).unwrap().dimensions()
}

// ---- Tests ----------------------------------------------------------------------------------

#[tokio::test]
async fn admin_routes_require_basic_auth() {
    let h = harness!();
    for (method, uri) in [
        ("POST", "/api/upload"),
        ("POST", "/api/admin/process"),
        ("GET", "/api/admin/photos"),
        ("PATCH", "/api/admin/photos/00000000-0000-0000-0000-000000000000"),
        ("POST", "/api/admin/photos/00000000-0000-0000-0000-000000000000/rotate"),
        ("GET", "/api/admin/places"),
        ("DELETE", "/api/admin/cache"),
    ] {
        for auth in [None, Some(basic("admin", "wrong")), Some(basic("admin", "s3cret"))] {
            let r = h.request(method, uri, auth.clone(), Some(json!({}))).await;
            assert_eq!(r.status, StatusCode::UNAUTHORIZED, "{method} {uri} {auth:?}");
            assert_eq!(r.headers[header::WWW_AUTHENTICATE], "Basic realm=\"Admin\"");
            assert_eq!(r.text(), "Unauthorized");
        }
    }
    assert_eq!(h.admin("GET", "/api/admin/photos", None).await.status, StatusCode::OK);
    assert_eq!(h.public("GET", "/healthz", None).await.text(), "ok");
}

#[tokio::test]
async fn presigned_upload_url() {
    let h = harness!();
    let r =
        h.admin("POST", "/api/upload", Some(json!({ "key": "originals/x.heic", "contentType": "image/heic" }))).await;
    assert_eq!(r.status, StatusCode::OK);
    let v = r.json();
    assert_eq!(v["key"], "originals/x.heic");
    let url = url::Url::parse(v["uploadUrl"].as_str().unwrap()).unwrap();
    assert!(url.path().ends_with("/photos/originals/x.heic"), "{url}");
    let q: HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(q["X-Amz-Expires"], "300");
    assert!(q["X-Amz-SignedHeaders"].contains("content-type"), "{q:?}");
    assert!(!q.keys().any(|k| k.to_lowercase().contains("checksum")), "no checksum params: {q:?}");

    for body in
        [json!({ "key": "k" }), json!({ "contentType": "image/jpeg" }), json!({ "key": "", "contentType": "x" })]
    {
        let r = h.admin("POST", "/api/upload", Some(body)).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST);
        assert_eq!(r.json(), json!({ "error": "key and contentType required" }));
    }
}

#[tokio::test]
async fn photo_lifecycle() {
    let h = harness!();

    // Process: EXIF GPS and date are read, renditions written, original removed.
    let r = h.upload("exif_full.jpg", "nyc", json!({ "caption": "Hello & <world>" })).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(r.json(), json!({ "ok": true, "lat": 40.7128, "lon": -74.006 }));
    assert!(h.object("originals/nyc.jpg").is_none());
    let (thumb, ct) = h.object("nyc_thumb.jpg").unwrap();
    assert_eq!(ct, "image/jpeg");
    assert_eq!(jpeg_size(&thumb), (225, 300));
    assert_eq!(jpeg_size(&h.object("nyc_large.jpg").unwrap().0), (1200, 1600));

    // The share card is precomputed in the background and its version recorded.
    h.settle().await;
    let (card, ct) = h.object("nyc_share.png").unwrap();
    assert_eq!(ct, "image/png");
    let png = image::load_from_memory(&card).unwrap();
    assert_eq!((png.width(), png.height()), (1080, 1920));

    // Public listing, in the frontend's Photo shape.
    let photos = h.public("GET", "/api/photos", None).await.json();
    let p = &photos[0];
    let mut keys: Vec<&str> = p.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "caption",
            "created_at",
            "date",
            "friendly_name",
            "id",
            "large_name",
            "large_url",
            "lat",
            "lon",
            "original_name",
            "share_card_version",
            "status",
            "thumb_name",
            "thumb_url"
        ]
    );
    assert_eq!(p["date"], "2024-03-19T14:30:05.000Z");
    assert_eq!(p["thumb_url"], "https://img.example/nyc_thumb.jpg");
    assert_eq!(p["status"], "published");
    assert!(p["created_at"].as_str().unwrap().ends_with('Z'));
    let version = h.share_card_version("nyc").await.unwrap();
    assert_eq!(p["share_card_version"], version.as_str());
    let id = p["id"].as_str().unwrap().to_owned();

    assert_eq!(h.public("GET", "/api/photos/nyc", None).await.json()["id"], id.as_str());
    assert_eq!(h.public("GET", "/api/photos/missing", None).await.status, StatusCode::NOT_FOUND);

    // The share route serves the stored card while it is current.
    let r = h.public("GET", &format!("/api/share/nyc?v={version}"), None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.headers[header::CONTENT_TYPE], "image/png");
    assert_eq!(r.headers[header::CACHE_CONTROL], "public, s-maxage=86400, stale-while-revalidate=604800");
    assert_eq!(r.bytes.as_ref(), card.as_slice());
    let r = h.public("GET", "/api/share/missing", None).await;
    assert_eq!((r.status, r.text().as_str()), (StatusCode::NOT_FOUND, "Not found"));

    // Admin list shape.
    let list = h.admin("GET", "/api/admin/photos", None).await.json();
    let mut keys: Vec<&str> = list[0].as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        ["caption", "date", "friendly_name", "id", "large_name", "lat", "lon", "status", "thumb_name", "thumb_url"]
    );

    // Edits: caption and date re-render the card; location alone does not.
    let r = h
        .admin(
            "PATCH",
            &format!("/api/admin/photos/{id}"),
            Some(json!({ "caption": "New", "lat": "", "lon": null, "date": "2024-05-06T07:08" })),
        )
        .await;
    assert_eq!((r.status, r.json()), (StatusCode::OK, json!({ "ok": true })));
    h.settle().await;
    let p = h.public("GET", "/api/photos/nyc", None).await.json();
    assert_eq!((p["caption"].clone(), p["lat"].clone(), p["lon"].clone()), (json!("New"), Value::Null, Value::Null));
    assert_eq!(p["date"], "2024-05-06T07:08:00.000Z");
    let new_version = h.share_card_version("nyc").await.unwrap();
    assert_ne!(new_version, version);
    assert_ne!(h.object("nyc_share.png").unwrap().0, card);

    let r = h.admin("PATCH", &format!("/api/admin/photos/{id}"), Some(json!({ "lat": 12, "lon": 34 }))).await;
    assert_eq!(r.status, StatusCode::OK);
    h.settle().await;
    assert_eq!(h.share_card_version("nyc").await.unwrap(), new_version);

    for (body, msg) in [
        (json!({ "lat": 91 }), "lat must be between -90 and 90"),
        (json!({ "lon": "east" }), "lon must be between -180 and 180"),
        (json!({ "unrelated": 1 }), "No fields to update"),
        (json!({ "date": "not a date" }), "date must be a valid date"),
    ] {
        let r = h.admin("PATCH", &format!("/api/admin/photos/{id}"), Some(body)).await;
        assert_eq!((r.status, r.json()), (StatusCode::BAD_REQUEST, json!({ "error": msg })));
    }

    // Rotation turns both renditions.
    let r = h.admin("POST", &format!("/api/admin/photos/{id}/rotate"), Some(json!({ "degrees": 90 }))).await;
    assert_eq!((r.status, r.json()), (StatusCode::OK, json!({ "ok": true })));
    assert_eq!(jpeg_size(&h.object("nyc_large.jpg").unwrap().0), (1600, 1200));
    assert_eq!(jpeg_size(&h.object("nyc_thumb.jpg").unwrap().0), (300, 225));
    let r = h.admin("POST", &format!("/api/admin/photos/{id}/rotate"), Some(json!({ "degrees": 45 }))).await;
    assert_eq!((r.status, r.json()), (StatusCode::BAD_REQUEST, json!({ "error": "degrees must be 90, 180, or 270" })));
    h.settle().await;

    // Delete removes the objects and the row.
    let r = h.admin("DELETE", &format!("/api/admin/photos/{id}"), None).await;
    assert_eq!((r.status, r.json()), (StatusCode::OK, json!({ "ok": true })));
    for key in ["nyc_thumb.jpg", "nyc_large.jpg", "nyc_share.png"] {
        assert!(h.object(key).is_none(), "{key} should be gone");
    }
    assert_eq!(h.public("GET", "/api/photos", None).await.json(), json!([]));
    for uri in [format!("/api/admin/photos/{id}"), "/api/admin/photos/not-a-uuid".to_owned()] {
        let r = h.admin("DELETE", &uri, None).await;
        assert_eq!((r.status, r.json()), (StatusCode::NOT_FOUND, json!({ "error": "Not found" })));
    }
}

#[tokio::test]
async fn process_location_and_date_rules() {
    let h = harness!();

    // Pinned coordinates win over EXIF.
    let r = h.upload("exif_full.jpg", "pinned", json!({ "lat": "10.5", "lon": -20 })).await;
    assert_eq!(r.json(), json!({ "ok": true, "lat": 10.5, "lon": -20.0 }));

    // A deliberately cleared location stays cleared.
    let r = h.upload("exif_full.jpg", "cleared", json!({ "gps_cleared": true })).await;
    assert_eq!(r.json(), json!({ "ok": true, "lat": null, "lon": null }));

    // Half a pair is an error unless the location was cleared.
    let r = h.upload("exif_full.jpg", "half", json!({ "lat": 10 })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.json()["error"], "lat and lon must both be given, with lat in [-90, 90] and lon in [-180, 180]");

    // The typed date is only used when the photo has none of its own.
    h.upload("base.jpg", "manual", json!({ "date": "2023-01-02T03:04" })).await;
    h.upload("exif_full.jpg", "exifwins", json!({ "date": "2023-01-02T03:04" })).await;
    let r = h.upload("base.jpg", "baddate", json!({ "date": "yesterday" })).await;
    assert_eq!((r.status, r.json()), (StatusCode::BAD_REQUEST, json!({ "error": "date must be a valid date" })));

    // HEIC and PNG go through too.
    let r = h.upload("exif.heic", "paris", json!({})).await;
    assert_eq!(r.json(), json!({ "ok": true, "lat": 48.8584, "lon": 2.2944999999999998 }));
    assert_eq!(jpeg_size(&h.object("paris_large.jpg").unwrap().0), (1600, 1200));

    let r = h.admin("POST", "/api/admin/process", Some(json!({ "friendly_name": "x" }))).await;
    assert_eq!((r.status, r.json()), (StatusCode::BAD_REQUEST, json!({ "error": "key and friendly_name required" })));
    let r = h
        .admin("POST", "/api/admin/process", Some(json!({ "key": "originals/none.jpg", "friendly_name": "none" })))
        .await;
    assert_eq!(r.status, StatusCode::INTERNAL_SERVER_ERROR);

    h.settle().await;
    let photos = h.public("GET", "/api/photos", None).await.json();
    let by: HashMap<&str, &Value> =
        photos.as_array().unwrap().iter().map(|p| (p["friendly_name"].as_str().unwrap(), p)).collect();
    assert_eq!(by["manual"]["date"], "2023-01-02T03:04:00.000Z");
    assert_eq!(by["exifwins"]["date"], "2024-03-19T14:30:05.000Z");
    assert_eq!(by["cleared"]["lat"], Value::Null);
    assert_eq!(by["manual"]["caption"], Value::Null, "empty caption is stored as null");
    assert_eq!(by["manual"]["original_name"], "base.jpg");

    // Re-uploading under an existing slug updates it in place and keeps its original name.
    let r = h.upload("base.jpg", "manual", json!({ "caption": "Again", "original_name": "other.jpg" })).await;
    assert_eq!(r.status, StatusCode::OK);
    h.settle().await;
    let p = h.public("GET", "/api/photos/manual", None).await.json();
    assert_eq!((p["caption"].clone(), p["original_name"].clone()), (json!("Again"), json!("base.jpg")));
    // The card was versioned from the stored row, so it is current.
    assert_eq!(p["share_card_version"].as_str(), Some(h.share_card_version("manual").await.unwrap().as_str()));
    let current: String = {
        let rows = h.public("GET", "/api/photos", None).await.json();
        let p = rows.as_array().unwrap().iter().find(|p| p["friendly_name"] == "manual").unwrap().clone();
        p["share_card_version"].as_str().unwrap().to_owned()
    };
    assert!(!current.is_empty());
}

#[tokio::test]
async fn share_card_falls_back_to_live_render() {
    let h = harness!();
    h.upload("base.jpg", "live", json!({ "caption": "Live" })).await;
    h.settle().await;
    // Stale version: rendered live rather than served from the stored copy.
    sqlx::query("UPDATE photos SET share_card_version = 'stale'").execute(&h.db).await.unwrap();
    h.objects.lock().unwrap().insert("live_share.png".into(), (b"old".to_vec(), "image/png".into()));
    let r = h.public("GET", "/api/share/live", None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_ne!(r.bytes.as_ref(), b"old");
    assert!(image::load_from_memory(&r.bytes).is_ok());
    // No large rendition to render from: 502.
    h.objects.lock().unwrap().remove("live_large.jpg");
    let r = h.public("GET", "/api/share/live", None).await;
    assert_eq!((r.status, r.text().as_str()), (StatusCode::BAD_GATEWAY, "Photo unavailable"));
}

#[tokio::test]
async fn places_crud() {
    let h = harness!();
    // The baseline migration seeds the one place that used to be hard-coded.
    let seeded = h.public("GET", "/api/places", None).await.json();
    assert_eq!(seeded.as_array().unwrap().len(), 1);
    assert_eq!(seeded[0]["name"], "Great Barrier Reef");
    assert_eq!(seeded[0]["radiusKm"], 60.0);

    let r = h
        .admin(
            "POST",
            "/api/admin/places",
            Some(json!({ "name": "  Atoll ", "lat": "-5", "lon": 150, "radius_km": 12.5 })),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED);
    let created = r.json();
    let mut keys: Vec<&str> = created.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, ["id", "latitude", "longitude", "name", "radiusKm"]);
    assert_eq!(
        (created["name"].clone(), created["latitude"].clone(), created["radiusKm"].clone()),
        (json!("Atoll"), json!(-5.0), json!(12.5))
    );
    let id = created["id"].as_str().unwrap();

    let names: Vec<Value> = h
        .admin("GET", "/api/admin/places", None)
        .await
        .json()
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].clone())
        .collect();
    assert_eq!(names, [json!("Atoll"), json!("Great Barrier Reef")]);

    let r = h
        .admin(
            "PATCH",
            &format!("/api/admin/places/{id}"),
            Some(json!({ "name": "Atoll 2", "lat": 1, "lon": 2, "radius_km": 3 })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.json()["name"], "Atoll 2");

    let r =
        h.admin("POST", "/api/admin/places", Some(json!({ "name": "x", "lat": 1, "lon": 2, "radius_km": 0 }))).await;
    assert_eq!(
        (r.status, r.json()),
        (StatusCode::BAD_REQUEST, json!({ "error": "radius_km must be between 0.1 and 500" }))
    );
    let missing = "00000000-0000-0000-0000-000000000000";
    let r = h
        .admin(
            "PATCH",
            &format!("/api/admin/places/{missing}"),
            Some(json!({ "name": "a", "lat": 1, "lon": 2, "radius_km": 3 })),
        )
        .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);

    assert_eq!(h.admin("DELETE", &format!("/api/admin/places/{id}"), None).await.json(), json!({ "ok": true }));
    assert_eq!(h.admin("DELETE", &format!("/api/admin/places/{id}"), None).await.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn rss_feed() {
    let h = harness!();
    h.upload("exif_full.jpg", "first & best", json!({ "caption": "Café <b>" })).await;
    h.upload("base.jpg", "second", json!({})).await;
    sqlx::query("UPDATE photos SET created_at = '2026-01-02T03:04:05Z' WHERE friendly_name = 'second'")
        .execute(&h.db)
        .await
        .unwrap();
    sqlx::query("UPDATE photos SET created_at = '2026-01-01T00:00:00Z' WHERE friendly_name = 'first & best'")
        .execute(&h.db)
        .await
        .unwrap();
    let id: uuid::Uuid = sqlx::query_scalar("SELECT id FROM photos WHERE friendly_name = 'first & best'")
        .fetch_one(&h.db)
        .await
        .unwrap();
    let id2: uuid::Uuid =
        sqlx::query_scalar("SELECT id FROM photos WHERE friendly_name = 'second'").fetch_one(&h.db).await.unwrap();

    let r = h.public("GET", "/feed.xml", None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.headers[header::CONTENT_TYPE], "application/rss+xml; charset=utf-8");
    assert_eq!(r.headers[header::CACHE_CONTROL], "public, s-maxage=900, stale-while-revalidate=3600");
    // The same document the TypeScript route builds for these rows.
    let expected = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rss version=\"2.0\" xmlns:atom=\"http://www.w3.org/2005/Atom\" xmlns:media=\"http://search.yahoo.com/mrss/\"><channel><title>Photos by Vedant Modi</title><link>https://photos.test/</link><description>Photos! Mapped!</description><language>en-us</language><lastBuildDate>Fri, 02 Jan 2026 03:04:05 GMT</lastBuildDate><atom:link href=\"https://photos.test/feed.xml\" rel=\"self\" type=\"application/rss+xml\" />\
<item><title>base.jpg</title><link>https://photos.test/p/second</link><guid isPermaLink=\"false\">{id2}</guid><pubDate>Fri, 02 Jan 2026 03:04:05 GMT</pubDate><description>&lt;p&gt;&lt;a href=&quot;https://photos.test/p/second&quot;&gt;&lt;img src=&quot;https://img.example/second_thumb.jpg&quot; alt=&quot;base.jpg&quot; /&gt;&lt;/a&gt;&lt;/p&gt;&lt;p&gt;base.jpg&lt;/p&gt;</description><media:thumbnail url=\"https://img.example/second_thumb.jpg\" /></item>\
<item><title>Café &lt;b&gt;</title><link>https://photos.test/p/first%20%26%20best</link><guid isPermaLink=\"false\">{id}</guid><pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate><description>&lt;p&gt;&lt;a href=&quot;https://photos.test/p/first%20%26%20best&quot;&gt;&lt;img src=&quot;https://img.example/first &amp;amp; best_thumb.jpg&quot; alt=&quot;Café &amp;lt;b&amp;gt;&quot; /&gt;&lt;/a&gt;&lt;/p&gt;&lt;p&gt;Café &amp;lt;b&amp;gt;&lt;/p&gt;&lt;p&gt;March 19, 2024&lt;/p&gt;</description><media:thumbnail url=\"https://img.example/first &amp; best_thumb.jpg\" /></item>\
</channel></rss>"
    );
    assert_eq!(r.text(), expected);
}

#[tokio::test]
async fn email_signup() {
    let h = harness!();

    let r = h.public("POST", "/api/subscribe", Some(json!({ "email": "not-an-email" }))).await;
    assert_eq!((r.status, r.json()), (StatusCode::BAD_REQUEST, json!({ "error": "Enter a valid email address" })));
    let r = h.public("POST", "/api/subscribe", None).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    // Honeypot: same answer, nothing sent.
    let r = h.public("POST", "/api/subscribe", Some(json!({ "email": "bot@example.com", "website": "spam" }))).await;
    assert_eq!(r.json(), json!({ "ok": true }));
    assert!(h.resend.calls().is_empty());

    let r = h.public("POST", "/api/subscribe", Some(json!({ "email": " Someone@Example.com " }))).await;
    assert_eq!((r.status, r.json()), (StatusCode::OK, json!({ "ok": true })));
    let call = h.resend.calls().pop().unwrap();
    assert_eq!((call.method.as_str(), call.path.as_str()), ("POST", "/emails"));
    assert_eq!(call.headers[header::AUTHORIZATION], format!("Bearer {RESEND_KEY}"));
    let slot = chrono::Utc::now().timestamp_millis() / 3_600_000;
    assert_eq!(
        call.headers["idempotency-key"],
        format!("subscribe-confirm/{}/{slot}", subscribe::hash_email("someone@example.com"))
    );
    assert_eq!(call.body["to"], json!(["someone@example.com"]));
    assert_eq!(call.body["from"], "Photos by Vedant Modi <photos@photos.example>");
    assert_eq!(call.body["subject"], "Confirm your subscription to Photos by Vedant Modi");
    let text = call.body["text"].as_str().unwrap();
    let link = text
        .lines()
        .find(|l| l.starts_with("Confirm subscription "))
        .unwrap()
        .trim_start_matches("Confirm subscription ");
    assert!(link.starts_with("https://photos.test/subscribe/confirm?token="), "{link}");
    let token = url::Url::parse(link).unwrap().query_pairs().find(|(k, _)| k == "token").unwrap().1.into_owned();
    assert!(
        call.body["html"]
            .as_str()
            .unwrap()
            .contains(&format!("token={}", photo_maps_backend::js::encode_uri_component(&token)))
    );

    // The link checks out and confirming adds the contact to the segment.
    let r = h
        .public(
            "GET",
            &format!("/api/subscribe/confirm?token={}", photo_maps_backend::js::encode_uri_component(&token)),
            None,
        )
        .await;
    assert_eq!(r.json(), json!({ "valid": true }));
    assert_eq!(h.public("GET", "/api/subscribe/confirm?token=nope", None).await.json(), json!({ "valid": false }));
    assert_eq!(h.public("GET", "/api/subscribe/confirm", None).await.json(), json!({ "valid": false }));

    h.resend.reply("GET /contacts/", 404, json!({ "name": "not_found", "message": "Contact not found" }));
    let r = h.public("POST", "/api/subscribe/confirm", Some(json!({ "token": token }))).await;
    assert_eq!(r.json(), json!({ "status": "confirmed" }));
    let create = h.resend.calls().pop().unwrap();
    assert_eq!((create.method.as_str(), create.path.as_str()), ("POST", "/contacts"));
    assert_eq!(
        create.body,
        json!({ "unsubscribed": false, "email": "someone@example.com", "segments": [{ "id": "seg_1" }] })
    );

    // An existing contact is resubscribed; "already in segment" is fine.
    h.resend.reply("GET /contacts/", 200, json!({ "id": "c1", "email": "someone@example.com" }));
    h.resend.reply(
        "POST /contacts/someone@example.com/segments/seg_1",
        422,
        json!({ "name": "validation_error", "message": "Contact is already in segment" }),
    );
    let before = h.resend.calls().len();
    assert_eq!(
        h.public("POST", "/api/subscribe/confirm", Some(json!({ "token": token }))).await.json(),
        json!({ "status": "confirmed" })
    );
    let calls = &h.resend.calls()[before..];
    let routes: Vec<String> = calls.iter().map(|c| format!("{} {}", c.method, c.path)).collect();
    assert_eq!(
        routes,
        [
            "GET /contacts/someone@example.com",
            "PATCH /contacts/someone@example.com",
            "POST /contacts/someone@example.com/segments/seg_1"
        ]
    );
    assert_eq!(calls[1].body, json!({ "unsubscribed": false }));

    h.resend.reply("PATCH /contacts/", 500, json!({ "name": "internal", "message": "boom" }));
    assert_eq!(
        h.public("POST", "/api/subscribe/confirm", Some(json!({ "token": token }))).await.json(),
        json!({ "status": "error" })
    );
    assert_eq!(
        h.public("POST", "/api/subscribe/confirm", Some(json!({ "token": "x.y" }))).await.json(),
        json!({ "status": "invalid" })
    );

    // A repeat inside the hour is reported, not resent.
    h.resend.reply("POST /emails", 409, json!({ "statusCode": 409, "name": "invalid_idempotent_request", "message": "Same idempotency key used with a different request payload." }));
    let r = h.public("POST", "/api/subscribe", Some(json!({ "email": "someone@example.com" }))).await;
    assert_eq!(r.json(), json!({ "ok": true, "alreadySent": true }));
    h.resend.reply("POST /emails", 500, json!({ "name": "application_error", "message": "down" }));
    let r = h.public("POST", "/api/subscribe", Some(json!({ "email": "someone@example.com" }))).await;
    assert_eq!(
        (r.status, r.json()),
        (StatusCode::BAD_GATEWAY, json!({ "error": "Couldn't send the confirmation email, try again later" }))
    );
}

#[tokio::test]
async fn weekly_digest() {
    let h = harness!();
    let bearer = |s: &str| format!("Bearer {s}");
    for auth in [None, Some(bearer("wrong")), Some(bearer("undefined"))] {
        let r = h.request("GET", "/api/cron/digest", auth, None).await;
        assert_eq!((r.status, r.json()), (StatusCode::UNAUTHORIZED, json!({ "error": "Unauthorized" })));
    }
    let cron = || Some(bearer(CRON_SECRET));
    assert_eq!(
        h.request("GET", "/api/cron/digest", cron(), None).await.json(),
        json!({ "sent": false, "reason": "no new photos" })
    );

    h.upload("exif_full.jpg", "one", json!({ "caption": "One" })).await;
    h.upload("base.jpg", "two", json!({})).await;
    sqlx::query("UPDATE photos SET created_at = now() - interval '1 hour' WHERE friendly_name = 'one'")
        .execute(&h.db)
        .await
        .unwrap();
    h.settle().await;

    h.resend.reply("POST /broadcasts", 200, json!({ "id": "b_123" }));
    h.resend.reply("POST /broadcasts/b_123/send", 200, json!({ "id": "b_123" }));
    let r = h.request("GET", "/api/cron/digest", cron(), None).await;
    assert_eq!(r.json(), json!({ "sent": true, "broadcast": "b_123", "photos": 2 }));
    let calls = h.resend.calls();
    let create = calls.iter().find(|c| c.path == "/broadcasts").unwrap();
    assert_eq!(create.body["segment_id"], "seg_1");
    assert_eq!(create.body["subject"], "2 new photos on the map");
    assert_eq!(create.body["name"], format!("Weekly digest {}", chrono::Utc::now().format("%Y-%m-%d")));
    let html = create.body["html"].as_str().unwrap();
    // Newest first: the hero is "two", from its large rendition; "one" is a thumbnail.
    assert!(html.contains(r#"src="https://img.example/two_large.jpg""#));
    assert!(html.contains(r#"src="https://img.example/one_thumb.jpg""#));
    assert!(html.contains("{{{RESEND_UNSUBSCRIBE_URL}}}"));
    assert!(create.body["text"].as_str().unwrap().contains("https://photos.test/p/one"));

    // Nobody subscribed: the draft is removed and it is a quiet week.
    h.resend.reply(
        "POST /broadcasts/b_123/send",
        422,
        json!({ "name": "validation_error", "message": "No contacts found in segment" }),
    );
    assert_eq!(
        h.request("GET", "/api/cron/digest", cron(), None).await.json(),
        json!({ "sent": false, "reason": "no subscribers" })
    );
    assert!(h.resend.calls().iter().any(|c| c.method == Method::DELETE && c.path == "/broadcasts/b_123"));

    h.resend.reply("POST /broadcasts/b_123/send", 500, json!({ "name": "application_error", "message": "send broke" }));
    let r = h.request("GET", "/api/cron/digest", cron(), None).await;
    assert_eq!((r.status, r.json()), (StatusCode::BAD_GATEWAY, json!({ "error": "send broke" })));
    h.resend.reply("POST /broadcasts", 422, json!({ "name": "validation_error", "message": "bad from" }));
    let r = h.request("GET", "/api/cron/digest", cron(), None).await;
    assert_eq!((r.status, r.json()), (StatusCode::BAD_GATEWAY, json!({ "error": "bad from" })));
}

#[tokio::test]
async fn cache_purge() {
    let h = harness!();
    let r = h.admin("DELETE", "/api/admin/cache", None).await;
    assert_eq!((r.status, r.json()), (StatusCode::OK, json!({ "ok": true })));
    let call = h.cloudflare.calls().pop().unwrap();
    assert_eq!(call.headers[header::AUTHORIZATION], "Bearer cf-token");
    assert_eq!(call.body, json!({ "hosts": ["img.example"] }));

    h.cloudflare.reply(
        "POST /zones/zone1/purge_cache",
        403,
        json!({ "success": false, "errors": [{ "message": "Authentication error" }] }),
    );
    let r = h.admin("DELETE", "/api/admin/cache", None).await;
    assert_eq!(
        (r.status, r.json()),
        (StatusCode::BAD_GATEWAY, json!({ "error": "Cloudflare purge failed: Authentication error" }))
    );
}

#[tokio::test]
async fn migrations_are_idempotent() {
    let h = harness!();
    // Running the baseline again (as on the existing production database) is a no-op.
    MIGRATOR.run(&h.db).await.unwrap();
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM places").fetch_one(&h.db).await.unwrap();
    assert_eq!(n, 1);
}
