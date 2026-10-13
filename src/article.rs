//! Artículos: los postmortems del homelab contados enteros.
//!
//! Cada artículo vive en `content/articles/<slug>.toml`, con lo que no
//! depende del idioma arriba (fecha, unidad relacionada, tecnologías) y los
//! textos en `[text.es]` / `[text.en]`. Se valida al arrancar como el resto
//! del contenido.

use std::collections::{BTreeMap, HashSet};

use anyhow::{Context, Result, ensure};
use serde::Deserialize;

use crate::content::{Lang, Site};

macro_rules! articles {
    ($($id:literal),* $(,)?) => { &[$(include_str!(concat!("../content/articles/", $id, ".toml"))),*] };
}

/// Los artículos compilados en el binario, del más reciente al más antiguo.
pub const EMBEDDED: &[&str] = articles![
    "cache-escritura-discos",
    "zabbix-load-lxc",
    "cambios-2026-09",
    "firewall-proxmox-ct",
    "think-adaptativo",
    "qwen3-8gb-vram",
    "terraform-forcenew",
    "okd-discos-lentos",
    "chrome-huerfanos",
    "lvm-thin-corte-de-luz",
    "copias-cron-path",
    "nat-hsts",
];

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Article {
    /// Va en la URL: `/{lang}/blog/{slug}/`.
    pub slug: String,
    /// Fecha del incidente o de la medida (AAAA-MM-DD).
    pub date: String,
    /// Unidad del rack donde pasó.
    pub unit: String,
    pub tech: Vec<String>,
    /// Qué clase de artículo es (ver [`KINDS`]).
    pub kind: String,
    pub text: BTreeMap<String, ArticleText>,
}

/// Tipos de artículo. Los cuatro primeros son postmortems y llevan ficha
/// (impacto y cómo se detectó); el resumen semanal y los cambios del mes no.
pub const KINDS: &[&str] = &[
    "incident",
    "near_miss",
    "improvement",
    "build",
    "digest",
    "changelog",
];
pub const POSTMORTEM_KINDS: &[&str] = &["incident", "near_miss", "improvement", "build"];

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArticleText {
    pub title: String,
    /// Para buscadores y para la tarjeta del índice.
    pub description: String,
    /// Entradilla: el problema y el resultado en dos frases.
    pub summary: String,
    pub sections: Vec<Section>,
    pub lesson: String,
    /// Ficha del postmortem: a quién o a qué afectó.
    #[serde(default)]
    pub impact: Option<String>,
    /// Cómo me enteré: aviso, prueba, medida…
    #[serde(default)]
    pub detected: Option<String>,
    /// Tiempo de servicio caído, si lo hubo.
    #[serde(default)]
    pub downtime: Option<String>,
}

/// Un enlace a una fuente de fuera (el resumen semanal enlaza a los
/// originales).
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceLink {
    pub title: String,
    pub url: String,
    /// Quién lo publica: «Blog de Proxmox», «NVD»…
    pub source: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Section {
    pub heading: String,
    #[serde(default)]
    pub paragraphs: Vec<String>,
    #[serde(default)]
    pub list: Vec<String>,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub links: Vec<SourceLink>,
}

impl Article {
    pub fn parse(src: &str) -> Result<Article> {
        toml::from_str(src).context("content/articles")
    }

    pub fn is_postmortem(&self) -> bool {
        POSTMORTEM_KINDS.contains(&self.kind.as_str())
    }

    pub fn texts(&self, lang: Lang) -> &ArticleText {
        &self.text[lang.code()]
    }

    pub fn validate(&self, site: &Site, units: &HashSet<&str>) -> Result<()> {
        let s = &self.slug;
        let ctx = |what: &str| format!("artículo {s}: {what}");
        ensure!(
            !s.is_empty()
                && s.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
            ctx("el slug va en la URL: solo minúsculas, cifras y guiones")
        );
        let d = self.date.as_bytes();
        ensure!(
            d.len() == 10
                && d[4] == b'-'
                && d[7] == b'-'
                && d.iter()
                    .enumerate()
                    .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()),
            ctx("la fecha va como AAAA-MM-DD")
        );
        ensure!(
            KINDS.contains(&self.kind.as_str()),
            ctx(&format!("tipo desconocido {}", self.kind))
        );
        ensure!(
            units.contains(self.unit.as_str()),
            ctx(&format!("unidad desconocida {}", self.unit))
        );
        let tech: HashSet<&str> = site.tech.iter().map(|t| t.id.as_str()).collect();
        for t in &self.tech {
            ensure!(
                tech.contains(t.as_str()),
                ctx(&format!("tecnología desconocida {t}"))
            );
        }
        ensure!(
            self.text.len() == Lang::ALL.len()
                && Lang::ALL.iter().all(|l| self.text.contains_key(l.code())),
            ctx("hacen falta exactamente [text.es] y [text.en]")
        );
        for lang in Lang::ALL {
            let t = self.texts(lang);
            let code = lang.code();
            ensure!(
                !t.sections.is_empty(),
                ctx(&format!("[text.{code}] sin secciones"))
            );
            ensure!(
                t.description.chars().count() <= 170,
                ctx(&format!(
                    "[text.{code}] description demasiado larga para buscadores"
                ))
            );
            if self.is_postmortem() {
                ensure!(
                    t.impact.is_some() && t.detected.is_some(),
                    ctx(&format!(
                        "[text.{code}] un postmortem lleva impact y detected"
                    ))
                );
            }
            for sec in &t.sections {
                ensure!(
                    !sec.paragraphs.is_empty()
                        || !sec.list.is_empty()
                        || sec.code.is_some()
                        || !sec.links.is_empty(),
                    ctx(&format!("[text.{code}] sección vacía «{}»", sec.heading))
                );
                for l in &sec.links {
                    ensure!(
                        l.url.starts_with("https://") && !l.url.contains(char::is_whitespace),
                        ctx(&format!("[text.{code}] enlace raro {}", l.url))
                    );
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::content::Content;

    #[test]
    fn embedded_articles_are_valid_and_sorted() {
        let c = Content::embedded().unwrap();
        assert_eq!(c.articles.len(), super::EMBEDDED.len());
        assert!(
            c.articles.windows(2).all(|w| w[0].date >= w[1].date),
            "del más reciente al más antiguo"
        );
        assert!(
            c.articles
                .iter()
                .all(|a| a.is_postmortem() || a.kind == "digest" || a.kind == "changelog")
        );
    }

    #[test]
    fn unknown_kind_is_rejected() {
        let c = Content::embedded().unwrap();
        let src = super::EMBEDDED[0].replacen("kind = \"", "kind = \"otro", 1);
        let a = super::Article::parse(&src).unwrap();
        let units = c.units.iter().map(|u| u.id.as_str()).collect();
        assert!(a.validate(&c.site, &units).is_err());
    }
}
