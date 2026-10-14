//! Double opt-in tokens and address handling for the email signup.
//!
//! Tokens are byte-compatible with the ones the TypeScript backend issued, so confirmation
//! links already sitting in inboxes keep working across the switch.

use base64::Engine as _;
use base64::engine::general_purpose::{URL_SAFE_NO_PAD, URL_SAFE_NO_PAD_INDIFFERENT};
use hmac::{Hmac, KeyInit, Mac};
use serde_json::Value;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::js;

pub const TOKEN_TTL_MS: i64 = 48 * 60 * 60 * 1000;

type HmacSha256 = Hmac<Sha256>;

/// Lowercased, trimmed address, or None if it doesn't look like one.
pub fn normalize_email(raw: &Value) -> Option<String> {
    let Value::String(s) = raw else { return None };
    let email = js::js_trim(s).to_lowercase();
    if js::utf16_len(&email) > 254 {
        return None;
    }
    looks_like_email(&email).then_some(email)
}

/// `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` with JavaScript's `\s`. The last dot is the one that
/// matters: the regex backtracks to find any dot with non-empty text on both sides.
fn looks_like_email(email: &str) -> bool {
    if email.chars().any(js::is_js_whitespace) {
        return false;
    }
    let mut parts = email.split('@');
    let (Some(local), Some(domain), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    if local.is_empty() {
        return false;
    }
    // Some dot in the domain with at least one character before and after it.
    domain.char_indices().any(|(i, c)| c == '.' && i > 0 && i + 1 < domain.len())
}

/// First 32 hex characters of the SHA-256 of the address; used in idempotency keys.
pub fn hash_email(email: &str) -> String {
    let digest = Sha256::digest(email.as_bytes());
    hex::encode(digest)[..32].to_owned()
}

/// Derived from the Resend API key so confirmation links need no extra secret.
fn signing_key(api_key: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(api_key.as_bytes()).expect("HMAC takes any key length");
    mac.update(b"subscribe-confirm-token");
    mac.finalize().into_bytes().to_vec()
}

fn sign(api_key: &str, payload: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(&signing_key(api_key)).expect("HMAC takes any key length");
    mac.update(payload.as_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

/// A stateless token: the address and an expiry, signed. Nothing is stored until the
/// link is confirmed, so an unconfirmed signup never becomes a contact.
pub fn create_confirm_token(api_key: &str, email: &str, now_ms: i64) -> String {
    // Same bytes as JSON.stringify({ e: email, x: now + TTL }).
    let json =
        serde_json::to_string(&serde_json::json!({ "e": email, "x": now_ms + TOKEN_TTL_MS })).expect("serializable");
    let payload = URL_SAFE_NO_PAD.encode(json.as_bytes());
    let sig = sign(api_key, &payload);
    format!("{payload}.{sig}")
}

/// The confirmed address, or None if the token is malformed, forged, or expired.
pub fn verify_confirm_token(api_key: &str, token: &str, now_ms: i64) -> Option<String> {
    // `token.split('.')` destructured into two: anything past a second dot is ignored.
    let mut parts = token.split('.');
    let payload = parts.next().filter(|p| !p.is_empty())?;
    let sig = parts.next().filter(|s| !s.is_empty())?;

    let expected = sign(api_key, payload);
    if expected.len() != sig.len() || !bool::from(expected.as_bytes().ct_eq(sig.as_bytes())) {
        return None;
    }

    let bytes = URL_SAFE_NO_PAD_INDIFFERENT.decode(payload).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    let x = value.get("x")?.as_f64()?;
    if x < now_ms as f64 {
        return None;
    }
    normalize_email(value.get("e")?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn email_normalization() {
        assert_eq!(normalize_email(&json!("  Foo@Example.COM ")).as_deref(), Some("foo@example.com"));
        assert_eq!(normalize_email(&json!("a@b.c")).as_deref(), Some("a@b.c"));
        // Cases checked against the TypeScript normalizeEmail.
        for (input, want) in [
            ("a@b.c.d", "a@b.c.d"),
            ("x@y.z\u{a0}", "x@y.z"),
            ("a@b..c", "a@b..c"),
            ("a@b.c.", "a@b.c."),
            ("a.@b.c", "a.@b.c"),
            ("ß@straße.de", "ß@straße.de"),
            ("ǅ@X.Y", "ǆ@x.y"),
            ("a@b.\u{85}c", "a@b.\u{85}c"),
        ] {
            assert_eq!(normalize_email(&json!(input)).as_deref(), Some(want), "{input:?}");
        }
        for bad in [
            json!("a@b"),
            json!("a@.c"),
            json!("a@b."),
            json!("@b.c"),
            json!("a b@c.d"),
            json!("a@b@c.d"),
            json!("a@b.c\u{a0}x"),
            json!(42),
            json!(null),
        ] {
            assert_eq!(normalize_email(&bad), None, "{bad}");
        }
        let long = format!("{}@example.com", "a".repeat(243));
        assert_eq!(js::utf16_len(&long), 255);
        assert_eq!(normalize_email(&json!(long)), None);
    }

    #[test]
    fn round_trip_and_expiry() {
        let t = create_confirm_token("re_key", "a@b.co", 1_000);
        assert_eq!(verify_confirm_token("re_key", &t, 1_000).as_deref(), Some("a@b.co"));
        assert_eq!(verify_confirm_token("re_key", &t, 1_000 + TOKEN_TTL_MS).as_deref(), Some("a@b.co"));
        assert_eq!(verify_confirm_token("re_key", &t, 1_001 + TOKEN_TTL_MS), None);
        assert_eq!(verify_confirm_token("other", &t, 1_000), None);
        assert_eq!(verify_confirm_token("re_key", &format!("{t}x"), 1_000), None);
        assert_eq!(verify_confirm_token("re_key", "", 1_000), None);
        assert_eq!(verify_confirm_token("re_key", "abc", 1_000), None);
        assert_eq!(verify_confirm_token("re_key", &format!("{t}.extra"), 1_000).as_deref(), Some("a@b.co"));
    }

    /// Token and hash produced by the TypeScript implementation (`src/lib/subscribe.ts`)
    /// with RESEND_API_KEY=re_test_key at Date.now() = 1760000000000.
    #[test]
    fn compatible_with_typescript_tokens() {
        let ts_token =
            "eyJlIjoic29tZW9uZUBleGFtcGxlLmNvbSIsIngiOjE3NjAxNzI4MDAwMDB9.5qiL3hHhmhELvdS1aVOcnj8B7R9u0xSw1IdxPmZqBBI";
        assert_eq!(create_confirm_token("re_test_key", "someone@example.com", 1_760_000_000_000), ts_token);
        assert_eq!(
            verify_confirm_token("re_test_key", ts_token, 1_760_000_000_000).as_deref(),
            Some("someone@example.com")
        );
        assert_eq!(hash_email("someone@example.com"), "72497f475e4f76d0b28f57c73a084ece");
    }
}
