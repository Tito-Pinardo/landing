//! Pre-renderizado de las páginas al arrancar.
//!
//! El contenido no cambia mientras el binario corre, así que cada página se
//! renderiza una vez y se sirve desde memoria con su ETag.

use askama::Template;
use bytes::Bytes;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::content::{Content, Lang, ProjectStatus, Texts, ZONES};

pub struct Page {
    pub body: Bytes,
    pub etag: String,
}

impl Page {
    pub fn new(html: String) -> Page {
        let etag = format!(
            "\"{}\"",
            &hex::encode(Sha256::digest(html.as_bytes()))[..16]
        );
        Page {
            body: Bytes::from(html),
            etag,
        }
    }
}

/// Lo que comparten todas las plantillas.
pub struct Ctx<'a> {
    pub lang: &'static str,
    pub other: &'static str,
    pub t: &'a Texts,
    pub asset_v: &'a str,
    pub public_url: &'a str,
    pub name: &'a str,
    pub github: &'a str,
    pub linkedin: &'a str,
    pub cv_url: &'a str,
}

impl Ctx<'_> {
    pub fn ui(&self, key: &str) -> &str {
        self.t.ui.get(key).map_or("", String::as_str)
    }
    pub fn lab(&self, key: &str) -> &str {
        self.t.lab.get(key).map_or("", String::as_str)
    }
    pub fn contact(&self, key: &str) -> &str {
        self.t.contact.get(key).map_or("", String::as_str)
    }
}

pub struct ZoneView {
    pub id: &'static str,
    pub n: usize,
    pub title: String,
    pub subtitle: String,
}

pub struct BranchView {
    pub id: String,
    pub icon: &'static str,
    pub title: String,
    pub text: String,
    /// Nivel medio de la rama sobre 100, para las barras de la tarjeta.
    pub power: u32,
    pub techs: Vec<TechView>,
}

pub struct TechView {
    pub id: String,
    pub name: String,
    pub level: u8,
    pub level_label: String,
    pub uses: usize,
}

pub struct ProjectView {
    pub id: String,
    pub status: &'static str,
    pub status_label: String,
    pub featured: bool,
    pub title: String,
    pub tagline: String,
    pub context: String,
    pub problem: String,
    pub bullets: Vec<String>,
    pub outcome: String,
    pub lesson: Option<String>,
    pub repo: Option<String>,
    pub tech: Vec<(String, String)>,
    pub tech_ids: String,
}

pub struct NodeView {
    pub id: String,
    pub x: u32,
    pub y: u32,
    pub kind: String,
    pub short: String,
    pub title: String,
    pub text: String,
    pub tech: Vec<String>,
}

pub struct LinkView {
    pub a: String,
    pub b: String,
    pub x1: u32,
    pub y1: u32,
    pub x2: u32,
    pub y2: u32,
}

#[derive(Template)]
#[template(path = "index.html")]
pub struct IndexTpl<'a> {
    pub c: Ctx<'a>,
    pub zones: Vec<ZoneView>,
    pub branches: Vec<BranchView>,
    pub projects: Vec<ProjectView>,
    pub nodes: Vec<NodeView>,
    pub links: Vec<LinkView>,
    pub legend: Vec<(&'static str, String)>,
    pub turnstile_site_key: Option<&'a str>,
    pub i18n_json: String,
    pub jsonld: String,
}

#[derive(Template)]
#[template(path = "result.html")]
pub struct ResultTpl<'a> {
    pub c: Ctx<'a>,
    pub ok: bool,
    pub message: &'a str,
}

#[derive(Template)]
#[template(path = "not_found.html")]
pub struct NotFoundTpl<'a> {
    pub c: Ctx<'a>,
}

pub fn ctx<'a>(content: &'a Content, lang: Lang, asset_v: &'a str, public_url: &'a str) -> Ctx<'a> {
    let p = &content.site.person;
    Ctx {
        lang: lang.code(),
        other: lang.other().code(),
        t: content.texts(lang),
        asset_v,
        public_url,
        name: &p.name,
        github: &p.github,
        linkedin: &p.linkedin,
        cv_url: match lang {
            Lang::Es => &p.cv_es,
            Lang::En => &p.cv_en,
        },
    }
}

