-- Medida anónima de las visitas: solo contadores por día, paso y modo (sala
-- 3D, página o móvil). Ninguna fila por visitante: ni IP (ni su hash), ni
-- cookies, ni navegador. Cada paso cuenta una vez por pestaña.
CREATE TABLE visit_steps (
    day  date    NOT NULL DEFAULT current_date,
    step text    NOT NULL CHECK (char_length(step) BETWEEN 1 AND 24),
    mode text    NOT NULL CHECK (mode IN ('sala', 'pagina', 'movil')),
    n    integer NOT NULL DEFAULT 0 CHECK (n >= 0),
    PRIMARY KEY (day, step, mode)
);
