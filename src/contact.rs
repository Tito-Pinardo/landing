//! Formulario de contacto: validación, límites de envío y guardado.

use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::content::Lang;

/// Envíos permitidos por IP en una hora y en un día.
pub const PER_IP_HOUR: i64 = 3;
pub const PER_IP_DAY: i64 = 10;
/// Tope global por hora: frena una inundación desde muchas IPs.
pub const GLOBAL_HOUR: i64 = 60;

#[derive(Debug, Deserialize)]
pub struct ContactForm {
    pub name: String,
    pub email: String,
    #[serde(default)]
    pub company: String,
    pub message: String,
    /// Campo trampa: invisible para personas, los bots lo rellenan.
    #[serde(default)]
    pub website: String,
    /// Token de Turnstile (lo añade el widget de Cloudflare).
    #[serde(default, rename = "cf-turnstile-response")]
    pub turnstile_token: String,
}

/// Mensaje ya validado y normalizado.
#[derive(Debug, PartialEq, Eq)]
pub struct NewMessage {
    pub name: String,
    pub email: String,
    pub company: Option<String>,
    pub message: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Invalid {
    Name,
    Email,
    Company,
    Message,
}

impl Invalid {
    pub fn field(&self) -> &'static str {
        match self {
            Invalid::Name => "name",
            Invalid::Email => "email",
            Invalid::Company => "company",
            Invalid::Message => "message",
        }
    }
}

impl ContactForm {
    pub fn is_spam_trap(&self) -> bool {
        !self.website.trim().is_empty()
    }

    pub fn validate(&self) -> Result<NewMessage, Vec<Invalid>> {
        let name = clean_line(&self.name);
        let email = self.email.trim().to_owned();
        let company = clean_line(&self.company);
        let message = self.message.trim().replace("\r\n", "\n");

        let mut errors = Vec::new();
        if !(1..=100).contains(&name.chars().count()) {
            errors.push(Invalid::Name);
        }
        if !valid_email(&email) {
            errors.push(Invalid::Email);
        }
        if company.chars().count() > 120 {
            errors.push(Invalid::Company);
        }
        if !(10..=5000).contains(&message.chars().count()) {
            errors.push(Invalid::Message);
        }
        if !errors.is_empty() {
            return Err(errors);
        }
        Ok(NewMessage {
            name,
            email,
            company: (!company.is_empty()).then_some(company),
            message,
        })
    }
}

