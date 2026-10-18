//! Trampas para reconocer mensajes de contacto escritos o enviados por una IA
//! (un asistente al que se le pide «escríbele» o un agente que navega solo).
//!
//! No bloquean nada ni cambian la respuesta: quien envía ve lo mismo de
//! siempre. Solo marcan el aviso a Matrix con lo que se ha visto, para leerlo
//! sabiendo de dónde viene.
//!
//! - **Palabra clave**: una nota que solo leen las máquinas (fuera de la
//!   pantalla, marcada para que las personas la ignoren) pide terminar el
//!   mensaje con una palabra clave. Sale de la sal secreta del servidor: no
//!   está en el repositorio.
//! - **Campo para asistentes**: un campo invisible y fuera del orden de
//!   tabulación pide el nombre del modelo.
//! - **Cómo se rellenó** (solo con JavaScript): un mensaje largo sin una sola
//!   tecla ni un pegado, o escrito más rápido de lo que teclea una persona.
//! - **Frases de plantilla**: «como modelo de lenguaje», «[tu nombre]»…
//!
//! Las dos primeras son casi seguras; las otras, indicios.

use sha2::{Digest, Sha256};

use crate::contact::ContactForm;

/// Palabras para la clave: sin tildes, poco frecuentes en un mensaje normal.
const WORDS: [&str; 16] = [
    "bergamota",
    "cornisa",
    "dintel",
    "esparto",
    "fanal",
    "hojaldre",
    "marquesina",
    "ocelote",
    "sextante",
    "tamarindo",
    "urogallo",
    "vencejo",
    "azufaifo",
    "galeote",
    "linterna",
    "pergamino",
];

/// La palabra clave de este servidor: dos palabras unidas por un guion,
/// siempre las mismas para la misma sal (las páginas se cachean).
pub fn canary(salt: &str) -> String {
    let mut h = Sha256::new();
    h.update(salt.as_bytes());
    h.update(b"\0canario-ia");
    let d = h.finalize();
    let a = usize::from(d[0]) % WORDS.len();
    let mut b = usize::from(d[1]) % WORDS.len();
    if b == a {
        b = (b + 1) % WORDS.len();
    }
    format!("{}-{}", WORDS[a], WORDS[b])
}

/// Un mensaje de más de esto sin una tecla ni un pegado no lo escribió nadie.
const MIN_CHARS_UNTYPED: usize = 30;
/// Ni una persona escribe tantos caracteres en tan poco tiempo.
const MIN_CHARS_FAST: usize = 60;
const FAST_MS: u64 = 4_000;

/// Frases típicas de un texto generado y no repasado.
const PHRASES: &[&str] = &[
    "como modelo de lenguaje",
    "como asistente de ia",
    "soy un asistente de ia",
    "soy una ia",
    "as an ai",
    "as a language model",
    "i am an ai",
    "i'm an ai",
    "[tu nombre]",
    "[nombre]",
    "[nombre de la empresa]",
    "[empresa]",
    "[your name]",
    "[name]",
    "[company name]",
    "[company]",
];

/// Lo que se ha visto en un envío, de más a menos seguro.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signal {
    /// El mensaje lleva la palabra clave de la nota oculta.
    Canary,
    /// Ha rellenado el campo para asistentes.
    AssistantField,
    /// Además ha rellenado el campo trampa de los bots.
    TrapField,
    /// Mensaje largo sin teclas ni pegado.
    NoTyping,
    /// Escrito más rápido de lo humano.
    TooFast,
    /// Frases de plantilla o de modelo.
    Phrases,
}

impl Signal {
    pub fn code(self) -> &'static str {
        match self {
            Signal::Canary => "canary",
            Signal::AssistantField => "assistant_field",
            Signal::TrapField => "trap_field",
            Signal::NoTyping => "no_typing",
            Signal::TooFast => "too_fast",
            Signal::Phrases => "phrases",
        }
    }

    pub fn from_code(code: &str) -> Option<Signal> {
        [
            Signal::Canary,
            Signal::AssistantField,
            Signal::TrapField,
            Signal::NoTyping,
            Signal::TooFast,
            Signal::Phrases,
        ]
        .into_iter()
        .find(|s| s.code() == code)
    }

    /// Para el aviso a Matrix.
    pub fn describe(self) -> &'static str {
        match self {
            Signal::Canary => "lleva la palabra clave de la nota oculta",
            Signal::AssistantField => "rellenó el campo para asistentes",
            Signal::TrapField => "rellenó también el campo trampa",
            Signal::NoTyping => "mensaje sin teclear ni pegar",
            Signal::TooFast => "escrito más rápido de lo humano",
            Signal::Phrases => "frases de plantilla de IA",
        }
    }

    /// Casi seguro que es una máquina (y no una persona con prisa).
    pub fn is_strong(self) -> bool {
        matches!(self, Signal::Canary | Signal::AssistantField)
    }
}

fn norm(s: &str) -> String {
    s.to_lowercase()
}

