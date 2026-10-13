//! Contenido de la web: se compila dentro del binario y se valida al arrancar.
//!
//! `site.toml` guarda lo que no depende del idioma y `es.toml` / `en.toml` los
//! textos con las mismas claves. Si falta una traducción o un id no cuadra, el
//! servidor no arranca: prefiero un fallo al desplegar que una página a medias.

use std::collections::{BTreeMap, HashSet};

use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};

use crate::article::{self, Article};
use crate::unit::{self, Unit};

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
    pub groups: Vec<Group>,
    pub nodes: Vec<Node>,
    pub flows: Vec<Flow>,
    pub incidents: Vec<Incident>,
}

impl Site {
    pub fn project(&self, id: &str) -> Option<&Project> {
        self.projects.iter().find(|p| p.id == id)
    }
}

/// Caso del modo detective: piezas con pista y opción correcta.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Incident {
    pub id: String,
    pub clues: Vec<String>,
    pub answer: usize,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Person {
    pub name: String,
    pub github: String,
    pub linkedin: String,
    /// Otros perfiles públicos que son míos (para «sameAs» en buscadores).
    #[serde(default)]
    pub profiles: Vec<String>,
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
    /// Grupo dentro del servidor; vacío si la pieza está fuera.
    pub group: String,
    pub tech: Vec<String>,
    /// Unidad del rack (página propia) en la que se puede entrar desde aquí.
    #[serde(default)]
    pub unit: Option<String>,
}

