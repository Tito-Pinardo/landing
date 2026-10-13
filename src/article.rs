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
    pub text: BTreeMap<String, ArticleText>,
}

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
}

impl Article {
    pub fn parse(src: &str) -> Result<Article> {
        toml::from_str(src).context("content/articles")
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
            for sec in &t.sections {
                ensure!(
                    !sec.paragraphs.is_empty() || !sec.list.is_empty() || sec.code.is_some(),
                    ctx(&format!("[text.{code}] sección vacía «{}»", sec.heading))
                );
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
    }
}