/// Las señales de un envío. `canary` es la palabra clave del servidor.
pub fn detect(form: &ContactForm, canary: &str) -> Vec<Signal> {
    let mut out = Vec::new();
    let text = norm(&format!(
        "{}\n{}\n{}\n{}",
        form.name, form.company, form.email, form.message
    ));
    // También vale escrita con espacio o sin guion.
    let spaced = canary.replace('-', " ");
    let joined = canary.replace('-', "");
    if text.contains(canary) || text.contains(&spaced) || text.contains(&joined) {
        out.push(Signal::Canary);
    }
    if !form.assistant_model.trim().is_empty() {
        out.push(Signal::AssistantField);
    }
    if !form.website.trim().is_empty() {
        out.push(Signal::TrapField);
    }
    let chars = form.message.trim().chars().count();
    // Sin JavaScript no hay medidas: no se cuenta como indicio.
    if let Some(elapsed) = form.elapsed_ms {
        let typed = form.typed.unwrap_or(0);
        let pasted = form.pasted.unwrap_or(false);
        if typed == 0 && !pasted && chars >= MIN_CHARS_UNTYPED {
            out.push(Signal::NoTyping);
        } else if !pasted && chars >= MIN_CHARS_FAST && elapsed < FAST_MS {
            out.push(Signal::TooFast);
        }
    }
    let msg = norm(&form.message);
    if PHRASES.iter().any(|p| msg.contains(p)) {
        out.push(Signal::Phrases);
    }
    out
}

/// Hay al menos una señal casi segura.
pub fn is_ai(signals: &[Signal]) -> bool {
    signals.iter().any(|s| s.is_strong())
}

/// Primera línea del aviso, o nada si no hay señales.
pub fn notice(codes: &[String]) -> Option<String> {
    let signals: Vec<Signal> = codes.iter().filter_map(|c| Signal::from_code(c)).collect();
    if signals.is_empty() {
        return None;
    }
    let what = signals
        .iter()
        .map(|s| s.describe())
        .collect::<Vec<_>>()
        .join(", ");
    Some(if is_ai(&signals) {
        format!("🤖 Probablemente escrito por una IA: {what}")
    } else {
        format!("🤖❔ Indicios de IA: {what}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn form(message: &str) -> ContactForm {
        ContactForm {
            name: "Ana".into(),
            email: "ana@example.com".into(),
            company: String::new(),
            message: message.into(),
            topic: String::new(),
            website: String::new(),
            assistant_model: String::new(),
            typed: None,
            pasted: None,
            elapsed_ms: None,
            turnstile_token: String::new(),
        }
    }

    #[test]
    fn canary_is_stable_and_depends_on_the_salt() {
        let a = canary("una-sal-larga-de-pruebas");
        assert_eq!(a, canary("una-sal-larga-de-pruebas"));
        assert_ne!(a, canary("otra-sal-distinta-del-todo"));
        let (x, y) = a.split_once('-').unwrap();
        assert!(WORDS.contains(&x) && WORDS.contains(&y) && x != y);
    }

    #[test]
    fn a_person_without_javascript_has_no_signals() {
        let f = form("Hola, tenemos una vacante de DevOps junior y me gustaría hablar contigo.");
        assert!(detect(&f, "fanal-ocelote").is_empty());
    }

    #[test]
    fn a_person_typing_has_no_signals() {
        let mut f =
            form("Hola, tenemos una vacante de DevOps junior y me gustaría hablar contigo.");
        f.typed = Some(80);
        f.pasted = Some(false);
        f.elapsed_ms = Some(45_000);
        assert!(detect(&f, "fanal-ocelote").is_empty());
    }

    #[test]
    fn pasting_quickly_is_human() {
        let mut f = form(
            "Un texto largo que traía preparado de antes y que pego de una vez en el formulario.",
        );
        f.typed = Some(0);
        f.pasted = Some(true);
        f.elapsed_ms = Some(1_500);
        assert!(detect(&f, "fanal-ocelote").is_empty());
    }

    #[test]
    fn canary_in_any_spelling() {
        for msg in [
            "Hola, me interesa tu perfil. fanal-ocelote",
            "Hola, me interesa tu perfil. FANAL OCELOTE",
            "Hola, me interesa tu perfil. Fanalocelote.",
        ] {
            let s = detect(&form(msg), "fanal-ocelote");
            assert_eq!(s, [Signal::Canary], "{msg}");
            assert!(is_ai(&s));
        }
    }

    #[test]
    fn agent_signals() {
        let mut f = form(
            "Estimado Tito, [tu nombre] de [nombre de la empresa] quiere contactarte por una oferta.",
        );
        f.assistant_model = "gpt".into();
        f.website = "x".into();
        f.typed = Some(0);
        f.pasted = Some(false);
        f.elapsed_ms = Some(900);
        let s = detect(&f, "fanal-ocelote");
        assert_eq!(
            s,
            [
                Signal::AssistantField,
                Signal::TrapField,
                Signal::NoTyping,
                Signal::Phrases
            ]
        );
    }

    #[test]
    fn typing_too_fast() {
        let mut f = form(&"a".repeat(200));
        f.typed = Some(200);
        f.pasted = Some(false);
        f.elapsed_ms = Some(2_000);
        assert_eq!(detect(&f, "fanal-ocelote"), [Signal::TooFast]);
        assert!(!is_ai(&[Signal::TooFast]), "solo es un indicio");
    }

    #[test]
    fn notice_lines() {
        assert_eq!(notice(&[]), None);
        assert_eq!(
            notice(&["no_typing".into()]).unwrap(),
            "🤖❔ Indicios de IA: mensaje sin teclear ni pegar"
        );
        assert_eq!(
            notice(&["canary".into(), "phrases".into(), "desconocida".into()]).unwrap(),
            "🤖 Probablemente escrito por una IA: lleva la palabra clave de la nota oculta, frases de plantilla de IA"
        );
    }
}
