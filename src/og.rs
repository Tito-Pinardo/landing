//! Imágenes para compartir (Open Graph) de cada unidad y artículo: un SVG
//! con el título y la cifra de la página, pasado a PNG con resvg. Se hacen la
//! primera vez que alguien (LinkedIn, Slack…) las pide y se quedan en memoria:
//! solo existen para las unidades y artículos del contenido, así que la caché
//! no puede crecer sin límite. Las fuentes van dentro del binario
//! (`assets/og`, recortadas a alfabeto latino; licencia en `OFL.txt`).

use std::sync::Arc;

use anyhow::{Context, Result};
use resvg::{tiny_skia, usvg};

use crate::content::{Content, Lang};

pub const W: u32 = 1200;
pub const H: u32 = 630;

const SANS: &str = "Inter Display";
const MONO: &str = "JetBrains Mono";

/// Lo que se escribe en una tarjeta.
pub struct Card {
    /// Línea pequeña de arriba («Unidad 1U · Comunidad»).
    pub kicker: String,
    pub title: String,
    /// La cifra o la frase que hace pulsar.
    pub subtitle: String,
    /// Tecnologías, en cajitas abajo.
    pub tags: Vec<String>,
}

impl Card {
    /// La tarjeta de una unidad (`kind` = "unit") o un artículo ("blog");
    /// `None` si no existe, para no hacer (ni guardar) imágenes inventadas.
    pub fn of(c: &Content, lang: Lang, kind: &str, id: &str) -> Option<Card> {
        match kind {
            "unit" => {
                let u = c.units.iter().find(|u| u.id == id)?;
                let t = u.texts(lang);
                Some(Card {
                    kicker: t.hero.kicker.clone(),
                    title: t.hero.title.clone(),
                    subtitle: t.hero.grade.clone(),
                    tags: u.host_tech.clone(),
                })
            }
            "blog" => {
                let a = c.articles.iter().find(|a| a.slug == id)?;
                let t = a.texts(lang);
                let kind = c
                    .texts(lang)
                    .blog
                    .get(&format!("kind_{}", a.kind))
                    .cloned()
                    .unwrap_or_default();
                Some(Card {
                    kicker: format!("Blog · {kind}"),
                    title: t.title.clone(),
                    subtitle: t.description.clone(),
                    tags: a.tech.clone(),
                })
            }
            _ => None,
        }
    }
}

pub struct Og {
    opt: usvg::Options<'static>,
}

impl Og {
    pub fn new() -> Self {
        let mut opt = usvg::Options::default();
        let db = opt.fontdb_mut();
        db.load_font_data(include_bytes!("../assets/og/InterDisplay-Bold.otf").to_vec());
        db.load_font_data(include_bytes!("../assets/og/JetBrainsMono-Regular.ttf").to_vec());
        db.load_font_data(include_bytes!("../assets/og/JetBrainsMono-Bold.ttf").to_vec());
        opt.font_family = MONO.into();
        Og { opt }
    }

