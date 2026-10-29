//! Pre-renderizado de las páginas al arrancar.
//!
//! El contenido no cambia mientras el binario corre, así que cada página se
//! renderiza una vez y se sirve desde memoria con su ETag.

use std::collections::BTreeMap;

use askama::Template;
use bytes::Bytes;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::article::{Article, ArticleText};
use crate::content::{Content, Lang, ProjectStatus, Texts, ZONES};
use crate::unit::{MAP_H, MAP_W, Unit, UnitText};

pub struct Page {
    pub body: Bytes,
    pub etag: String,
}

impl Page {
    pub fn from_bytes(body: Bytes) -> Page {
        let etag = format!("\"{}\"", &hex::encode(Sha256::digest(&body))[..16]);
        Page { body, etag }
    }

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
    /// Ruta de la página dentro del idioma ("" en la portada, "xpify/" en
    /// una unidad): el cambio de idioma lleva a la misma página.
    pub path: String,
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
    /// URL de su unidad en el rack, si la tiene.
    pub unit_url: Option<String>,
}

pub struct NodeView {
    pub id: String,
    pub x: u32,
    pub y: u32,
    pub kind: String,
    pub group: String,
    pub short: String,
    pub title: String,
    pub text: String,
    pub tech: Vec<String>,
    pub tech_ids: String,
    pub unit_url: Option<String>,
}

pub struct GroupView {
    pub id: String,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    pub label: String,
}

pub struct FlowView {
    pub id: String,
    pub category: String,
    pub title: String,
    /// (título de la pieza, texto del paso)
    pub steps: Vec<(String, String)>,
}

/// Una unidad en la lista del rack de la portada.
pub struct RackView {
    pub id: String,
    pub n: usize,
    pub url: String,
    pub slot: String,
    pub specs: String,
    pub state: String,
    pub status: String,
    pub title: String,
    pub tech_ids: String,
    /// Piezas del laboratorio que llevan a esta unidad: su estado en vivo
    /// es el de la unidad.
    pub nodes: String,
}

/// Un artículo en una lista (índice, portada o su unidad).
pub struct ArticleCard {
    pub url: String,
    pub slug: String,
    pub date: String,
    pub date_label: String,
    pub title: String,
    pub description: String,
    /// Entradilla (el artículo destacado del índice la enseña entera).
    pub summary: String,
    /// Día y mes corto para la columna de fecha del archivo («06», «oct»).
    pub day: String,
    pub mon: String,
    pub unit: String,
    pub unit_slot: String,
    pub tech: Vec<String>,
    /// Ids de las tecnologías separados por espacios, para filtrar.
    pub tech_ids: String,
    pub kind: String,
    pub kind_label: String,
}

/// Una opción de filtro del índice del blog: (id, texto, cuántos artículos).
/// Un mes del archivo del blog, con sus artículos.
pub struct MonthGroup {
    pub label: String,
    pub items: Vec<ArticleCard>,
}

pub struct FilterOpt {
    pub id: String,
    pub label: String,
    pub count: usize,
}

#[derive(Template)]
#[template(path = "blog.html")]
pub struct BlogTpl<'a> {
    pub c: Ctx<'a>,
    pub url: String,
    /// El más reciente, destacado arriba; el resto, por meses.
    pub lead: Option<ArticleCard>,
    pub months: Vec<MonthGroup>,
    pub kinds: Vec<FilterOpt>,
    pub techs: Vec<FilterOpt>,
    pub units: Vec<FilterOpt>,
    pub jsonld: String,
}

#[derive(Template)]
#[template(path = "article.html")]
pub struct ArticleTpl<'a> {
    pub c: Ctx<'a>,
    pub url: String,
    pub slug: &'a str,
    pub date: &'a str,
    pub date_label: String,
    pub t: &'a ArticleText,
    pub tech: Vec<String>,
    pub kind: &'a str,
    pub kind_label: String,
    pub postmortem: bool,
    pub unit_url: String,
    pub unit_slot: String,
    pub jsonld: String,
}

/// Unidad vecina en el rack, para pasar de una a otra.
pub struct UnitNav {
    pub url: String,
    pub slot: String,
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
    pub groups: Vec<GroupView>,
    pub flows: Vec<FlowView>,
    pub flow_tabs: Vec<(String, String)>,
    pub links: Vec<LinkView>,
    pub legend: Vec<(&'static str, String)>,
    pub rack: Vec<RackView>,
    pub posts: Vec<ArticleCard>,
    pub turnstile_site_key: Option<&'a str>,
    /// Nota para asistentes de IA del formulario, con la palabra clave.
    pub ai_note: String,
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
        path: String::new(),
    }
}

/// Piezas del laboratorio que llevan a una unidad.
fn unit_nodes<'a>(site: &'a crate::content::Site, unit: &str) -> Vec<&'a str> {
    site.nodes
        .iter()
        .filter(|n| n.unit.as_deref() == Some(unit))
        .map(|n| n.id.as_str())
        .collect()
}

fn unit_url(lang: Lang, id: &str) -> String {
    format!("/{}/{id}/", lang.code())
}

