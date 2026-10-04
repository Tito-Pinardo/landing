//! Pruebas de extremo a extremo del router contra PostgreSQL real.
//! `#[sqlx::test]` crea una base de datos nueva por prueba y aplica las
//! migraciones, así que ninguna depende de lo que deje otra.

use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Router,
    body::Body,
    extract::connect_info::MockConnectInfo,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use sqlx::PgPool;
use tokio::sync::Notify;
use tower::ServiceExt;

use crate::{
    app::{self, AppState},
    config::{Config, Matrix},
    contact,
    live::Live,
    notify,
};

const SALT: &str = "sal-de-pruebas-0123456789";

fn config(trust_proxy_headers: bool) -> Config {
    Config {
        bind: "127.0.0.1:0".parse().unwrap(),
        database_url: String::new(),
        db_max_connections: 2,
        ip_hash_salt: SALT.into(),
        trust_proxy_headers,
        public_url: "https://example.org".into(),
        turnstile: None,
        matrix: None,
        github_user: None,
        homelab_status_file: None,
    }
}

fn router(db: PgPool, cfg: Config) -> (Router, Arc<Notify>) {
    let wake = Arc::new(Notify::new());
    let state = AppState::new(
        cfg,
        db,
        reqwest::Client::new(),
        Live::default(),
        wake.clone(),
    )
    .unwrap();
    let app =
        app::router(state).layer(MockConnectInfo(SocketAddr::from(([198, 51, 100, 1], 1234))));
    (app, wake)
}

async fn send(app: &Router, req: Request<Body>) -> (StatusCode, axum::http::HeaderMap, String) {
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let body = res.into_body().collect().await.unwrap().to_bytes();
    (status, headers, String::from_utf8_lossy(&body).into_owned())
}

fn get(uri: &str) -> Request<Body> {
    Request::get(uri).body(Body::empty()).unwrap()
}

