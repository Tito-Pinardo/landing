//! Configuración por variables de entorno (las rellena Ansible en producción).

use std::{net::SocketAddr, path::PathBuf};

use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: SocketAddr,
    pub database_url: String,
    /// Conexiones máximas del pool. Pocas: cada una es un proceso de
    /// PostgreSQL y el trabajo real de la BD es mínimo.
    pub db_max_connections: u32,
    /// Sal secreta para el hash de la IP del límite de envíos.
    pub ip_hash_salt: String,
    /// Fiarse de `CF-Connecting-IP`. Solo es seguro si al servidor únicamente
    /// le llega tráfico a través de Traefik y Cloudflare (lo garantiza el
    /// cortafuegos del CT).
    pub trust_proxy_headers: bool,
    pub public_url: String,
    pub turnstile: Option<Turnstile>,
    pub matrix: Option<Matrix>,
    pub github_user: Option<String>,
    pub homelab_status_file: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub struct Turnstile {
    pub site_key: String,
    pub secret: String,
}

#[derive(Clone)]
pub struct Matrix {
    pub homeserver: String,
    pub access_token: String,
    pub room_id: String,
}

impl std::fmt::Debug for Matrix {
    // A mano para que el token no acabe nunca en un log.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Matrix")
            .field("homeserver", &self.homeserver)
            .field("room_id", &self.room_id)
            .finish_non_exhaustive()
    }
}

impl Config {
    pub fn from_env() -> Result<Config> {
        let bind = var("BIND_ADDR")
            .unwrap_or_else(|| "127.0.0.1:8080".into())
            .parse()
            .context("BIND_ADDR")?;
        let database_url = var("DATABASE_URL").context("falta DATABASE_URL")?;
        let ip_hash_salt = var("IP_HASH_SALT").context("falta IP_HASH_SALT")?;
        anyhow::ensure!(
            ip_hash_salt.len() >= 16,
            "IP_HASH_SALT debe tener al menos 16 caracteres"
        );

        let turnstile = match (var("TURNSTILE_SITE_KEY"), var("TURNSTILE_SECRET")) {
            (Some(site_key), Some(secret)) => Some(Turnstile { site_key, secret }),
            (None, None) => None,
            _ => anyhow::bail!("TURNSTILE_SITE_KEY y TURNSTILE_SECRET van juntas"),
        };
        let matrix = match (
            var("MATRIX_HOMESERVER"),
            var("MATRIX_ACCESS_TOKEN"),
            var("MATRIX_ROOM_ID"),
        ) {
            (Some(homeserver), Some(access_token), Some(room_id)) => Some(Matrix {
                homeserver: homeserver.trim_end_matches('/').to_owned(),
                access_token,
                room_id,
            }),
            (None, None, None) => None,
            _ => {
                anyhow::bail!("MATRIX_HOMESERVER, MATRIX_ACCESS_TOKEN y MATRIX_ROOM_ID van juntas")
            }
        };

        Ok(Config {
            bind,
            database_url,
            db_max_connections: var("DB_MAX_CONNECTIONS")
                .map(|v| v.parse())
                .transpose()
                .context("DB_MAX_CONNECTIONS")?
                .unwrap_or(8),
            ip_hash_salt,
            trust_proxy_headers: var("TRUST_PROXY_HEADERS").is_some_and(|v| v == "true"),
            public_url: var("PUBLIC_URL")
                .unwrap_or_else(|| "https://titopinardogutierrez.com".into())
                .trim_end_matches('/')
                .to_owned(),
            turnstile,
            matrix,
            github_user: var("GITHUB_USER"),
            homelab_status_file: var("HOMELAB_STATUS_FILE").map(PathBuf::from),
        })
    }
}

/// Variable de entorno no vacía.
fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}
