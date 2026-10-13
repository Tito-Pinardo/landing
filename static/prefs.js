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
