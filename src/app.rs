//! Rutas y estado compartido.

use std::{net::SocketAddr, sync::Arc, time::Duration};

use axum::{
    Form, Json, Router,
    body::Body,
    extract::{ConnectInfo, Path, Query, RawQuery, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
};
use rust_embed::Embed;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::sync::Notify;
use tower_http::{
    compression::CompressionLayer, limit::RequestBodyLimitLayer, timeout::TimeoutLayer,
    trace::TraceLayer,
};

use crate::{
    config::Config,
    contact::{self, ContactForm, Limit},
    content::{Content, Lang},
    live::Live,
    render::{self, Page},
    security,
};

#[derive(Embed)]
#[folder = "static/"]
struct Assets;

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

struct Inner {
    cfg: Config,
    content: Content,
    asset_v: String,
    pages: [Page; 2],
    not_found: [Page; 2],
    db: PgPool,
    http: reqwest::Client,
    live: Live,
    wake_notifier: Arc<Notify>,
}

impl AppState {
    pub fn new(
        cfg: Config,
        db: PgPool,
        http: reqwest::Client,
        live: Live,
        wake_notifier: Arc<Notify>,
    ) -> anyhow::Result<Self> {
        let content = Content::embedded()?;
        let asset_v = asset_version();
        let site_key = cfg.turnstile.as_ref().map(|t| t.site_key.as_str());
        let pages = [
            render::index(&content, Lang::Es, &asset_v, &cfg.public_url, site_key)?,
            render::index(&content, Lang::En, &asset_v, &cfg.public_url, site_key)?,
        ];
        let not_found = Lang::ALL.map(|lang| {
            use askama::Template;
            let c = render::ctx(&content, lang, &asset_v, &cfg.public_url);
            Page::new(render::NotFoundTpl { c }.render().expect("plantilla 404"))
        });
        Ok(AppState(Arc::new(Inner {
            cfg,
            content,
            asset_v,
            pages,
            not_found,
            db,
            http,
            live,
            wake_notifier,
        })))
    }

    fn page(&self, lang: Lang) -> &Page {
        &self.0.pages[lang as usize]
    }
}

pub fn router(state: AppState) -> Router {
    let csp = security::content_security_policy(state.0.cfg.turnstile.is_some());
    Router::new()
        .route("/", get(root))
        .route("/{lang}", get(lang_no_slash))
        .route("/{lang}/", get(page))
        .route("/{lang}/contact", post(contact_form))
        .route("/api/contact", post(contact_json))
        .route("/api/status", get(status))
        .route("/healthz", get(healthz))
        .route("/static/{*path}", get(asset))
        .route("/robots.txt", get(robots))
        .route("/sitemap.xml", get(sitemap))
        .fallback(not_found)
        .layer(RequestBodyLimitLayer::new(16 * 1024))
        .layer(CompressionLayer::new())
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(15),
        ))
        .layer(axum::middleware::from_fn(move |req, next| {
            security::headers(csp.clone(), req, next)
        }))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

// ---------------------------------------------------------------------------
// Páginas
// ---------------------------------------------------------------------------

/// Idioma preferido según `Accept-Language`: el primero de es/en con más
/// peso. Si no aparece ninguno, inglés (visitante de fuera); sin cabecera,
/// español.
pub fn preferred_lang(headers: &HeaderMap) -> Lang {
    let Some(raw) = headers
        .get(header::ACCEPT_LANGUAGE)
        .and_then(|v| v.to_str().ok())
    else {
        return Lang::Es;
    };
    let mut best: Option<(f32, Lang)> = None;
    for part in raw.split(',') {
        let mut it = part.trim().split(';');
        let tag = it.next().unwrap_or_default().trim().to_ascii_lowercase();
        let q = it
            .find_map(|p| p.trim().strip_prefix("q="))
            .and_then(|q| q.parse::<f32>().ok())
            .unwrap_or(1.0);
        let primary = tag.split('-').next().unwrap_or_default();
        if let Some(lang) = Lang::from_code(primary)
            && best.is_none_or(|(bq, _)| q > bq)
        {
            best = Some((q, lang));
        }
    }
    best.map_or(Lang::En, |(_, l)| l)
}

async fn root(headers: HeaderMap) -> Response {
    let lang = preferred_lang(&headers);
    let mut res = Redirect::to(&format!("/{}/", lang.code())).into_response();
    res.headers_mut()
        .insert(header::VARY, HeaderValue::from_static("Accept-Language"));
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=0"),
    );
    res
}

async fn lang_no_slash(
    State(st): State<AppState>,
    Path(lang): Path<String>,
    headers: HeaderMap,
) -> Response {
    match Lang::from_code(&lang) {
        Some(l) => Redirect::permanent(&format!("/{}/", l.code())).into_response(),
        None => not_found(State(st), headers).await,
    }
}