pub fn index(
    content: &Content,
    lang: Lang,
    asset_v: &str,
    public_url: &str,
    turnstile_site_key: Option<&str>,
    canary: &str,
) -> anyhow::Result<Page> {
    let site = &content.site;
    let t = content.texts(lang);
    let ai_note = t.contact["ai_note"].replace("{canary}", canary);
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
                unit_url: content.project_unit(&p.id).map(|u| unit_url(lang, &u.id)),
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
            group: n.group.clone(),
            short: t.nodes[&n.id].short.clone(),
            title: t.nodes[&n.id].title.clone(),
            text: t.nodes[&n.id].text.clone(),
            tech: n.tech.iter().map(|id| tech_name(id)).collect(),
            tech_ids: n.tech.join(" "),
            unit_url: n.unit.as_deref().map(|u| unit_url(lang, u)),
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
    let groups = site
        .groups
        .iter()
        .map(|g| GroupView {
            id: g.id.clone(),
            x: g.x,
            y: g.y,
            w: g.w,
            h: g.h,
            label: t.groups[&g.id].clone(),
        })
        .collect();
    let flows = site
        .flows
        .iter()
        .map(|f| FlowView {
            id: f.id.clone(),
            category: f.category.clone(),
            title: t.flows[&f.id].title.clone(),
            steps: f
                .path
                .iter()
                .zip(&t.flows[&f.id].steps)
                .map(|(node, text)| (t.nodes[node].title.clone(), text.clone()))
                .collect(),
        })
        .collect();
    // Pestañas en el orden en que aparecen los recorridos, con "todos" primero.
    let mut flow_tabs: Vec<(String, String)> =
        vec![("all".into(), t.flow_categories["all"].clone())];
    for f in &site.flows {
        if !flow_tabs.iter().any(|(id, _)| *id == f.category) {
            flow_tabs.push((f.category.clone(), t.flow_categories[&f.category].clone()));
        }
    }
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

    let rack = content
        .units
        .iter()
        .enumerate()
        .map(|(i, u)| {
            let ut = u.texts(lang);
            RackView {
                id: u.id.clone(),
                n: i + 1,
                url: unit_url(lang, &u.id),
                slot: ut.ui["slot"].clone(),
                specs: ut.ui["face_specs"].clone(),
                state: ut.ui["state"].clone(),
                status: u.status.clone(),
                title: ut.hero.title.clone(),
                tech_ids: u.tech(site).join(" "),
                nodes: unit_nodes(site, &u.id).join(" "),
            }
        })
        .collect();

    let tpl = IndexTpl {
        i18n_json: script_json(&i18n(content, lang))?,
        jsonld: script_json(&jsonld(content, lang, public_url))?,
        c,
        zones,
        branches,
        projects,
        nodes,
        groups,
        flows,
        flow_tabs,
        links,
        legend,
        rack,
        posts: content
            .articles
            .iter()
            .take(3)
            .map(|a| article_card(content, a, lang))
            .collect(),
        turnstile_site_key,
        ai_note,
    };
    Ok(Page::new(tpl.render()?))
}

pub struct SkillView {
    pub id: String,
    pub name: String,
    pub note: String,
}

/// Una pestaña de «antes y después»: sus medidas con las barras ya
/// calculadas (anchos en % del mayor de los dos, para el SVG).
pub struct BenchGroupView<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub rows: Vec<BenchRowView<'a>>,
}

pub struct BenchRowView<'a> {
    pub label: &'a str,
    pub why: &'a str,
    pub before: String,
    pub after: String,
    pub before_w: String,
    pub after_w: String,
    /// «−84 %» o «×2,3»; `better` lo pinta en verde.
    pub delta: String,
    pub better: bool,
}

/// Número con la coma o el punto de cada idioma; sin decimales si es entero.
fn num(v: f64, lang: Lang) -> String {
    let s = if v.fract() == 0.0 || v.abs() >= 100.0 {
        format!("{v:.0}")
    } else {
        format!("{v:.1}")
    };
    if lang == Lang::Es {
        s.replace('.', ",")
    } else {
        s
    }
}

fn bench_views<'a>(unit: &'a Unit, t: &'a UnitText, lang: Lang) -> Vec<BenchGroupView<'a>> {
    let Some(tb) = &t.bench else {
        return Vec::new();
    };
    tb.groups
        .iter()
        .map(|(id, name)| BenchGroupView {
            id,
            name,
            rows: unit
                .bench
                .iter()
                .filter(|b| &b.group == id)
                .map(|b| {
                    let max = b.before.max(b.after);
                    let better = if b.higher {
                        b.after > b.before
                    } else {
                        b.after < b.before
                    };
                    // Lo que sube mucho se cuenta en veces; lo demás, en %.
                    let ratio = b.after / b.before;
                    let delta = if ratio >= 2.0 {
                        format!("×{}", num((ratio * 10.0).round() / 10.0, lang))
                    } else {
                        let pct = ((ratio - 1.0) * 100.0).round();
                        format!(
                            "{}{} %",
                            if pct < 0.0 { "−" } else { "+" },
                            num(pct.abs(), lang)
                        )
                    };
                    let rt = &tb.rows[&b.id];
                    BenchRowView {
                        label: &rt.label,
                        why: &rt.why,
                        before: format!("{} {}", num(b.before, lang), b.unit),
                        after: format!("{} {}", num(b.after, lang), b.unit),
                        before_w: format!("{:.1}", 100.0 * b.before / max),
                        after_w: format!("{:.1}", 100.0 * b.after / max),
                        delta,
                        better,
                    }
                })
                .collect(),
        })
        .collect()
}

