// Preferencias de vista: tema, animaciones y la noche en casa.
// Se carga en <head> sin defer para pintar la página ya con el tema bueno
// (sin destello). El resto de scripts lee `window.tpPrefs`.
(() => {
  "use strict";
  const doc = document.documentElement;
  doc.classList.add("js");
  const get = (k) => { try { return JSON.parse(localStorage.getItem("tp:" + k)); } catch { return null; } };
  const put = (k, v) => { try { localStorage.setItem("tp:" + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
  const osReduce = matchMedia("(prefers-reduced-motion: reduce)");

  function applyTheme(t) {
    if (t === "light" || t === "dark") doc.dataset.theme = t;
    else delete doc.dataset.theme;
  }
  // Sin elección propia manda la del sistema; una elección propia manda sobre ella.
  const motionPref = () => get("motion");
  const motionOff = () => { const m = motionPref(); return m === null ? osReduce.matches : !m; };
  function applyMotion() {
    if (motionOff()) doc.dataset.motion = "off";
    else delete doc.dataset.motion;
  }
  applyTheme(get("theme"));
  applyMotion();
  const motionAtLoad = !motionOff();

  // De noche en casa (Madrid, de 23:00 a 7:00) los enanitos duermen.
  let hour;
  try {
    hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Madrid" }).format(new Date()));
  } catch { hour = new Date().getHours(); }
  const night = hour >= 23 || hour < 7 || new URLSearchParams(location.search).has("noche");
  if (night) doc.dataset.night = "1";

  window.tpPrefs = { motionOff, night };

  // ---------------------------------------------------------- entrar y salir del rack
  // Transiciones entre páginas (View Transitions entre documentos): al entrar
  // en una unidad, su frontal 1U del rack se convierte en el frontal de la
  // página y la unidad sale hacia ti como un cajón mientras el rack se hunde;
  // al volver, al revés; entre unidades vecinas, las bandejas se deslizan.
  // Sin soporte, o con «Animaciones: no», se navega sin más.
  const LANG = "(?:es|en)";
  const isRack = (u) => new RegExp(`^/${LANG}/$`).test(u.pathname);
  const isUnit = (u) => new RegExp(`^/${LANG}/(?!blog/)[a-z0-9-]+/$`).test(u.pathname);
  const pathOf = (u) => u.pathname;
  let lastClick = null;
  addEventListener("click", (ev) => { lastClick = ev.target.closest?.("a[href]") || null; }, { capture: true });

  function kindOf(from, to) {
    if (!from || !to || from.origin !== to.origin) return null;
    if (isRack(from) && isUnit(to)) return "rack-in";
    if (isUnit(from) && isRack(to)) return "rack-out";
    if (isUnit(from) && isUnit(to)) {
      const next = document.querySelector('a[rel="next"]');
      const prev = document.querySelector('a[rel="prev"]');
      if (next && new URL(next.href).pathname === to.pathname) return "unit-next";
      if (prev && new URL(prev.href).pathname === to.pathname) return "unit-prev";
      return "unit-next";
    }
    return null;
  }
  // El frontal del rack que corresponde a una unidad (por su enlace).
  function rackFace(unitPath) {
    if (lastClick && new URL(lastClick.href, location.href).pathname === unitPath) {
      return lastClick.closest(".rack-unit") || lastClick;
    }
    for (const a of document.querySelectorAll(".rack-unit a[href]")) {
      if (new URL(a.href, location.href).pathname === unitPath) return a.closest(".rack-unit");
    }
    return null;
  }
  function name(el) {
    if (!el) return;
    el.style.viewTransitionName = "unit-face";
    // Que no se quede puesto al volver con el botón de atrás (bfcache).
    setTimeout(() => { el.style.viewTransitionName = ""; }, 1500);
  }

  addEventListener("pageswap", (ev) => {
    const vt = ev.viewTransition;
    if (!vt) return;
    if (motionOff()) { vt.skipTransition(); return; }
    const to = ev.activation?.entry?.url ? new URL(ev.activation.entry.url) : null;
    const kind = kindOf(new URL(location.href), to);
    if (!kind) { vt.skipTransition(); return; }
    vt.types.add(kind);
    // El frontal de la unidad se nombra en el CSS según el tipo; aquí, el del rack.
    if (kind === "rack-in") name(rackFace(pathOf(to)));
  });
  addEventListener("pagereveal", (ev) => {
    const vt = ev.viewTransition;
    if (!vt) return;
    if (motionOff()) { vt.skipTransition(); return; }
    const from = navigation?.activation?.from?.url ? new URL(navigation.activation.from.url) : null;
    const here = new URL(location.href);
    let kind = null;
    if (from && isRack(from) && isUnit(here)) kind = "rack-in";
    else if (from && isUnit(from) && isRack(here)) kind = "rack-out";
    else if (from && isUnit(from) && isUnit(here)) kind = sessionStorage.getItem("tp:vt") || "unit-next";
    if (!kind) { vt.skipTransition(); return; }
    vt.types.add(kind);
    // La unidad no repite su animación de entrada: ya la hace la transición.
    if (kind === "rack-in") doc.dataset.arrived = "rack";
    // Al volver al rack: su fila, centrada antes de la primera captura (si
    // no, la página nueva sale arriba del todo y luego salta), recibe la
    // unidad.
    if (kind === "rack-out") {
      const li = rackFace(from.pathname);
      if (li) {
        li.scrollIntoView({ block: "center", behavior: "instant" });
        name(li);
      }
    }
  });
  // ---------------------------------------------------------- respaldo sin transiciones entre páginas
  // Firefox (y otros) solo tienen View Transitions dentro de una página. Ahí
  // se hace a mano: antes de irse, la fila sube a donde estará el frontal o
  // la bandeja se recoge; la página nueva sabe cómo se llegó (sessionStorage)
  // y termina el gesto.
  const crossDoc = "CSSViewTransitionRule" in window;
  if (!crossDoc) {
    try {
      const fx = sessionStorage.getItem("tp:fx");
      if (fx) {
        sessionStorage.removeItem("tp:fx");
        if (!motionOff()) {
          doc.dataset.fx = fx;
          if (fx === "rack-in") doc.dataset.arrived = "rack";
        }
      }
    } catch { /* sin almacenamiento */ }
    const go = (href, fx, ms) => {
      try { sessionStorage.setItem("tp:fx", fx); } catch { /* sin almacenamiento */ }
      setTimeout(() => { location.href = href; }, ms);
    };
    addEventListener("click", (ev) => {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || motionOff()) return;
      const a = ev.target.closest?.("a[href]");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const to = new URL(a.href, location.href);
      const kind = kindOf(new URL(location.href), to);
      if (kind === "rack-in") {
        ev.preventDefault();
        const src = a.closest(".rack-unit, .quest, .lab-console") || a;
        const r = src.getBoundingClientRect();
        // Una copia de la fila (sin su atributo style: la CSP no lo deja
        // copiar) sube a donde estará el frontal y se ensancha.
        const ghost = (src.closest(".rack-unit") || a).cloneNode(true);
        ghost.removeAttribute("style");
        ghost.removeAttribute("id");
        ghost.querySelectorAll("[style], [id]").forEach((e) => { e.removeAttribute("style"); e.removeAttribute("id"); });
        ghost.classList.add("fx-ghost");
        ghost.setAttribute("aria-hidden", "true");
        Object.assign(ghost.style, { top: r.top + "px", left: r.left + "px", width: r.width + "px", height: r.height + "px" });
        document.body.append(ghost);
        doc.classList.add("fx-leaving");
        // Donde estará el frontal: en el móvil ocupa casi todo el ancho.
        const narrow = innerWidth <= 640;
        const W = narrow ? innerWidth - 32 : Math.min(innerWidth - 2 * 34, 1240);
        const top = narrow ? 100 : 104;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          ghost.style.transform = `translate(${(innerWidth - W) / 2 - r.left}px, ${top - r.top}px)`;
          ghost.style.width = W + "px";
          ghost.style.height = "62px";
        }));
        window.tpSound?.play("slide");
        go(a.href, "rack-in", 420);
      } else if (kind === "rack-out") {
        ev.preventDefault();
        doc.classList.add("fx-closing");
        window.tpSound?.play("slide");
        go(a.href, "rack-out", 380);
      }
    });
    // Volver con el botón de atrás (bfcache): la página vieja, como estaba.
    addEventListener("pageshow", (e) => {
      if (!e.persisted) return;
      doc.classList.remove("fx-leaving", "fx-closing");
      document.querySelectorAll(".fx-ghost").forEach((g) => g.remove());
    });
  }

  // Entre unidades, la página nueva no sabe si se fue hacia arriba o abajo.
  addEventListener("pageswap", (ev) => {
    const to = ev.activation?.entry?.url ? new URL(ev.activation.entry.url) : null;
    const kind = kindOf(new URL(location.href), to);
    try { if (kind?.startsWith("unit-")) sessionStorage.setItem("tp:vt", kind); } catch { /* sin almacenamiento */ }
  });

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.querySelector("[data-prefs-toggle]");
    const panel = document.querySelector("[data-prefs-panel]");
    if (!btn || !panel) return;
    const note = panel.querySelector("[data-night-note]");
    if (note) note.hidden = !night;
    const radios = (name) => panel.querySelectorAll(`input[name="${name}"]`);
    const check = (name, value) => { for (const r of radios(name)) r.checked = r.value === value; };
    check("tp-theme", get("theme") || "auto");
    check("tp-motion", motionOff() ? "off" : "on");

    const open = (on) => {
      panel.hidden = !on;
      btn.setAttribute("aria-expanded", String(on));
      if (on) panel.querySelector("input:checked")?.focus();
    };
    btn.addEventListener("click", () => open(panel.hidden));
    document.addEventListener("click", (ev) => {
      if (!panel.hidden && !panel.contains(ev.target) && !btn.contains(ev.target)) open(false);
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !panel.hidden) { open(false); btn.focus(); }
    });
    for (const r of radios("tp-theme")) r.addEventListener("change", () => {
      put("theme", r.value === "auto" ? null : r.value);
      applyTheme(r.value);
    });
    for (const r of radios("tp-motion")) r.addEventListener("change", () => {
      put("motion", r.value === "on");
      applyMotion();
      // Los enanitos y las animaciones de entrada se montan al cargar: si
      // se encienden después de haber empezado sin ellas, hace falta recargar.
      if (!motionOff() && !motionAtLoad) location.reload();
    });
  });
})();
