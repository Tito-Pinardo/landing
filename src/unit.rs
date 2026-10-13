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

/// Las unidades compiladas en el binario, en el orden del rack (de arriba a
/// abajo, como en un armario de verdad: red arriba, discos abajo).
macro_rules! units {
    ($($id:literal),* $(,)?) => { &[$(include_str!(concat!("../content/units/", $id, ".toml"))),*] };
}
pub const EMBEDDED: &[&str] = units![
    "router",
    "traefik",
    "authelia",
    "dns",
    "landing",
    "matrix",
    "paperless",
    "obsidian",
    "n8n",
    "homepage",
    "amp",
    "plex",
    "arr",
    "tv",
    "hermes",
    "zabbix",
    "wazuh",
    "iac",
    "backup",
    "okd",
    "xpify",
    "proxmox",
    "zfs"
];

/// Lienzo del mapa de una unidad.
pub const MAP_W: u32 = 1200;
pub const MAP_H: u32 = 630;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Unit {
    pub id: String,
    /// Misión de `site.toml` a la que pertenece, si es una.
    #[serde(default)]
    pub project: Option<String>,
    /// live | retired | lab: el color de los LEDs del frontal.
    pub status: String,
    /// Tecnologías de la propia máquina (se ilumina el marco de la VM).
    pub host_tech: Vec<String>,
    pub links: Vec<[String; 2]>,
    /// Solo XPIFY: el cálculo de XP del backend.
    #[serde(default)]
    pub xp: Option<XpRules>,
    /// Solo Hermes: el reparto de la memoria de la GPU.
    #[serde(default)]
    pub vram: Option<Vram>,
    pub groups: Vec<Group>,
    pub pods: Vec<Node>,
    pub flows: Vec<UnitFlow>,
    #[serde(default)]
    pub incidents: Vec<UnitIncident>,
    pub text: BTreeMap<String, UnitText>,
}