/// El plano de los repositorios: nodos en columnas por capa, las líneas de
/// quién usa a quién y el reparto de líneas por lenguaje. Las posiciones se
/// calculan aquí; el navegador solo resalta.
pub struct ReposView<'a> {
    pub repos: Vec<RepoView<'a>>,
    pub edges: Vec<RepoEdge>,
    pub layers: Vec<(&'a str, u32)>,
    pub mix: Vec<LangShare<'a>>,
    pub total: String,
    pub h: u32,
}

pub struct RepoView<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub lang: &'a str,
    pub lang_name: &'a str,
    pub loc: String,
    pub tests: String,
    pub commits: String,
    pub version: &'a str,
    pub retired: bool,
    pub role: &'a str,
    pub summary: &'a str,
    pub tree: &'a [(String, String)],
    /// (id, nombre) de los que usa y con los que habla.
    pub uses: Vec<(&'a str, &'a str)>,
    pub talks: Vec<(&'a str, &'a str)>,
    pub x: u32,
    pub y: u32,
}

pub struct RepoEdge {
    pub from: String,
    pub to: String,
    pub uses: bool,
    pub d: String,
}

pub struct LangShare<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub x: String,
    pub w: String,
    pub pct: String,
}

const REPO_COL: u32 = 300;
const REPO_W: u32 = 272;
const REPO_H: u32 = 58;
const REPO_ROW: u32 = 80;
const REPO_TOP: u32 = 46;

/// Miles con el separador de cada idioma (28 431 / 28,431).
fn miles(v: u32, lang: Lang) -> String {
    let s = v.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push(if lang == Lang::Es { '\u{202f}' } else { ',' });
        }
        out.push(c);
    }
    out
}

fn repos_view<'a>(unit: &'a Unit, t: &'a UnitText, lang: Lang) -> Option<ReposView<'a>> {
    let tr = t.repos.as_ref()?;
    let mut pos: BTreeMap<&str, (u32, u32)> = BTreeMap::new();
    let mut rows = 0;
    let layers: Vec<(&str, u32)> = tr
        .layers
        .iter()
        .enumerate()
        .map(|(i, (id, name))| {
            let x = 10 + i as u32 * REPO_COL;
            let mut n = 0;
            for r in unit.repos.iter().filter(|r| &r.layer == id) {
                pos.insert(&r.id, (x, REPO_TOP + n * REPO_ROW));
                n += 1;
            }
            rows = rows.max(n);
            (name.as_str(), x)
        })
        .collect();
    let name = |id: &str| {
        unit.repos
            .iter()
            .find(|r| r.id == id)
            .map_or("", |r| r.name.as_str())
    };
    // Curva entre los lados que se miran; en la misma columna, por fuera a la derecha.
    let curve = |a: &str, b: &str| {
        let ((ax, ay), (bx, by)) = (pos[a], pos[b]);
        let (ay, by) = (ay + REPO_H / 2, by + REPO_H / 2);
        if ax == bx {
            let x = ax + REPO_W;
            format!("M{x} {ay} C{} {ay} {} {by} {x} {by}", x + 24, x + 24)
        } else if ax < bx {
            let (x1, x2) = (ax + REPO_W, bx);
            let m = (x1 + x2) / 2;
            format!("M{x1} {ay} C{m} {ay} {m} {by} {x2} {by}")
        } else {
            let (x1, x2) = (ax, bx + REPO_W);
            let m = (x1 + x2) / 2;
            format!("M{x1} {ay} C{m} {ay} {m} {by} {x2} {by}")
        }
    };
    let mut edges = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for r in &unit.repos {
        for u in &r.uses {
            edges.push(RepoEdge {
                from: r.id.clone(),
                to: u.clone(),
                uses: true,
                d: curve(&r.id, u),
            });
        }
        for o in &r.talks {
            let k = if &r.id < o {
                (r.id.as_str(), o.as_str())
            } else {
                (o.as_str(), r.id.as_str())
            };
            if seen.insert(k) {
                edges.push(RepoEdge {
                    from: r.id.clone(),
                    to: o.clone(),
                    uses: false,
                    d: curve(&r.id, o),
                });
            }
        }
    }
    let mut por_lang: Vec<(&str, u32)> = Vec::new();
    for r in unit.repos.iter().filter(|r| !r.retired) {
        match por_lang.iter_mut().find(|(l, _)| *l == r.lang) {
            Some(x) => x.1 += r.loc,
            None => por_lang.push((&r.lang, r.loc)),
        }
    }
    por_lang.sort_by_key(|a| std::cmp::Reverse(a.1));
    let total: u32 = por_lang.iter().map(|(_, n)| n).sum();
    let mut x = 0.0;
    let mix = por_lang
        .iter()
        .map(|(l, n)| {
            let w = 100.0 * f64::from(*n) / f64::from(total.max(1));
            let v = LangShare {
                id: l,
                name: &tr.langs[*l],
                x: format!("{x:.2}"),
                w: format!("{w:.2}"),
                pct: format!("{} %", num((w * 10.0).round() / 10.0, lang)),
            };
            x += w;
            v
        })
        .collect();
    let repos = unit
        .repos
        .iter()
        .map(|r| {
            let it = &tr.items[&r.id];
            let (x, y) = pos[r.id.as_str()];
            // Con quién habla, en los dos sentidos (se apunta en uno solo).
            let talks = unit
                .repos
                .iter()
                .filter(|o| r.talks.contains(&o.id) || o.talks.contains(&r.id))
                .map(|o| (o.id.as_str(), o.name.as_str()))
                .collect();
            RepoView {
                id: &r.id,
                name: &r.name,
                lang: &r.lang,
                lang_name: &tr.langs[&r.lang],
                loc: miles(r.loc, lang),
                tests: miles(r.tests, lang),
                commits: miles(r.commits, lang),
                version: &r.version,
                retired: r.retired,
                role: &it.role,
                summary: &it.summary,
                tree: &it.tree,
                uses: r.uses.iter().map(|u| (u.as_str(), name(u))).collect(),
                talks,
                x,
                y,
            }
        })
        .collect();
    Some(ReposView {
        repos,
        edges,
        layers,
        mix,
        total: miles(total, lang),
        h: REPO_TOP + rows * REPO_ROW,
    })
}

