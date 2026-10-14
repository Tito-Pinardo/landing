// Índice del blog: filtros por tipo, tecnología y unidad, y búsqueda en el
// texto entero de cada artículo. El índice (/{lang}/blog/index.json) se pide
// la primera vez que se escribe; los filtros viajan en la URL para poder
// compartir «los artículos de ZFS» con un enlace.
(() => {
  "use strict";
  const form = document.querySelector("[data-blog-filters]");
  const list = document.querySelector("[data-post-list]");
  if (!form || !list) return;
  const cards = [...list.querySelectorAll("[data-slug]")];
  const months = [...list.querySelectorAll("[data-month]")];
  const q = form.querySelector("[data-bf-q]");
  const count = form.querySelector("[data-bf-count]");
  const clear = form.querySelector("[data-bf-clear]");
  const empty = document.querySelector("[data-bf-empty]");
  const lang = document.documentElement.lang || "es";
  // Sin tildes ni mayúsculas: «cortafuegos» encuentra «Cortafuegos» y «energia», «energía».
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let index = null, loading = null;

  function loadIndex() {
    loading ||= fetch(`/${lang}/blog/index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((items) => { index = new Map(items.map((i) => [i.slug, norm(i.text)])); })
      .catch(() => { index = new Map(); });
    return loading;
  }

  function state() {
    const d = new FormData(form);
    return { q: (d.get("q") || "").trim(), kind: d.get("kind") || "", tech: d.get("tech") || "", unit: d.get("unit") || "" };
  }

  function apply(push = true) {
    const s = state();
    const words = norm(s.q).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const c of cards) {
      const text = index?.get(c.dataset.slug) ?? norm(c.textContent);
      const ok = (!s.kind || c.dataset.kind === s.kind)
        && (!s.tech || c.dataset.tech.split(" ").includes(s.tech))
        && (!s.unit || c.dataset.unit === s.unit)
        && words.every((w) => text.includes(w));
      c.hidden = !ok;
      if (ok) shown++;
    }
    // Un mes sin artículos visibles no enseña su rótulo.
    for (const m of months) m.hidden = !m.querySelector("[data-slug]:not([hidden])");
    count.textContent = count.dataset.template.replace("{n}", shown).replace("{total}", cards.length);
    const active = Boolean(s.q || s.kind || s.tech || s.unit);
    clear.hidden = !active;
    empty.hidden = shown > 0;
    if (push) {
      const u = new URL(location.href);
      for (const k of ["q", "kind", "tech", "unit"]) { if (s[k]) u.searchParams.set(k, s[k]); else u.searchParams.delete(k); }
      history.replaceState(null, "", u);
    }
  }

  // Estado inicial desde la URL.
  const params = new URLSearchParams(location.search);
  if (params.get("q")) q.value = params.get("q");
  for (const k of ["tech", "unit"]) { const v = params.get(k); if (v) form.elements[k].value = v; }
  const kind = params.get("kind");
  if (kind) for (const r of form.querySelectorAll('input[name="kind"]')) r.checked = r.value === kind;

  form.addEventListener("submit", (ev) => ev.preventDefault());
  // En el móvil los filtros empiezan plegados (salvo que vengan en la URL).
  const box = document.querySelector("[data-filters-box]");
  if (box && matchMedia("(max-width: 900px)").matches && ![...params.keys()].length) box.open = false;
  form.addEventListener("change", () => apply());
  q.addEventListener("input", () => { if (!index) loadIndex().then(() => apply()); apply(); });
  form.addEventListener("reset", () => setTimeout(() => apply(), 0));
  if (q.value) loadIndex().then(() => apply(false));
  apply(false);
})();
