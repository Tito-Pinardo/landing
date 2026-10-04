//! Datos en vivo de la sección "Ahora mismo".
//!
//! Se refrescan en segundo plano y se sirven ya serializados desde memoria:
//! una visita nunca espera a GitHub ni toca la base de datos.

use std::{
    path::PathBuf,
    sync::{Arc, RwLock},
    time::Duration,
};

use std::collections::BTreeMap;

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

const GITHUB_EVERY: Duration = Duration::from_secs(15 * 60);
const HOMELAB_EVERY: Duration = Duration::from_secs(60);
/// Pasado este tiempo sin actualizarse, el estado del homelab no se enseña.
const HOMELAB_STALE: time::Duration = time::Duration::hours(2);
const MAX_EVENTS: usize = 6;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Activity {
    pub repo: String,
    pub kind: &'static str,
    pub detail: Option<String>,
    pub url: String,
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
}

/// Lo que publica el homelab (lo escribe un cron con datos de Zabbix). Solo
/// agregados: nunca nombres, IPs ni puertos.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Homelab {
    pub services_up: u32,
    pub services_total: u32,
    pub uptime_30d: f64,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    /// Disponibilidad de cada uno de los últimos días (hasta 31), en %.
    #[serde(default)]
    pub daily: Vec<f64>,
    /// Estado por pieza del mapa del laboratorio: "up", "down" u "off".
    #[serde(default)]
    pub nodes: BTreeMap<String, String>,
}

#[derive(Default)]
struct State {
    github: Vec<Activity>,
    github_etag: Option<String>,
    homelab: Option<Homelab>,
}

#[derive(Clone)]
pub struct Live {
    state: Arc<RwLock<State>>,
    /// Respuesta de /api/status ya serializada.
    json: Arc<RwLock<Bytes>>,
}

impl Default for Live {
    fn default() -> Self {
        let live = Live {
            state: Arc::default(),
            json: Arc::new(RwLock::new(Bytes::new())),
        };
        live.publish();
        live
    }
}

impl Live {
    pub fn json(&self) -> Bytes {
        self.json.read().expect("lock").clone()
    }

    fn publish(&self) {
        #[derive(Serialize)]
        struct Out<'a> {
            github: &'a [Activity],
            homelab: Option<&'a Homelab>,
        }
        let state = self.state.read().expect("lock");
        let homelab = state
            .homelab
            .as_ref()
            .filter(|h| OffsetDateTime::now_utc() - h.updated_at < HOMELAB_STALE);
        let body = serde_json::to_vec(&Out {
            github: &state.github,
            homelab,
        })
        .expect("serializable");
        *self.json.write().expect("lock") = Bytes::from(body);
    }

    pub fn spawn_github(&self, http: reqwest::Client, user: String) {
        let live = self.clone();
        tokio::spawn(async move {
            loop {
                if let Err(e) = live.refresh_github(&http, &user).await {
                    tracing::warn!(error = %e, "no se pudo leer la actividad de GitHub");
                }
                tokio::time::sleep(GITHUB_EVERY).await;
            }
        });
    }

    async fn refresh_github(&self, http: &reqwest::Client, user: &str) -> anyhow::Result<()> {
        let etag = self.state.read().expect("lock").github_etag.clone();
        let mut req = http
            .get(format!(
                "https://api.github.com/users/{user}/events/public?per_page=30"
            ))
            .header("accept", "application/vnd.github+json")
            .header("x-github-api-version", "2022-11-28");
        // Con ETag, un 304 no gasta cuota de la API.
        if let Some(etag) = &etag {
            req = req.header("if-none-match", etag);
        }
        let res = req.send().await?;
        if res.status() == reqwest::StatusCode::NOT_MODIFIED {
            return Ok(());
        }
        let res = res.error_for_status()?;
        let etag = res
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let events: Vec<GhEvent> = res.json().await?;
        let activity = summarise(events);
        {
            let mut state = self.state.write().expect("lock");
            state.github = activity;
            state.github_etag = etag;
        }
        self.publish();
        Ok(())
    }

    pub fn spawn_homelab(&self, path: PathBuf) {
        let live = self.clone();
        tokio::spawn(async move {
            loop {
                match read_homelab(&path).await {
                    Ok(h) => live.state.write().expect("lock").homelab = Some(h),
                    Err(e) => tracing::debug!(error = %e, "estado del homelab no disponible"),
                }
                // Se publica siempre: así un estado viejo deja de enseñarse.
                live.publish();
                tokio::time::sleep(HOMELAB_EVERY).await;
            }
        });
    }
}