pub struct IncidentView<'a> {
    pub id: &'a str,
    pub n: usize,
    pub title: &'a str,
    pub meta: &'a str,
    pub symptom: &'a str,
    pub options: &'a [String],
    pub answer: usize,
    pub cause: &'a str,
    pub fix: &'a str,
    pub lesson: &'a str,
}

#[derive(Template)]
#[template(path = "unit.html")]
pub struct UnitTpl<'a> {
    pub c: Ctx<'a>,
    pub id: &'a str,
    pub t: &'a UnitText,
    pub url: String,
    pub back_url: String,
    pub pods: Vec<NodeView>,
    pub groups: Vec<GroupView>,
    pub links: Vec<LinkView>,
    pub flows: Vec<FlowView>,
    pub skills: Vec<SkillView>,
    pub incidents: Vec<IncidentView<'a>>,
    pub bench: Vec<BenchGroupView<'a>>,
    pub repos: Option<ReposView<'a>>,
    pub common: &'a BTreeMap<String, String>,
    pub status: &'a str,
    /// «Posición 3 de 23 en el rack» y el estado, ya rellenos.
    pub pos_label: String,
    pub status_label: String,
    pub prev: Option<UnitNav>,
    pub next: Option<UnitNav>,
    pub has_xp: bool,
    /// Rótulo de cada bahía, numeradas según las que tenga la unidad.
    pub bays: BTreeMap<&'static str, String>,
    pub posts: Vec<ArticleCard>,
    /// Enlaces a su código en el repositorio público: (ruta, url).
    pub code: Vec<(String, String)>,
    pub jsonld: String,
    pub host_tech: String,
    pub map_w: u32,
    pub map_h: u32,
    pub data_json: String,
}

impl UnitTpl<'_> {
    pub fn ui(&self, key: &str) -> &str {
        self.t
            .ui
            .get(key)
            .or_else(|| self.common.get(key))
            .map_or("", String::as_str)
    }
    pub fn bay(&self, key: &str) -> &str {
        self.bays.get(key).map_or("", String::as_str)
    }
}