pub fn index(
    content: &Content,
    lang: Lang,
    asset_v: &str,
    public_url: &str,
    turnstile_site_key: Option<&str>,
) -> anyhow::Result<Page> {
    let site = &content.site;
    let t = content.texts(lang);
    let c = ctx(content, lang, asset_v, public_url);

    let zones = ZONES
        .iter()
        .enumerate()
        .map(|(i, id)| ZoneView {
            id,
            n: i + 1,
            title: t.zones[*id].title.clone(),
            subtitle: t.zones[*id].subtitle.clone(),
        })
        .collect();

    let tech_name = |id: &str| {
        site.tech
            .iter()
            .find(|x| x.id == id)
            .map(|x| x.name.clone())
            .unwrap_or_default()
    };

    let branches = site
        .branches
        .iter()
        .map(|b| {
            let levels: Vec<u32> = site
                .tech
                .iter()
                .filter(|x| x.branch == b.id)
                .map(|x| u32::from(x.level))
                .collect();
            let power = if levels.is_empty() {
                0
            } else {
                levels.iter().sum::<u32>() * 100 / (3 * levels.len() as u32)
            };
            BranchView {
                id: b.id.clone(),
                power,
                icon: icon(&b.icon),
                title: t.branches[&b.id].title.clone(),
                text: t.branches[&b.id].text.clone(),
                techs: site
                    .tech
                    .iter()
                    .filter(|x| x.branch == b.id)
                    .map(|x| TechView {
                        id: x.id.clone(),
                        name: x.name.clone(),
                        level: x.level,
                        level_label: c.ui(&format!("level_{}", x.level)).to_owned(),
                        uses: site
                            .projects
                            .iter()
                            .filter(|p| p.tech.contains(&x.id))
                            .count(),
                    })
                    .collect(),
            }
        })
        .collect();

    let projects = site
        .projects
        .iter()
        .map(|p| {
            let pt = &t.projects[&p.id];
            ProjectView {
                id: p.id.clone(),
                status: p.status.css(),
                status_label: c
                    .ui(match p.status {
                        ProjectStatus::Done => "status_done",
                        ProjectStatus::Live => "status_live",
                        ProjectStatus::Ongoing => "status_ongoing",
                    })
                    .to_owned(),
                featured: p.featured,
                title: pt.title.clone(),
                tagline: pt.tagline.clone(),
                context: pt.context.clone(),
                problem: pt.problem.clone(),
                bullets: pt.bullets.clone(),
                outcome: pt.outcome.clone(),
                lesson: pt.lesson.clone(),
                repo: p.repo.clone(),
                tech: p
                    .tech
                    .iter()
                    .map(|id| (id.clone(), tech_name(id)))
                    .collect(),
                tech_ids: p.tech.join(" "),
            }
        })
        .collect();

    let nodes: Vec<NodeView> = site
        .nodes
        .iter()
        .map(|n| NodeView {
            id: n.id.clone(),
            x: n.x,
            y: n.y,
            kind: n.kind.clone(),
            short: t.nodes[&n.id].short.clone(),
            title: t.nodes[&n.id].title.clone(),
            text: t.nodes[&n.id].text.clone(),
            tech: n.tech.iter().map(|id| tech_name(id)).collect(),
        })
        .collect();
    let pos = |id: &str| {
        nodes
            .iter()
            .find(|n| n.id == id)
            .map(|n| (n.x, n.y))
            .unwrap_or_default()
    };
    let links = site
        .links
        .iter()
        .map(|[a, b]| {
            let ((x1, y1), (x2, y2)) = (pos(a), pos(b));
            LinkView {
                a: a.clone(),
                b: b.clone(),
                x1,
                y1,
                x2,
                y2,
            }
        })
        .collect();
    let legend = [
        "edge",
        "network",
        "compute",
        "control",
        "observability",
        "ai",
        "app",
    ]
    .into_iter()
    .map(|k| (k, c.lab(&format!("legend_{k}")).to_owned()))
    .collect();

    let tpl = IndexTpl {
        i18n_json: script_json(&i18n(content, lang))?,
        jsonld: script_json(&jsonld(content, lang, public_url))?,
        c,
        zones,
        branches,
        projects,
        nodes,
        links,
        legend,
        turnstile_site_key,
    };
    Ok(Page::new(tpl.render()?))
}