async fn read_homelab(path: &PathBuf) -> anyhow::Result<Homelab> {
    let raw = tokio::fs::read(path).await?;
    anyhow::ensure!(raw.len() < 8192, "fichero de estado demasiado grande");
    let h: Homelab = serde_json::from_slice(&raw)?;
    anyhow::ensure!(
        h.services_up <= h.services_total,
        "services_up > services_total"
    );
    anyhow::ensure!(
        (0.0..=100.0).contains(&h.uptime_30d),
        "uptime fuera de rango"
    );
    anyhow::ensure!(h.daily.len() <= 31, "demasiados días");
    anyhow::ensure!(
        h.daily.iter().all(|d| (0.0..=100.0).contains(d)),
        "día fuera de rango"
    );
    anyhow::ensure!(h.nodes.len() <= 64, "demasiadas piezas");
    for (id, estado) in &h.nodes {
        anyhow::ensure!(
            !id.is_empty()
                && id.len() <= 20
                && id
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()),
            "id de pieza no válido"
        );
        anyhow::ensure!(
            matches!(estado.as_str(), "up" | "down" | "off"),
            "estado de pieza no válido"
        );
    }
    Ok(h)
}

#[derive(Debug, Deserialize)]
struct GhEvent {
    #[serde(rename = "type")]
    kind: String,
    repo: GhRepo,
    #[serde(default)]
    payload: serde_json::Value,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
struct GhRepo {
    name: String,
}

/// Se queda con los eventos que dicen algo (commits, repos nuevos, PRs y
/// releases) y junta los pushes seguidos al mismo repo.
fn summarise(events: Vec<GhEvent>) -> Vec<Activity> {
    let mut out: Vec<Activity> = Vec::new();
    for ev in events {
        let repo_url = format!("https://github.com/{}", ev.repo.name);
        let (kind, detail, url) = match ev.kind.as_str() {
            "PushEvent" => {
                // GitHub ya no siempre manda la lista de commits en el evento.
                let msg = ev.payload["commits"]
                    .as_array()
                    .and_then(|c| c.last())
                    .and_then(|c| c["message"].as_str())
                    .map(first_line);
                ("push", msg, repo_url)
            }
            "CreateEvent" if ev.payload["ref_type"] == "repository" => ("create", None, repo_url),
            "PullRequestEvent" => {
                let pr = &ev.payload["pull_request"];
                let title = pr["title"].as_str().map(first_line);
                let url = pr["html_url"].as_str().map_or(repo_url, str::to_owned);
                ("pull_request", title, url)
            }
            "ReleaseEvent" => {
                let r = &ev.payload["release"];
                let name = r["name"]
                    .as_str()
                    .or(r["tag_name"].as_str())
                    .map(first_line);
                let url = r["html_url"].as_str().map_or(repo_url, str::to_owned);
                ("release", name, url)
            }
            _ => continue,
        };
        if kind == "push"
            && let Some(prev) = out.last()
            && prev.kind == "push"
            && prev.repo == ev.repo.name
        {
            continue;
        }
        out.push(Activity {
            repo: ev.repo.name,
            kind,
            detail,
            url,
            at: ev.created_at,
        });
        if out.len() == MAX_EVENTS {
            break;
        }
    }
    out
}

fn first_line(s: &str) -> String {
    let line = s.lines().next().unwrap_or_default().trim();
    if line.chars().count() > 100 {
        format!("{}…", line.chars().take(99).collect::<String>())
    } else {
        line.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(kind: &str, repo: &str, payload: serde_json::Value) -> GhEvent {
        GhEvent {
            kind: kind.into(),
            repo: GhRepo { name: repo.into() },
            payload,
            created_at: OffsetDateTime::UNIX_EPOCH,
        }
    }

    #[test]
    fn summarise_filters_and_merges_pushes() {
        let events = vec![
            ev(
                "PushEvent",
                "u/a",
                serde_json::json!({"commits": [{"message": "feat: x\n\ncuerpo"}]}),
            ),
            ev("PushEvent", "u/a", serde_json::json!({})),
            ev("WatchEvent", "u/b", serde_json::json!({})),
            ev(
                "CreateEvent",
                "u/c",
                serde_json::json!({"ref_type": "branch"}),
            ),
            ev(
                "CreateEvent",
                "u/c",
                serde_json::json!({"ref_type": "repository"}),
            ),
            ev("PushEvent", "u/a", serde_json::json!({})),
        ];
        let out = summarise(events);
        let kinds: Vec<_> = out.iter().map(|a| (a.kind, a.repo.as_str())).collect();
        assert_eq!(
            kinds,
            vec![("push", "u/a"), ("create", "u/c"), ("push", "u/a")]
        );
        assert_eq!(out[0].detail.as_deref(), Some("feat: x"));
    }

    #[test]
    fn long_lines_are_cut() {
        let s = "a".repeat(150);
        assert_eq!(first_line(&s).chars().count(), 100);
    }

    #[test]
    fn stale_homelab_is_hidden() {
        let live = Live::default();
        live.state.write().unwrap().homelab = Some(Homelab {
            services_up: 20,
            services_total: 21,
            uptime_30d: 99.9,
            updated_at: OffsetDateTime::now_utc() - time::Duration::hours(3),
            daily: vec![],
            nodes: BTreeMap::new(),
        });
        live.publish();
        let v: serde_json::Value = serde_json::from_slice(&live.json()).unwrap();
        assert!(v["homelab"].is_null());

        live.state
            .write()
            .unwrap()
            .homelab
            .as_mut()
            .unwrap()
            .updated_at = OffsetDateTime::now_utc();
        live.publish();
        let v: serde_json::Value = serde_json::from_slice(&live.json()).unwrap();
        assert_eq!(v["homelab"]["services_up"], 20);
    }

    #[tokio::test]
    async fn homelab_file_is_validated() {
        let dir = std::env::temp_dir().join(format!("landing-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let path = dir.join("status.json");
        tokio::fs::write(&path, r#"{"services_up":30,"services_total":21,"uptime_30d":99.0,"updated_at":"2026-10-04T10:00:00Z"}"#)
            .await
            .unwrap();
        assert!(read_homelab(&path).await.is_err());
        tokio::fs::write(&path, r#"{"services_up":20,"services_total":21,"uptime_30d":99.0,"updated_at":"2026-10-04T10:00:00Z","ip":"x"}"#)
            .await
            .unwrap();
        assert!(
            read_homelab(&path).await.is_err(),
            "campos extra rechazados"
        );
        tokio::fs::write(&path, r#"{"services_up":20,"services_total":21,"uptime_30d":99.0,"updated_at":"2026-10-04T10:00:00Z"}"#)
            .await
            .unwrap();
        assert_eq!(read_homelab(&path).await.unwrap().services_up, 20);
        let base = r#""services_up":20,"services_total":21,"uptime_30d":99.0,"updated_at":"2026-10-04T10:00:00Z""#;
        tokio::fs::write(
            &path,
            format!(r#"{{{base},"daily":[99.5,100],"nodes":{{"plex":"up","okd":"off"}}}}"#),
        )
        .await
        .unwrap();
        let h = read_homelab(&path).await.unwrap();
        assert_eq!((h.daily.len(), h.nodes["okd"].as_str()), (2, "off"));
        for malo in [
            r#""nodes":{"plex":"<script>"}"#,
            r#""nodes":{"Plex 1":"up"}"#,
            r#""daily":[101]"#,
        ] {
            tokio::fs::write(&path, format!("{{{base},{malo}}}"))
                .await
                .unwrap();
            assert!(read_homelab(&path).await.is_err(), "{malo}");
        }
        tokio::fs::remove_dir_all(&dir).await.unwrap();
    }
}