/// Página de una unidad del rack.
pub fn unit(
    content: &Content,
    unit: &Unit,
    lang: Lang,
    asset_v: &str,
    public_url: &str,
) -> anyhow::Result<Page> {
    let site = &content.site;
    let t = unit.texts(lang);
    let mut c = ctx(content, lang, asset_v, public_url);
    c.path = format!("{}/", unit.id);
    let tech_name = |id: &str| {
        site.tech
            .iter()
            .find(|x| x.id == id)
            .map(|x| x.name.clone())
            .unwrap_or_default()
    };

    let pods: Vec<NodeView> = unit
        .pods
        .iter()
        .map(|n| NodeView {
            id: n.id.clone(),
            x: n.x,
            y: n.y,
            kind: n.kind.clone(),
            group: n.group.clone(),
            short: t.pods[&n.id].short.clone(),
            title: t.pods[&n.id].title.clone(),
            text: t.pods[&n.id].text.clone(),
            tech: n.tech.iter().map(|id| tech_name(id)).collect(),
            tech_ids: n.tech.join(" "),
            unit_url: None,
        })
        .collect();
    let pos = |id: &str| {
        pods.iter()
            .find(|n| n.id == id)
            .map(|n| (n.x, n.y))
            .unwrap_or_default()
    };
    let links = unit
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
    let groups = unit
        .groups
        .iter()
        .map(|g| GroupView {
            id: g.id.clone(),
            x: g.x,
            y: g.y,
            w: g.w,
            h: g.h,
            label: t.groups[&g.id].clone(),
        })
        .collect();
    let flows = unit
        .flows
        .iter()
        .map(|f| FlowView {
            id: f.id.clone(),
            category: String::new(),
            title: t.flows[&f.id].title.clone(),
            steps: f
                .path
                .iter()
                .zip(&t.flows[&f.id].steps)
                .map(|(pod, text)| (t.pods[pod].title.clone(), text.clone()))
                .collect(),
        })
        .collect();
    // En el orden de la misión, que es el del árbol de habilidades.
    let skills = unit
        .tech(site)
        .into_iter()
        .map(|id| SkillView {
            id: id.to_owned(),
            name: tech_name(id),
            note: t.tech_notes[id].clone(),
        })
        .collect();
    let incidents = unit
        .incidents
        .iter()
        .enumerate()
        .map(|(n, i)| {
            let it = &t.incidents[&i.id];
            IncidentView {
                id: &i.id,
                n: n + 1,
                title: &it.title,
                meta: &it.meta,
                symptom: &it.symptom,
                options: &it.options,
                answer: i.answer,
                cause: &it.cause,
                fix: &it.fix,
                lesson: &it.lesson,
            }
        })
        .collect();

    let mt = content.texts(lang);
    let mut ui = mt.unit_ui.clone();
    ui.extend(t.ui.iter().map(|(k, v)| (k.clone(), v.clone())));
    let pos = content
        .units
        .iter()
        .position(|u| u.id == unit.id)
        .unwrap_or_default();
    let neighbour = |i: usize| {
        content.units.get(i).map(|u| UnitNav {
            url: unit_url(lang, &u.id),
            slot: u.texts(lang).ui["slot"].clone(),
        })
    };
    let mut bays = BTreeMap::new();
    let mut n = 0;
    for (key, label, on) in [
        ("hero", unit.id.to_uppercase(), true),
        ("map", t.ui["map_silk"].clone(), true),
        ("skills", "SKILLS".into(), true),
        ("xp", "XP ENGINE".into(), unit.xp.is_some()),
        ("vram", "VRAM".into(), unit.vram.is_some()),
        ("bench", "BENCH".into(), !unit.bench.is_empty()),
        ("repos", "SOURCE".into(), !unit.repos.is_empty()),
        ("incidents", "LOGS".into(), !unit.incidents.is_empty()),
        ("build", "BUILD".into(), true),
        ("close", "EOF".into(), true),
    ] {
        if on {
            bays.insert(key, format!("BAY {n:02} · {label}"));
            n += 1;
        }
    }
    let data = serde_json::json!({
        "lang": lang.code(),
        "id": unit.id,
        "ui": ui,
        "pods": unit.pods.iter().map(|n| serde_json::json!({
            "id": n.id, "x": n.x, "y": n.y, "short": t.pods[&n.id].short, "title": t.pods[&n.id].title, "text": t.pods[&n.id].text, "tech": n.tech,
        })).collect::<Vec<_>>(),
        "flows": unit.flows.iter().map(|f| serde_json::json!({
            "id": f.id, "title": t.flows[&f.id].title, "path": f.path, "steps": t.flows[&f.id].steps,
        })).collect::<Vec<_>>(),
        "host_tech": unit.host_tech,
        "xp": unit.xp,
        "difficulties": t.xp.as_ref().map(|x| &x.difficulties),
        "vram": unit.vram,
        "vram_text": t.vram,
        "map_w": MAP_W,
        "live_nodes": unit_nodes(site, &unit.id),
        "home": format!("/{}/", lang.code()),
        "achievement": {
            "label": c.ui("achievement_unlocked"),
            "title": mt.achievements["insider"].title,
            "text": mt.achievements["insider"].text,
        },
    });

    let tpl = UnitTpl {
        url: format!("{public_url}{}", unit_url(lang, &unit.id)),
        // «Volver al rack» deja en la fila de esta unidad (y la transición la
        // devuelve a su hueco); las migas siguen yendo al laboratorio.
        back_url: format!("/{}/#ru-{}", lang.code(), unit.id),
        id: &unit.id,
        t,
        pods,
        groups,
        links,
        flows,
        skills,
        incidents,
        bench: bench_views(unit, t, lang),
        repos: repos_view(unit, t, lang),
        common: &mt.unit_ui,
        status: &unit.status,
        pos_label: ui["rack_pos"]
            .replace("{n}", &(pos + 1).to_string())
            .replace("{total}", &content.units.len().to_string()),
        status_label: ui[&format!("status_{}", unit.status)].clone(),
        prev: pos.checked_sub(1).and_then(neighbour),
        next: neighbour(pos + 1),
        has_xp: unit.xp.is_some(),
        bays,
        posts: content
            .unit_articles(&unit.id)
            .map(|a| article_card(content, a, lang))
            .collect(),
        code: unit
            .code
            .iter()
            .map(|path| (path.clone(), code_url(content, path)))
            .collect(),
        jsonld: script_json(&unit_jsonld(content, unit, lang, public_url))?,
        host_tech: unit.host_tech.join(" "),
        map_w: MAP_W,
        map_h: MAP_H,
        data_json: script_json(&data)?,
        c,
    };
    Ok(Page::new(tpl.render()?))
}

fn article_url(lang: Lang, slug: &str) -> String {
    format!("/{}/blog/{slug}/", lang.code())
}

