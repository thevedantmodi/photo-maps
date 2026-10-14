//! The slice of the Resend API the app uses, with the same requests and error shapes as
//! the `resend` Node SDK (v6) the TypeScript backend called.

use reqwest::{Client, Method};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::config::ResendConfig;

/// A failed call, normalized the way the SDK does: the API's own `{ name, message }` body
/// when it sent one, else a synthetic `application_error`.
#[derive(Debug, Clone)]
pub struct ResendError {
    pub name: String,
    pub message: String,
    pub status: Option<u16>,
}

impl std::fmt::Display for ResendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.name, self.message)
    }
}

impl std::error::Error for ResendError {}

pub type ResendResult<T = Value> = Result<T, ResendError>;

#[derive(Clone)]
pub struct Resend {
    http: Client,
    cfg: ResendConfig,
}

#[derive(Deserialize)]
struct Created {
    id: String,
}

impl Resend {
    pub fn new(http: Client, cfg: ResendConfig) -> Self {
        Resend { http, cfg }
    }

    pub fn config(&self) -> &ResendConfig {
        &self.cfg
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        idempotency_key: Option<&str>,
    ) -> ResendResult {
        let unreachable = || ResendError {
            name: "application_error".into(),
            message: "Unable to fetch data. The request could not be resolved.".into(),
            status: None,
        };
        // Path segments (contact emails) are interpolated unescaped, as the SDK does; the URL
        // parser percent-encodes whatever must be.
        let url = format!("{}{}", self.cfg.api_base, path);
        let mut req =
            self.http.request(method, &url).bearer_auth(&self.cfg.api_key).header("Content-Type", "application/json");
        if let Some(key) = idempotency_key {
            req = req.header("Idempotency-Key", key);
        }
        if let Some(body) = body {
            req = req.body(body.to_string());
        }
        let res = req.send().await.map_err(|_| unreachable())?;
        let status = res.status();
        let text = res.text().await.map_err(|_| unreachable())?;

        if !status.is_success() {
            return Err(match serde_json::from_str::<Value>(&text) {
                Ok(v) => ResendError {
                    name: v.get("name").and_then(Value::as_str).unwrap_or("undefined").to_owned(),
                    message: v.get("message").and_then(Value::as_str).unwrap_or("undefined").to_owned(),
                    status: Some(status.as_u16()),
                },
                Err(_) => ResendError {
                    name: "application_error".into(),
                    message: "Internal server error. We are unable to process your request right now, please try again later.".into(),
                    status: Some(status.as_u16()),
                },
            });
        }
        serde_json::from_str(&text).map_err(|_| unreachable())
    }

    /// `emails.send`. The idempotency key makes a repeat inside Resend's window a no-op
    /// answered with 409.
    pub async fn send_email(
        &self,
        to: &str,
        subject: &str,
        html: &str,
        text: &str,
        idempotency_key: &str,
    ) -> ResendResult {
        let body = json!({
            "from": self.cfg.from_address(),
            "html": html,
            "subject": subject,
            "text": text,
            "to": [to],
        });
        self.request(Method::POST, "/emails", Some(body), Some(idempotency_key)).await
    }

    /// `contacts.get({ email })`.
    pub async fn get_contact(&self, email: &str) -> ResendResult {
        self.request(Method::GET, &format!("/contacts/{email}"), None, None).await
    }

    pub async fn create_contact(&self, email: &str, segment_id: &str) -> ResendResult {
        let body = json!({ "unsubscribed": false, "email": email, "segments": [{ "id": segment_id }] });
        self.request(Method::POST, "/contacts", Some(body), None).await
    }

    pub async fn resubscribe_contact(&self, email: &str) -> ResendResult {
        self.request(Method::PATCH, &format!("/contacts/{email}"), Some(json!({ "unsubscribed": false })), None).await
    }

    pub async fn add_contact_to_segment(&self, email: &str, segment_id: &str) -> ResendResult {
        self.request(Method::POST, &format!("/contacts/{email}/segments/{segment_id}"), None, None).await
    }

    /// `broadcasts.create` without `send`, so a failed send can be cleaned up.
    pub async fn create_broadcast(
        &self,
        name: &str,
        segment_id: &str,
        subject: &str,
        html: &str,
        text: &str,
    ) -> ResendResult<String> {
        let body = json!({
            "name": name,
            "segment_id": segment_id,
            "from": self.cfg.from_address(),
            "html": html,
            "subject": subject,
            "text": text,
        });
        let v = self.request(Method::POST, "/broadcasts", Some(body), None).await?;
        serde_json::from_value::<Created>(v).map(|c| c.id).map_err(|_| ResendError {
            name: "application_error".into(),
            message: "create failed".into(),
            status: None,
        })
    }

    pub async fn send_broadcast(&self, id: &str) -> ResendResult {
        self.request(Method::POST, &format!("/broadcasts/{id}/send"), Some(json!({})), None).await
    }

    pub async fn remove_broadcast(&self, id: &str) -> ResendResult {
        self.request(Method::DELETE, &format!("/broadcasts/{id}"), None, None).await
    }

    /// Add a confirmed address to the subscriber segment. Safe to call twice: an existing
    /// contact (including one who unsubscribed and has now opted in again) is resubscribed.
    pub async fn add_subscriber(&self, email: &str) -> anyhow::Result<()> {
        let segment = self.cfg.segment_id.as_deref().ok_or_else(|| anyhow::anyhow!("RESEND_SEGMENT_ID is not set"))?;

        // Any failed lookup reads as "no such contact", as it did with the SDK; a real
        // outage then surfaces from the create call instead.
        if self.get_contact(email).await.is_err() {
            self.create_contact(email, segment).await.map_err(|e| anyhow::anyhow!("contacts.create: {}", e.message))?;
            return Ok(());
        }

        self.resubscribe_contact(email).await.map_err(|e| anyhow::anyhow!("contacts.update: {}", e.message))?;
        if let Err(e) = self.add_contact_to_segment(email, segment).await {
            // Already in the segment is fine; anything else is a real failure.
            if !e.message.to_lowercase().contains("already") {
                anyhow::bail!("contacts.segments.add: {}", e.message);
            }
        }
        Ok(())
    }
}
