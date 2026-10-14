-- Quién ha resuelto cada reto de bandera de la terminal: solo el hash con
-- sal de la IP (como el formulario), para contar una vez por visitante sin
-- guardar nombres ni direcciones.
CREATE TABLE flag_solves (
    flag       text        NOT NULL CHECK (char_length(flag) BETWEEN 1 AND 40),
    ip_hash    bytea       NOT NULL CHECK (octet_length(ip_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (flag, ip_hash)
);
