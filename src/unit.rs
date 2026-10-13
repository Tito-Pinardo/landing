//! Unidades del rack: la página propia de un proyecto con mucha miga.
//!
//! Cada unidad vive en `content/units/<id>.toml`: arriba lo que no depende
//! del idioma (mapa, recorridos, reglas) y debajo `[text.es]` / `[text.en]`.
//! Se valida al arrancar contra `site.toml`, igual que el resto del
//! contenido: una pieza o una tecnología que no cuadre impide desplegar.

use std::collections::{BTreeMap, HashSet};

use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};

use crate::content::{Fact, FlowText, Group, Lang, Node, NodeText, Site, Stat};

/// Las unidades compiladas en el binario.
pub const EMBEDDED: &[&str] = &[include_str!("../content/units/xpify.toml")];

/// Lienzo del mapa de una unidad.
pub const MAP_W: u32 = 1200;
pub const MAP_H: u32 = 630;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Unit {
    pub id: String,
    /// Misión de `site.toml` a la que pertenece.
    pub project: String,
    /// Tecnologías de la propia máquina (se ilumina el marco de la VM).
    pub host_tech: Vec<String>,
    pub links: Vec<[String; 2]>,
    pub xp: XpRules,
    pub groups: Vec<Group>,
    pub pods: Vec<Node>,
    pub flows: Vec<UnitFlow>,
    pub incidents: Vec<UnitIncident>,
    pub text: BTreeMap<String, UnitText>,
}