/// Zona rectangular del servidor en el mapa del laboratorio.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Group {
    pub id: String,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Recorrido animado: la lista de piezas por las que pasa algo de verdad.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Flow {
    pub id: String,
    /// Pestaña en la que aparece (`[flow_categories]` en es/en.toml).
    pub category: String,
    pub path: Vec<String>,
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
    pub groups: BTreeMap<String, String>,
    pub nodes: BTreeMap<String, NodeText>,
    pub flows: BTreeMap<String, FlowText>,
    /// Nombres de las pestañas de recorridos; `all` es "todos".
    pub flow_categories: BTreeMap<String, String>,
    pub hermes: Hermes,
    pub incident_ui: BTreeMap<String, String>,
    pub incidents: BTreeMap<String, IncidentText>,
    pub compare: BTreeMap<String, String>,
    pub before_after: BeforeAfter,
    pub personality: BTreeMap<String, String>,
    pub gnomes: Gnomes,
    pub now: Now,
    pub contact: BTreeMap<String, String>,
    pub terminal: Terminal,
    pub achievements: BTreeMap<String, TitleText>,
    /// Textos comunes de las páginas de unidad (cada unidad puede
    /// sobrescribirlos en su `[text.*.ui]`).
    pub unit_ui: BTreeMap<String, String>,
    /// Lista del rack en la portada.
    pub rack: BTreeMap<String, String>,
    /// Artículos (índice, página de cada uno y bloque de la portada).
    pub blog: BTreeMap<String, String>,
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
pub struct IncidentText {
    pub title: String,
    pub intro: String,
    pub options: Vec<String>,
    /// Por qué cada opción no es la buena (vacío en la correcta).
    pub feedback: Vec<String>,
    pub solution: String,
    pub lesson: String,
    pub clues: BTreeMap<String, String>,
}

/// Frases de los enanitos que pasean por la página.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Gnomes {
    pub toggle: String,
    pub toggle_title: String,
    pub hermes_reveal: String,
    pub mobile_hint: String,
    pub click: Vec<String>,
    pub fall: Vec<String>,
    pub trip: Vec<String>,
    pub near: Vec<String>,
    /// De noche en casa los enanitos duermen: lo que dicen si les despiertas.
    pub night: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BeforeAfter {
    pub title: String,
    pub intro: String,
    pub before: String,
    pub after: String,
    pub before_items: Vec<String>,
    pub after_items: Vec<String>,
    pub handle: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FlowText {
    pub title: String,
    /// Un texto por pieza del recorrido (mismo número que `path`).
    pub steps: Vec<String>,
}

/// Textos del guía. Los mensajes sueltos van en `text` (se validan contra
/// `HERMES_KEYS`); las listas, aparte.
#[derive(Debug, Deserialize, Serialize)]
pub struct Hermes {
    pub idle: Vec<String>,
    pub zones: BTreeMap<String, String>,
    #[serde(flatten)]
    pub text: BTreeMap<String, String>,
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
    pub challenge: String,
    pub motd: Vec<String>,
    pub log: Vec<String>,
    pub submit_ok: String,
    pub submit_bad: String,
    pub no_such_file: String,
}

// ---------------------------------------------------------------------------

pub struct Content {
    pub site: Site,
    pub es: Texts,
    pub en: Texts,
    pub units: Vec<Unit>,
    pub articles: Vec<Article>,
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
    "quick_on",
    "quick_off",
    "lab_quick",
    "unit_enter",
    "unit_where",
    "unit_badge",
    "sound_on",
    "sound_off",
    "view",
    "view_title",
    "theme",
    "theme_auto",
    "theme_light",
    "theme_dark",
    "motion",
    "motion_on",
    "motion_off",
    "night_note",
];
const RACK_KEYS: &[&str] = &[
    "title",
    "intro",
    "enter",
    "lit",
    "units",
    "live_up",
    "live_off",
    "live_down",
];
const BLOG_KEYS: &[&str] = &[
    "nav",
    "title",
    "meta_title",
    "meta_description",
    "intro",
    "read",
    "all",
    "back",
    "published",
    "unit",
    "unit_cta",
    "lesson",
    "home_title",
    "home_intro",
    "in_unit",
    "crumb",
];
const LAB_KEYS: &[&str] = &[
    "intro",
    "server_title",
    "server_specs",
    "outside",
    "flows_title",
    "flows_hint",
    "play",
    "pause",
    "prev",
    "next",
    "replay",
    "step",
    "of",
    "pick_node",
    "legend_edge",
    "legend_network",
    "legend_compute",
    "legend_control",
    "legend_observability",
    "legend_ai",
    "legend_app",
    "disclaimer",
];
const HERMES_KEYS: &[&str] = &[
    "name",
    "role",
    "open",
    "minimize",
    "greet",
    "greet_return",
    "choice_tour",
    "choice_hr",
    "choice_free",
    "choice_lab",
    "hr_text",
    "free_text",
    "tour_next",
    "tour_prev",
    "tour_exit",
    "tour_end",
    "skill",
    "mission_one",
    "mission_many",
    "skill_none",
    "flow_start",
    "flow_done",
    "achievement",
    "cv",
    "lang",
];
const INCIDENT_UI_KEYS: &[&str] = &[
    "button",
    "title",
    "intro",
    "clues",
    "normal",
    "diagnose",
    "need_more",
    "wrong",
    "solved",
    "lesson",
    "exit",
    "again",
    "mobile",
];
const COMPARE_KEYS: &[&str] = &["button", "hint", "second"];
const PERSONALITY_KEYS: &[&str] = &[
    "night",
    "morning",
    "afternoon",
    "evening",
    "weekend",
    "visit_2",
    "visit_many",
    "lang_hint",
    "tour_end_lab",
    "tour_end_all",
    "detective",
    "hacker",
];
const CONTACT_KEYS: &[&str] = &[
    "intro",
    "name",
    "email",
    "company",
    "topic",
    "topic_job",
    "topic_project",
    "topic_homelab",
    "topic_other",
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
        let mut content = Self::parse(
            include_str!("../content/site.toml"),
            include_str!("../content/es.toml"),
            include_str!("../content/en.toml"),
        )?;
        content.units = unit::EMBEDDED
            .iter()
            .map(|src| Unit::parse(src))
            .collect::<Result<_>>()?;
        content.validate_units()?;
        content.articles = article::EMBEDDED
            .iter()
            .map(|src| Article::parse(src))
            .collect::<Result<_>>()?;
        content.validate_articles()?;
        Ok(content)
    }

    pub fn unit(&self, id: &str) -> Option<&Unit> {
        self.units.iter().find(|u| u.id == id)
    }

    /// Unidad de una misión, si la tiene.
    pub fn project_unit(&self, project: &str) -> Option<&Unit> {
        self.units
            .iter()
            .find(|u| u.project.as_deref() == Some(project))
    }

    /// Artículos de una unidad, del más reciente al más antiguo.
    pub fn unit_articles<'a>(&'a self, unit: &'a str) -> impl Iterator<Item = &'a Article> {
        self.articles.iter().filter(move |a| a.unit == unit)
    }

    fn validate_articles(&self) -> Result<()> {
        let units: HashSet<&str> = self.units.iter().map(|u| u.id.as_str()).collect();
        let mut slugs = HashSet::new();
        for a in &self.articles {
            ensure!(
                slugs.insert(a.slug.as_str()),
                "artículo repetido {}",
                a.slug
            );
            a.validate(&self.site, &units)?;
        }
        Ok(())
    }

    fn validate_units(&self) -> Result<()> {
        let mut ids = HashSet::new();
        for u in &self.units {
            ensure!(ids.insert(u.id.as_str()), "unidad repetida {}", u.id);
            ensure!(
                !["contact", "static", "api", "blog"].contains(&u.id.as_str()),
                "unidad {}: el id choca con una ruta",
                u.id
            );
            u.validate(&self.site)?;
            ensure!(
                u.code.is_empty()
                    || self
                        .site
                        .project(crate::render::CODE_PROJECT)
                        .is_some_and(|p| p.repo.is_some()),
                "unidad {}: enlaza código pero la misión {} no tiene repositorio",
                u.id,
                crate::render::CODE_PROJECT
            );
        }
        for n in &self.site.nodes {
            if let Some(id) = &n.unit {
                ensure!(
                    self.unit(id).is_some(),
                    "nodo {}: unidad desconocida {id}",
                    n.id
                );
            }
        }
        // Cada unidad tiene que tener una puerta en el laboratorio.
        for u in &self.units {
            ensure!(
                self.site
                    .nodes
                    .iter()
                    .any(|n| n.unit.as_deref() == Some(&u.id)),
                "unidad {}: ninguna pieza del laboratorio lleva a ella",
                u.id
            );
        }
        Ok(())
    }

    pub fn parse(site: &str, es: &str, en: &str) -> Result<Content> {
        let content = Content {
            site: toml::from_str(site).context("content/site.toml")?,
            es: toml::from_str(es).context("content/es.toml")?,
            en: toml::from_str(en).context("content/en.toml")?,
            units: Vec::new(),
            articles: Vec::new(),
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
            ensure!(n.x <= 1200 && n.y <= 800, "nodo {} fuera del lienzo", n.id);
            ensure!(
                n.group.is_empty() || site.groups.iter().any(|g| g.id == n.group),
                "nodo {}: grupo desconocido {}",
                n.id,
                n.group
            );
            for t in &n.tech {
                ensure!(
                    tech.contains(t.as_str()),
                    "nodo {}: tecnología desconocida {t}",
                    n.id
                );
            }
        }
        for g in &site.groups {
            ensure!(
                g.x + g.w <= 1200 && g.y + g.h <= 800,
                "grupo {} fuera del lienzo",
                g.id
            );
        }
        for f in &site.flows {
            ensure!(
                f.path.len() >= 2,
                "recorrido {}: hacen falta al menos dos pasos",
                f.id
            );
            for id in &f.path {
                ensure!(
                    nodes.contains(id.as_str()),
                    "recorrido {}: pieza desconocida {id}",
                    f.id
                );
            }
        }
        for i in &site.incidents {
            for id in &i.clues {
                ensure!(
                    nodes.contains(id.as_str()),
                    "caso {}: pieza desconocida {id}",
                    i.id
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
            required(code, "unit_ui", unit::COMMON_KEYS, &t.unit_ui)?;
            required(code, "rack", RACK_KEYS, &t.rack)?;
            required(code, "blog", BLOG_KEYS, &t.blog)?;
            required(code, "hermes", HERMES_KEYS, &t.hermes.text)?;
            required(code, "incident_ui", INCIDENT_UI_KEYS, &t.incident_ui)?;
            required(code, "compare", COMPARE_KEYS, &t.compare)?;
            required(code, "personality", PERSONALITY_KEYS, &t.personality)?;
            let g = &t.gnomes;
            ensure!(
                [&g.click, &g.fall, &g.trip, &g.near]
                    .iter()
                    .all(|l| !l.is_empty()),
                "{code}.toml [gnomes]: ninguna lista de frases puede ir vacía"
            );
            ensure!(
                t.before_after.before_items.len() == t.before_after.after_items.len(),
                "{code}.toml [before_after]: las dos listas deben tener la misma longitud"
            );
            same_keys(
                code,
                "incidents",
                site.incidents.iter().map(|i| i.id.as_str()),
                keys(&t.incidents),
            )?;
            for i in &site.incidents {
                let it = &t.incidents[&i.id];
                same_keys(
                    code,
                    &format!("incidents.{}.clues", i.id),
                    i.clues.iter().map(String::as_str),
                    keys(&it.clues),
                )?;
                ensure!(
                    it.options.len() >= 2
                        && it.options.len() == it.feedback.len()
                        && i.answer < it.options.len(),
                    "{code}.toml [incidents.{}]: opciones, explicaciones y respuesta no cuadran",
                    i.id
                );
                for (k, f) in it.feedback.iter().enumerate() {
                    ensure!(
                        (k == i.answer) == f.is_empty(),
                        "{code}.toml [incidents.{}]: solo la opción correcta va sin explicación",
                        i.id
                    );
                }
            }
            same_keys(code, "hermes.zones", ZONES, keys(&t.hermes.zones))?;
            same_keys(
                code,
                "groups",
                site.groups.iter().map(|g| g.id.as_str()),
                keys(&t.groups),
            )?;
            same_keys(
                code,
                "flows",
                site.flows.iter().map(|f| f.id.as_str()),
                keys(&t.flows),
            )?;
            let mut cats: HashSet<&str> = site.flows.iter().map(|f| f.category.as_str()).collect();
            cats.insert("all");
            same_keys(code, "flow_categories", cats, keys(&t.flow_categories))?;
            for f in &site.flows {
                let n = t.flows[&f.id].steps.len();
                ensure!(
                    n == f.path.len(),
                    "{code}.toml [flows.{}]: {n} pasos de texto para {} piezas",
                    f.id,
                    f.path.len()
                );
            }
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
    fn flow_steps_must_match_path() {
        let site = include_str!("../content/site.toml");
        let es = include_str!("../content/es.toml");
        let en = include_str!("../content/en.toml")
            .replace("  \"I'm away from home and need a document.\",\n", "");
        assert_ne!(
            en,
            include_str!("../content/en.toml"),
            "la prueba debe quitar un paso"
        );
        let err = Content::parse(site, es, &en).err().expect("debe fallar");
        assert!(err.to_string().contains("flows.remote"), "{err}");
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
