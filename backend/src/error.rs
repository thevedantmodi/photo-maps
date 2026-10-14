use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// An error answered as `{ "error": message }`, the shape every route and the admin UI use.
#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self { status, message: message.into() }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    pub fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, "Not found")
    }

    /// Logs the cause and answers 500 with it, as the old routes did with `String(e)`.
    pub fn internal(context: &str, err: impl std::fmt::Display) -> Self {
        tracing::error!("[{context}] {err:#}");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, format!("Error: {err:#}"))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

/// Database failures in admin routes are unexpected and surface as 500s.
impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        ApiError::internal("db", e)
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
