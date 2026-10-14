use std::net::SocketAddr;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use photo_maps_backend::config::Config;
use photo_maps_backend::state::{AppState, connect_lazy};
use photo_maps_backend::{MIGRATOR, routes};
use tracing_subscriber::EnvFilter;

/// How long background work (share card renders) gets to finish on shutdown.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(25);

const USAGE: &str = "usage: photo-maps-backend [serve|migrate]

  serve     run the HTTP API (default). Listens on $BIND:$PORT, default 0.0.0.0:8080.
  migrate   apply database migrations and exit.";

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,tower_http=info")))
        .init();

    match std::env::args().nth(1).as_deref() {
        None | Some("serve") => serve().await,
        Some("migrate") => migrate().await,
        Some("-h" | "--help" | "help") => {
            println!("{USAGE}");
            Ok(())
        }
        Some(other) => bail!("unknown command {other:?}\n\n{USAGE}"),
    }
}

async fn migrate() -> Result<()> {
    let config = Config::from_env()?;
    let pool = connect_lazy(&config.database_url)?;
    MIGRATOR.run(&pool).await.context("migrations failed")?;
    tracing::info!("migrations applied");
    Ok(())
}

async fn serve() -> Result<()> {
    let config = Config::from_env()?;
    if config.admin.is_none() {
        tracing::warn!("ADMIN_USER/ADMIN_PASS not set: the admin API will refuse every request");
    }
    let pool = connect_lazy(&config.database_url)?;
    let state = AppState::new(config, pool)?;
    let tasks = state.tasks.clone();
    let app = routes::router(state);

    let bind = std::env::var("BIND").unwrap_or_else(|_| "0.0.0.0".into());
    let port: u16 = std::env::var("PORT").ok().map(|p| p.parse()).transpose().context("PORT")?.unwrap_or(8080);
    let addr: SocketAddr = format!("{bind}:{port}").parse().context("BIND/PORT")?;
    let listener = tokio::net::TcpListener::bind(addr).await.with_context(|| format!("bind {addr}"))?;
    tracing::info!("listening on http://{addr}");

    axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await?;

    tasks.close();
    if tokio::time::timeout(SHUTDOWN_GRACE, tasks.wait()).await.is_err() {
        tracing::warn!("shutting down with {} background task(s) unfinished", tasks.len());
    }
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutting down");
}
