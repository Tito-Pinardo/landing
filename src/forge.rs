//! Los repos de mi Forgejo en la web: la página `/repos/` y el resumen de
//! «Ahora mismo».
//!
//! Qué repos salen y para qué sirve cada uno está en el contenido
//! (`[[forge]]` de `site.toml` y `[forge]` de cada idioma; los de BattlePros
//! toman sus textos del mapa de repos de su unidad). La actividad la escribe
//! el host en `forja.json` (`publish_landing_forja.py` de infra-tf) junto al
//! estado del homelab: la web no tiene credenciales ni red hacia Forgejo.
//!
//! Los repos son privados y la web es pública, así que los mensajes se
//! filtran dos veces: en el host y aquí ([`publishable`]). Lo que no pasa se
//! queda en las cifras.

use std::collections::BTreeMap;

use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

/// Grupos de la página, en este orden.
pub const GROUPS: &[&str] = &["web", "infra", "battlepros"];
/// Semanas de la barra de actividad.
pub const WEEKS: usize = 12;
/// Pasado este tiempo sin actualizarse, la actividad no se enseña.
pub const STALE: time::Duration = time::Duration::hours(6);

/// Un repo de la lista (`[[forge]]` de `site.toml`).
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Forge {
    /// Nombre del repo en Forgejo.
    pub id: String,
    /// Uno de [`GROUPS`].
    pub group: String,
    /// Unidad del rack donde se cuenta por dentro.
    #[serde(default)]
    pub unit: Option<String>,
    /// Copia pública (GitHub), si la hay.
    #[serde(default)]
    pub public: Option<String>,
    #[serde(default)]
    pub stack: Vec<String>,
    /// `false`: solo cifras, sin mensajes.
    #[serde(default = "yes")]
    pub log: bool,
    #[serde(default)]
    pub fork: bool,
}

fn yes() -> bool {
    true
}