/// «2026-08-07» → «7 de agosto de 2026» / «7 August 2026».
const MONTHS_ES: [&str; 12] = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
];
const MONTHS_EN: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// Año, índice del mes (0-11) y día de una fecha AAAA-MM-DD.
fn date_parts(date: &str) -> Option<(&str, usize, u32)> {
    let mut parts = date.split('-');
    let (y, m, d) = (parts.next()?, parts.next()?, parts.next()?);
    let i = m
        .parse::<usize>()
        .ok()?
        .checked_sub(1)
        .filter(|i| *i < 12)?;
    Some((y, i, d.parse().ok()?))
}

pub fn date_label(date: &str, lang: Lang) -> String {
    let Some((y, i, d)) = date_parts(date) else {
        return date.to_owned();
    };
    match lang {
        Lang::Es => format!("{d} de {} de {y}", MONTHS_ES[i]),
        Lang::En => format!("{d} {} {y}", MONTHS_EN[i]),
    }
}

/// «octubre de 2026» / «October 2026»: el rótulo de cada mes del archivo.
fn month_label(date: &str, lang: Lang) -> String {
    let Some((y, i, _)) = date_parts(date) else {
        return date.to_owned();
    };
    match lang {
        Lang::Es => format!("{} de {y}", MONTHS_ES[i]),
        Lang::En => format!("{} {y}", MONTHS_EN[i]),
    }
}

fn tech_names(site: &crate::content::Site, ids: &[String]) -> Vec<String> {
    ids.iter()
        .filter_map(|id| site.tech.iter().find(|t| &t.id == id))
        .map(|t| t.name.clone())
        .collect()
}

fn unit_slot(content: &Content, unit: &str, lang: Lang) -> String {
    content
        .unit(unit)
        .map(|u| u.texts(lang).ui["slot"].clone())
        .unwrap_or_default()
}

fn article_card(content: &Content, a: &Article, lang: Lang) -> ArticleCard {
    let t = a.texts(lang);
    ArticleCard {
        url: article_url(lang, &a.slug),
        slug: a.slug.clone(),
        date: a.date.clone(),
        date_label: date_label(&a.date, lang),
        title: t.title.clone(),
        description: t.description.clone(),
        summary: t.summary.clone(),
        day: date_parts(&a.date).map_or_else(String::new, |(_, _, d)| format!("{d:02}")),
        mon: date_parts(&a.date).map_or_else(String::new, |(_, i, _)| {
            let m = match lang {
                Lang::Es => MONTHS_ES[i],
                Lang::En => MONTHS_EN[i],
            };
            m.chars().take(3).collect()
        }),
        unit: a.unit.clone(),
        unit_slot: unit_slot(content, &a.unit, lang),
        tech: tech_names(&content.site, &a.tech),
        tech_ids: a.tech.join(" "),
        kind: a.kind.clone(),
        kind_label: kind_label(content, &a.kind, lang),
    }
}

fn kind_label(content: &Content, kind: &str, lang: Lang) -> String {
    content.texts(lang).blog[&format!("kind_{kind}")].clone()
}

/// Cuenta cuántas veces sale cada id, en el orden en que aparece primero.
fn count_opts<'a>(
    ids: impl Iterator<Item = &'a str>,
    label: impl Fn(&str) -> String,
) -> Vec<FilterOpt> {
    let mut out: Vec<FilterOpt> = Vec::new();
    for id in ids {
        match out.iter_mut().find(|o| o.id == id) {
            Some(o) => o.count += 1,
            None => out.push(FilterOpt {
                id: id.to_owned(),
                label: label(id),
                count: 1,
            }),
        }
    }
    out
}

/// Índice de búsqueda del blog: todo el texto de cada artículo en minúsculas,
/// para que el navegador busque sin servidor. Se pide al empezar a escribir.
pub fn blog_index(content: &Content, lang: Lang) -> anyhow::Result<Bytes> {
    let items: Vec<serde_json::Value> = content
        .articles
        .iter()
        .map(|a| {
            let t = a.texts(lang);
            let mut text = vec![t.title.as_str(), &t.description, &t.summary, &t.lesson];
            text.extend(t.impact.as_deref());
            text.extend(t.detected.as_deref());
            for s in &t.sections {
                text.push(&s.heading);
                text.extend(s.paragraphs.iter().map(String::as_str));
                text.extend(s.list.iter().map(String::as_str));
                text.extend(s.code.as_deref());
                for l in &s.links {
                    text.push(&l.title);
                    text.push(&l.source);
                }
            }
            let tech = tech_names(&content.site, &a.tech).join(" ");
            serde_json::json!({ "slug": a.slug, "text": format!("{} {tech}", text.join(" ")).to_lowercase() })
        })
        .collect();
    Ok(Bytes::from(serde_json::to_vec(&items)?))
}

fn author(content: &Content, public_url: &str) -> serde_json::Value {
    let p = &content.site.person;
    serde_json::json!({"@type": "Person", "name": p.name, "url": public_url, "sameAs": same_as(p)})
}

/// Perfiles que son la misma persona: GitHub, LinkedIn y los demás.
fn same_as(p: &crate::content::Person) -> Vec<&str> {
    [p.github.as_str(), p.linkedin.as_str()]
        .into_iter()
        .chain(p.profiles.iter().map(String::as_str))
        .collect()
}

