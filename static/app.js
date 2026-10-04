// titopinardogutierrez.com — mejora progresiva: la página funciona sin esto.
(() => {
  "use strict";
  const doc = document.documentElement;
  doc.classList.add("js");

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const T = JSON.parse($("#i18n").textContent);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------ almacenamiento
  // Solo comodidades del visitante; si el navegador lo bloquea, no pasa nada.
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("tp:" + key);
        return v === null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("tp:" + key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
    },
  };

  // ------------------------------------------------------------ utilidades
  const scrollTo = (el, block = "start") => el?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block });
  const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));

  // Escribe el texto letra a letra (o de golpe con movimiento reducido).
  function typeInto(el, text, done) {
    clearInterval(el._typing);
    el.classList.remove("is-typing");
    if (reduceMotion || text.length > 400) {
      el.textContent = text;
      done?.();
      return;
    }
    el.textContent = "";
    el.classList.add("is-typing");
    let i = 0;
    el._typing = setInterval(() => {
      i += 2;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(el._typing);
        el.classList.remove("is-typing");
        done?.();
      }
    }, 16);
  }

  // ------------------------------------------------------------ Hermes, el guía
  // Guionizado: no hay IA aquí, solo reacciones a lo que hace el visitante.
  const H = T.hermes;
  const hermes = {
    root: $("[data-hermes]"),
    bubble: $("[data-hermes-bubble]"),
    text: $("[data-hermes-text]"),
    choices: $("[data-hermes-choices]"),
    toggle: $("[data-hermes-toggle]"),
    badge: $("[data-hermes-badge]"),
    pending: null,
    tour: -1,
    idleTimer: 0,
    idleCount: 0,
  };
  const tipsSeen = new Set(store.get("hermesTips", []));

  function hermesIsOpen() { return !hermes.bubble.hidden; }

  function hermesShow(open) {
    hermes.bubble.hidden = !open;
    hermes.toggle.setAttribute("aria-expanded", String(open));
    store.set("hermesMin", !open);
    if (open) hermes.badge.hidden = true;
  }

  // choices: [{label, run}] o [{label, href, download}]
  function hermesSay(msg, choices = [], force = false) {
    if (doc.classList.contains("quick-mode")) return;
    if (!hermesIsOpen() && !force) {
      hermes.pending = { msg, choices };
      hermes.badge.hidden = false;
      return;
    }
    hermes.pending = null;
    hermesShow(true);
    hermes.root.classList.add("is-talking");
    hermes.choices.replaceChildren();
    typeInto(hermes.text, msg, () => {
      hermes.root.classList.remove("is-talking");
      hermes.choices.replaceChildren(...choices.map((c, i) => {
        const el = document.createElement(c.href ? "a" : "button");
        el.className = "btn btn-sm" + (i === 0 ? " btn-primary" : "");
        el.textContent = c.label;
        if (c.href) {
          el.href = c.href;
          if (c.download) el.setAttribute("download", "");
          el.addEventListener("click", () => c.run?.());
        } else {
          el.type = "button";
          el.addEventListener("click", c.run);
        }
        return el;
      }));
    });
    hermesIdleReset();
  }

  function hermesMenu(greeting) {
    hermesSay(greeting, [
      { label: H.choice_tour, run: () => tourGo(Math.max(0, hermes.tour)) },
      { label: H.choice_hr, run: hermesHr },
      { label: H.choice_lab, run: hermesLab },
      { label: H.choice_free, run: hermesFree },
    ], true);
  }
  function hermesHr() {
    scrollTo($("#quick"));
    hermesSay(H.hr_text, [
      { label: T.ui.download_cv, href: T.cv, download: true, run: () => unlock("recruiter") },
      { label: T.ui.contact, run: () => scrollTo($("#contact")) },
    ], true);
  }
  function hermesLab() {
    scrollTo($("#lab"));
    hermesSay(H.zones.lab, [], true);
    setTimeout(() => labStartFlow("visit"), 900);
  }
  function hermesFree() {
    hermesSay(H.free_text, [], true);
    setTimeout(() => { if (hermes.tour < 0) hermesShow(false); }, 5000);
  }

  // Tour guiado por las zonas, en orden.
  function tourGo(i) {
    const zones = T.zones;
    if (i >= zones.length) {
      hermes.tour = -1;
      store.set("hermesTour", -1);
      unlock("companion");
      hermesSay(H.tour_end, [{ label: T.ui.contact, run: () => scrollTo($("#contact")) }], true);
      return;
    }
    hermes.tour = i;
    store.set("hermesTour", i);
    const z = zones[i];
    const section = $("#" + z.id);
    scrollTo(section);
    $$(".zone.is-spotlight").forEach((x) => x.classList.remove("is-spotlight"));
    section?.classList.add("is-spotlight");
    setTimeout(() => section?.classList.remove("is-spotlight"), 2600);
    tipsSeen.add(z.id);
    store.set("hermesTips", [...tipsSeen]);
    const choices = [{ label: `${H.tour_next} (${i + 1}/${zones.length})`, run: () => tourGo(i + 1) }];
    if (i > 0) choices.push({ label: H.tour_prev, run: () => tourGo(i - 1) });
    choices.push({ label: H.tour_exit, run: () => { hermes.tour = -1; store.set("hermesTour", -1); hermesFree(); } });
    hermesSay(H.zones[z.id], choices, true);
    if (z.id === "lab") setTimeout(() => labStartFlow("visit"), 1200);
  }

  // Comentario al entrar por primera vez en una zona (fuera del tour).
  function hermesZone(id) {
    if (hermes.tour >= 0 || tipsSeen.has(id) || !H.zones[id]) return;
    tipsSeen.add(id);
    store.set("hermesTips", [...tipsSeen]);
    hermesSay(H.zones[id]);
  }

  // Pistas si el visitante se queda quieto con el guía abierto.
  function hermesIdleReset() {
    clearTimeout(hermes.idleTimer);
    hermes.idleTimer = setTimeout(() => {
      if (!hermesIsOpen() || hermes.tour >= 0 || hermes.idleCount >= 3 || labState.playing) return;
      const tip = H.idle[(store.get("hermesIdle", 0) + hermes.idleCount) % H.idle.length];
      hermes.idleCount += 1;
      store.set("hermesIdle", store.get("hermesIdle", 0) + 1);
      hermesSay(tip);
    }, 45000);
  }
  ["scroll", "pointerdown", "keydown"].forEach((ev) => addEventListener(ev, hermesIdleReset, { passive: true }));

  hermes.toggle?.addEventListener("click", () => {
    if (hermesIsOpen()) return hermesShow(false);
    if (hermes.pending) return hermesSay(hermes.pending.msg, hermes.pending.choices, true);
    hermesMenu(fill(H.greet_return, { zones: store.get("zones", []).length }));
  });
  $("[data-hermes-min]")?.addEventListener("click", () => hermesShow(false));

  // ------------------------------------------------------------ logros
  const unlocked = new Set(store.get("achievements", []));
  const toasts = $("[data-toasts]");

  function unlock(id) {
    if (unlocked.has(id)) return;
    const a = T.achievements.find((x) => x.id === id);
    if (!a) return;
    unlocked.add(id);
    store.set("achievements", [...unlocked]);
    if (doc.classList.contains("quick-mode")) return;
    if (hermesIsOpen() && hermes.tour < 0 && !["companion", "navigator"].includes(id)) {
      setTimeout(() => hermesSay(fill(H.achievement, { title: a.title })), 1200);
    }
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.innerHTML = '<span class="toast-icon" aria-hidden="true">★</span><div><small></small><strong></strong><span class="toast-text"></span></div>';
    el.querySelector("small").textContent = T.ui.achievement_unlocked;
    el.querySelector("strong").textContent = a.title;
    el.querySelector(".toast-text").textContent = a.text;
    toasts.append(el);
    setTimeout(() => {
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), 320);
    }, 4200);
  }

  // Cambiar de idioma: se apunta antes de navegar y se celebra al llegar.
  if (store.get("pendingPolyglot", false)) {
    store.set("pendingPolyglot", false);
    setTimeout(() => unlock("polyglot"), 600);
  }
  $$("[data-lang-switch]").forEach((a) => a.addEventListener("click", () => store.set("pendingPolyglot", true)));
  $$("[data-cv]").forEach((a) => a.addEventListener("click", () => { unlock("recruiter"); hermesSay(H.cv); }));

  // ------------------------------------------------------------ vista rápida
  const quickBtn = $("[data-quick-toggle]");
  function setQuick(on) {
    doc.classList.toggle("quick-mode", on);
    quickBtn?.setAttribute("aria-pressed", String(on));
    store.set("quick", on);
  }
  setQuick(store.get("quick", false));
  quickBtn?.addEventListener("click", () => {
    const on = !doc.classList.contains("quick-mode");
    setQuick(on);
    if (on) $("#quick").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  });

  // ------------------------------------------------------------ zonas descubiertas
  const zoneIds = T.zones.map((z) => z.id);
  const found = new Set(store.get("zones", []).filter((z) => zoneIds.includes(z)));
  const xpBar = $("[data-xp-bar]");
  const xpCount = $("[data-xp-count]");

  function paintZones() {
    for (const id of zoneIds) {
      const on = found.has(id);
      $(`[data-tile="${id}"]`)?.classList.toggle("is-found", on);
      $(`[data-zone-link="${id}"]`)?.classList.toggle("is-found", on);
    }
    xpCount.textContent = found.size;
    xpBar.setAttribute("width", String(Math.round((found.size / zoneIds.length) * 100)));
  }
  paintZones();

  if ("IntersectionObserver" in window) {
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = e.target.dataset.zone;
        if (!found.has(id)) {
          found.add(id);
          store.set("zones", [...found]);
          paintZones();
          if (found.size === zoneIds.length) unlock("explorer");
        }
        if (id === "now") loadLive();
        hermesZone(id);
        if (id === "lab" && !labState.autoplayed && !reduceMotion) {
          labState.autoplayed = true;
          setTimeout(() => { if (!labState.flow) labStartFlow("visit"); }, 700);
        }
      }
    }, { threshold: 0.25 });
    $$("[data-zone]").forEach((z) => seen.observe(z));

    // Resalta en la barra la zona en pantalla.
    const current = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          $$("[data-zone-link]").forEach((a) => a.classList.toggle("is-current", a.dataset.zoneLink === e.target.dataset.zone));
        }
      }
    }, { rootMargin: "-45% 0px -50% 0px" });
    $$("[data-zone]").forEach((z) => current.observe(z));
  } else {
    loadLive();
  }

  // ------------------------------------------------------------ filtro por habilidad
  const quests = $$(".quest");
  const filterStatus = $("[data-filter-status]");
  const filterName = $("[data-filter-name]");
  const huntedSkills = new Set(store.get("skills", []));
  let activeTech = null;

  function filterBy(tech, name) {
    activeTech = tech;
    $$(".skill").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tech === tech)));
    for (const q of quests) {
      const hit = tech !== null && q.dataset.tech.split(" ").includes(tech);
      q.classList.toggle("is-match", hit);
      q.classList.toggle("is-dim", tech !== null && !hit);
      $$("[data-chip]", q).forEach((c) => c.classList.toggle("is-hit", c.dataset.chip === tech));
    }
    filterStatus.hidden = tech === null;
    if (tech !== null) {
      filterName.textContent = name;
      huntedSkills.add(tech);
      store.set("skills", [...huntedSkills]);
      if (huntedSkills.size >= 3) unlock("skill_hunter");
    }
  }
  $$(".skill").forEach((b) => b.addEventListener("click", () => {
    if (b.hasAttribute("data-unused")) return;
    const tech = b.dataset.tech;
    if (activeTech === tech) return filterBy(null);
    const name = $(".skill-name", b).textContent;
    filterBy(tech, name);
    const n = quests.filter((q) => q.dataset.tech.split(" ").includes(tech)).length;
    hermesSay(n ? fill(H.skill, { skill: name, n, missions: n === 1 ? H.mission_one : H.mission_many }) : fill(H.skill_none, { skill: name }));
    scrollTo($("#quests"));
  }));
  $("[data-filter-clear]")?.addEventListener("click", () => filterBy(null));

  // ------------------------------------------------------------ laboratorio
  // Recorridos animados: un paquete viaja de pieza en pieza por el camino
  // real y Hermes narra cada paso en la consola.
  const SVGNS = "http://www.w3.org/2000/svg";
  const nodeById = Object.fromEntries(T.nodes.map((n) => [n.id, n]));
  const labNodes = $$(".lab-node");
  const layer = $("[data-flow-layer]");
  const packet = $("[data-packet]");
  const packetGlow = $("[data-packet-glow]");
  const consoleEl = {
    title: $("[data-console-title]"),
    step: $("[data-console-step]"),
    text: $("[data-console-text]"),
    trail: $("[data-console-trail]"),
    controls: $("[data-console-controls]"),
    play: $("[data-flow-play]"),
  };
  const opened = new Set(store.get("nodes", []));
  const flowsDone = new Set(store.get("flowsDone", []));
  const labState = { flow: null, step: -1, playing: false, timer: 0, anim: 0, autoplayed: false };
  $$("[data-flow]").forEach((b) => b.classList.toggle("is-done", flowsDone.has(b.dataset.flow)));

  const mapWrap = $("[data-map-wrap]");
  // En pantallas estrechas el mapa se desplaza: se centra en la pieza activa.
  function follow(id) {
    const n = nodeById[id];
    if (!mapWrap || !n || mapWrap.scrollWidth <= mapWrap.clientWidth) return;
    const x = (n.x / 1200) * mapWrap.scrollWidth - mapWrap.clientWidth / 2;
    mapWrap.scrollTo({ left: Math.max(0, x), behavior: reduceMotion ? "auto" : "smooth" });
  }

  function movePacket(x, y) {
    for (const c of [packet, packetGlow]) { c?.setAttribute("cx", x); c?.setAttribute("cy", y); }
  }

  function setActiveNode(id, inPath) {
    labNodes.forEach((n) => {
      n.classList.toggle("is-active", n.dataset.node === id);
      n.classList.toggle("is-dim", inPath ? !inPath.includes(n.dataset.node) : false);
    });
  }

  function markGroups(path) {
    const groups = new Set(path ? labNodes.filter((n) => path.includes(n.dataset.node)).map((n) => n.dataset.group) : []);
    $$(".lab-group").forEach((g) => g.classList.toggle("is-on", groups.has(g.dataset.group)));
  }

  function segment(from, to, animate, done) {
    const a = nodeById[from], b = nodeById[to];
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("class", "flow-trail");
    path.setAttribute("d", `M${a.x} ${a.y} L${b.x} ${b.y}`);
    $$(".flow-trail", layer).forEach((p) => p.classList.add("is-old"));
    layer.append(path);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!animate || reduceMotion || len === 0) {
      movePacket(b.x, b.y);
      return done?.();
    }
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
    const dur = Math.min(1300, 450 + len * 1.1);
    const t0 = performance.now();
    cancelAnimationFrame(labState.anim);
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      movePacket(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e);
      path.style.strokeDashoffset = `${len * (1 - e)}`;
      if (k < 1) labState.anim = requestAnimationFrame(tick);
      else { path.style.strokeDasharray = ""; path.style.strokeDashoffset = ""; done?.(); }
    };
    labState.anim = requestAnimationFrame(tick);
  }

  function paintTrail(flow, step) {
    consoleEl.trail.replaceChildren(...flow.path.map((id, i) => {
      const li = document.createElement("li");
      li.textContent = nodeById[id].title.split(" (")[0];
      li.className = i < step ? "is-done" : i === step ? "is-now" : "";
      return li;
    }));
  }

  function narrate(flow, step) {
    consoleEl.title.textContent = flow.title;
    consoleEl.step.textContent = `${T.lab.step} ${step + 1} ${T.lab.of} ${flow.path.length}`;
    paintTrail(flow, step);
    setActiveNode(flow.path[step], flow.path);
    follow(flow.path[step]);
    labNodes.find((n) => n.dataset.node === flow.path[step])?.classList.add("is-visited");
    typeInto(consoleEl.text, flow.steps[step], () => {
      clearTimeout(labState.timer);
      if (labState.playing) labState.timer = setTimeout(() => labStep(step + 1, true), 1500);
    });
  }

  function labStep(i, animate) {
    const flow = labState.flow;
    if (!flow) return;
    clearTimeout(labState.timer);
    if (i >= flow.path.length) return labFinish();
    if (i < 0) i = 0;
    const forward = i === labState.step + 1 && i > 0;
    if (!forward) {
      // Saltar atrás (o reiniciar): se redibuja el camino sin animación.
      layer.replaceChildren();
      labNodes.forEach((n) => n.classList.remove("is-visited"));
      for (let k = 1; k <= i; k++) segment(flow.path[k - 1], flow.path[k], false);
      for (let k = 0; k <= i; k++) labNodes.find((n) => n.dataset.node === flow.path[k])?.classList.add("is-visited");
      const n0 = nodeById[flow.path[i]];
      movePacket(n0.x, n0.y);
      labState.step = i;
      return narrate(flow, i);
    }
    labState.step = i;
    follow(flow.path[i]);
    segment(flow.path[i - 1], flow.path[i], animate, () => narrate(flow, i));
  }

  function setPlaying(on) {
    labState.playing = on;
    consoleEl.play.textContent = on ? T.lab.pause : T.lab.play;
  }

  function labStartFlow(id) {
    const flow = T.flows.find((f) => f.id === id);
    if (!flow || !layer) return;
    cancelAnimationFrame(labState.anim);
    clearTimeout(labState.timer);
    labState.flow = flow;
    labState.step = -1;
    $$("[data-flow]").forEach((b) => b.classList.toggle("is-active", b.dataset.flow === id));
    markGroups(flow.path);
    consoleEl.controls.hidden = false;
    setPlaying(true);
    layer.replaceChildren();
    labNodes.forEach((n) => n.classList.remove("is-visited"));
    labStep(0, false);
  }

  function labFinish() {
    const flow = labState.flow;
    setPlaying(false);
    consoleEl.play.textContent = T.lab.replay;
    labState.step = flow.path.length;
    paintTrail(flow, flow.path.length);
    typeInto(consoleEl.text, H.flow_done);
    flowsDone.add(flow.id);
    store.set("flowsDone", [...flowsDone]);
    $(`[data-flow="${flow.id}"]`)?.classList.add("is-done");
    $(`[data-flow="${flow.id}"]`)?.classList.remove("is-active");
    unlock("navigator");
  }

  $$("[data-flow]").forEach((b) => b.addEventListener("click", (ev) => {
    ev.preventDefault();
    labStartFlow(b.dataset.flow);
    if (hermes.tour < 0) hermesSay(fill(H.flow_start, { flow: b.textContent.trim() }));
    if (!matchMedia("(min-width: 1100px)").matches) scrollTo($("[data-console]"), "center");
  }));
  consoleEl.play?.addEventListener("click", () => {
    const flow = labState.flow;
    if (!flow) return;
    if (labState.step >= flow.path.length) return labStartFlow(flow.id);
    setPlaying(!labState.playing);
    if (labState.playing) labStep(labState.step + 1, true);
    else clearTimeout(labState.timer);
  });
  $("[data-flow-next]")?.addEventListener("click", () => { setPlaying(false); labStep(labState.step + 1, true); });
  $("[data-flow-prev]")?.addEventListener("click", () => { setPlaying(false); labStep(labState.step - 1, false); });

  // Pulsar una pieza: se para el recorrido y Hermes cuenta qué hace.
  labNodes.forEach((n) => n.addEventListener("click", (ev) => {
    ev.preventDefault();
    const node = nodeById[n.dataset.node];
    if (labState.flow) { setPlaying(false); cancelAnimationFrame(labState.anim); clearTimeout(labState.timer); }
    labState.flow = null;
    $$("[data-flow]").forEach((b) => b.classList.remove("is-active"));
    consoleEl.controls.hidden = true;
    consoleEl.trail.replaceChildren();
    layer.replaceChildren();
    markGroups([node.id]);
    setActiveNode(node.id, null);
    movePacket(node.x, node.y);
    consoleEl.title.textContent = node.title;
    consoleEl.step.textContent = "";
    typeInto(consoleEl.text, node.text);
    opened.add(node.id);
    store.set("nodes", [...opened]);
    if (opened.size >= 5) unlock("architect");
  }));

  // ------------------------------------------------------------ datos en vivo
  let live = null;
  let liveLoading = null;
  const rtf = "Intl" in window && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(T.lang, { numeric: "auto" }) : null;

  function ago(iso) {
    const s = (new Date(iso).getTime() - Date.now()) / 1000;
    if (!rtf || Number.isNaN(s)) return new Date(iso).toLocaleDateString(T.lang);
    const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
    for (const [u, secs] of units) if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), u);
    return rtf.format(Math.round(s), "second");
  }

  function loadLive() {
    if (liveLoading) return liveLoading;
    liveLoading = fetch("/api/status", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => { live = data; renderLive(data); return data; })
      .catch(() => null);
    return liveLoading;
  }

  function renderLive(data) {
    const list = $("[data-activity]");
    if (Array.isArray(data.github) && data.github.length) {
      list.replaceChildren(...data.github.map((ev) => {
        const li = document.createElement("li");
        const kind = document.createElement("span");
        kind.className = "kind";
        kind.textContent = ev.kind.replace("_", " ");
        const a = document.createElement("a");
        a.href = ev.url;
        a.textContent = ev.repo;
        a.rel = "noopener";
        const time = document.createElement("time");
        time.dateTime = ev.at;
        time.textContent = ago(ev.at);
        li.append(kind, a, time);
        if (ev.detail) {
          const d = document.createElement("span");
          d.className = "detail";
          d.textContent = ev.detail;
          li.append(d);
        }
        return li;
      }));
    } else {
      const li = document.createElement("li");
      li.className = "muted small";
      li.textContent = T.now.github_empty;
      list.replaceChildren(li);
    }
    const h = data.homelab;
    if (h) {
      $("[data-live-empty]").hidden = true;
      $("[data-homelab-stats]").hidden = false;
      $("[data-hl-services]").textContent = `${h.services_up}/${h.services_total}`;
      $("[data-hl-uptime]").textContent = `${h.uptime_30d.toFixed(2)} %`;
      const t = $("[data-hl-updated]");
      t.dateTime = h.updated_at;
      t.textContent = ago(h.updated_at);
    }
  }

  // ------------------------------------------------------------ contacto
  const form = $("[data-contact-form]");
  const formStatus = $("[data-form-status]");
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("[data-send]", form);
    const data = Object.fromEntries(new FormData(form).entries());
    $$(".field", form).forEach((f) => f.classList.remove("is-invalid"));
    formStatus.className = "form-status";
    formStatus.textContent = T.contact.sending;
    btn.disabled = true;
    try {
      const res = await fetch(`/api/contact?lang=${T.lang}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        form.reset();
        formStatus.classList.add("is-ok");
        formStatus.textContent = T.contact.ok;
        unlock("messenger");
      } else {
        formStatus.classList.add("is-error");
        if (body.error === "invalid") {
          (body.fields || []).forEach((f) => form.elements[f]?.closest(".field")?.classList.add("is-invalid"));
          formStatus.textContent = T.contact.invalid;
          form.elements[(body.fields || [])[0]]?.focus();
        } else if (body.error === "rate_limited") {
          formStatus.textContent = T.contact.rate_limited;
        } else {
          formStatus.textContent = T.contact.error;
        }
      }
    } catch {
      formStatus.className = "form-status is-error";
      formStatus.textContent = T.contact.error;
    } finally {
      btn.disabled = false;
      window.turnstile?.reset?.();
    }
  });

  // ------------------------------------------------------------ terminal
  const term = $("[data-terminal]");
  const out = $("[data-term-out]");
  const input = $("[data-term-input]");
  const history = [];
  let histPos = 0;

  function print(text, cls) {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = text;
    out.append(line);
    out.scrollTop = out.scrollHeight;
    return line;
  }
  function printLink(label, href) {
    const line = document.createElement("div");
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    line.append(a);
    out.append(line);
  }
  const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));

  function openTerminal() {
    if (!term.open) {
      term.showModal();
      if (!out.childElementCount) print(T.terminal.welcome, "t-dim");
    }
    input.focus();
  }
  function closeTerminal() { term.close(); }

  function goTo(id) {
    closeTerminal();
    $(`#${id}`)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }

  const commands = {
    help() { for (const [c, d] of T.terminal.help) print(pad(c, 18) + d); },
    whoami() { print(T.terminal.whoami, "t-ok"); },
    ls() { for (const z of T.zones) print(pad(z.id + "/", 12) + z.title + (found.has(z.id) ? "  ✓" : ""), found.has(z.id) ? "t-ok" : null); },
    cd(arg) {
      const z = T.zones.find((x) => x.id === arg || x.title.toLowerCase() === (arg || "").toLowerCase());
      if (!z) return print(`cd: ${arg || ""}: ${T.terminal.not_found}`, "t-err");
      goTo(z.id);
    },
    skills(arg) {
      const branches = arg ? T.branches.filter((b) => b.id === arg) : T.branches;
      if (!branches.length) return print(`skills: ${arg}: ${T.terminal.not_found}`, "t-err");
      for (const b of branches) {
        print(`[${b.id}] ${b.title}`, "t-cmd");
        for (const t of b.tech) print("  " + pad(t.name, 32) + "■".repeat(t.level) + "□".repeat(3 - t.level));
      }
    },
    projects() { for (const p of T.projects) print(pad(p.id, 14) + p.title); },
    cat(arg) {
      const p = T.projects.find((x) => x.id === arg);
      if (!p) return print(`cat: ${arg || ""}: ${T.terminal.not_found}`, "t-err");
      print(p.title, "t-cmd");
      print(p.tagline);
      print("★ " + p.outcome, "t-ok");
      print("stack: " + p.tech.join(", "), "t-dim");
    },
    async status() {
      const data = live || (await loadLive());
      if (!data) return print(T.now.live_unavailable, "t-err");
      if (data.homelab) {
        const h = data.homelab;
        print(`${T.now.homelab_services}: ${h.services_up}/${h.services_total}`, "t-ok");
        print(`${T.now.homelab_uptime}: ${h.uptime_30d.toFixed(2)} %`, "t-ok");
      } else {
        print(T.now.live_unavailable, "t-dim");
      }
      for (const ev of (data.github || []).slice(0, 3)) print(`${ev.kind} ${ev.repo} · ${ago(ev.at)}`, "t-dim");
    },
    cv() { unlock("recruiter"); printLink(T.ui.download_cv, T.cv); location.href = T.cv; },
    contact() { goTo("contact"); setTimeout(() => $("#cf-name")?.focus(), 500); },
    lang(arg) {
      const to = arg || T.other;
      if (to !== "es" && to !== "en") return print(`lang: ${arg}: ${T.terminal.not_found}`, "t-err");
      if (to === T.lang) return;
      store.set("pendingPolyglot", true);
      location.href = `/${to}/`;
    },
    achievements() {
      for (const a of T.achievements) print((unlocked.has(a.id) ? "★ " : "☆ ") + pad(a.title, 26) + (unlocked.has(a.id) ? a.text : "???"), unlocked.has(a.id) ? "t-ok" : "t-dim");
    },
    clear() { out.replaceChildren(); },
    exit() { closeTerminal(); },
    sudo() { print(T.terminal.sudo, "t-err"); },
    hermes() { closeTerminal(); hermesMenu(fill(H.greet_return, { zones: found.size })); },
  };
  commands.quit = commands.exit;
  commands.man = commands.help;

  async function run(line) {
    const [cmd, ...args] = line.trim().split(/\s+/);
    if (!cmd) return;
    print(`${T.terminal.prompt} ${line}`, "t-cmd");
    unlock("root");
    const fn = commands[cmd.toLowerCase()];
    if (fn) await fn(args.join(" ").toLowerCase());
    else print(`${cmd}: ${T.terminal.not_found}`, "t-err");
  }

  $$("[data-terminal-open]").forEach((b) => b.addEventListener("click", openTerminal));
  $("[data-terminal-close]")?.addEventListener("click", closeTerminal);
  $("[data-term-form]")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const line = input.value;
    input.value = "";
    if (line.trim()) { history.push(line); histPos = history.length; }
    run(line);
  });
  input?.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowUp" && histPos > 0) { input.value = history[--histPos]; ev.preventDefault(); }
    else if (ev.key === "ArrowDown") { histPos = Math.min(history.length, histPos + 1); input.value = history[histPos] || ""; ev.preventDefault(); }
    else if (ev.key === "Tab") {
      ev.preventDefault();
      const match = Object.keys(commands).filter((c) => c.startsWith(input.value));
      if (match.length === 1) input.value = match[0] + " ";
    }
  });
  term?.addEventListener("click", (ev) => { if (ev.target === term) closeTerminal(); });

  // Atajo: «`» o Ctrl+K abren la terminal (salvo escribiendo en un campo).
  document.addEventListener("keydown", (ev) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
    if (term.open || typing || doc.classList.contains("quick-mode")) return;
    if (ev.key === "`" || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k")) {
      ev.preventDefault();
      openTerminal();
    }
  });

  // ------------------------------------------------------------ apariciones y contadores
  if ("IntersectionObserver" in window && !reduceMotion) {
    const reveal = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        reveal.unobserve(e.target);
      }
    }, { threshold: 0.12 });
    const groups = [".values > li", ".branch", ".quest", ".timeline > li", ".world-tile", ".now-grid > .card", ".side > .card", ".flow-buttons > li"];
    for (const sel of groups) {
      $$(sel).forEach((el, i) => {
        el.classList.add("reveal");
        el.style.transitionDelay = `${Math.min(i, 6) * 70}ms`;
        reveal.observe(el);
      });
    }

    const counters = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        counters.unobserve(e.target);
        const m = /^(\d+)(.*)$/.exec(e.target.textContent.trim());
        if (!m) continue;
        const target = Number(m[1]), rest = m[2], t0 = performance.now();
        const tick = (now) => {
          const k = Math.min(1, (now - t0) / 1200);
          e.target.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))) + rest;
          if (k < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.6 });
    $$(".stats strong").forEach((el) => counters.observe(el));
  }

  // ------------------------------------------------------------ Hermes saluda
  setTimeout(() => {
    if (doc.classList.contains("quick-mode")) return;
    const tour = store.get("hermesTour", -1);
    if (!store.get("hermesGreeted", false)) {
      store.set("hermesGreeted", true);
      hermesMenu(H.greet);
    } else if (tour >= 0) {
      hermes.tour = tour;
      hermesSay(fill(H.greet_return, { zones: found.size }), [
        { label: H.tour_next, run: () => tourGo(tour) },
        { label: H.choice_free, run: hermesFree },
      ], !store.get("hermesMin", false));
    } else if (!store.get("hermesMin", true)) {
      hermesMenu(fill(H.greet_return, { zones: found.size }));
    }
  }, 1400);
})();
