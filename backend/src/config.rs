//! Settings, read from the same environment variables the Next.js backend used so one
//! `.env` serves both the frontend and this service.

use anyhow::{Context, Result, bail};

#[derive(Clone, Debug)]
pub struct Config {
    /// Postgres connection string. `DATABASE_URL_UNPOOLED` is preferred when set: this is a
    /// long-lived process with its own pool, so it does not need Neon's PgBouncer in front.
    pub database_url: String,
    pub r2: R2Config,
    /// `NEXT_PUBLIC_R2_PUBLIC_URL`: public base URL of the bucket, without a trailing slash.
    pub r2_public_url: String,
    pub admin: Option<AdminCredentials>,
    pub cloudflare: Option<CloudflareConfig>,
    pub resend: Option<ResendConfig>,
    /// Bearer token the weekly digest cron must present. Unset means the route is closed.
    pub cron_secret: Option<String>,
    pub base_url: BaseUrlConfig,
}

#[derive(Clone, Debug)]
pub struct R2Config {
    pub endpoint: String,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    /// Path-style addressing (`endpoint/bucket/key`) instead of virtual-hosted. R2 takes
    /// either; local S3 stand-ins such as MinIO usually need this. `R2_FORCE_PATH_STYLE=1`.
    pub force_path_style: bool,
}

#[derive(Clone)]
pub struct AdminCredentials {
    pub user: String,
    pub pass: String,
}

impl std::fmt::Debug for AdminCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AdminCredentials").field("user", &self.user).finish_non_exhaustive()
    }
}

#[derive(Clone, Debug)]
pub struct CloudflareConfig {
    pub zone_id: String,
    pub api_token: String,
    pub api_base: String,
}

#[derive(Clone, Debug)]
pub struct ResendConfig {
    pub api_key: String,
    /// `RESEND_EMAIL_DOMAIN`: the verified sending domain.
    pub email_domain: String,
    /// `RESEND_SEGMENT_ID`: segment confirmed subscribers join; checked where it is used.
    pub segment_id: Option<String>,
    pub api_base: String,
}

impl ResendConfig {
    pub fn from_address(&self) -> String {
        format!("Photos by Vedant Modi <photos@{}>", self.email_domain)
    }
}

/// Inputs to `base_url::resolve`; see there for the precedence.
#[derive(Clone, Debug, Default)]
pub struct BaseUrlConfig {
    /// `NEXT_PUBLIC_BASE_URL`, trailing slash removed.
    pub explicit: Option<String>,
    /// True when `APP_ENV` (or, for compatibility, `VERCEL_ENV`) is `production`.
    pub production: bool,
    /// `VERCEL_URL`, a last resort when a request carries no Host.
    pub vercel_url: Option<String>,
}

fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn required(name: &str) -> Result<String> {
    var(name).with_context(|| format!("{name} must be set"))
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let database_url = var("DATABASE_URL_UNPOOLED")
            .or_else(|| var("DATABASE_URL"))
            .context("DATABASE_URL (or DATABASE_URL_UNPOOLED) must be set")?;

        let r2 = R2Config {
            endpoint: required("R2_ENDPOINT")?,
            bucket: required("R2_BUCKET")?,
            access_key_id: required("R2_ACCESS_KEY_ID")?,
            secret_access_key: required("R2_SECRET_ACCESS_KEY")?,
            force_path_style: matches!(var("R2_FORCE_PATH_STYLE").as_deref(), Some("1" | "true")),
        };
        let r2_public_url = required("NEXT_PUBLIC_R2_PUBLIC_URL")?;
        if url::Url::parse(&r2_public_url).is_err() {
            bail!("NEXT_PUBLIC_R2_PUBLIC_URL must be an absolute URL");
        }

        let admin = match (var("ADMIN_USER"), var("ADMIN_PASS")) {
            (Some(user), Some(pass)) => Some(AdminCredentials { user, pass }),
            _ => None,
        };

        let cloudflare = match (var("CLOUDFLARE_ZONE_ID"), var("CLOUDFLARE_API_TOKEN")) {
            (Some(zone_id), Some(api_token)) => {
                Some(CloudflareConfig { zone_id, api_token, api_base: "https://api.cloudflare.com/client/v4".into() })
            }
            _ => None,
        };

        let resend = match (var("RESEND_API_KEY"), var("RESEND_EMAIL_DOMAIN")) {
            (Some(api_key), Some(email_domain)) => Some(ResendConfig {
                api_key,
                email_domain,
                segment_id: var("RESEND_SEGMENT_ID"),
                api_base: var("RESEND_BASE_URL").unwrap_or_else(|| "https://api.resend.com".into()),
            }),
            _ => None,
        };

        let env = var("APP_ENV").or_else(|| var("VERCEL_ENV"));
        let base_url = BaseUrlConfig {
            explicit: var("NEXT_PUBLIC_BASE_URL").map(|u| u.trim_end_matches('/').to_owned()),
            production: env.as_deref() == Some("production"),
            vercel_url: var("VERCEL_URL"),
        };

        Ok(Config {
            database_url,
            r2,
            r2_public_url: r2_public_url.trim_end_matches('/').to_owned(),
            admin,
            cloudflare,
            resend,
            cron_secret: var("CRON_SECRET"),
            base_url,
        })
    }

    /// `getPublicUrl`: where a bucket key is served from.
    pub fn public_url(&self, key: &str) -> String {
        format!("{}/{}", self.r2_public_url, key)
    }
}