/// Textos que necesita el JavaScript (terminal, logros, datos en vivo).
fn i18n(content: &Content, lang: Lang) -> serde_json::Value {
    let t = content.texts(lang);
    let site = &content.site;
    serde_json::json!({
        "lang": lang.code(),
        "other": lang.other().code(),
        "cv": match lang { Lang::Es => &site.person.cv_es, Lang::En => &site.person.cv_en },
        "ui": t.ui,
        "zones": ZONES.iter().map(|z| serde_json::json!({"id": z, "title": t.zones[*z].title})).collect::<Vec<_>>(),
        "terminal": t.terminal,
        "achievements": site.achievements.iter().map(|a| serde_json::json!({
            "id": a, "title": t.achievements[a].title, "text": t.achievements[a].text
        })).collect::<Vec<_>>(),
        "projects": site.projects.iter().map(|p| serde_json::json!({
            "id": p.id, "title": t.projects[&p.id].title, "tagline": t.projects[&p.id].tagline,
            "outcome": t.projects[&p.id].outcome, "tech": p.tech,
        })).collect::<Vec<_>>(),
        "branches": site.branches.iter().map(|b| serde_json::json!({
            "id": b.id, "title": t.branches[&b.id].title,
            "tech": site.tech.iter().filter(|x| x.branch == b.id)
                .map(|x| serde_json::json!({"id": x.id, "name": x.name, "level": x.level}))
                .collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
        "now": t.now,
        "contact": t.contact,
    })
}

/// Datos estructurados para buscadores (schema.org/Person).
fn jsonld(content: &Content, lang: Lang, public_url: &str) -> serde_json::Value {
    let p = &content.site.person;
    let t = content.texts(lang);
    serde_json::json!({
        "@context": "https://schema.org",
        "@type": "Person",
        "name": p.name,
        "url": public_url,
        "jobTitle": t.hero.role,
        "description": t.meta.description,
        "address": {"@type": "PostalAddress", "addressLocality": "Alcalá de Henares", "addressRegion": "Madrid", "addressCountry": "ES"},
        "sameAs": [p.github, p.linkedin],
        "knowsAbout": content.site.tech.iter().map(|x| &x.name).collect::<Vec<_>>(),
        "knowsLanguage": ["es", "en"],
    })
}

/// JSON seguro dentro de `<script>`: sin `</` ni separadores de línea
/// que rompan el HTML.
fn script_json(v: &impl Serialize) -> anyhow::Result<String> {
    Ok(serde_json::to_string(v)?
        .replace("</", "<\\/")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029"))
}

/// Iconos de las ramas (SVG en línea, trazos con `currentColor`).
fn icon(name: &str) -> &'static str {
    match name {
        "layers" => {
            r#"<path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="m2 13 10 5 10-5"/><path d="m2 17.5 10 5 10-5"/>"#
        }
        "box" => {
            r#"<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>"#
        }
        "network" => {
            r#"<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-2.5h14V17"/>"#
        }
        "shield" => {
            r#"<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/>"#
        }
        _ => r#"<path d="m8 6-6 6 6 6"/><path d="m16 6 6 6-6 6"/><path d="m14 4-4 16"/>"#,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_json_cannot_close_the_tag() {
        let s = script_json(&serde_json::json!({"x": "</script><script>alert(1)"})).unwrap();
        assert!(!s.contains("</"));
    }

    #[test]
    fn both_languages_render() {
        let content = Content::embedded().unwrap();
        for lang in Lang::ALL {
            let page = index(&content, lang, "test", "https://example.org", None).unwrap();
            let html = std::str::from_utf8(&page.body).unwrap();
            assert!(html.contains(&format!("<html lang=\"{}\"", lang.code())));
            assert!(
                html.contains(&content.texts(lang).hero.pitch.replace('\'', "&#39;"))
                    || html.contains("hero")
            );
            for p in &content.site.projects {
                assert!(
                    html.contains(&format!("id=\"quest-{}\"", p.id)),
                    "falta {}",
                    p.id
                );
            }
            assert!(
                !html.contains("challenges.cloudflare.com"),
                "sin Turnstile si no está configurado"
            );
        }
    }
}