fn crumbs(items: &[(&str, String)]) -> serde_json::Value {
    serde_json::json!({
        "@type": "BreadcrumbList",
        "itemListElement": items.iter().enumerate().map(|(i, (name, url))| serde_json::json!({
            "@type": "ListItem", "position": i + 1, "name": name, "item": url,
        })).collect::<Vec<_>>(),
    })
}

fn unit_jsonld(content: &Content, unit: &Unit, lang: Lang, public_url: &str) -> serde_json::Value {
    let t = unit.texts(lang);
    let mt = content.texts(lang);
    let url = format!("{public_url}{}", unit_url(lang, &unit.id));
    serde_json::json!({
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "TechArticle",
                "headline": t.hero.title,
                "description": t.meta.description,
                "inLanguage": lang.code(),
                "url": url,
                "author": author(content, public_url),
                "about": tech_names(&content.site, &unit.tech(&content.site).iter().map(|s| s.to_string()).collect::<Vec<_>>()),
            },
            crumbs(&[
                (&mt.unit_ui["crumb_rack"], format!("{public_url}/{}/", lang.code())),
                (&mt.unit_ui["crumb_lab"], format!("{public_url}/{}/#lab", lang.code())),
                (&t.ui["slot"], url.clone()),
            ]),
        ],
    })
}

/// Índice de artículos.
pub fn blog(
    content: &Content,
    lang: Lang,
    asset_v: &str,
    public_url: &str,
) -> anyhow::Result<Page> {
    let mut c = ctx(content, lang, asset_v, public_url);
    c.path = "blog/".into();
    let t = content.texts(lang);
    let url = format!("{public_url}/{}/blog/", lang.code());
    let articles: Vec<ArticleCard> = content
        .articles
        .iter()
        .map(|a| article_card(content, a, lang))
        .collect();
    let jsonld = serde_json::json!({
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Blog",
                "name": t.blog["title"],
                "description": t.blog["meta_description"],
                "url": url,
                "inLanguage": lang.code(),
                "author": author(content, public_url),
                "blogPost": articles.iter().map(|a| serde_json::json!({
                    "@type": "BlogPosting", "headline": a.title, "datePublished": a.date,
                    "url": format!("{public_url}{}", a.url),
                })).collect::<Vec<_>>(),
            },
            crumbs(&[
                (&t.unit_ui["crumb_rack"], format!("{public_url}/{}/", lang.code())),
                (&t.blog["crumb"], url.clone()),
            ]),
        ],
    });
    let kinds = count_opts(content.articles.iter().map(|a| a.kind.as_str()), |k| {
        kind_label(content, k, lang)
    });
    let mut techs = count_opts(
        content
            .articles
            .iter()
            .flat_map(|a| a.tech.iter().map(String::as_str)),
        |id| tech_names(&content.site, &[id.to_owned()]).join(""),
    );
    techs.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.label.cmp(&b.label)));
    let units = count_opts(content.articles.iter().map(|a| a.unit.as_str()), |u| {
        unit_slot(content, u, lang)
    });
    let mut rest = content.articles.iter();
    let lead = rest.next().map(|a| article_card(content, a, lang));
    let mut months: Vec<MonthGroup> = Vec::new();
    for a in rest {
        let label = month_label(&a.date, lang);
        match months.last_mut() {
            Some(m) if m.label == label => m.items.push(article_card(content, a, lang)),
            _ => months.push(MonthGroup {
                label,
                items: vec![article_card(content, a, lang)],
            }),
        }
    }
    let tpl = BlogTpl {
        jsonld: script_json(&jsonld)?,
        url,
        lead,
        months,
        kinds,
        techs,
        units,
        c,
    };
    Ok(Page::new(tpl.render()?))
}

