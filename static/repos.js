// Página /repos/: las fechas llegan pintadas («10 nov») y aquí pasan a
// «hace 3 horas» en el idioma de la página. Sin JS se quedan como vienen.
(() => {
  "use strict";
  const lang = document.documentElement.lang || "es";
  let rtf;
  try { rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" }); } catch { return; }
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  const ago = (iso) => {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return null;
    const s = (t - Date.now()) / 1000;
    for (const [u, secs] of units) if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), u);
    return rtf.format(0, "minute");
  };
  for (const el of document.querySelectorAll("time[data-ago]")) {
    const text = ago(el.getAttribute("datetime"));
    if (!text) continue;
    el.title = el.textContent.trim();
    el.textContent = text;
  }
})();
