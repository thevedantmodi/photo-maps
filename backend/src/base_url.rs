//! The origin share-card QR codes, emails and feeds should point at.
//!
//! Preview deployments and tunnels each get a different hostname, so the incoming request
//! is the best guide. Production is the exception: there `NEXT_PUBLIC_BASE_URL` wins, so a
//! request that reached this service through some other hostname still advertises the
//! canonical domain.
//!
//! Deriving from Host means a spoofed header changes what that one response contains; it is
//! not a route to poisoning anyone else's card.

use axum::http::HeaderMap;

use crate::config::BaseUrlConfig;

fn header<'a>(h: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let v = h.get(name)?.to_str().ok()?;
    // Chained proxies append: "client-facing, next-hop". The first entry is the original.
    let first = v.split(',').next()?.trim();
    (!first.is_empty()).then_some(first)
}

fn from_host(h: &HeaderMap) -> Option<String> {
    let host = header(h, "x-forwarded-host").or_else(|| header(h, "host"))?;
    let proto = header(h, "x-forwarded-proto").unwrap_or(if host.starts_with("localhost") { "http" } else { "https" });
    Some(format!("{proto}://{host}"))
}

pub fn resolve(cfg: &BaseUrlConfig, headers: &HeaderMap) -> String {
    if let (Some(explicit), true) = (&cfg.explicit, cfg.production) {
        return explicit.clone();
    }
    if let Some(derived) = from_host(headers) {
        return derived;
    }
    if let Some(v) = &cfg.vercel_url {
        return format!("https://{v}");
    }
    cfg.explicit.clone().unwrap_or_else(|| "http://localhost:3000".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(*k, v.parse().unwrap());
        }
        h
    }

    #[test]
    fn precedence() {
        let prod =
            BaseUrlConfig { explicit: Some("https://photos.example".into()), production: true, vercel_url: None };
        let preview = BaseUrlConfig { production: false, ..prod.clone() };
        let h = headers(&[("host", "preview.example")]);

        assert_eq!(resolve(&prod, &h), "https://photos.example");
        assert_eq!(resolve(&preview, &h), "https://preview.example");
        assert_eq!(resolve(&preview, &HeaderMap::new()), "https://photos.example");
        assert_eq!(resolve(&BaseUrlConfig::default(), &HeaderMap::new()), "http://localhost:3000");
        assert_eq!(
            resolve(
                &BaseUrlConfig { vercel_url: Some("x.vercel.app".into()), ..Default::default() },
                &HeaderMap::new()
            ),
            "https://x.vercel.app"
        );
    }

    #[test]
    fn forwarded_headers() {
        let cfg = BaseUrlConfig::default();
        assert_eq!(resolve(&cfg, &headers(&[("host", "localhost:3000")])), "http://localhost:3000");
        assert_eq!(
            resolve(
                &cfg,
                &headers(&[
                    ("host", "backend.internal"),
                    ("x-forwarded-host", "photos.example"),
                    ("x-forwarded-proto", "https")
                ])
            ),
            "https://photos.example"
        );
        assert_eq!(
            resolve(
                &cfg,
                &headers(&[("x-forwarded-host", "a.example, b.example"), ("x-forwarded-proto", "http, https")])
            ),
            "http://a.example"
        );
    }
}
