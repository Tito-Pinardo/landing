//! Cabeceras de seguridad e IP real del cliente.

use std::net::{IpAddr, SocketAddr};

use axum::{
    extract::{ConnectInfo, Request},
    http::{HeaderMap, HeaderValue, header},
    middleware::Next,
    response::Response,
};
use sha2::{Digest, Sha256};

/// CSP estricta: nada en línea, solo recursos propios. Turnstile (el captcha
/// de Cloudflare) es la única excepción y solo si está configurado.
pub fn content_security_policy(turnstile: bool) -> HeaderValue {
    let cf = if turnstile {
        " https://challenges.cloudflare.com"
    } else {
        ""
    };
    let csp = format!(
        "default-src 'none'; script-src 'self'{cf}; style-src 'self'; img-src 'self' data:; \
         font-src 'self'; connect-src 'self'; frame-src{frame}; base-uri 'none'; \
         form-action 'self'; frame-ancestors 'none'; manifest-src 'self'",
        frame = if turnstile { cf } else { " 'none'" },
    );
    HeaderValue::from_str(&csp).expect("CSP válida")
}

/// Añade las cabeceras de seguridad a todas las respuestas.
pub async fn headers(csp: HeaderValue, req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert(header::CONTENT_SECURITY_POLICY, csp);
    h.insert(
        header::STRICT_TRANSPORT_SECURITY,
        HeaderValue::from_static("max-age=63072000; includeSubDomains; preload"),
    );
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    h.insert(
        "permissions-policy",
        HeaderValue::from_static("camera=(), microphone=(), geolocation=(), interest-cohort=()"),
    );
    h.insert(
        "cross-origin-opener-policy",
        HeaderValue::from_static("same-origin"),
    );
    res
}

/// IP del visitante. Detrás de Cloudflare la conexión llega de Traefik, así
/// que la IP real viene en `CF-Connecting-IP`; solo se usa si `trust` es
/// cierto, porque cualquiera puede inventarse esa cabecera.
pub fn client_ip(
    headers: &HeaderMap,
    peer: Option<&ConnectInfo<SocketAddr>>,
    trust: bool,
) -> IpAddr {
    if trust {
        for name in ["cf-connecting-ip", "x-real-ip"] {
            if let Some(ip) = headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse().ok())
            {
                return ip;
            }
        }
    }
    peer.map(|c| c.0.ip()).unwrap_or(IpAddr::from([0, 0, 0, 0]))
}

/// Hash con sal de la IP: deja limitar envíos sin guardar la IP.
pub fn ip_hash(salt: &str, ip: IpAddr) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(salt.as_bytes());
    h.update([0]);
    h.update(ip.to_string().as_bytes());
    h.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_headers_ignored_unless_trusted() {
        let mut h = HeaderMap::new();
        h.insert("cf-connecting-ip", HeaderValue::from_static("203.0.113.7"));
        let peer = ConnectInfo(SocketAddr::from(([198, 51, 100, 1], 4000)));
        assert_eq!(
            client_ip(&h, Some(&peer), false),
            IpAddr::from([198, 51, 100, 1])
        );
        assert_eq!(
            client_ip(&h, Some(&peer), true),
            IpAddr::from([203, 0, 113, 7])
        );
    }

    #[test]
    fn garbage_header_falls_back_to_peer() {
        let mut h = HeaderMap::new();
        h.insert("cf-connecting-ip", HeaderValue::from_static("not-an-ip"));
        let peer = ConnectInfo(SocketAddr::from(([198, 51, 100, 1], 4000)));
        assert_eq!(
            client_ip(&h, Some(&peer), true),
            IpAddr::from([198, 51, 100, 1])
        );
    }

    #[test]
    fn ip_hash_depends_on_salt() {
        let ip = IpAddr::from([203, 0, 113, 7]);
        assert_ne!(
            ip_hash("sal-uno-larga-xxxx", ip),
            ip_hash("sal-dos-larga-xxxx", ip)
        );
        assert_eq!(
            ip_hash("sal-uno-larga-xxxx", ip),
            ip_hash("sal-uno-larga-xxxx", ip)
        );
    }

    #[test]
    fn csp_only_allows_turnstile_when_enabled() {
        let off = content_security_policy(false);
        assert!(!off.to_str().unwrap().contains("cloudflare"));
        let on = content_security_policy(true);
        assert!(
            on.to_str()
                .unwrap()
                .contains("frame-src https://challenges.cloudflare.com")
        );
    }
}