/// Reglas del cálculo de XP; el navegador las aplica tal cual.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct XpRules {
    pub base_min: u32,
    pub base_max: u32,
    pub base_default: u32,
    pub difficulty: Vec<f64>,
    pub time_limits: Vec<u32>,
    pub time_factors: Vec<f64>,
    pub time_slow: f64,
    pub accuracy_base: f64,
    pub accuracy_weight: f64,
    pub level_constant: f64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnitFlow {
    pub id: String,
    pub path: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnitIncident {
    pub id: String,
    pub answer: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UnitText {
    pub meta: UnitMeta,
    pub ui: BTreeMap<String, String>,
    pub hero: UnitHero,
    pub stats: Vec<Stat>,
    pub groups: BTreeMap<String, String>,
    pub pods: BTreeMap<String, NodeText>,
    pub flows: BTreeMap<String, FlowText>,
    pub xp: XpText,
    pub incidents: BTreeMap<String, IncidentLog>,
    pub timeline: Vec<Phase>,
    pub decisions: Vec<Decision>,
    /// Para qué usé cada tecnología del proyecto; también lo enseña la
    /// misión de la página principal al filtrar por habilidad.
    pub tech_notes: BTreeMap<String, String>,
    pub close: Close,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UnitMeta {
    pub title: String,
    pub description: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UnitHero {
    pub kicker: String,
    pub title: String,
    pub tagline: String,
    pub grade: String,
    pub facts: Vec<Fact>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct XpText {
    /// Un nombre por factor de `xp.difficulty`.
    pub difficulties: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IncidentLog {
    pub title: String,
    pub meta: String,
    pub symptom: String,
    pub options: Vec<String>,
    pub cause: String,
    pub fix: String,
    pub lesson: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Phase {
    pub title: String,
    pub period: String,
    pub items: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Decision {
    pub title: String,
    pub choice: String,
    pub why: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Close {
    pub lessons: Vec<String>,
    pub next: Vec<String>,
}

/// Claves de `[text.*.ui]` que usan la plantilla y el JS.
const UI_KEYS: &[&str] = &[
    "back",
    "crumb_rack",
    "crumb_lab",
    "slot",
    "face_specs",
    "retired",
    "pull",
    "map_title",
    "map_intro",
    "vm_title",
    "vm_specs",
    "outside",
    "flows_title",
    "flows_hint",
    "play",
    "pause",
    "prev",
    "next",
    "step",
    "of",
    "pick",
    "narrator",
    "narrator_role",
    "tech_title",
    "tech_intro",
    "tech_all",
    "tech_clear",
    "xp_title",
    "xp_intro",
    "xp_base",
    "xp_difficulty",
    "xp_accuracy",
    "xp_time",
    "xp_minutes",
    "xp_result",
    "xp_formula",
    "xp_level",
    "xp_level_note",
    "xp_noscript",
    "incidents_title",
    "incidents_intro",
    "incident_guess",
    "incident_wrong",
    "incident_right",
    "incident_reveal",
    "cause",
    "fix",
    "lesson",
    "solved",
    "timeline_title",
    "decisions_title",
    "lessons_title",
    "next_title",
    "cta_title",
    "cta_text",
    "disclaimer",
    "noscript",
];

impl Unit {
    pub fn parse(src: &str) -> Result<Unit> {
        toml::from_str(src).context("content/units")
    }

    pub fn texts(&self, lang: Lang) -> &UnitText {
        &self.text[lang.code()]
    }

    /// Tecnologías de la misión a la que pertenece.
    pub fn project_tech<'a>(&self, site: &'a Site) -> &'a [String] {
        site.projects
            .iter()
            .find(|p| p.id == self.project)
            .map_or(&[], |p| p.tech.as_slice())
    }

    pub fn validate(&self, site: &Site) -> Result<()> {
        let id = &self.id;
        let ctx = |what: &str| format!("unidad {id}: {what}");
        ensure!(
            !id.is_empty() && id.bytes().all(|b| b.is_ascii_lowercase() || b == b'-'),
            ctx("el id va en la URL: solo minúsculas y guiones")
        );
        ensure!(
            site.projects.iter().any(|p| p.id == self.project),
            ctx(&format!("misión desconocida {}", self.project))
        );
        let tech: HashSet<&str> = site.tech.iter().map(|t| t.id.as_str()).collect();
        let pods: HashSet<&str> = self.pods.iter().map(|p| p.id.as_str()).collect();
        ensure!(pods.len() == self.pods.len(), ctx("pieza repetida"));
        for t in &self.host_tech {
            ensure!(
                tech.contains(t.as_str()),
                ctx(&format!("tecnología desconocida {t}"))
            );
        }
        for p in &self.pods {
            ensure!(
                p.x <= MAP_W && p.y <= MAP_H,
                ctx(&format!("pieza {} fuera del lienzo", p.id))
            );
            ensure!(
                p.group.is_empty() || self.groups.iter().any(|g| g.id == p.group),
                ctx(&format!("pieza {}: grupo desconocido {}", p.id, p.group))
            );
            for t in &p.tech {
                ensure!(
                    tech.contains(t.as_str()),
                    ctx(&format!("pieza {}: tecnología desconocida {t}", p.id))
                );
            }
        }
        for g in &self.groups {
            ensure!(
                g.x + g.w <= MAP_W && g.y + g.h <= MAP_H,
                ctx(&format!("grupo {} fuera del lienzo", g.id))
            );
        }
        for [a, b] in &self.links {
            ensure!(
                pods.contains(a.as_str()) && pods.contains(b.as_str()),
                ctx(&format!("enlace {a}-{b}"))
            );
        }
        for f in &self.flows {
            ensure!(
                f.path.len() >= 2,
                ctx(&format!("recorrido {}: hacen falta dos pasos", f.id))
            );
            for p in &f.path {
                ensure!(
                    pods.contains(p.as_str()),
                    ctx(&format!("recorrido {}: pieza desconocida {p}", f.id))
                );
            }
        }
        let x = &self.xp;
        ensure!(
            x.base_min <= x.base_default && x.base_default <= x.base_max,
            ctx("xp: base fuera de rango")
        );
        ensure!(
            !x.difficulty.is_empty() && x.time_limits.len() == x.time_factors.len(),
            ctx("xp: factores incompletos")
        );
        ensure!(
            x.time_limits.windows(2).all(|w| w[0] < w[1]),
            ctx("xp: los límites de tiempo deben ir de menor a mayor")
        );

        // Lo que se usó tiene que tener su nota: la misión de la página
        // principal la enseña al filtrar por habilidad.
        let project_tech: HashSet<&str> =
            self.project_tech(site).iter().map(String::as_str).collect();
        let used: HashSet<&str> = self
            .pods
            .iter()
            .flat_map(|p| p.tech.iter())
            .chain(&self.host_tech)
            .map(String::as_str)
            .collect();
        for t in &used {
            ensure!(
                project_tech.contains(t),
                ctx(&format!(
                    "la pieza usa {t}, que no está en la misión {}",
                    self.project
                ))
            );
        }

        ensure!(
            self.text.len() == Lang::ALL.len()
                && Lang::ALL.iter().all(|l| self.text.contains_key(l.code())),
            ctx("hacen falta exactamente [text.es] y [text.en]")
        );
        for lang in Lang::ALL {
            let code = lang.code();
            let t = self.texts(lang);
            let ctx = |what: &str| format!("unidad {id} [text.{code}]: {what}");
            for k in UI_KEYS {
                ensure!(t.ui.contains_key(*k), ctx(&format!("falta ui.{k}")));
            }
            same(
                self.pods.iter().map(|p| p.id.as_str()),
                t.pods.keys(),
                &ctx("pods"),
            )?;
            for (pid, p) in &t.pods {
                ensure!(
                    p.short.chars().count() <= 16,
                    ctx(&format!("pods.{pid}: short demasiado largo"))
                );
            }
            same(
                self.groups.iter().map(|g| g.id.as_str()),
                t.groups.keys(),
                &ctx("groups"),
            )?;
            same(
                self.flows.iter().map(|f| f.id.as_str()),
                t.flows.keys(),
                &ctx("flows"),
            )?;
            for f in &self.flows {
                ensure!(
                    t.flows[&f.id].steps.len() == f.path.len(),
                    ctx(&format!("flows.{}: un texto por paso", f.id))
                );
            }
            same(
                self.incidents.iter().map(|i| i.id.as_str()),
                t.incidents.keys(),
                &ctx("incidents"),
            )?;
            for i in &self.incidents {
                let it = &t.incidents[&i.id];
                ensure!(
                    it.options.len() >= 2 && i.answer < it.options.len(),
                    ctx(&format!("incidents.{}: opciones y respuesta", i.id))
                );
            }
            ensure!(
                t.xp.difficulties.len() == self.xp.difficulty.len(),
                ctx("xp.difficulties: un nombre por factor")
            );
            same(
                project_tech.iter().copied(),
                t.tech_notes.keys(),
                &ctx("tech_notes"),
            )?;
        }
        Ok(())
    }
}

fn same<'a>(
    expected: impl Iterator<Item = &'a str>,
    got: impl Iterator<Item = &'a String>,
    what: &str,
) -> Result<()> {
    let expected: HashSet<&str> = expected.collect();
    let got: HashSet<&str> = got.map(String::as_str).collect();
    let missing: Vec<_> = expected.difference(&got).collect();
    let extra: Vec<_> = got.difference(&expected).collect();
    ensure!(
        missing.is_empty() && extra.is_empty(),
        "{what}: faltan {missing:?}, sobran {extra:?}"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::content::Content;

    #[test]
    fn embedded_units_are_valid() {
        let c = Content::embedded().unwrap();
        assert!(c.units.iter().any(|u| u.id == "xpify"));
    }

    #[test]
    fn unknown_pod_in_a_flow_is_rejected() {
        let c = Content::embedded().unwrap();
        let src = super::EMBEDDED[0].replacen(
            "path = [\"player\", \"cloudflare\"",
            "path = [\"nadie\", \"cloudflare\"",
            1,
        );
        let err = super::Unit::parse(&src)
            .unwrap()
            .validate(&c.site)
            .unwrap_err();
        assert!(err.to_string().contains("pieza desconocida nadie"), "{err}");
    }

    #[test]
    fn every_project_tech_needs_a_note() {
        let c = Content::embedded().unwrap();
        let src = super::EMBEDDED[0].replacen("\nredis = \"Puente", "\nredis_x = \"Puente", 1);
        let err = super::Unit::parse(&src)
            .unwrap()
            .validate(&c.site)
            .unwrap_err();
        assert!(err.to_string().contains("tech_notes"), "{err}");
    }
}
