use serde::{Deserialize, Serialize};
use worker::{event, Context, Env, HttpMetadata, Request, Response, Result, RouteContext, Router};

mod exif;
mod image_processor;
mod r2;

#[derive(Deserialize)]
struct ProcessRequest {
    key: String,
    friendly_name: String,
}

#[derive(Serialize)]
struct ProcessResponse {
    thumb_name: String,
    large_name: String,
    lat: Option<f64>,
    lon: Option<f64>,
    date: Option<String>,
    width: u32,
    height: u32,
}

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    Router::new()
        .post_async("/process", handle_process)
        .run(req, env)
        .await
}

async fn handle_process(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let secret = ctx.secret("PROCESSOR_SECRET")?.to_string();
    let provided = req.headers().get("x-processor-secret")?.unwrap_or_default();
    if provided != secret {
        return Response::error("unauthorized", 401);
    }

    let body: ProcessRequest = match req.json().await {
        Ok(b) => b,
        Err(_) => return Response::error("key and friendly_name required", 400),
    };

    let bucket = ctx.bucket("PHOTOS")?;

    let object = match r2::get_original(&bucket, &body.key).await {
        Ok(Some(obj)) => obj,
        Ok(None) => return Response::error(format!("object not found: {}", body.key), 400),
        Err(_) => return Response::error("failed to read original", 500),
    };

    let buf = match object.body() {
        Some(b) => match b.bytes().await {
            Ok(bytes) => bytes,
            Err(_) => return Response::error("failed to read original body", 500),
        },
        None => return Response::error("empty original body", 500),
    };
    worker::console_log!("[process] got original: {} bytes", buf.len());

    let img = match image::load_from_memory(&buf) {
        Ok(i) => i,
        Err(_) => return Response::error("failed to decode image", 400),
    };
    let (src_w, src_h) = (img.width(), img.height());

    let exif_data = exif::parse(&buf);
    let img = image_processor::apply_orientation(img, exif_data.orientation);

    worker::console_log!("[process] decoded {}x{}", src_w, src_h);

    let thumb_buf = image_processor::resize_and_encode(&img, 300, 300, 80);
    let large_buf = image_processor::resize_and_encode(&img, 1600, 1600, 85);

    worker::console_log!(
        "[process] thumb {} bytes, large {} bytes",
        thumb_buf.len(),
        large_buf.len()
    );

    let thumb_name = format!("{}_thumb.jpg", body.friendly_name);
    let large_name = format!("{}_large.jpg", body.friendly_name);

    let jpeg_meta = HttpMetadata {
        content_type: Some("image/jpeg".into()),
        ..Default::default()
    };

    if r2::put_variant(&bucket, &thumb_name, thumb_buf, jpeg_meta.clone())
        .await
        .is_err()
    {
        return Response::error("failed to upload thumb", 500);
    }
    if r2::put_variant(&bucket, &large_name, large_buf, jpeg_meta)
        .await
        .is_err()
    {
        return Response::error("failed to upload large", 500);
    }

    worker::console_log!("[process] uploaded variants");

    Response::from_json(&ProcessResponse {
        thumb_name,
        large_name,
        lat: exif_data.lat,
        lon: exif_data.lon,
        date: exif_data.date,
        width: src_w,
        height: src_h,
    })
}
