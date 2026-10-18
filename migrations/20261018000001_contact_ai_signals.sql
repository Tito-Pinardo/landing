-- Señales de que un mensaje lo escribió o lo envió una IA (ver src/aitrap.rs).
-- No bloquean nada: se guardan y se avisan con el mensaje.
ALTER TABLE contact_messages ADD COLUMN ai_signals text[] NOT NULL DEFAULT '{}';
