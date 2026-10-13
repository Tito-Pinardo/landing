-- Motivo del contacto: las ofertas de trabajo llegan a Matrix destacadas.
ALTER TABLE contact_messages
    ADD COLUMN topic text NOT NULL DEFAULT 'other'
        CHECK (topic IN ('job', 'project', 'homelab', 'other'));