/// Página de un artículo.
pub fn article(
    content: &Content,
    a: &Article,
    lang: Lang,
    asset_v: &str,
    public_url: &str,
) -> anyhow::Result<Page> {
    let mut c = ctx(content, lang, asset_v, public_url);
    c.path = format!("blog/{}/", a.slug);
    let t = a.texts(lang);
    let mt = content.texts(lang);
    let url = format!("{public_url}{}", article_url(lang, &a.slug));
    let tech = tech_names(&content.site, &a.tech);
    let jsonld = serde_json::json!({
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "TechArticle",
                "headline": t.title,
                "description": t.description,
                "datePublished": a.date,
                "inLanguage": lang.code(),
                "url": url,
                "mainEntityOfPage": url,
                "image": format!("{public_url}/static/og.png"),
                "author": author(content, public_url),
                "keywords": tech,
            },
            crumbs(&[
                (&mt.unit_ui["crumb_rack"], format!("{public_url}/{}/", lang.code())),
                (&mt.blog["crumb"], format!("{public_url}/{}/blog/", lang.code())),
                (&t.title, url.clone()),
            ]),
        ],
    });
    let tpl = ArticleTpl {
        jsonld: script_json(&jsonld)?,
        url,
        slug: &a.slug,
        date: &a.date,
        date_label: date_label(&a.date, lang),
        t,
        tech,
        kind: &a.kind,
        kind_label: kind_label(content, &a.kind, lang),
        postmortem: a.is_postmortem(),
        unit_url: unit_url(lang, &a.unit),
        unit_slot: unit_slot(content, &a.unit, lang),
        c,
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
        "lab": t.lab,
        "hermes": t.hermes,
        "nodes": site.nodes.iter().map(|n| serde_json::json!({
            "id": n.id, "x": n.x, "y": n.y, "title": t.nodes[&n.id].title, "text": t.nodes[&n.id].text,
            "unit": n.unit.as_deref().map(|u| unit_url(lang, u)),
        })).collect::<Vec<_>>(),
        // Unidades del rack: a dónde llevar y qué contar al filtrar.
        "units": content.units.iter().map(|u| serde_json::json!({
            "id": u.id, "project": u.project, "url": unit_url(lang, &u.id),
            "slot": u.texts(lang).ui["slot"], "tech": u.tech(site),
            "notes": u.texts(lang).tech_notes,
        })).collect::<Vec<_>>(),
        "rack": t.rack,
        // Retos de bandera: solo el hash (la bandera no está en la página).
        "flags": site.flags.iter().map(|f| serde_json::json!({
            "id": f.id, "sha256": f.sha256, "unit": unit_url(lang, &f.unit),
        })).collect::<Vec<_>>(),
        "incident_ui": t.incident_ui,
        "compare": t.compare,
        "personality": t.personality,
        "gnomes": t.gnomes,
        "incidents": site.incidents.iter().map(|i| {
            let it = &t.incidents[&i.id];
            serde_json::json!({
                "id": i.id, "title": it.title, "intro": it.intro, "options": it.options,
                "feedback": it.feedback, "answer": i.answer, "solution": it.solution,
                "lesson": it.lesson, "clues": it.clues,
            })
        }).collect::<Vec<_>>(),
        "flows": site.flows.iter().map(|f| serde_json::json!({
            "id": f.id, "category": f.category, "title": t.flows[&f.id].title, "path": f.path, "steps": t.flows[&f.id].steps,
            "broken": f.broken, "verdict": t.flows[&f.id].verdict,
        })).collect::<Vec<_>>(),
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
        "sameAs": same_as(p),
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

/// Dónde está una ruta en el repositorio público de la infraestructura:
/// las carpetas se abren como árbol y los ficheros como fichero.
fn code_url(content: &Content, path: &str) -> String {
    let repo = content
        .site
        .project(CODE_PROJECT)
        .and_then(|p| p.repo.as_deref())
        .unwrap_or_default();
    let kind = if path.rsplit('/').next().is_some_and(|f| f.contains('.')) {
        "blob"
    } else {
        "tree"
    };
    format!("{repo}/{kind}/main/{path}")
}

/// La misión cuyo repositorio es el de la infraestructura.
pub const CODE_PROJECT: &str = "homelab-iac";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_json_cannot_close_the_tag() {
        let s = script_json(&serde_json::json!({"x": "</script><script>alert(1)"})).unwrap();
        assert!(!s.contains("</"));
    }

    #[test]
    fn units_render_in_both_languages() {
        let content = Content::embedded().unwrap();
        for u in &content.units {
            for lang in Lang::ALL {
                let page = unit(&content, u, lang, "test", "https://example.org").unwrap();
                let html = std::str::from_utf8(&page.body).unwrap();
                assert!(
                    html.contains(&format!("href=\"/{}/{}/\"", lang.other().code(), u.id)),
                    "el cambio de idioma lleva a la misma unidad"
                );
                for p in &u.pods {
                    assert!(html.contains(&format!("data-pod=\"{}\"", p.id)));
                }
            }
        }
    }

    #[test]
    fn dates_read_naturally() {
        assert_eq!(date_label("2026-08-07", Lang::Es), "7 de agosto de 2026");
        assert_eq!(date_label("2026-10-13", Lang::En), "13 October 2026");
        assert_eq!(date_label("roto", Lang::Es), "roto");
    }

    #[test]
    fn articles_render_in_both_languages() {
        let content = Content::embedded().unwrap();
        for lang in Lang::ALL {
            let html = blog(&content, lang, "test", "https://example.org").unwrap();
            let html = std::str::from_utf8(&html.body).unwrap();
            for a in &content.articles {
                assert!(html.contains(&format!("/{}/blog/{}/", lang.code(), a.slug)));
                let page = article(&content, a, lang, "test", "https://example.org").unwrap();
                let page = std::str::from_utf8(&page.body).unwrap();
                assert!(page.contains("\"TechArticle\""));
                assert!(page.contains(&format!(
                    "href=\"/{}/blog/{}/\"",
                    lang.other().code(),
                    a.slug
                )));
            }
        }
    }

    #[test]
    fn both_languages_render() {
        let content = Content::embedded().unwrap();
        for lang in Lang::ALL {
            let page = index(
                &content,
                lang,
                "test",
                "https://example.org",
                None,
                "fanal-ocelote",
            )
            .unwrap();
            let html = std::str::from_utf8(&page.body).unwrap();
            assert!(html.contains(&format!("<html lang=\"{}\"", lang.code())));
            assert!(
                html.contains("«fanal-ocelote»"),
                "la nota del formulario lleva la palabra clave"
            );
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