async fn page(
    State(st): State<AppState>,
    Path(lang): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some(lang) = Lang::from_code(&lang) else {
        return not_found(State(st), headers).await;
    };
    serve_page(st.page(lang), &headers, "public, max-age=300, s-maxage=600")
}

fn serve_page(page: &Page, req: &HeaderMap, cache: &'static str) -> Response {
    let etag = HeaderValue::from_str(&page.etag).expect("etag válido");
    let mut res = if req.get(header::IF_NONE_MATCH) == Some(&etag) {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        (
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            page.body.clone(),
        )
            .into_response()
    };
    res.headers_mut().insert(header::ETAG, etag);
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    res
}

async fn not_found(State(st): State<AppState>, headers: HeaderMap) -> Response {
    let page = &st.0.not_found[preferred_lang(&headers) as usize];
    let mut res = serve_page(page, &headers, "public, max-age=60");
    *res.status_mut() = StatusCode::NOT_FOUND;
    res
}

// ---------------------------------------------------------------------------
// Ficheros estáticos
// ---------------------------------------------------------------------------

/// Versión de los recursos: cambia cuando cambia el CSS o el JS, así se
/// pueden cachear "para siempre" con `?v=`.
fn asset_version() -> String {
    let mut h = Sha256::new();
    for name in ["app.css", "app.js"] {
        if let Some(f) = Assets::get(name) {
            h.update(f.metadata.sha256_hash());
        }
    }
    hex::encode(h.finalize())[..12].to_owned()
}

async fn asset(
    Path(path): Path<String>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
    State(st): State<AppState>,
) -> Response {
    let Some(file) = Assets::get(&path) else {
        return not_found(State(st), headers).await;
    };
    let etag = HeaderValue::from_str(&format!(
        "\"{}\"",
        &hex::encode(file.metadata.sha256_hash())[..16]
    ))
    .expect("etag");
    let versioned = query.is_some_and(|q| q.starts_with("v="));
    let cache = if versioned {
        "public, max-age=31536000, immutable"
    } else if path.ends_with(".pdf") {
        "public, max-age=86400"
    } else {
        "public, max-age=3600"
    };
    let mut res = if headers.get(header::IF_NONE_MATCH) == Some(&etag) {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        let mime = file.metadata.mimetype();
        (
            [(header::CONTENT_TYPE, mime.to_owned())],
            Body::from(file.data),
        )
            .into_response()
    };
    res.headers_mut().insert(header::ETAG, etag);
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    res
}

async fn robots(State(st): State<AppState>) -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
            (header::CACHE_CONTROL, "public, max-age=86400"),
        ],
        format!(
            "User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: {}/sitemap.xml\n",
            st.0.cfg.public_url
        ),
    )
}

async fn sitemap(State(st): State<AppState>) -> impl IntoResponse {
    let u = &st.0.cfg.public_url;
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\" xmlns:xhtml=\"http://www.w3.org/1999/xhtml\">\n",
    );
    for lang in Lang::ALL {
        xml.push_str(&format!(
            "<url><loc>{u}/{l}/</loc><xhtml:link rel=\"alternate\" hreflang=\"es\" href=\"{u}/es/\"/><xhtml:link rel=\"alternate\" hreflang=\"en\" href=\"{u}/en/\"/></url>\n",
            l = lang.code()
        ));
    }
    xml.push_str("</urlset>\n");
    (
        [
            (header::CONTENT_TYPE, "application/xml"),
            (header::CACHE_CONTROL, "public, max-age=86400"),
        ],
        xml,
    )
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async fn status(State(st): State<AppState>) -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CACHE_CONTROL, "public, max-age=60"),
        ],
        st.0.live.json(),
    )
}

