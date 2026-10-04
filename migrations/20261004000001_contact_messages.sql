-- Mensajes del formulario de contacto.
-- Las restricciones repiten la validación del servidor a propósito: si algún
-- día entra un dato por otro camino, la base de datos tampoco lo acepta.
CREATE TABLE contact_messages (
    id              uuid        PRIMARY KEY,
    created_at      timestamptz NOT NULL DEFAULT now(),
    lang            text        NOT NULL CHECK (lang IN ('es', 'en')),
    name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    email           text        NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
    company         text                 CHECK (char_length(company) <= 120),
    message         text        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
    -- SHA-256 de (sal + IP): sirve para limitar envíos sin guardar la IP.
    ip_hash         bytea       NOT NULL CHECK (octet_length(ip_hash) = 32),
    user_agent      text                 CHECK (char_length(user_agent) <= 300),
    -- Bandeja de salida del aviso a Matrix (patrón outbox).
    notified_at     timestamptz,
    notify_attempts integer     NOT NULL DEFAULT 0 CHECK (notify_attempts >= 0),
    last_error      text
);

-- Límite de envíos por IP: "cuántos mensajes de este hash en la última hora".
CREATE INDEX contact_messages_ip_recent_idx
    ON contact_messages (ip_hash, created_at DESC);

-- Bandeja de salida: solo indexa lo pendiente, así el índice se queda pequeño.
CREATE INDEX contact_messages_pending_idx
    ON contact_messages (created_at)
    WHERE notified_at IS NULL;

-- Límite global y purga por antigüedad.
CREATE INDEX contact_messages_created_idx
    ON contact_messages (created_at);