    /// Ancho real del texto con esa fuente, en píxeles (usvg lo pasa a
    /// trazos y se mide su caja).
    fn width(&self, text: &str, family: &str, weight: u16, size: f32) -> f32 {
        let svg = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="400"><text x="0" y="300" font-family="{family}" font-weight="{weight}" font-size="{size}">{}</text></svg>"#,
            esc(text)
        );
        usvg::Tree::from_str(&svg, &self.opt)
            .ok()
            .map(|t| t.root().abs_bounding_box().width())
            .filter(|w| *w > 0.0)
            .unwrap_or(text.chars().count() as f32 * size * 0.62)
    }

    /// Reparte el texto en líneas de como mucho `max_w` píxeles; si no cabe
    /// en `max_lines`, la última acaba en «…».
    fn wrap(
        &self,
        text: &str,
        family: &str,
        weight: u16,
        size: f32,
        max_w: f32,
        max_lines: usize,
    ) -> Vec<String> {
        let mut lines: Vec<String> = Vec::new();
        let mut cur = String::new();
        for word in text.split_whitespace() {
            let probe = if cur.is_empty() {
                word.to_string()
            } else {
                format!("{cur} {word}")
            };
            if cur.is_empty() || self.width(&probe, family, weight, size) <= max_w {
                cur = probe;
                continue;
            }
            lines.push(std::mem::take(&mut cur));
            cur = word.to_string();
            if lines.len() == max_lines {
                // No cabe: se recorta la última línea y se le pone «…».
                let mut last = lines.pop().unwrap_or_default();
                while !last.is_empty()
                    && self.width(&format!("{last}…"), family, weight, size) > max_w
                {
                    last = last
                        .rsplit_once(' ')
                        .map(|(a, _)| a.to_string())
                        .unwrap_or_default();
                }
                lines.push(format!(
                    "{}…",
                    last.trim_end_matches([',', '.', ':', ';', '·', ' '])
                ));
                return lines;
            }
        }
        if !cur.is_empty() {
            lines.push(cur);
        }
        lines
    }

    pub fn svg(&self, card: &Card) -> String {
        const LEFT: f32 = 90.0;
        // El título no pisa el cuadro «TP» de la derecha.
        const TITLE_W: f32 = 880.0;
        const TEXT_W: f32 = 1020.0;
        const BOTTOM: f32 = 470.0;

        let mut size = 72.0;
        let mut title = self.wrap(&card.title, SANS, 700, size, TITLE_W, 2);
        if title.last().is_some_and(|l| l.ends_with('…')) {
            size = 58.0;
            title = self.wrap(&card.title, SANS, 700, size, TITLE_W, 3);
        }
        let lh = size * 1.1;

        let mut out = String::with_capacity(4096);
        out.push_str(&format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<defs>
  <radialGradient id="a" cx="1" cy="0" r="0.75"><stop offset="0" stop-color="#1e2547"/><stop offset="1" stop-color="#0b0f17" stop-opacity="0"/></radialGradient>
  <radialGradient id="b" cx="0" cy="1" r="0.5"><stop offset="0" stop-color="#0f2e2b"/><stop offset="1" stop-color="#0b0f17" stop-opacity="0"/></radialGradient>
  <pattern id="d" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="#ffffff" fill-opacity="0.06"/></pattern>
</defs>
<rect width="{W}" height="{H}" fill="#0b0f17"/>
<rect width="{W}" height="{H}" fill="url(#a)"/>
<rect width="{W}" height="{H}" fill="url(#b)"/>
<rect width="{W}" height="{H}" fill="url(#d)"/>
<rect x="1018" y="72" width="90" height="90" rx="16" fill="none" stroke="#2dd4bf" stroke-width="5"/>
<text x="1063" y="130" text-anchor="middle" font-family="{MONO}" font-weight="700" font-size="34" fill="#2dd4bf">TP</text>
"##
        ));

        let kicker = self.wrap(&card.kicker, MONO, 700, 28.0, TITLE_W - 40.0, 1);
        out.push_str(&format!(
            r##"<text x="{LEFT}" y="140" font-family="{MONO}" font-weight="700" font-size="28" fill="#2dd4bf">&gt; {}</text>
"##,
            esc(kicker.first().map(String::as_str).unwrap_or(""))
        ));

        // Título y cifra: primero se colocan y luego se bajan juntos hasta el
        // centro del hueco libre, para que un título corto no deje un vacío.
        let mut lines: Vec<(f32, String)> = Vec::new();
        let mut y = 140.0 + 28.0 + lh * 0.95;
        for line in &title {
            let el = format!(
                r##"font-family="{SANS}" font-weight="700" font-size="{size}" letter-spacing="-1.5" fill="#eef2ff">{}"##,
                esc(line)
            );
            lines.push((y, el));
            y += lh;
        }
        let sub_size = 30.0;
        let sub_lh = sub_size * 1.35;
        y += 22.0 - lh + sub_lh; // primera línea, bajo la última del título
        let room = if y > BOTTOM {
            0
        } else {
            1 + ((BOTTOM - y) / sub_lh) as usize
        };
        for line in self.wrap(&card.subtitle, MONO, 400, sub_size, TEXT_W, room.min(2)) {
            let el = format!(
                r##"font-family="{MONO}" font-size="{sub_size}" fill="#a5b4c8">{}"##,
                esc(&line)
            );
            lines.push((y, el));
            y += sub_lh;
        }
        let last = lines.last().map(|(y, _)| *y).unwrap_or(BOTTOM);
        let shift = ((BOTTOM - last) / 2.0).clamp(0.0, 80.0);
        for (y, el) in lines {
            out.push_str(&format!(
                "<text x=\"{LEFT}\" y=\"{:.0}\" {el}</text>\n",
                y + shift
            ));
        }

        // Cajitas de tecnologías: las que quepan en una fila.
        let mut x = LEFT;
        for tag in &card.tags {
            let w = self.width(tag, MONO, 400, 24.0) + 36.0;
            if x + w > LEFT + TEXT_W {
                break;
            }
            out.push_str(&format!(
                r##"<rect x="{x:.0}" y="500" width="{w:.0}" height="52" rx="8" fill="#111827" stroke="#334155" stroke-width="2"/><text x="{tx:.0}" y="534" font-family="{MONO}" font-size="24" fill="#cbd5e1">{}</text>
"##,
                esc(tag),
                tx = x + 18.0,
            ));
            x += w + 14.0;
        }

        out.push_str(&format!(
            r##"<text x="{LEFT}" y="598" font-family="{MONO}" font-size="22" fill="#64748b">titopinardogutierrez.com</text>
</svg>"##
        ));
        out
    }

    pub fn png(&self, card: &Card) -> Result<Vec<u8>> {
        let tree = usvg::Tree::from_str(&self.svg(card), &self.opt).context("SVG de la tarjeta")?;
        let mut pix = tiny_skia::Pixmap::new(W, H).context("lienzo")?;
        resvg::render(&tree, tiny_skia::Transform::default(), &mut pix.as_mut());
        pix.encode_png().context("PNG")
    }
}

