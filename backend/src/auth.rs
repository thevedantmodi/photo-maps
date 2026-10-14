//! HTTP Basic Auth for the admin API, as `src/proxy.ts` did for the Next.js routes.
//!
//! The frontend still guards `/admin` pages itself; this service checks again because it
//! can be reached directly, not only through the frontend's rewrites.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use subtle::ConstantTimeEq;

use crate::config::AdminCredentials;
use crate::state::AppState;

pub async fn require_admin(State(state): State<Arc<AppState>>, req: Request, next: Next) -> Response {
    let ok = state.config.admin.as_ref().is_some_and(|creds| {
        req.headers().get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).is_some_and(|v| check(creds, v))
    });
    if ok {
        return next.run(req).await;
    }
    (StatusCode::UNAUTHORIZED, [(header::WWW_AUTHENTICATE, "Basic realm=\"Admin\"")], "Unauthorized").into_response()
}

fn check(creds: &AdminCredentials, authorization: &str) -> bool {
    let Some((scheme, encoded)) = authorization.split_once(' ') else { return false };
    if !scheme.eq_ignore_ascii_case("basic") {
        return false;
    }
    let Ok(decoded) = STANDARD.decode(encoded.trim()) else { return false };
    let Ok(decoded) = String::from_utf8(decoded) else { return false };
    let Some((user, pass)) = decoded.split_once(':') else { return false };
    // Both compared in full, so timing says nothing about which half was wrong.
    let user_ok = user.as_bytes().ct_eq(creds.user.as_bytes());
    let pass_ok = pass.as_bytes().ct_eq(creds.pass.as_bytes());
    bool::from(user_ok & pass_ok)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn creds() -> AdminCredentials {
        AdminCredentials { user: "admin".into(), pass: "s3cret".into() }
    }

    fn basic(s: &str) -> String {
        format!("Basic {}", STANDARD.encode(s))
    }

    #[test]
    fn accepts_only_exact_credentials() {
        assert!(check(&creds(), &basic("admin:s3cret")));
        assert!(check(&creds(), &basic("admin:s3cret").replace("Basic", "basic")));
        assert!(!check(&creds(), &basic("admin:wrong")));
        assert!(!check(&creds(), &basic("Admin:s3cret")));
        assert!(!check(&creds(), &basic("admin:s3cret:extra")));
        assert!(!check(&creds(), &basic("admin")));
        assert!(!check(&creds(), "Basic !!!"));
        assert!(!check(&creds(), "Bearer abc"));
        assert!(!check(&creds(), ""));
    }

    #[test]
    fn password_may_contain_colons() {
        let c = AdminCredentials { user: "u".into(), pass: "a:b".into() };
        assert!(check(&c, &basic("u:a:b")));
    }
}