/// Simulador de VRAM: qué parte del modelo cabe en la GPU según lo que haya
/// abierto en el PC, y lo que eso supone en velocidad y tiempo de respuesta.
/// Los números salen de las medidas reales; el navegador solo interpola.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Vram {
    pub total_mib: u32,
    /// Lo que se queda el controlador y el propio sistema gráfico.
    pub reserved_mib: u32,
    /// Pesos del modelo y búferes de cálculo, sin la caché KV.
    pub model_mib: u32,
    /// Caché KV por tipo: [id, MiB].
    pub kv: Vec<(String, u32)>,
    pub apps: Vec<VramApp>,
    /// Medidas: [% del modelo en GPU, tokens por segundo], de menor a mayor.
    pub speed: Vec<(f64, f64)>,
    /// Tokens que genera la llamada que elige herramienta.
    pub tokens_pick: u32,
    /// Tokens de la llamada que redacta, pensando y sin pensar.
    pub tokens_write_think: u32,
    pub tokens_write_direct: u32,
    /// Segundos de carga del modelo en frío.
    pub load_s: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct VramApp {
    pub id: String,
    pub mib: u32,
    pub on: bool,
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
    #[serde(default)]
    pub xp: Option<XpText>,
    #[serde(default)]
    pub vram: Option<VramText>,
    #[serde(default)]
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
pub struct VramText {
    pub title: String,
    pub intro: String,
    pub kv: String,
    pub kv_names: BTreeMap<String, String>,
    pub apps: String,
    pub app_names: BTreeMap<String, String>,
    pub think: String,
    pub think_on: String,
    pub think_off: String,
    pub bar_reserved: String,
    pub bar_apps: String,
    pub bar_model: String,
    pub bar_cpu: String,
    pub free: String,
    pub in_gpu: String,
    pub speed: String,
    pub turn: String,
    pub formula: String,
    pub verdict_full: String,
    pub verdict_split: String,
    pub note: String,
    pub noscript: String,
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

/// Claves de `[text.*.ui]` propias de cada unidad. El resto de textos de la
/// página son comunes (`[unit_ui]` de es/en.toml) y una unidad puede
/// sobrescribir cualquiera.
const UNIT_KEYS: &[&str] = &[
    "slot",
    "face_specs",
    "state",
    "map_silk",
    "vm_title",
    "vm_specs",
    "outside",
    "disclaimer",
];

/// Claves comunes de todas las unidades (`[unit_ui]` en es/en.toml).
pub const COMMON_KEYS: &[&str] = &[
    "back",
    "crumb_rack",
    "crumb_lab",
    "pull",
    "map_title",
    "map_intro",
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
    "noscript",
    "unit_prev",
    "unit_next",
    "rack_pos",
    "status_live",
    "status_retired",
    "status_lab",
    "live_up",
    "live_off",
    "live_down",
];

/// Claves que solo hacen falta si la unidad tiene calculadora de XP.
const XP_KEYS: &[&str] = &[
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
];

pub const STATUSES: &[&str] = &["live", "retired", "lab"];

impl Unit {
    pub fn parse(src: &str) -> Result<Unit> {
        toml::from_str(src).context("content/units")
    }

    pub fn texts(&self, lang: Lang) -> &UnitText {
        &self.text[lang.code()]
    }

    /// Lo que se ve en la bahía de habilidades: las tecnologías de su
    /// misión o, si no es una, las de sus piezas y su máquina, en el orden
    /// del árbol de habilidades.
    pub fn tech<'a>(&'a self, site: &'a Site) -> Vec<&'a str> {
        if let Some(p) = self.project.as_deref().and_then(|id| site.project(id)) {
            return p.tech.iter().map(String::as_str).collect();
        }
        let used: HashSet<&str> = self
            .pods
            .iter()
            .flat_map(|p| p.tech.iter())
            .chain(&self.host_tech)
            .map(String::as_str)
            .collect();
        site.tech
            .iter()
            .map(|t| t.id.as_str())
            .filter(|t| used.contains(t))
            .collect()
    }

    pub fn validate(&self, site: &Site) -> Result<()> {
        let id = &self.id;
        let ctx = |what: &str| format!("unidad {id}: {what}");
        ensure!(
            !id.is_empty()
                && id
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
            ctx("el id va en la URL: solo minúsculas, cifras y guiones")
        );
        if let Some(p) = &self.project {
            ensure!(
                site.project(p).is_some(),
                ctx(&format!("misión desconocida {p}"))
            );
        }
        ensure!(
            STATUSES.contains(&self.status.as_str()),
            ctx(&format!("estado desconocido {}", self.status))
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
        ensure!(
            !self.flows.is_empty(),
            ctx("hace falta al menos un recorrido")
        );
        if let Some(v) = &self.vram {
            ensure!(
                !v.kv.is_empty() && v.speed.len() >= 2,
                ctx("vram: hacen falta tipos de caché y al menos dos medidas")
            );
            ensure!(
                v.speed.windows(2).all(|w| w[0].0 < w[1].0),
                ctx("vram: las medidas van de menor a mayor % en GPU")
            );
            ensure!(
                v.reserved_mib < v.total_mib,
                ctx("vram: la reserva no cabe en la tarjeta")
            );
        }
        if let Some(x) = &self.xp {
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
        }

        // Lo que se usó tiene que tener su nota: la página principal la
        // enseña al filtrar por habilidad.
        let unit_tech: HashSet<&str> = self.tech(site).into_iter().collect();
        ensure!(!unit_tech.is_empty(), ctx("sin tecnologías"));
        if let Some(project) = &self.project {
            for t in self
                .pods
                .iter()
                .flat_map(|p| p.tech.iter())
                .chain(&self.host_tech)
            {
                ensure!(
                    unit_tech.contains(t.as_str()),
                    ctx(&format!(
                        "la pieza usa {t}, que no está en la misión {project}"
                    ))
                );
            }
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
            let xp_keys = if self.xp.is_some() { XP_KEYS } else { &[] };
            for k in UNIT_KEYS.iter().chain(xp_keys) {
                ensure!(t.ui.contains_key(*k), ctx(&format!("falta ui.{k}")));
            }
            for k in t.ui.keys() {
                ensure!(
                    UNIT_KEYS.contains(&k.as_str())
                        || COMMON_KEYS.contains(&k.as_str())
                        || xp_keys.contains(&k.as_str()),
                    ctx(&format!("ui.{k} no la usa nadie"))
                );
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
            match (&self.xp, &t.xp) {
                (Some(x), Some(tx)) => ensure!(
                    tx.difficulties.len() == x.difficulty.len(),
                    ctx("xp.difficulties: un nombre por factor")
                ),
                (None, None) => {}
                _ => anyhow::bail!(ctx("[xp] y [text.*.xp] van juntos")),
            }
            match (&self.vram, &t.vram) {
                (Some(v), Some(tv)) => {
                    same(
                        v.kv.iter().map(|(k, _)| k.as_str()),
                        tv.kv_names.keys(),
                        &ctx("vram.kv_names"),
                    )?;
                    same(
                        v.apps.iter().map(|a| a.id.as_str()),
                        tv.app_names.keys(),
                        &ctx("vram.app_names"),
                    )?;
                }
                (None, None) => {}
                _ => anyhow::bail!(ctx("[vram] y [text.*.vram] van juntos")),
            }
            same(
                unit_tech.iter().copied(),
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

    fn xpify() -> &'static str {
        super::EMBEDDED
            .iter()
            .find(|s| s.contains("\nid = \"xpify\""))
            .unwrap()
    }

    #[test]
    fn embedded_units_are_valid() {
        let c = Content::embedded().unwrap();
        assert!(c.units.iter().any(|u| u.id == "xpify"));
        assert_eq!(c.units.len(), super::EMBEDDED.len());
    }

    #[test]
    fn every_server_node_has_a_unit() {
        let c = Content::embedded().unwrap();
        for n in c.site.nodes.iter().filter(|n| !n.group.is_empty()) {
            assert!(n.unit.is_some(), "la pieza {} no tiene unidad", n.id);
        }
    }

    #[test]
    fn unknown_pod_in_a_flow_is_rejected() {
        let c = Content::embedded().unwrap();
        let src = xpify().replacen(
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
        let src = xpify().replacen("\nredis = \"Puente", "\nredis_x = \"Puente", 1);
        let err = super::Unit::parse(&src)
            .unwrap()
            .validate(&c.site)
            .unwrap_err();
        assert!(err.to_string().contains("tech_notes"), "{err}");
    }
}
