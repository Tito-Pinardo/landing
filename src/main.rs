//! Servidor de titopinardogutierrez.com.

mod aitrap;
mod app;
#[cfg(test)]
mod app_tests;
mod article;
mod config;
mod contact;
mod content;
mod live;
mod minify;
mod notify;
mod render;
mod security;
mod unit;

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
    // `landing dump-assets <dir>` escribe el CSS y el JS tal como se sirven
    // (minificados), para comprobarlos con `node --check` (lo usa CI).
    if std::env::args().nth(1).as_deref() == Some("dump-assets") {
        let dir = std::path::PathBuf::from(std::env::args().nth(2).context("falta el directorio")?);
        std::fs::create_dir_all(&dir)?;
        for (name, body, _) in app::minified_assets() {
            std::fs::write(dir.join(&name), &body)?;
        }
        println!("escrito en {}", dir.display());
        return Ok(());
    }
    // `landing dump-site <dir>` escribe la portada (es y en) y `static/` tal
    // como se sirven, para probarla sin base de datos (banco de pruebas de
    // experiencia, tools/ux). Los formularios no funcionan ahí.
    if std::env::args().nth(1).as_deref() == Some("dump-site") {
        let dir = std::path::PathBuf::from(std::env::args().nth(2).context("falta el directorio")?);
        let c = content::Content::embedded()?;
        for (lang, code) in [(content::Lang::Es, "es"), (content::Lang::En, "en")] {
            let page = render::index(&c, lang, "dev", "http://127.0.0.1:8099", None, "banco")?;
            std::fs::create_dir_all(dir.join(code))?;
            std::fs::write(dir.join(code).join("index.html"), &page.body)?;
        }
        for (name, body) in app::served_assets() {
            let path = dir.join("static").join(&name);
            if let Some(p) = path.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::fs::write(path, &body)?;
        }
        println!("escrito en {}", dir.display());
        return Ok(());
    }
    // `landing check-article <fichero>` valida un borrador de artículo (el
    // resumen semanal) sin tener que recompilar la web.
    if std::env::args().nth(1).as_deref() == Some("check-article") {
        let path = std::env::args().nth(2).context("falta el fichero")?;
        let src = std::fs::read_to_string(&path).with_context(|| path.clone())?;
        let a = content::Content::embedded()?.check_article(&src)?;
        println!("artículo válido: {}", a.slug);
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