async fn healthz(State(st): State<AppState>) -> Response {
    match sqlx::query_scalar!("SELECT 1 AS \"ok!\"")
        .fetch_one(&st.0.db)
        .await
    {
        Ok(_) => ([(header::CACHE_CONTROL, "no-store")], "ok").into_response(),
        Err(e) => {
            tracing::error!(error = %e, "healthz: base de datos no disponible");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                [(header::CACHE_CONTROL, "no-store")],
                "db",
            )
                .into_response()
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Sent,
    Invalid(Vec<&'static str>),
    RateLimited,
    Captcha,
    Error,
}

async fn submit(
    st: &AppState,
    lang: Lang,
    form: ContactForm,
    headers: &HeaderMap,
    peer: Option<&ConnectInfo<SocketAddr>>,
) -> Outcome {
    let cfg = &st.0.cfg;
    // A un bot no se le dice que le hemos pillado.
    if form.is_spam_trap() {
        tracing::info!("contacto descartado por el campo trampa");
        return Outcome::Sent;
    }
    let msg = match form.validate() {
        Ok(m) => m,
        Err(errs) => return Outcome::Invalid(errs.iter().map(|e| e.field()).collect()),
    };
    let ip = security::client_ip(headers, peer, cfg.trust_proxy_headers);
    if let Some(ts) = &cfg.turnstile {
        match contact::verify_turnstile(&st.0.http, &ts.secret, &form.turnstile_token, ip).await {
            Ok(true) => {}
            Ok(false) => return Outcome::Captcha,
            Err(e) => {
                tracing::error!(error = %e, "Turnstile no responde");
                return Outcome::Error;
            }
        }
    }
    let ip_hash = security::ip_hash(&cfg.ip_hash_salt, ip);
    match contact::check_limits(&st.0.db, &ip_hash).await {
        Ok(Limit::Ok) => {}
        Ok(Limit::Exceeded) => return Outcome::RateLimited,
        Err(e) => {
            tracing::error!(error = %e, "no se pudieron comprobar los límites");
            return Outcome::Error;
        }
    }
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok());
    match contact::insert(&st.0.db, lang, &msg, &ip_hash, ua).await {
        Ok(id) => {
            tracing::info!(%id, "mensaje de contacto guardado");
            st.0.wake_notifier.notify_one();
            Outcome::Sent
        }
        Err(e) => {
            tracing::error!(error = %e, "no se pudo guardar el mensaje");
            Outcome::Error
        }
    }
}

#[derive(Deserialize)]
pub struct LangQuery {
    lang: Option<String>,
}

#[derive(Serialize)]
struct ContactReply {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    fields: Vec<&'static str>,
}

async fn contact_json(
    State(st): State<AppState>,
    Query(q): Query<LangQuery>,
    peer: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(form): Json<ContactForm>,
) -> Response {
    let lang = q
        .lang
        .as_deref()
        .and_then(Lang::from_code)
        .unwrap_or(Lang::Es);
    let (status, reply) = match submit(&st, lang, form, &headers, Some(&peer)).await {
        Outcome::Sent => (
            StatusCode::OK,
            ContactReply {
                ok: true,
                error: None,
                fields: vec![],
            },
        ),
        Outcome::Invalid(fields) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            ContactReply {
                ok: false,
                error: Some("invalid"),
                fields,
            },
        ),
        Outcome::RateLimited => (
            StatusCode::TOO_MANY_REQUESTS,
            ContactReply {
                ok: false,
                error: Some("rate_limited"),
                fields: vec![],
            },
        ),
        Outcome::Captcha => (
            StatusCode::FORBIDDEN,
            ContactReply {
                ok: false,
                error: Some("captcha"),
                fields: vec![],
            },
        ),
        Outcome::Error => (
            StatusCode::SERVICE_UNAVAILABLE,
            ContactReply {
                ok: false,
                error: Some("error"),
                fields: vec![],
            },
        ),
    };
    (status, [(header::CACHE_CONTROL, "no-store")], Json(reply)).into_response()
}

/// Envío sin JavaScript: responde con una página HTML.
async fn contact_form(
    State(st): State<AppState>,
    Path(lang): Path<String>,
    peer: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Form(form): Form<ContactForm>,
) -> Response {
    use askama::Template;
    let Some(lang) = Lang::from_code(&lang) else {
        return not_found(State(st), headers).await;
    };
    let outcome = submit(&st, lang, form, &headers, Some(&peer)).await;
    let c = render::ctx(&st.0.content, lang, &st.0.asset_v, &st.0.cfg.public_url);
    let (status, key) = match &outcome {
        Outcome::Sent => (StatusCode::OK, "ok"),
        Outcome::Invalid(_) => (StatusCode::UNPROCESSABLE_ENTITY, "invalid"),
        Outcome::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "rate_limited"),
        Outcome::Captcha => (StatusCode::FORBIDDEN, "error"),
        Outcome::Error => (StatusCode::SERVICE_UNAVAILABLE, "error"),
    };
    let message = c.contact(key);
    let html = render::ResultTpl {
        ok: outcome == Outcome::Sent,
        message,
        c: render::ctx(&st.0.content, lang, &st.0.asset_v, &st.0.cfg.public_url),
    }
    .render()
    .unwrap_or_default();
    (
        status,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        html,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn al(v: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(header::ACCEPT_LANGUAGE, HeaderValue::from_str(v).unwrap());
        h
    }

    #[test]
    fn language_negotiation() {
        assert_eq!(preferred_lang(&HeaderMap::new()), Lang::Es);
        assert_eq!(preferred_lang(&al("es-ES,es;q=0.9,en;q=0.8")), Lang::Es);
        assert_eq!(preferred_lang(&al("en-GB,en;q=0.9")), Lang::En);
        assert_eq!(preferred_lang(&al("de-DE,de;q=0.9")), Lang::En);
        assert_eq!(preferred_lang(&al("de;q=1,en;q=0.5,es;q=0.7")), Lang::Es);
        assert_eq!(preferred_lang(&al("garbage;;;,,")), Lang::En);
    }
}
