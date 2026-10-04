//! Servidor de titopinardogutierrez.com.

mod app;
#[cfg(test)]
mod app_tests;
mod config;
mod contact;
mod content;
mod live;
mod notify;
mod render;
mod security;

use std::{net::SocketAddr, sync::Arc, time::Duration};

use anyhow::Context;
use sqlx::postgres::PgPoolOptions;
use tokio::sync::Notify;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=warn,sqlx=warn".into()),
        )
        .json()
        .init();

    // `landing check` valida el contenido sin arrancar (lo usa CI).
    if std::env::args().nth(1).as_deref() == Some("check") {
        content::Content::embedded()?;
        println!("contenido válido");
        return Ok(());
    }

    let cfg = config::Config::from_env()?;
    tracing::info!(bind = %cfg.bind, matrix = cfg.matrix.is_some(), turnstile = cfg.turnstile.is_some(), "arrancando");

    let db = PgPoolOptions::new()
        .max_connections(cfg.db_max_connections)
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(3))
        .idle_timeout(Duration::from_secs(600))
        .connect(&cfg.database_url)
        .await
        .context("conectando a PostgreSQL")?;
    sqlx::migrate!().run(&db).await.context("migraciones")?;

    let http = reqwest::Client::builder()
        // Un User-Agent propio: el proxy de Matrix rechaza los genéricos.
        .user_agent(concat!(
            "titopinardogutierrez.com/",
            env!("CARGO_PKG_VERSION")
        ))
        .timeout(Duration::from_secs(10))
        .build()?;

    let live = live::Live::default();
    if let Some(user) = cfg.github_user.clone() {
        live.spawn_github(http.clone(), user);
    }
    if let Some(path) = cfg.homelab_status_file.clone() {
        live.spawn_homelab(path);
    }

    let wake = Arc::new(Notify::new());
    if let Some(matrix) = cfg.matrix.clone() {
        tokio::spawn(notify::run(db.clone(), http.clone(), matrix, wake.clone()));
    } else {
        tracing::warn!("Matrix sin configurar: los mensajes se guardan pero no se avisan");
    }

    // Purga diaria de mensajes antiguos.
    {
        let db = db.clone();
        tokio::spawn(async move {
            loop {
                match contact::purge_old(&db).await {
                    Ok(0) => {}
                    Ok(n) => tracing::info!(borrados = n, "mensajes antiguos purgados"),
                    Err(e) => tracing::error!(error = %e, "fallo purgando mensajes"),
                }
                tokio::time::sleep(Duration::from_secs(24 * 3600)).await;
            }
        });
    }

    let bind = cfg.bind;
    let state = app::AppState::new(cfg, db, http, live, wake)?;
    let router = app::router(state);
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .with_context(|| format!("escuchando en {bind}"))?;
    tracing::info!(%bind, "listo");
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown())
    .await?;
    tracing::info!("parado");
    Ok(())
}

async fn shutdown() {
    let ctrl_c = async { tokio::signal::ctrl_c().await.ok() };
    let term = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM")
            .recv()
            .await
    };
    tokio::select! {
        _ = ctrl_c => {}
        _ = term => {}
    }
}
