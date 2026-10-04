//! Contenido de la web: se compila dentro del binario y se valida al arrancar.
//!
//! `site.toml` guarda lo que no depende del idioma y `es.toml` / `en.toml` los
//! textos con las mismas claves. Si falta una traducción o un id no cuadra, el
//! servidor no arranca: prefiero un fallo al desplegar que una página a medias.

use std::collections::{BTreeMap, HashSet};

use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    Es,
    En,
}

impl Lang {
    pub const ALL: [Lang; 2] = [Lang::Es, Lang::En];

    pub fn code(self) -> &'static str {
        match self {
            Lang::Es => "es",
            Lang::En => "en",
        }
    }

    pub fn other(self) -> Lang {
        match self {
            Lang::Es => Lang::En,
            Lang::En => Lang::Es,
        }
    }

    pub fn from_code(code: &str) -> Option<Lang> {
        match code {
            "es" => Some(Lang::Es),
            "en" => Some(Lang::En),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// site.toml
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Site {
    pub links: Vec<[String; 2]>,
    pub achievements: Vec<String>,
    pub person: Person,
    pub branches: Vec<Branch>,
    pub tech: Vec<Tech>,
    pub projects: Vec<Project>,
    pub nodes: Vec<Node>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Person {
    pub name: String,
    pub github: String,
    pub linkedin: String,
    pub cv_es: String,
    pub cv_en: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Branch {
    pub id: String,
    pub icon: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tech {
    pub id: String,
    pub name: String,
    pub branch: String,
    pub level: u8,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub id: String,
    pub status: ProjectStatus,
    #[serde(default)]
    pub featured: bool,
    pub tech: Vec<String>,
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    Done,
    Live,
    Ongoing,
}

impl ProjectStatus {
    pub fn css(self) -> &'static str {
        match self {
            ProjectStatus::Done => "done",
            ProjectStatus::Live => "live",
            ProjectStatus::Ongoing => "ongoing",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Node {
    pub id: String,
    pub x: u32,
    pub y: u32,
    pub kind: String,
    pub tech: Vec<String>,
}

// ---------------------------------------------------------------------------
// es.toml / en.toml
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Texts {
    pub meta: Meta,
    pub ui: BTreeMap<String, String>,
    pub hero: Hero,
    pub zones: BTreeMap<String, Zone>,
    pub about: About,
    pub quick: Quick,
    pub branches: BTreeMap<String, TitleText>,
    pub projects: BTreeMap<String, ProjectText>,
    pub journey: Vec<JourneyItem>,
    pub languages: Items<LanguageItem>,
    pub interests: Items<String>,
    pub lab: BTreeMap<String, String>,
    pub nodes: BTreeMap<String, NodeText>,
    pub now: Now,
    pub contact: BTreeMap<String, String>,
    pub terminal: Terminal,
    pub achievements: BTreeMap<String, TitleText>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Meta {
    pub lang: String,
    pub title: String,
    pub description: String,
    pub og_image_alt: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Hero {
    pub kicker: String,
    pub name: String,
    pub role: String,
    pub pitch: String,
    pub looking: String,
    pub location: String,
    pub stats: Vec<Stat>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Stat {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Zone {
    pub title: String,
    pub subtitle: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct About {
    pub paragraphs: Vec<String>,
    pub values: Vec<TitleText>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Quick {
    pub title: String,
    pub intro: String,
    pub summary: String,
    pub facts: Vec<Fact>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Fact {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TitleText {
    pub title: String,
    pub text: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NodeText {
    /// Etiqueta del mapa: tiene que caber en la caja del nodo.
    pub short: String,
    pub title: String,
    pub text: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectText {
    pub title: String,
    pub tagline: String,
    pub context: String,
    pub problem: String,
    pub bullets: Vec<String>,
    pub outcome: String,
    pub lesson: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct JourneyItem {
    pub kind: String,
    pub title: String,
    pub org: String,
    pub place: String,
    pub period: String,
    pub bullets: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Items<T> {
    pub items: Vec<T>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LanguageItem {
    pub name: String,
    pub level: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Now {
    pub intro: String,
    pub focus: Vec<String>,
    pub github_title: String,
    pub github_empty: String,
    pub homelab_title: String,
    pub homelab_services: String,
    pub homelab_uptime: String,
    pub homelab_updated: String,
    pub live_unavailable: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Terminal {
    pub title: String,
    pub open: String,
    pub welcome: String,
    pub prompt: String,
    pub not_found: String,
    pub help: Vec<[String; 2]>,
    pub whoami: String,
    pub sudo: String,
}

// ---------------------------------------------------------------------------

pub struct Content {
    pub site: Site,
    pub es: Texts,
    pub en: Texts,
}

/// Zonas (secciones) en el orden en que aparecen en la página.
pub const ZONES: [&str; 7] = [
    "about", "skills", "quests", "journey", "lab", "now", "contact",
];

/// Claves de `[ui]`, `[lab]` y `[contact]` que usan las plantillas. Se
/// comprueban al arrancar para que una errata no deje un hueco en la página.
const UI_KEYS: &[&str] = &[
    "skip",
    "nav_quick",
    "nav_explore",
    "lang_switch",
    "download_cv",
    "contact",
    "quick_hint",
    "explore_hint",
    "progress",
    "zones_found",
    "achievement_unlocked",
    "back_to_map",
    "close",
    "filter_all",
    "filter_hint",
    "projects_with",
    "level_1",
    "level_2",
    "level_3",
    "status_done",
    "status_live",
    "status_ongoing",
    "view_code",
    "private_code",
    "footer",
    "footer_source",
    "noscript",
];
const LAB_KEYS: &[&str] = &[
    "intro",
    "legend_edge",
    "legend_network",
    "legend_compute",
    "legend_control",
    "legend_observability",
    "legend_ai",
    "legend_app",
    "disclaimer",
];
const CONTACT_KEYS: &[&str] = &[
    "intro",
    "name",
    "email",
    "company",
    "message",
    "send",
    "sending",
    "ok",
    "error",
    "rate_limited",
    "invalid",
    "privacy",
    "elsewhere",
];

impl Content {
    pub fn texts(&self, lang: Lang) -> &Texts {
        match lang {
            Lang::Es => &self.es,
            Lang::En => &self.en,
        }
    }

    /// Carga el contenido compilado en el binario.
    pub fn embedded() -> Result<Content> {
        Self::parse(
            include_str!("../content/site.toml"),
            include_str!("../content/es.toml"),
            include_str!("../content/en.toml"),
        )
    }

    pub fn parse(site: &str, es: &str, en: &str) -> Result<Content> {
        let content = Content {
            site: toml::from_str(site).context("content/site.toml")?,
            es: toml::from_str(es).context("content/es.toml")?,
            en: toml::from_str(en).context("content/en.toml")?,
        };
        content.validate()?;
        Ok(content)
    }

    fn validate(&self) -> Result<()> {
        let site = &self.site;
        let tech: HashSet<&str> = site.tech.iter().map(|t| t.id.as_str()).collect();
        let branches: HashSet<&str> = site.branches.iter().map(|b| b.id.as_str()).collect();
        let nodes: HashSet<&str> = site.nodes.iter().map(|n| n.id.as_str()).collect();

        ensure!(tech.len() == site.tech.len(), "id de tecnología repetido");
        for t in &site.tech {
            ensure!(
                branches.contains(t.branch.as_str()),
                "{}: rama desconocida {}",
                t.id,
                t.branch
            );
            ensure!((1..=3).contains(&t.level), "{}: nivel fuera de 1-3", t.id);
        }
        for p in &site.projects {
            for t in &p.tech {
                ensure!(
                    tech.contains(t.as_str()),
                    "proyecto {}: tecnología desconocida {t}",
                    p.id
                );
            }
        }
        for n in &site.nodes {
            ensure!(n.x <= 1000 && n.y <= 520, "nodo {} fuera del lienzo", n.id);
            for t in &n.tech {
                ensure!(
                    tech.contains(t.as_str()),
                    "nodo {}: tecnología desconocida {t}",
                    n.id
                );
            }
        }
        for [a, b] in &site.links {
            ensure!(
                nodes.contains(a.as_str()) && nodes.contains(b.as_str()),
                "enlace {a}-{b}"
            );
        }

        for lang in Lang::ALL {
            let t = self.texts(lang);
            let code = lang.code();
            ensure!(
                t.meta.lang == code,
                "{code}.toml declara lang = {}",
                t.meta.lang
            );
            same_keys(
                code,
                "projects",
                site.projects.iter().map(|p| p.id.as_str()),
                keys(&t.projects),
            )?;
            same_keys(
                code,
                "nodes",
                site.nodes.iter().map(|n| n.id.as_str()),
                keys(&t.nodes),
            )?;
            same_keys(
                code,
                "branches",
                site.branches.iter().map(|b| b.id.as_str()),
                keys(&t.branches),
            )?;
            same_keys(
                code,
                "achievements",
                site.achievements.iter().map(String::as_str),
                keys(&t.achievements),
            )?;
            same_keys(code, "zones", ZONES, keys(&t.zones))?;
            for (id, n) in &t.nodes {
                ensure!(
                    n.short.chars().count() <= 16,
                    "{code}.toml [nodes.{id}]: short demasiado largo"
                );
            }
            required(code, "ui", UI_KEYS, &t.ui)?;
            required(code, "lab", LAB_KEYS, &t.lab)?;
            required(code, "contact", CONTACT_KEYS, &t.contact)?;
        }
        Ok(())
    }
}

fn same_keys<'a>(
    lang: &str,
    what: &str,
    expected: impl IntoIterator<Item = &'a str>,
    got: impl IntoIterator<Item = &'a str>,
) -> Result<()> {
    let expected: HashSet<&str> = expected.into_iter().collect();
    let got: HashSet<&str> = got.into_iter().collect();
    if expected != got {
        let missing: Vec<_> = expected.difference(&got).collect();
        let extra: Vec<_> = got.difference(&expected).collect();
        bail!("{lang}.toml [{what}]: faltan {missing:?}, sobran {extra:?}");
    }
    Ok(())
}

fn keys<V>(map: &BTreeMap<String, V>) -> impl Iterator<Item = &str> {
    map.keys().map(String::as_str)
}

fn required(lang: &str, what: &str, keys: &[&str], map: &BTreeMap<String, String>) -> Result<()> {
    for k in keys {
        ensure!(map.contains_key(*k), "{lang}.toml [{what}]: falta {k}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_content_is_valid() {
        Content::embedded().expect("el contenido compilado debe ser válido");
    }

    #[test]
    fn missing_translation_is_rejected() {
        let site = include_str!("../content/site.toml");
        let es = include_str!("../content/es.toml");
        let en =
            include_str!("../content/en.toml").replace("[projects.okd]", "[projects.okd-typo]");
        let err = Content::parse(site, es, &en).err().expect("debe fallar");
        assert!(err.to_string().contains("projects"), "{err}");
    }

    #[test]
    fn lang_codes_round_trip() {
        for lang in Lang::ALL {
            assert_eq!(Lang::from_code(lang.code()), Some(lang));
            assert_eq!(lang.other().other(), lang);
        }
        assert_eq!(Lang::from_code("fr"), None);
    }
}
