//! Aviso de mensajes nuevos a Matrix con una bandeja de salida (outbox).
//!
//! El mensaje se guarda primero en PostgreSQL y el aviso sale después. Si
//! Matrix está caído, el mensaje no se pierde: el trabajador lo reintenta
//! hasta que el servidor devuelve un `event_id`.

use std::{sync::Arc, time::Duration};

use serde::Deserialize;
use sqlx::PgPool;
use tokio::sync::Notify;
use uuid::Uuid;

use crate::config::Matrix;

/// Reintentos antes de dejar un aviso por imposible (sigue en la BD).
const MAX_ATTEMPTS: i32 = 12;

struct Pending {
    id: Uuid,
    lang: String,
    name: String,
    email: String,
    company: Option<String>,
    message: String,
}

/// Bucle del trabajador: se despierta al llegar un mensaje o cada minuto.
pub async fn run(db: PgPool, http: reqwest::Client, matrix: Matrix, wake: Arc<Notify>) {
    loop {
        match deliver_batch(&db, &http, &matrix).await {
            Ok(0) => {}
            Ok(n) => tracing::info!(enviados = n, "avisos de contacto enviados a Matrix"),
            Err(e) => tracing::error!(error = %e, "fallo leyendo la bandeja de salida"),
        }
        tokio::select! {
            () = wake.notified() => {}
            () = tokio::time::sleep(Duration::from_secs(60)) => {}
        }
    }
}

async fn deliver_batch(
    db: &PgPool,
    http: &reqwest::Client,
    matrix: &Matrix,
) -> sqlx::Result<usize> {
    // Reserva el lote en una transacción corta. SKIP LOCKED permite tener
    // varias réplicas sin que dos envíen el mismo aviso.
    let mut tx = db.begin().await?;
    let batch = sqlx::query_as!(
        Pending,
        r#"
        UPDATE contact_messages
           SET notify_attempts = notify_attempts + 1
         WHERE id IN (
               SELECT id FROM contact_messages
                WHERE notified_at IS NULL AND notify_attempts < $1
                ORDER BY created_at
                LIMIT 10
                FOR UPDATE SKIP LOCKED)
        RETURNING id, lang, name, email, company, message
        "#,
        MAX_ATTEMPTS,
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;

    let mut sent = 0;
    for msg in batch {
        match send(http, matrix, &msg).await {
            Ok(event_id) => {
                sqlx::query!(
                    "UPDATE contact_messages SET notified_at = now(), last_error = NULL WHERE id = $1",
                    msg.id
                )
                .execute(db)
                .await?;
                tracing::info!(id = %msg.id, %event_id, "aviso entregado");
                sent += 1;
            }
            Err(e) => {
                let err = e.to_string();
                tracing::warn!(id = %msg.id, error = %err, "aviso no entregado, se reintentará");
                sqlx::query!(
                    "UPDATE contact_messages SET last_error = left($2, 500) WHERE id = $1",
                    msg.id,
                    err
                )
                .execute(db)
                .await?;
            }
        }
    }
    Ok(sent)
}

async fn send(http: &reqwest::Client, matrix: &Matrix, msg: &Pending) -> anyhow::Result<String> {
    #[derive(Deserialize)]
    struct Sent {
        event_id: Option<String>,
    }

    let company = msg.company.as_deref().unwrap_or("—");
    let body = format!(
        "📬 Nuevo contacto desde la web ({lang})\nDe: {name} <{email}>\nEmpresa: {company}\n\n{message}",
        lang = msg.lang,
        name = msg.name,
        email = msg.email,
        message = msg.message,
    );
    let html = format!(
        "<p>📬 <strong>Nuevo contacto desde la web</strong> ({lang})</p>\
         <p><strong>De:</strong> {name} &lt;{email}&gt;<br><strong>Empresa:</strong> {company}</p>\
         <blockquote>{message}</blockquote>",
        lang = escape(&msg.lang),
        name = escape(&msg.name),
        email = escape(&msg.email),
        company = escape(company),
        message = escape(&msg.message).replace('\n', "<br>"),
    );

    // El id del mensaje como id de transacción: si el reintento llega
    // después de un envío que sí funcionó, Matrix no lo duplica.
    let url = format!(
        "{}/_matrix/client/v3/rooms/{}/send/m.room.message/{}",
        matrix.homeserver,
        urlencode(&matrix.room_id),
        msg.id
    );
    let res: Sent = http
        .put(url)
        .bearer_auth(&matrix.access_token)
        .json(&serde_json::json!({
            "msgtype": "m.text",
            "body": body,
            "format": "org.matrix.custom.html",
            "formatted_body": html,
        }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    // Sin event_id no hay aviso, aunque la respuesta sea 200.
    res.event_id
        .ok_or_else(|| anyhow::anyhow!("Matrix respondió sin event_id"))
}

fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_is_escaped() {
        assert_eq!(escape("<script>&\"'"), "&lt;script&gt;&amp;&quot;&#39;");
    }

    #[test]
    fn room_id_is_url_encoded() {
        assert_eq!(
            urlencode("!abc:matrix.example.org"),
            "%21abc%3Amatrix.example.org"
        );
    }
}