fn json_contact(body: serde_json::Value, ip: &str) -> Request<Body> {
    Request::post("/api/contact?lang=es")
        .header(header::CONTENT_TYPE, "application/json")
        .header("cf-connecting-ip", ip)
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn valid_body() -> serde_json::Value {
    serde_json::json!({
        "name": "Ana García",
        "email": "ana@example.com",
        "company": "ACME",
        "message": "Hola, tenemos una vacante de DevOps junior."
    })
}

#[sqlx::test]
async fn pages_headers_and_etag(db: PgPool) {
    let (app, _) = router(db, config(false));

    let (status, h, body) = send(&app, get("/es/")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.contains("<html lang=\"es\""));
    assert!(
        h[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap()
            .contains("default-src 'none'")
    );
    assert!(h.contains_key(header::STRICT_TRANSPORT_SECURITY));
    let etag = h[header::ETAG].clone();

    let req = Request::get("/es/")
        .header(header::IF_NONE_MATCH, etag)
        .body(Body::empty())
        .unwrap();
    let (status, _, body) = send(&app, req).await;
    assert_eq!(status, StatusCode::NOT_MODIFIED);
    assert!(body.is_empty());

    let (status, _, body) = send(&app, get("/en/")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.contains("<html lang=\"en\""));
}

#[sqlx::test]
async fn root_redirects_by_language(db: PgPool) {
    let (app, _) = router(db, config(false));
    let req = Request::get("/")
        .header(header::ACCEPT_LANGUAGE, "en-US,en;q=0.9")
        .body(Body::empty())
        .unwrap();
    let (status, h, _) = send(&app, req).await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    assert_eq!(h[header::LOCATION], "/en/");
    assert_eq!(h[header::VARY], "Accept-Language");

    let (status, h, _) = send(&app, get("/es")).await;
    assert_eq!(status, StatusCode::PERMANENT_REDIRECT);
    assert_eq!(h[header::LOCATION], "/es/");
}

#[sqlx::test]
async fn unknown_paths_are_404_pages(db: PgPool) {
    let (app, _) = router(db, config(false));
    for uri in [
        "/fr/",
        "/nada",
        "/static/no-existe.css",
        "/es/../etc/passwd",
    ] {
        let (status, h, _) = send(&app, get(uri)).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{uri}");
        assert!(
            h[header::CONTENT_TYPE]
                .to_str()
                .unwrap()
                .starts_with("text/html"),
            "{uri}"
        );
    }
}

#[sqlx::test]
async fn versioned_assets_are_immutable(db: PgPool) {
    let (app, _) = router(db, config(false));
    let (status, h, _) = send(&app, get("/static/app.css?v=abc")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        h[header::CACHE_CONTROL]
            .to_str()
            .unwrap()
            .contains("immutable")
    );
    assert!(
        h[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("text/css")
    );

    let (status, h, _) = send(&app, get("/static/cv/Tito_Pinardo_CV_ES.pdf")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(h[header::CONTENT_TYPE], "application/pdf");
}

#[sqlx::test]
async fn healthz_checks_the_database(db: PgPool) {
    let (app, _) = router(db, config(false));
    let (status, _, body) = send(&app, get("/healthz")).await;
    assert_eq!((status, body.as_str()), (StatusCode::OK, "ok"));
}

#[sqlx::test]
async fn contact_is_stored_with_hashed_ip(db: PgPool) {
    let (app, _) = router(db.clone(), config(true));
    let (status, h, body) = send(&app, json_contact(valid_body(), "203.0.113.9")).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(h[header::CACHE_CONTROL], "no-store");

    let row =
        sqlx::query!("SELECT name, company, lang, ip_hash, notified_at FROM contact_messages")
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(row.name, "Ana García");
    assert_eq!(row.company.as_deref(), Some("ACME"));
    assert_eq!(row.lang, "es");
    assert!(row.notified_at.is_none());
    let expected = crate::security::ip_hash(SALT, "203.0.113.9".parse().unwrap());
    assert_eq!(
        row.ip_hash,
        expected.to_vec(),
        "se guarda el hash, no la IP"
    );
}

#[sqlx::test]
async fn invalid_contact_lists_fields(db: PgPool) {
    let (app, _) = router(db.clone(), config(false));
    let body = serde_json::json!({"name": "", "email": "x", "message": "corto"});
    let (status, _, body) = send(&app, json_contact(body, "203.0.113.9")).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["fields"], serde_json::json!(["name", "email", "message"]));
    let n = sqlx::query_scalar!("SELECT count(*) FROM contact_messages")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(n, Some(0));
}

#[sqlx::test]
async fn honeypot_pretends_success_but_stores_nothing(db: PgPool) {
    let (app, _) = router(db.clone(), config(false));
    let mut body = valid_body();
    body["website"] = "http://spam.example".into();
    let (status, _, _) = send(&app, json_contact(body, "203.0.113.9")).await;
    assert_eq!(status, StatusCode::OK);
    let n = sqlx::query_scalar!("SELECT count(*) FROM contact_messages")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(n, Some(0));
}

#[sqlx::test]
async fn rate_limit_per_ip(db: PgPool) {
    let (app, _) = router(db, config(true));
    for _ in 0..contact::PER_IP_HOUR {
        let (status, _, _) = send(&app, json_contact(valid_body(), "203.0.113.9")).await;
        assert_eq!(status, StatusCode::OK);
    }
    let (status, _, body) = send(&app, json_contact(valid_body(), "203.0.113.9")).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "{body}");
    // Otra IP sigue pudiendo escribir.
    let (status, _, _) = send(&app, json_contact(valid_body(), "203.0.113.10")).await;
    assert_eq!(status, StatusCode::OK);
}

#[sqlx::test]
async fn untrusted_proxy_header_cannot_dodge_the_limit(db: PgPool) {
    // Sin confiar en las cabeceras, todas las peticiones cuentan como la
    // misma IP de conexión aunque cada una diga venir de una IP distinta.
    let (app, _) = router(db, config(false));
    for i in 0..contact::PER_IP_HOUR {
        let (status, _, _) =
            send(&app, json_contact(valid_body(), &format!("203.0.113.{i}"))).await;
        assert_eq!(status, StatusCode::OK);
    }
    let (status, _, _) = send(&app, json_contact(valid_body(), "203.0.113.200")).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
}

#[sqlx::test]
async fn oversized_body_is_rejected(db: PgPool) {
    let (app, _) = router(db, config(false));
    let mut body = valid_body();
    body["message"] = "x".repeat(20_000).into();
    let (status, _, _) = send(&app, json_contact(body, "203.0.113.9")).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[sqlx::test]
async fn html_form_fallback_without_javascript(db: PgPool) {
    let (app, _) = router(db.clone(), config(false));
    let req = Request::post("/en/contact")
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(Body::from(
            "name=Bob&email=bob%40example.com&message=Hello+there%2C+let%27s+talk.&website=",
        ))
        .unwrap();
    let (status, h, body) = send(&app, req).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        h[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("text/html")
    );
    assert!(body.contains("Message sent"));
    let lang = sqlx::query_scalar!("SELECT lang FROM contact_messages")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(lang, "en");
}

// ---------------------------------------------------------------------------
// Bandeja de salida contra un Matrix simulado
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
struct FakeMatrix {
    received: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
    /// Cuántas peticiones fallan antes de empezar a aceptar.
    fail_first: Arc<Mutex<u32>>,
}

async fn fake_matrix(fake: FakeMatrix) -> String {
    use axum::{
        Json,
        extract::{Path, State},
        routing::put,
    };
    async fn send(
        State(f): State<FakeMatrix>,
        Path((_room, txn)): Path<(String, String)>,
        headers: axum::http::HeaderMap,
        Json(body): Json<serde_json::Value>,
    ) -> axum::response::Response {
        use axum::response::IntoResponse;
        assert_eq!(headers[header::AUTHORIZATION], "Bearer token-de-prueba");
        let mut fail = f.fail_first.lock().unwrap();
        if *fail > 0 {
            *fail -= 1;
            return StatusCode::BAD_GATEWAY.into_response();
        }
        f.received.lock().unwrap().push((txn.clone(), body));
        Json(serde_json::json!({"event_id": format!("$ev-{txn}")})).into_response()
    }
    let app = Router::new()
        .route(
            "/_matrix/client/v3/rooms/{room}/send/m.room.message/{txn}",
            put(send),
        )
        .with_state(fake);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

async fn wait_until(mut f: impl AsyncFnMut() -> bool) {
    for _ in 0..100 {
        if f().await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("la condición no se cumplió a tiempo");
}

#[sqlx::test]
async fn outbox_delivers_and_retries(db: PgPool) {
    let fake = FakeMatrix::default();
    *fake.fail_first.lock().unwrap() = 1;
    let homeserver = fake_matrix(fake.clone()).await;
    let matrix = Matrix {
        homeserver,
        access_token: "token-de-prueba".into(),
        room_id: "!sala:example.org".into(),
    };

    let (app, wake) = router(db.clone(), config(false));
    let mut body = valid_body();
    body["name"] = "<b>Eve</b>".into();
    let (status, _, _) = send(&app, json_contact(body, "203.0.113.9")).await;
    assert_eq!(status, StatusCode::OK);

    tokio::spawn(notify::run(
        db.clone(),
        reqwest::Client::new(),
        matrix,
        wake.clone(),
    ));

    // El primer intento recibe un 502; el aviso tiene que acabar llegando
    // en un reintento sin perder el mensaje.
    wait_until(async || {
        sqlx::query_scalar!("SELECT notify_attempts FROM contact_messages")
            .fetch_one(&db)
            .await
            .unwrap()
            >= 1
    })
    .await;
    wake.notify_one();
    wait_until(async || {
        sqlx::query_scalar!("SELECT notified_at FROM contact_messages")
            .fetch_one(&db)
            .await
            .unwrap()
            .is_some()
    })
    .await;

    let row = sqlx::query!("SELECT id, notify_attempts, last_error FROM contact_messages")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(row.notify_attempts, 2);
    assert!(row.last_error.is_none());

    let received = fake.received.lock().unwrap();
    assert_eq!(received.len(), 1);
    let (txn, msg) = &received[0];
    assert_eq!(
        txn,
        &row.id.to_string(),
        "el id del mensaje es el id de transacción"
    );
    let html = msg["formatted_body"].as_str().unwrap();
    assert!(
        html.contains("&lt;b&gt;Eve&lt;/b&gt;"),
        "el HTML va escapado: {html}"
    );
}