/// Una línea: sin saltos ni caracteres de control, espacios colapsados.
fn clean_line(s: &str) -> String {
    s.split(|c: char| c.is_whitespace() || c.is_control())
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Comprobación deliberadamente sencilla: la única validación real de un
/// correo es contestarlo. Esto solo descarta lo que seguro no lo es.
fn valid_email(email: &str) -> bool {
    if email.len() > 254 || email.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let Some((local, domain)) = email.rsplit_once('@') else {
        return false;
    };
    !local.is_empty()
        && local.len() <= 64
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !domain.contains("..")
}

#[derive(Debug, PartialEq, Eq)]
pub enum Limit {
    Ok,
    Exceeded,
}

/// Comprueba los límites con una sola consulta (usa los índices por
/// `(ip_hash, created_at)` y por `created_at`).
pub async fn check_limits(db: &PgPool, ip_hash: &[u8]) -> sqlx::Result<Limit> {
    let row = sqlx::query!(
        r#"
        SELECT
            count(*) FILTER (WHERE ip_hash = $1 AND created_at > now() - interval '1 hour') AS "ip_hour!",
            count(*) FILTER (WHERE ip_hash = $1)                                           AS "ip_day!",
            count(*) FILTER (WHERE created_at > now() - interval '1 hour')                AS "global_hour!"
        FROM contact_messages
        WHERE created_at > now() - interval '1 day'
        "#,
        ip_hash,
    )
    .fetch_one(db)
    .await?;

    let exceeded =
        row.ip_hour >= PER_IP_HOUR || row.ip_day >= PER_IP_DAY || row.global_hour >= GLOBAL_HOUR;
    Ok(if exceeded { Limit::Exceeded } else { Limit::Ok })
}

pub async fn insert(
    db: &PgPool,
    lang: Lang,
    msg: &NewMessage,
    ip_hash: &[u8],
    user_agent: Option<&str>,
) -> sqlx::Result<Uuid> {
    let id = Uuid::new_v4();
    let user_agent = user_agent.map(|ua| ua.chars().take(300).collect::<String>());
    sqlx::query!(
        r#"
        INSERT INTO contact_messages (id, lang, name, email, company, message, ip_hash, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
        id,
        lang.code(),
        msg.name,
        msg.email,
        msg.company,
        msg.message,
        ip_hash,
        user_agent,
    )
    .execute(db)
    .await?;
    Ok(id)
}

/// Borra los mensajes de más de un año que ya se avisaron: no guardo datos
/// personales más tiempo del necesario.
pub async fn purge_old(db: &PgPool) -> sqlx::Result<u64> {
    let res = sqlx::query!(
        "DELETE FROM contact_messages WHERE created_at < now() - interval '365 days' AND notified_at IS NOT NULL"
    )
    .execute(db)
    .await?;
    Ok(res.rows_affected())
}

/// Verifica el token de Turnstile con la API de Cloudflare.
pub async fn verify_turnstile(
    http: &reqwest::Client,
    secret: &str,
    token: &str,
    ip: std::net::IpAddr,
) -> Result<bool, reqwest::Error> {
    #[derive(Deserialize)]
    struct Verify {
        success: bool,
    }
    if token.is_empty() || token.len() > 2048 {
        return Ok(false);
    }
    let res: Verify = http
        .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
        .form(&[
            ("secret", secret),
            ("response", token),
            ("remoteip", &ip.to_string()),
        ])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(res.success)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn form(name: &str, email: &str, message: &str) -> ContactForm {
        ContactForm {
            name: name.into(),
            email: email.into(),
            company: String::new(),
            message: message.into(),
            website: String::new(),
            turnstile_token: String::new(),
        }
    }

    #[test]
    fn valid_message_is_normalised() {
        let mut f = form(
            "  Ana \n  García ",
            " ana@example.com ",
            "Hola, tenemos una vacante para ti.\r\n",
        );
        f.company = "  ACME\tS.L. ".into();
        let m = f.validate().unwrap();
        assert_eq!(m.name, "Ana García");
        assert_eq!(m.email, "ana@example.com");
        assert_eq!(m.company.as_deref(), Some("ACME S.L."));
        assert_eq!(m.message, "Hola, tenemos una vacante para ti.");
    }

    #[test]
    fn empty_company_is_none() {
        let m = form("Ana", "ana@example.com", "Mensaje suficientemente largo")
            .validate()
            .unwrap();
        assert_eq!(m.company, None);
    }

    #[test]
    fn invalid_fields_are_all_reported() {
        let errs = form("", "no-es-un-correo", "corto").validate().unwrap_err();
        assert_eq!(errs, vec![Invalid::Name, Invalid::Email, Invalid::Message]);
    }

    #[test]
    fn email_checks() {
        for ok in ["a@b.co", "nombre.apellido+tag@empresa.es"] {
            assert!(valid_email(ok), "{ok}");
        }
        for bad in [
            "", "a@b", "@b.co", "a@.co", "a@b.", "a@b..co", "a b@c.co", "a@b.co\n",
        ] {
            assert!(!valid_email(bad), "{bad:?}");
        }
    }

    #[test]
    fn limits_are_measured_in_chars_not_bytes() {
        let name = "ñ".repeat(100);
        assert!(
            form(&name, "a@b.co", "Mensaje suficientemente largo")
                .validate()
                .is_ok()
        );
        let name = "ñ".repeat(101);
        assert_eq!(
            form(&name, "a@b.co", "Mensaje suficientemente largo")
                .validate()
                .unwrap_err(),
            vec![Invalid::Name]
        );
    }

    #[test]
    fn honeypot() {
        let mut f = form("Ana", "a@b.co", "Mensaje suficientemente largo");
        assert!(!f.is_spam_trap());
        f.website = "http://spam".into();
        assert!(f.is_spam_trap());
    }
}