impl Default for Og {
    fn default() -> Self {
        Self::new()
    }
}

/// Caché de PNG ya hechos, por clave (`es/unit/amp`).
pub type Cache = Arc<std::sync::Mutex<std::collections::HashMap<String, bytes::Bytes>>>;

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn las_fuentes_estan_y_se_miden() {
        let og = Og::new();
        let families: Vec<String> = og
            .opt
            .fontdb
            .faces()
            .flat_map(|f| f.families.iter().map(|(n, _)| n.clone()))
            .collect();
        assert!(families.iter().any(|f| f == SANS), "{families:?}");
        assert!(families.iter().any(|f| f == MONO), "{families:?}");
        // Más texto, más ancho: si no hubiera fuente, todo mediría lo mismo.
        assert!(
            og.width("Tito Pinardo", SANS, 700, 72.0) > og.width("Tito", SANS, 700, 72.0) * 2.0
        );
    }

    #[test]
    fn todas_las_paginas_tienen_tarjeta_y_lo_demas_no() {
        let c = Content::embedded().unwrap();
        for lang in Lang::ALL {
            for u in &c.units {
                assert!(Card::of(&c, lang, "unit", &u.id).is_some(), "{}", u.id);
            }
            for a in &c.articles {
                let card = Card::of(&c, lang, "blog", &a.slug).unwrap();
                assert!(!card.kicker.ends_with("· "), "{}: tipo sin nombre", a.slug);
            }
        }
        assert!(Card::of(&c, Lang::Es, "unit", "no-existe").is_none());
        assert!(Card::of(&c, Lang::Es, "otra", "amp").is_none());
    }

    #[test]
    fn un_titulo_largo_se_parte_y_acaba_en_puntos() {
        let og = Og::new();
        let long = "una frase muy larga ".repeat(20);
        let lines = og.wrap(&long, SANS, 700, 72.0, 880.0, 2);
        assert_eq!(lines.len(), 2);
        assert!(lines[1].ends_with('…'));
        for l in &lines {
            assert!(og.width(l, SANS, 700, 72.0) <= 880.0, "{l}");
        }
    }

    #[test]
    fn hace_un_png_del_tamano_de_open_graph() {
        let og = Og::new();
        let card = Card {
            kicker: "Unidad 1U".into(),
            title: "AMP <servidores> & juego".into(),
            subtitle: "Escrituras ×8,8".into(),
            tags: vec!["proxmox".into(), "terraform".into()],
        };
        let png = og.png(&card).unwrap();
        assert_eq!(&png[1..4], b"PNG");
        // Ancho y alto en la cabecera IHDR.
        assert_eq!(u32::from_be_bytes(png[16..20].try_into().unwrap()), W);
        assert_eq!(u32::from_be_bytes(png[20..24].try_into().unwrap()), H);
    }
}