/// `[forge]` de cada idioma: textos de la página y, para los repos que no
/// están en el mapa de una unidad, su papel y resumen.
#[derive(Debug, Deserialize, Serialize)]
pub struct ForgeTexts {
    #[serde(default)]
    pub items: BTreeMap<String, ForgeItem>,
    #[serde(flatten)]
    pub ui: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ForgeItem {
    pub role: String,
    pub summary: String,
}

pub const KEYS: &[&str] = &[
    "nav",
    "crumb",
    "kicker",
    "title",
    "meta_title",
    "meta_description",
    "intro",
    "group_web",
    "group_infra",
    "group_battlepros",
    "stat_repos",
    "stat_commits_30d",
    "stat_commits",
    "stat_last",
    "commits",
    "commits_30d",
    "since",
    "weeks",
    "recent",
    "no_recent",
    "private_log",
    "public_copy",
    "unit_link",
    "fork",
    "retired",
    "latest",
    "no_data",
    "updated",
    "lang_note",
    "all",
    "loc",
    "tests",
];

// ------------------------------------------------------------ forja.json

/// Lo que publica el host.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Forja {
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    pub repos: Vec<Activity>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Activity {
    pub id: String,
    pub commits: u32,
    /// Fecha del primer commit (AAAA-MM-DD).
    pub since: String,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_at: Option<OffsetDateTime>,
    pub commits_30d: u32,
    /// Commits por semana, de la más antigua a la actual.
    pub weeks: Vec<u32>,
    pub recent: Vec<Commit>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Commit {
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
    pub msg: String,
}

/// Lee y comprueba `forja.json`. Se queda solo con los repos de la lista,
/// quita los mensajes de los que van sin ellos y los que no pasan
/// [`publishable`].
pub fn parse(raw: &[u8], list: &[(String, bool)]) -> Result<Forja> {
    ensure!(raw.len() < 64 * 1024, "forja.json demasiado grande");
    let mut f: Forja = serde_json::from_slice(raw)?;
    ensure!(f.repos.len() <= 40, "demasiados repos");
    f.repos.retain_mut(|r| {
        let Some((_, log)) = list.iter().find(|(id, _)| *id == r.id) else {
            return false;
        };
        if !log {
            r.recent.clear();
        }
        r.recent.retain(|c| publishable(&c.msg));
        r.recent.truncate(6);
        true
    });
    for r in &f.repos {
        ensure!(r.weeks.len() == WEEKS, "{}: semanas", r.id);
        ensure!(
            r.since.len() == 10 && r.since.bytes().all(|b| b.is_ascii_digit() || b == b'-'),
            "{}: fecha del primer commit",
            r.id
        );
        ensure!(r.commits_30d <= r.commits, "{}: cifras", r.id);
    }
    Ok(f)
}

/// Si un mensaje de commit se puede enseñar en público. Una segunda red por
/// si un día el filtro del host se equivoca: dominios y direcciones de red
/// privada, números de CT, correos, secretos y seguridad. Los nombres de las
/// máquinas solo los conoce el host (aquí estarían publicándose).
pub fn publishable(msg: &str) -> bool {
    const FUERA: &[&str] = &[
        ".lan",
        ".local",
        ".internal",
        "token",
        "contrase",
        "password",
        "secret",
        "llave",
        "clave",
        "credencial",
        "openbao",
        "cve-",
        "vulnerab",
        "exploit",
        "bypass",
        "fuga",
        "leak",
        "anticheat",
        "firewall",
        "baneo",
        "suplant",
        "sin cuenta",
        "inyecci",
        "xss",
        "csrf",
        "@",
    ];
    let low = msg.to_lowercase();
    if msg.is_empty() || msg.chars().count() > 160 || msg.chars().any(char::is_control) {
        return false;
    }
    if FUERA.iter().any(|w| low.contains(w)) {
        return false;
    }
    // «CT 125», «ct125», direcciones IPv4 y prefijos de red privada
    // («10.0.0.», «172.16.4»; «0.3.35» es una versión y pasa).
    let b = low.as_bytes();
    for i in 0..b.len() {
        let word_start = i == 0 || !b[i - 1].is_ascii_alphanumeric();
        if word_start && b[i..].starts_with(b"ct") {
            let rest = &b[i + 2..];
            let rest = rest.strip_prefix(b" ").unwrap_or(rest);
            if rest.first().is_some_and(u8::is_ascii_digit) {
                return false;
            }
        }
    }
    !low.split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .any(|w| {
            let parts: Vec<&str> = w.split('.').collect();
            let ip = parts.len() == 4 && parts.iter().all(|p| !p.is_empty() && p.len() <= 3);
            let private = parts.len() >= 3 && ["10", "172", "192"].contains(&parts[0]);
            ip || private
        })
}

/// Para «Ahora mismo»: lo último de todos los repos y las cifras del mes.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Feed {
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    pub repos: usize,
    pub commits_30d: u32,
    pub items: Vec<FeedItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FeedItem {
    pub repo: String,
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
    pub msg: String,
}

pub fn feed(f: &Forja, n: usize) -> Feed {
    let mut items: Vec<FeedItem> = f
        .repos
        .iter()
        .flat_map(|r| {
            r.recent.iter().map(|c| FeedItem {
                repo: r.id.clone(),
                at: c.at,
                msg: c.msg.clone(),
            })
        })
        .collect();
    items.sort_by_key(|i| std::cmp::Reverse(i.at));
    items.truncate(n);
    Feed {
        updated_at: f.updated_at,
        repos: f.repos.len(),
        commits_30d: f.repos.iter().map(|r| r.commits_30d).sum(),
        items,
    }
}

/// «feat(bedrock): coordenadas…» → (Some("feat"), Some("bedrock"), "coordenadas…").
pub fn split_message(msg: &str) -> (Option<&str>, Option<&str>, &str) {
    let Some((head, text)) = msg.split_once(": ") else {
        return (None, None, msg);
    };
    let head = head.trim_end_matches('!');
    let (kind, scope) = match head.split_once('(') {
        Some((k, s)) => (k, s.strip_suffix(')')),
        None => (head, None),
    };
    if kind.is_empty() || !kind.bytes().all(|b| b.is_ascii_lowercase()) || kind.len() > 10 {
        return (None, None, msg);
    }
    (Some(kind), scope, text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list() -> Vec<(String, bool)> {
        vec![("landing".into(), true), ("infra-tf".into(), false)]
    }

    #[test]
    fn mensajes_que_no_salen() {
        for m in [
            "fix: firewall del CT 127",
            "feat(ct125): algo",
            "fix: ruta a 172.16.4.20",
            "fix: la red 10.0.0. no llegaba",
            "docs: la ip 10.0.0.12 del router",
            "chore: token de Renovate",
            "fix(anticheat): detectar teletransportes",
            "docs: escribe a alguien@example.com",
            "test(bateria): baneo_auto lleva a los bots a la plataforma",
            "fix(mando): ViaProxy sin cuenta; la comprueba la entrada",
            "fix: git.casa.lan",
            "",
        ] {
            assert!(!publishable(m), "{m}");
        }
        for m in [
            "feat(web): cada unidad con su imagen al compartir",
            "fix(mando): admitir versiones con compilación (-bN) para Geyser",
            "perf: AcquirePoi busca solo en lo cargado",
            "feat: motor «nivel» y teselas a la vez",
            "chore: versión 0.3.8",
            "fix(lock): solo mando y mando-api pasan a 0.3.35",
            "fix(sincronizacion): guardar a todos al apagar",
        ] {
            assert!(publishable(m), "{m}");
        }
    }

    #[test]
    fn solo_repos_de_la_lista_y_sin_mensajes_si_no_tocan() {
        let raw = br#"{"updated_at":"2026-11-10T20:00:00Z","repos":[
            {"id":"landing","commits":10,"since":"2026-10-04","last_at":"2026-11-10T19:49:29Z","commits_30d":5,"weeks":[0,0,0,0,0,0,0,0,0,1,2,2],
             "recent":[{"at":"2026-11-10T19:49:29Z","msg":"fix(web): botones"},{"at":"2026-11-09T10:00:00Z","msg":"fix: CT 125"}]},
            {"id":"infra-tf","commits":556,"since":"2026-09-16","last_at":null,"commits_30d":379,"weeks":[0,0,0,42,100,18,17,179,113,31,46,10],
             "recent":[{"at":"2026-11-10T01:14:50Z","msg":"feat: algo"}]},
            {"id":"otro","commits":1,"since":"2026-01-01","last_at":null,"commits_30d":0,"weeks":[0,0,0,0,0,0,0,0,0,0,0,0],"recent":[]}
        ]}"#;
        let f = parse(raw, &list()).unwrap();
        assert_eq!(f.repos.len(), 2, "«otro» no está en la lista");
        assert_eq!(f.repos[0].recent.len(), 1, "el del CT se cae");
        assert!(f.repos[1].recent.is_empty(), "infra-tf va sin mensajes");
        let feed = feed(&f, 8);
        assert_eq!(feed.commits_30d, 384);
        assert_eq!(feed.items.len(), 1);
        assert_eq!(feed.items[0].repo, "landing");
    }

    #[test]
    fn rechaza_lo_que_no_cuadra() {
        let semanas = br#"{"updated_at":"2026-11-10T20:00:00Z","repos":[{"id":"landing","commits":1,"since":"2026-10-04","last_at":null,"commits_30d":0,"weeks":[1],"recent":[]}]}"#;
        assert!(parse(semanas, &list()).is_err());
        let cifras = br#"{"updated_at":"2026-11-10T20:00:00Z","repos":[{"id":"landing","commits":1,"since":"2026-10-04","last_at":null,"commits_30d":9,"weeks":[0,0,0,0,0,0,0,0,0,0,0,0],"recent":[]}]}"#;
        assert!(parse(cifras, &list()).is_err());
        assert!(parse(b"{}", &list()).is_err());
    }

    #[test]
    fn parte_los_mensajes_convencionales() {
        assert_eq!(
            split_message("feat(bedrock): lejos del 0"),
            (Some("feat"), Some("bedrock"), "lejos del 0")
        );
        assert_eq!(
            split_message("perf: más rápido"),
            (Some("perf"), None, "más rápido")
        );
        assert_eq!(
            split_message("BattlePros: RemoveBlockGoal (parche 0024)"),
            (None, None, "BattlePros: RemoveBlockGoal (parche 0024)")
        );
        assert_eq!(
            split_message("sin dos puntos"),
            (None, None, "sin dos puntos")
        );
    }
}
