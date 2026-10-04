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
      const P = T.personality;
      const msg = unlocked.size >= T.achievements.length - 2 ? P.tour_end_all
        : !store.get("flowsDone", []).length ? P.tour_end_lab : H.tour_end;
      hermesSay(msg, [{ label: T.ui.contact, run: () => scrollTo($("#contact")) }], true);
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
  // Se recuerda solo 30 min: volver otro día a la página y verla "rota"
  // por una vista rápida olvidada confundía (visto en Firefox el 04-10).
  function setQuick(on) {
    doc.classList.toggle("quick-mode", on);
    quickBtn?.setAttribute("aria-pressed", String(on));
    $("[data-quick-banner]").hidden = !on;
    store.set("quick", on ? Date.now() : 0);
  }
  const quickSince = store.get("quick", 0);
  setQuick(typeof quickSince === "number" && quickSince > 0 && Date.now() - quickSince < 30 * 60 * 1000);
  $$("[data-quick-exit]").forEach((b) => b.addEventListener("click", () => setQuick(false)));
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
  const mapHint = $("[data-map-hint]");
  mapWrap?.addEventListener("scroll", () => mapHint?.classList.add("is-gone"), { once: true, passive: true });
  function follow(id) {
    const n = nodeById[id];
    if (!mapWrap || !n || mapWrap.scrollWidth <= mapWrap.clientWidth) return;
    const x = (n.x / 1200) * mapWrap.scrollWidth - mapWrap.clientWidth / 2;
    mapWrap.scrollTo({ left: Math.max(0, x), behavior: reduceMotion ? "auto" : "smooth" });
  }

  const packetGnome = $("[data-packet-gnome]");
  let gnomeX = 0;
  function movePacket(x, y) {
    if (packetGnome) {
      const dir = x < gnomeX - 0.5 ? -1 : 1;
      gnomeX = x;
      packetGnome.setAttribute("transform", `translate(${x} ${y}) scale(${dir} 1)`);
    }
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

  // Dos corredores: "a" (el recorrido principal) y "b" (el de comparar).
  const packetB = $("[data-packet-b]");
  const packetGlowB = $("[data-packet-glow-b]");
  function movePacketB(x, y) {
    for (const c of [packetB, packetGlowB]) { c?.setAttribute("cx", x); c?.setAttribute("cy", y); }
  }
  const clearTrails = (which) => $$(`.trail-${which}`, layer).forEach((p) => p.remove());

  function segment(from, to, animate, done, which = "a") {
    const a = nodeById[from], b = nodeById[to];
    const move = which === "a" ? movePacket : movePacketB;
    const st = which === "a" ? labState : bState;
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("class", `flow-trail trail-${which}`);
    path.setAttribute("d", `M${a.x} ${a.y} L${b.x} ${b.y}`);
    $$(`.trail-${which}`, layer).forEach((p) => p.classList.add("is-old"));
    layer.append(path);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!animate || reduceMotion || len === 0) {
      move(b.x, b.y);
      return done?.();
    }
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
    const dur = Math.min(1300, 450 + len * 1.1);
    const t0 = performance.now();
    cancelAnimationFrame(st.anim);
    if (which === "a") packetGnome?.classList.remove("is-idle");
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      move(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e);
      path.style.strokeDashoffset = `${len * (1 - e)}`;
      if (k < 1) st.anim = requestAnimationFrame(tick);
      else {
        path.style.strokeDasharray = "";
        path.style.strokeDashoffset = "";
        if (which === "a") packetGnome?.classList.add("is-idle");
        done?.();
      }
    };
    st.anim = requestAnimationFrame(tick);
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
      clearTrails("a");
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
    clearTrails("a");
    labNodes.forEach((n) => n.classList.remove("is-visited"));
    labStep(0, false);
  }

  // ------------------------------------------------------------ comparar dos recorridos
  const bState = { flow: null, step: -1, timer: 0, anim: 0 };
  let compareOn = false;
  const consoleB = {
    box: $("[data-console-b]"),
    title: $("[data-console-b-title]"),
    step: $("[data-console-b-step]"),
    text: $("[data-console-b-text]"),
  };

  function bNarrate() {
    const f = bState.flow;
    consoleB.step.textContent = `${T.lab.step} ${bState.step + 1} ${T.lab.of} ${f.path.length}`;
    consoleB.text.textContent = f.steps[bState.step];
    labNodes.find((n) => n.dataset.node === f.path[bState.step])?.classList.add("is-visited");
    clearTimeout(bState.timer);
    bState.timer = setTimeout(bNext, 2600);
  }
  function bNext() {
    const f = bState.flow;
    if (!f) return;
    bState.step += 1;
    if (bState.step >= f.path.length) {
      consoleB.step.textContent = "";
      consoleB.text.textContent = H.flow_done;
      return;
    }
    segment(f.path[bState.step - 1], f.path[bState.step], true, bNarrate, "b");
  }
  function bStart(id) {
    const f = T.flows.find((x) => x.id === id);
    if (!f) return;
    bStop();
    bState.flow = f;
    bState.step = 0;
    $(`[data-flow="${id}"]`)?.classList.add("is-b");
    consoleB.box.hidden = false;
    consoleB.title.textContent = f.title;
    const n0 = nodeById[f.path[0]];
    movePacketB(n0.x, n0.y);
    const both = new Set([...(labState.flow?.path || []), ...f.path]);
    labNodes.forEach((n) => n.classList.toggle("is-dim", !both.has(n.dataset.node)));
    markGroups([...both]);
    bNarrate();
  }
  function bStop() {
    clearTimeout(bState.timer);
    cancelAnimationFrame(bState.anim);
    bState.flow = null;
    clearTrails("b");
    movePacketB(-50, -50);
    if (consoleB.box) consoleB.box.hidden = true;
    $$(".flow-btn.is-b").forEach((b) => b.classList.remove("is-b"));
  }
  $("[data-compare-toggle]")?.addEventListener("click", (ev) => {
    compareOn = !compareOn;
    ev.currentTarget.setAttribute("aria-pressed", String(compareOn));
    $("[data-compare-hint]").hidden = !compareOn;
    if (!compareOn) bStop();
  });

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

  // Pestañas de categorías de recorridos.
  $$("[data-flow-tab]").forEach((tab) => tab.addEventListener("click", () => {
    const cat = tab.dataset.flowTab;
    $$("[data-flow-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === tab)));
    $$("[data-flow-cat]").forEach((li) => { li.hidden = cat !== "all" && li.dataset.flowCat !== cat; });
  }));

  $$("[data-flow]").forEach((b) => b.addEventListener("click", (ev) => {
    ev.preventDefault();
    if (lab.classList.contains("is-incident")) closeIncident();
    if (compareOn && labState.flow && labState.flow.id !== b.dataset.flow) {
      bStart(b.dataset.flow);
      return;
    }
    bStop();
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
  function stopFlows() {
    if (labState.flow) { setPlaying(false); cancelAnimationFrame(labState.anim); clearTimeout(labState.timer); }
    labState.flow = null;
    bStop();
    $$("[data-flow]").forEach((b) => b.classList.remove("is-active"));
    consoleEl.controls.hidden = true;
    consoleEl.trail.replaceChildren();
    layer.replaceChildren();
  }

  labNodes.forEach((n) => n.addEventListener("click", (ev) => {
    ev.preventDefault();
    if (lab.classList.contains("is-incident")) return incidentCheck(n.dataset.node);
    const node = nodeById[n.dataset.node];
    stopFlows();
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

  // ------------------------------------------------------------ modo detective
  const IU = T.incident_ui;
  const lab = $("[data-lab]");
  const incEl = {
    box: $("[data-incident]"),
    list: $("[data-incident-list]"),
    count: $("[data-incident-count]"),
    found: $("[data-incident-found]"),
    options: $("[data-incident-options]"),
    open: $("[data-incident-open]"),
  };
  const inc = { cur: null, found: new Set(), solved: false };

  function openIncidents() {
    stopFlows();
    lab.classList.add("is-incident");
    incEl.open.setAttribute("aria-pressed", "true");
    labNodes.forEach((n) => n.classList.remove("is-clue", "is-checked", "is-dim", "is-active"));
    markGroups(null);
    movePacket(-50, -50);
    inc.cur = null;
    incEl.box.hidden = false;
    incEl.list.hidden = false;
    incEl.found.replaceChildren();
    incEl.options.replaceChildren();
    incEl.count.parentElement.hidden = true;
    consoleEl.title.textContent = IU.title;
    consoleEl.step.textContent = "";
    typeInto(consoleEl.text, IU.intro + (matchMedia("(max-width: 899px)").matches ? " " + IU.mobile : ""));
    incEl.list.replaceChildren(...T.incidents.map((c) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-sm";
      b.textContent = "🔍 " + c.title;
      b.addEventListener("click", () => pickIncident(c));
      li.append(b);
      return li;
    }));
    scrollTo($(".lab-screen"), "start");
  }

  function pickIncident(c) {
    inc.cur = c;
    inc.found = new Set();
    inc.solved = false;
    labNodes.forEach((n) => n.classList.remove("is-clue", "is-checked"));
    incEl.list.hidden = true;
    incEl.found.replaceChildren();
    incEl.options.replaceChildren();
    incEl.count.parentElement.hidden = false;
    incEl.count.textContent = "0";
    consoleEl.title.textContent = c.title;
    typeInto(consoleEl.text, c.intro);
  }

  function incidentCheck(id) {
    const c = inc.cur;
    if (!c || inc.solved) return;
    const el = labNodes.find((n) => n.dataset.node === id);
    el?.classList.add("is-checked");
    setActiveNode(id, null);
    follow(id);
    const clue = c.clues[id];
    if (!clue) return typeInto(consoleEl.text, IU.normal);
    typeInto(consoleEl.text, clue);
    if (inc.found.has(id)) return;
    inc.found.add(id);
    el?.classList.add("is-clue");
    const li = document.createElement("li");
    const strong = document.createElement("strong");
    strong.textContent = nodeById[id].title.split(" (")[0] + ": ";
    li.append(strong, clue);
    incEl.found.append(li);
    incEl.count.textContent = `${inc.found.size} / ${Object.keys(c.clues).length}`;
    if (inc.found.size >= 2 && !incEl.options.childElementCount) renderOptions(c);
  }

  function renderOptions(c) {
    const label = document.createElement("p");
    label.innerHTML = "<strong></strong>";
    label.firstChild.textContent = IU.diagnose;
    incEl.options.replaceChildren(label, ...c.options.map((text, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-sm";
      b.textContent = text;
      b.addEventListener("click", () => {
        if (inc.solved) return;
        if (i !== c.answer) {
          b.classList.add("is-wrong");
          return typeInto(consoleEl.text, `${IU.wrong} ${c.feedback[i]}`);
        }
        inc.solved = true;
        b.classList.add("is-right");
        $$("button", incEl.options).forEach((x) => { x.disabled = x !== b; });
        const res = document.createElement("div");
        res.className = "incident-result small";
        const h = document.createElement("p");
        h.innerHTML = "<strong></strong>";
        h.firstChild.textContent = IU.solved + " " + c.solution;
        const l = document.createElement("p");
        l.innerHTML = "<strong></strong> ";
        l.firstChild.textContent = IU.lesson + ": ";
        l.append(c.lesson);
        res.append(h, l);
        const again = document.createElement("button");
        again.type = "button";
        again.className = "btn btn-sm btn-primary";
        again.textContent = IU.again;
        again.addEventListener("click", openIncidents);
        incEl.options.append(res, again);
        typeInto(consoleEl.text, IU.solved);
        unlock("detective");
        hermesSay(T.personality.detective);
      });
      return b;
    }));
  }

  function closeIncident() {
    lab.classList.remove("is-incident");
    incEl.open?.setAttribute("aria-pressed", "false");
    incEl.box.hidden = true;
    inc.cur = null;
    labNodes.forEach((n) => n.classList.remove("is-clue", "is-checked", "is-active"));
    consoleEl.title.textContent = H.name;
    typeInto(consoleEl.text, T.lab.pick_node);
  }
  incEl.open?.addEventListener("click", () => (lab.classList.contains("is-incident") ? closeIncident() : openIncidents()));
  $("[data-incident-exit]")?.addEventListener("click", closeIncident);

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
        a.target = "_blank";
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
    if (h?.nodes) {
      labNodes.forEach((n) => {
        const st = h.nodes[n.dataset.node];
        n.classList.remove("st-up", "st-down", "st-off");
        if (st) n.classList.add("st-" + st);
      });
    }
    const bars = $("[data-uptime-bars]");
    if (h?.daily?.length && bars) {
      const w = 300 / h.daily.length;
      bars.replaceChildren(...h.daily.map((v, i) => {
        const r = document.createElementNS(SVGNS, "rect");
        const height = 6 + (Math.max(0, v - 80) / 20) * 30;
        r.setAttribute("x", (i * w + 1).toFixed(1));
        r.setAttribute("width", Math.max(1, w - 2).toFixed(1));
        r.setAttribute("y", (36 - height).toFixed(1));
        r.setAttribute("height", height.toFixed(1));
        r.setAttribute("rx", "1.5");
        if (v < 95) r.classList.add("is-low"); else if (v < 99) r.classList.add("is-mid");
        r.style.transitionDelay = `${i * 25}ms`;
        const t = document.createElementNS(SVGNS, "title");
        t.textContent = `${v.toFixed(2)} %`;
        r.append(t);
        return r;
      }));
      bars.setAttribute("aria-label", `${T.now.homelab_uptime}: ${h.daily.map((v) => Math.round(v)).join(", ")}`);
      requestAnimationFrame(() => requestAnimationFrame(() => bars.classList.add("is-in")));
    }
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

  // Servidor de mentira para el reto: la bandera está en un log de Hermes,
  // codificada en base64. Encontrarla en el código fuente también vale.
  const TT = T.terminal;
  const FS_DIRS = {
    "/": ["etc/", "home/", "var/"],
    "/etc": ["hostname", "motd"],
    "/home": ["tito/"],
    "/home/tito": [".bash_history"],
    "/var": ["log/"],
    "/var/log": ["hermes.log"],
  };
  const FS_FILES = {
    "/etc/hostname": ["tito-homelab"],
    "/etc/motd": TT.motd,
    "/var/log/hermes.log": TT.log,
    "/home/tito/.bash_history": ["terraform plan", "ansible-playbook playbooks/landing.yml", "git commit -m \"docs: postmortem\"", "cat /var/log/hermes.log"],
  };
  const norm = (p) => "/" + p.split("/").filter(Boolean).join("/");
  const flagOk = (f) => {
    const line = TT.log.find((l) => l.includes("->")) || "";
    try { return f.trim() === atob(line.split("->")[1].trim()); } catch { return false; }
  };

  const commands = {
    help() { for (const [c, d] of T.terminal.help) print(pad(c, 18) + d); },
    whoami() { print(T.terminal.whoami, "t-ok"); },
    ls(arg) {
      const path = (arg || "").replace(/^-a\s*/, "");
      if (path.startsWith("/")) {
        const dir = FS_DIRS[norm(path)];
        if (!dir) return print(`ls: ${path}: ${TT.no_such_file}`, "t-err");
        return print(dir.join("  "));
      }
      for (const z of T.zones) print(pad(z.id + "/", 12) + z.title + (found.has(z.id) ? "  ✓" : ""), found.has(z.id) ? "t-ok" : null);
    },
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
      if ((arg || "").startsWith("/")) {
        const file = FS_FILES[norm(arg)];
        if (!file) return print(`cat: ${arg}: ${FS_DIRS[norm(arg)] ? "Is a directory" : TT.no_such_file}`, "t-err");
        return file.forEach((l) => print(l));
      }
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
    challenge() { print(TT.challenge, "t-ok"); },
    reto() { print(TT.challenge, "t-ok"); },
    base64(arg) {
      const m = /^-d\s+(\S+)/.exec(arg || "");
      if (!m) return print("uso: base64 -d <texto>", "t-dim");
      try { print(atob(m[1])); } catch { print("base64: entrada no válida", "t-err"); }
    },
    submit(arg) {
      if (flagOk(arg || "")) {
        print(TT.submit_ok, "t-ok");
        unlock("hacker");
        closeTerminal();
        hermesSay(T.personality.hacker);
      } else {
        print(TT.submit_bad, "t-err");
      }
    },
    hermes() { closeTerminal(); hermesMenu(fill(H.greet_return, { zones: found.size })); },
    enanos(arg) { setGnomes(arg !== "off"); print(arg === "off" ? "😢" : "⛏️  ✓", "t-ok"); },
    gnomes(arg) { setGnomes(arg !== "off"); print(arg === "off" ? "😢" : "⛏️  ✓", "t-ok"); },
  };
  commands.quit = commands.exit;
  commands.man = commands.help;

  async function run(line) {
    const [cmd, ...args] = line.trim().split(/\s+/);
    if (!cmd) return;
    print(`${T.terminal.prompt} ${line}`, "t-cmd");
    unlock("root");
    const fn = commands[cmd.toLowerCase()];
    const raw = args.join(" ");
    if (fn) await fn(["base64", "submit", "cat", "ls"].includes(cmd.toLowerCase()) ? raw : raw.toLowerCase());
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

  // ------------------------------------------------------------ enanitos
  // Decoración guionizada: enanitos que llevan paquetes, cables y servidores
  // por el pie de la pantalla. Un solo bucle de animación, como mucho tres a
  // la vez, y nada si la pestaña no se ve o se pidió menos movimiento.
  const G = T.gnomes;
  const world = $("[data-gnome-world]");
  const gnomes = [];
  let gnomesOn = store.get("gnomesOn", true);
  let gnomeRaf = 0, gnomeLast = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
  const COLORS = [["#ef4444", "#2563eb"], ["#16a34a", "#7c3aed"], ["#f59e0b", "#0891b2"], ["#db2777", "#15803d"], ["#0ea5e9", "#b45309"]];
  const GNOME = `<g class="gn-legs"><rect class="gn-leg gn-leg-l" x="13" y="39" width="5" height="11" rx="2.5"/><rect class="gn-leg gn-leg-r" x="22" y="39" width="5" height="11" rx="2.5"/></g><path class="gn-body" d="M9 43 Q20 20 31 43 Z"/><circle class="gn-face" cx="20" cy="24" r="7"/><path class="gn-beard" d="M12.5 25 Q20 42 27.5 25 Q20 31 12.5 25 Z"/><path class="gn-hat" d="M11.5 23 Q19 -3 29 22.5 Q20 19 11.5 23 Z"/><circle class="gn-eye" cx="17.4" cy="23.4" r="1.1"/><circle class="gn-eye" cx="22.6" cy="23.4" r="1.1"/><circle class="gn-nose" cx="20" cy="26.2" r="1.9"/>`;
  const STARS = `<g class="gn-stars"><text x="6" y="6">✦</text><text x="26" y="2">✧</text><text x="16" y="-4">✦</text></g>`;
  const ITEMS = {
    env: `<g class="gn-item-drop"><g class="gn-env" transform="translate(23 29)"><rect width="17" height="12" rx="2"/><path d="M0 1 L8.5 7 L17 1"/></g></g>`,
    srv: `<g class="gn-item-drop"><g class="gn-srv" transform="translate(5 -13)"><rect width="30" height="12" rx="2"/><circle cx="6" cy="6" r="1.7"/><circle cx="11" cy="6" r="1.7"/></g></g>`,
    reel: `<path class="gn-cable" d="M9 36 C-8 44 -22 30 -46 48"/><g class="gn-reel" transform="translate(27 33)"><circle r="6.5"/><circle r="2.5"/></g>`,
    mug: `<g class="gn-item-drop"><g class="gn-mug" transform="translate(26 30)"><rect width="9" height="10" rx="1.5"/><path d="M9 3 q4 2 0 5"/></g></g>`,
  };

  function gnomeEl(kind, item) {
    const el = document.createElement("div");
    el.className = "gnome";
    const [hat, tunic] = pickOne(COLORS);
    el.style.setProperty("--g-hat", hat);
    el.style.setProperty("--g-tunic", tunic);
    if (kind === "pair") {
      el.classList.add("is-wide");
      el.innerHTML = `<svg viewBox="-4 -14 158 66"><g class="gn-flip"><g class="gn-inner">${GNOME}</g><path class="gn-cable" d="M30 33 Q76 62 120 33"/><g transform="translate(108 0)"><g class="gn-inner">${GNOME}</g></g></g></svg>`;
    } else {
      el.innerHTML = `<svg viewBox="-10 -14 60 66"><g class="gn-flip"><g class="gn-inner">${GNOME}${ITEMS[item] || ""}</g>${STARS}</g></svg>`;
    }
    world.append(el);
    return el;
  }

  function gnomeSay(g, text) {
    g.el.querySelector(".gnome-say")?.remove();
    const b = document.createElement("div");
    b.className = "gnome-say";
    b.textContent = text;
    g.el.append(b);
    clearTimeout(g.sayTimer);
    g.sayTimer = setTimeout(() => b.remove(), 2800);
  }

  function gnomePlace(g) {
    g.el.style.transform = `translate(${g.x.toFixed(1)}px, ${g.y}px)`;
    g.el.querySelector(".gn-flip").setAttribute("transform", g.dir < 0 ? `translate(${g.el.classList.contains("is-wide") ? 150 : 40} 0) scale(-1 1)` : "");
  }

  function gnomeSpawn(kind, opts = {}) {
    if (!gnomesOn || !world || gnomes.length >= 3 || doc.classList.contains("quick-mode") || reduceMotion) return;
    const item = opts.item || pickOne(Object.keys(ITEMS));
    const el = gnomeEl(kind, item);
    const w = kind === "pair" ? 240 : 66;
    const dir = opts.dir || (Math.random() < 0.5 ? 1 : -1);
    const g = {
      el, kind, dir, y: 0, state: "walk",
      x: opts.x ?? (dir > 0 ? -w - 10 : innerWidth + 10),
      w, speed: kind === "pair" ? rnd(32, 42) : rnd(42, 70),
      tripAt: kind === "trip" ? rnd(innerWidth * 0.25, innerWidth * 0.75) : null,
      clicks: 0, scared: false,
    };
    el.classList.add("is-walking");
    el.addEventListener("pointerdown", (ev) => { ev.preventDefault(); gnomeClick(g); });
    gnomes.push(g);
    if (kind === "fall") {
      // Cae desde la barra superior hasta el suelo, se marea y sigue andando.
      g.state = "fall";
      g.y = -(innerHeight - 120);
      el.classList.remove("is-walking");
      gnomePlace(g);
      gnomeSay(g, opts.say || pickOne(G.fall));
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.classList.add("is-falling");
        g.y = 0;
        gnomePlace(g);
      }));
      setTimeout(() => {
        el.classList.remove("is-falling");
        el.classList.add("is-dizzy");
        setTimeout(() => { el.classList.remove("is-dizzy"); el.classList.add("is-walking"); g.state = "walk"; }, 1700);
      }, 1050);
    }
    gnomePlace(g);
    gnomeRun();
    return g;
  }

  function gnomeClick(g) {
    g.el.classList.remove("is-jump");
    void g.el.offsetWidth;
    g.el.classList.add("is-jump");
    gnomeSay(g, pickOne(G.click));
    const total = store.get("gnomeClicks", 0) + 1;
    store.set("gnomeClicks", total);
    if (total === 1) setTimeout(() => hermesSay(G.hermes_reveal), 1200);
    if (total >= 5) unlock("gnome_friend");
  }

  function gnomeTrip(g) {
    g.state = "trip";
    g.tripAt = null;
    g.el.classList.remove("is-walking");
    g.el.classList.add("is-tripped");
    gnomeSay(g, pickOne(G.trip));
    setTimeout(() => {
      g.el.classList.remove("is-tripped");
      g.el.classList.add("is-walking");
      g.state = "walk";
    }, 1500);
  }

  function gnomeRemove(g) {
    g.el.remove();
    gnomes.splice(gnomes.indexOf(g), 1);
  }

  function gnomeTick(t) {
    const dt = Math.min(0.05, (t - (gnomeLast || t)) / 1000);
    gnomeLast = t;
    for (const g of [...gnomes]) {
      if (g.state !== "walk") continue;
      const before = g.x;
      g.x += g.dir * g.speed * (g.scared ? 2.4 : 1) * dt;
      if (g.tripAt !== null && (before - g.tripAt) * (g.x - g.tripAt) <= 0) gnomeTrip(g);
      gnomePlace(g);
      if (g.x < -g.w - 60 || g.x > innerWidth + 60) gnomeRemove(g);
    }
    gnomeRaf = gnomes.length ? requestAnimationFrame(gnomeTick) : 0;
    if (!gnomeRaf) gnomeLast = 0;
  }
  function gnomeRun() { if (!gnomeRaf && !document.hidden) gnomeRaf = requestAnimationFrame(gnomeTick); }

  function gnomeClear() { [...gnomes].forEach(gnomeRemove); }

  // Se apartan si el ratón se acerca.
  let nearT = 0;
  addEventListener("pointermove", (ev) => {
    if (!gnomes.length || ev.timeStamp - nearT < 120) return;
    nearT = ev.timeStamp;
    for (const g of gnomes) {
      if (g.state !== "walk" || g.scared) continue;
      const r = g.el.getBoundingClientRect();
      if (Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2)) < 75) {
        g.scared = true;
        g.el.classList.add("is-running");
        gnomeSay(g, pickOne(G.near));
        setTimeout(() => { g.scared = false; g.el.classList.remove("is-running"); }, 1600);
      }
    }
  }, { passive: true });

  // Un scroll muy rápido tira a alguno desde arriba.
  let lastY = scrollY, lastScrollT = performance.now(), lastFall = 0;
  addEventListener("scroll", () => {
    const now = performance.now();
    const v = Math.abs(scrollY - lastY) / Math.max(1, now - lastScrollT) * 1000;
    lastY = scrollY;
    lastScrollT = now;
    if (v > 4000 && now - lastFall > 6000) {
      lastFall = now;
      gnomeSpawn("fall", { x: rnd(60, innerWidth - 100) });
    }
  }, { passive: true });

  function gnomeSchedule() {
    setTimeout(() => {
      if (!document.hidden) {
        const r = Math.random();
        gnomeSpawn(r < 0.2 ? "pair" : r < 0.5 ? "trip" : "walk");
      }
      gnomeSchedule();
    }, rnd(7000, 13000));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(gnomeRaf); gnomeRaf = 0; gnomeLast = 0; } else gnomeRun();
  });

  const gnomeBtn = $("[data-gnome-toggle]");
  function setGnomes(on) {
    gnomesOn = on;
    store.set("gnomesOn", on);
    doc.classList.toggle("gnomes-off", !on);
    gnomeBtn?.setAttribute("aria-pressed", String(on));
    if (!on) gnomeClear();
    $$(".rail-climber").forEach((c) => { c.hidden = !on; });
  }
  setGnomes(gnomesOn);
  gnomeBtn?.addEventListener("click", () => {
    setGnomes(!gnomesOn);
    if (gnomesOn) gnomeSpawn("fall", { x: rnd(80, innerWidth - 120) });
  });
  if (!reduceMotion) {
    setTimeout(() => gnomeSpawn("walk", { item: "env", dir: 1 }), 2500);
    gnomeSchedule();
  }

  // ------------------------------------------------------------ enanitos trabajando
  // La "fábrica": enanitos con su tarea fija en cada servidor del rack, en
  // las piezas del laboratorio y patrullando entre nodos. Brazos y piernas
  // con animateTransform (SVG nativo: el giro lleva su propio centro).
  const rot = (vals, dur, begin = "0s") =>
    `<animateTransform attributeName="transform" type="rotate" values="${vals}" dur="${dur}" begin="${begin}" repeatCount="indefinite"/>`;
  const limb = (x, y, inner, anim) => `<g transform="translate(${x} ${y})"><g>${anim}${inner}</g></g>`;
  const ARM = `<rect class="w-arm" x="-2.2" y="0" width="4.4" height="11" rx="2.2"/><circle class="gn-face" cx="0" cy="11" r="2.4"/>`;
  const LEG = `<rect class="gn-leg" x="-2.5" y="0" width="5" height="11" rx="2.5"/>`;
  const HEAD = `<path class="gn-body" d="M9 43 Q20 20 31 43 Z"/><circle class="gn-face" cx="20" cy="24" r="7"/><path class="gn-beard" d="M12.5 25 Q20 42 27.5 25 Q20 31 12.5 25 Z"/><path class="gn-hat" d="M11.5 23 Q19 -3 29 22.5 Q20 19 11.5 23 Z"/><circle class="gn-eye" cx="17.4" cy="23.4" r="1.1"/><circle class="gn-eye" cx="22.6" cy="23.4" r="1.1"/><circle class="gn-nose" cx="20" cy="26.2" r="1.9"/>`;
  const TOOLS = {
    hammer: `<rect class="w-tool-wood" x="-1" y="8" width="2" height="13"/><rect class="w-tool-metal" x="-5.5" y="19" width="11" height="5" rx="1"/>`,
    wrench: `<rect class="w-tool-metal" x="-1.6" y="8" width="3.2" height="11"/><circle cx="0" cy="21" r="3.4" fill="none" stroke="#9ca3af" stroke-width="2.4"/>`,
    broom: `<rect class="w-tool-wood" x="-1" y="4" width="2" height="26"/><path class="w-tool-wood" d="M-6 30 h12 l3 7 h-18 Z"/>`,
    mug: `<g transform="translate(-4 9)"><rect width="8" height="9" rx="1.5" fill="#e2e8f0"/><path d="M8 2 q4 2 0 5" fill="none" stroke="#94a3b8" stroke-width="1.5"/></g>`,
  };
  function worker(pose) {
    const still = (deg) => `<animateTransform attributeName="transform" type="rotate" values="${deg}" dur="1s" repeatCount="indefinite"/>`;
    let legs = limb(15.5, 39, LEG, still("0")) + limb(24.5, 39, LEG, still("0"));
    let armL = limb(12.5, 31, ARM, still("25"));
    let armR = limb(27.5, 31, ARM, still("-25"));
    let extra = "";
    if (pose === "hammer") {
      armR = limb(27.5, 31, ARM + TOOLS.hammer, rot("-150;-20;-150", ".7s"));
      extra = `<g class="w-spark"><circle cx="36" cy="54" r="2.5"><animate attributeName="opacity" values="0;0;1;0" dur=".7s" repeatCount="indefinite"/></circle></g>`;
    } else if (pose === "wrench") {
      armR = limb(27.5, 31, ARM + TOOLS.wrench, rot("-80;-20;-80", "1.1s"));
    } else if (pose === "type") {
      legs = limb(15.5, 39, LEG, still("-80")) + limb(24.5, 39, LEG, still("-80"));
      armL = limb(12.5, 31, ARM, rot("-50;-62;-50", ".22s"));
      armR = limb(27.5, 31, ARM, rot("-62;-50;-62", ".22s"));
      extra = `<g class="w-laptop"><rect x="18" y="34" width="22" height="3" rx="1"/><rect x="30" y="20" width="3" height="15" rx="1"/><rect class="w-screen" x="31" y="21" width="1.2" height="12"><animate attributeName="opacity" values="1;.4;1" dur="1.3s" repeatCount="indefinite"/></rect></g>`;
    } else if (pose === "sweep") {
      armL = limb(12.5, 31, ARM, still("-20"));
      armR = limb(27.5, 31, ARM + TOOLS.broom, rot("-35;5;-35", "1.2s"));
      legs = limb(15.5, 39, LEG, rot("-15;15;-15", "1.2s")) + limb(24.5, 39, LEG, rot("15;-15;15", "1.2s"));
    } else if (pose === "lift") {
      armL = limb(12.5, 31, ARM, still("165"));
      armR = limb(27.5, 31, ARM, still("-165"));
    } else if (pose === "sit") {
      legs = limb(15.5, 39, LEG, rot("-70;-95;-70", "1.6s")) + limb(24.5, 39, LEG, rot("-95;-70;-95", "1.6s"));
      armR = limb(27.5, 31, ARM + TOOLS.mug, rot("-30;-30;-150;-150;-30", "5s"));
    } else if (pose === "carry") {
      armL = limb(12.5, 31, ARM, still("160"));
      armR = limb(27.5, 31, ARM, still("-160"));
      legs = limb(15.5, 39, LEG, rot("-25;25;-25", ".45s")) + limb(24.5, 39, LEG, rot("25;-25;25", ".45s"));
      extra = `<g class="w-box"><rect x="8" y="-6" width="24" height="14" rx="1.5"/><path d="M8 1 h24 M20 -6 v14" stroke-width="1"/></g>`;
    } else if (pose === "climb") {
      armL = limb(12.5, 31, ARM, rot("170;130;170", "1s"));
      armR = limb(27.5, 31, ARM, rot("-130;-170;-130", "1s"));
      legs = limb(15.5, 39, LEG, rot("-30;10;-30", "1s")) + limb(24.5, 39, LEG, rot("10;-30;10", "1s"));
    }
    return `<g class="worker pose-${pose}">${legs}${armL}${HEAD}${armR}${extra}</g>`;
  }
  const workerSvg = (pose) => `<svg viewBox="-12 -16 64 76" aria-hidden="true">${worker(pose)}</svg>`;

  function station(target, pose, place) {
    if (!target) return;
    if (getComputedStyle(target).position === "static") target.style.position = "relative";
    const el = document.createElement("div");
    el.className = "station";
    const [hat, tunic] = pickOne(COLORS);
    el.style.setProperty("--g-hat", hat);
    el.style.setProperty("--g-tunic", tunic);
    for (const [k, v] of Object.entries(place)) el.style[k] = v;
    el.innerHTML = workerSvg(pose);
    const g = { el };
    el.addEventListener("pointerdown", (ev) => { ev.preventDefault(); gnomeClick(g); });
    target.append(el);
  }

  if (!reduceMotion && world) {
    // Un enanito con su tarea encima de cada servidor del rack.
    const ZONE_POSES = { about: "sweep", skills: "carry", quests: "hammer", journey: "sit", lab: "wrench", now: "type", contact: "lift" };
    for (const [id, pose] of Object.entries(ZONE_POSES)) {
      station($("#" + id), pose, { top: "-76px", left: pose === "lift" ? "auto" : `${18 + Math.random() * 30}%`, right: pose === "lift" ? "60px" : "auto" });
    }
    // En el héroe: uno martillea el nombre y dos sostienen la tarjeta.
    station($(".hero-text"), "hammer", { top: "70px", right: "-10px" });
    station($(".player-card"), "sit", { top: "-80px", right: "24px" });
    station($(".player-card"), "wrench", { top: "-80px", left: "18px" });
    // Uno sube y baja por el raíl izquierdo.
    const climber = document.createElement("div");
    climber.className = "rail-climber gnome-world-item";
    climber.innerHTML = workerSvg("climb");
    climber.addEventListener("pointerdown", (ev) => { ev.preventDefault(); gnomeClick({ el: climber }); });
    document.body.append(climber);

    // En el laboratorio: trabajadores fijos sobre algunas piezas…
    const LAB_POSES = { hermes: "type", zfs: "sweep", gpu: "hammer", proxmox: "wrench", backup: "sit", iac: "type", traefik: "lift", zabbix: "sit", router: "wrench" };
    const labSvg = $(".lab-map");
    const workersLayer = document.createElementNS(SVGNS, "g");
    workersLayer.setAttribute("class", "lab-workers");
    for (const [id, pose] of Object.entries(LAB_POSES)) {
      const n = nodeById[id];
      if (!n) continue;
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("class", "lab-worker");
      const [hat, tunic] = pickOne(COLORS);
      g.style.setProperty("--g-hat", hat);
      g.style.setProperty("--g-tunic", tunic);
      g.setAttribute("transform", `translate(${n.x + 34} ${n.y - 76}) scale(1.05)`);
      g.innerHTML = worker(pose);
      g.addEventListener("click", (ev) => { ev.stopPropagation(); typeInto(consoleEl.text, pickOne(G.click)); });
      workersLayer.append(g);
    }
    // …y patrullas que van de pieza en pieza cargando cajas.
    const ROUTES = [
      ["traefik", "landing", "postgres", "matrix", "landing"],
      ["zabbix", "wazuh", "iac", "zfs", "proxmox"],
      ["plex", "arr", "gpu", "tv", "plex"],
      ["internet", "cloudflare", "router", "casa", "router"],
    ];
    const patrols = ROUTES.map((route) => {
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("class", "lab-worker");
      const [hat, tunic] = pickOne(COLORS);
      g.style.setProperty("--g-hat", hat);
      g.style.setProperty("--g-tunic", tunic);
      g.innerHTML = `<g transform="translate(-20 -66) scale(0.95)">${worker("carry")}</g>`;
      g.addEventListener("click", () => typeInto(consoleEl.text, pickOne(G.click)));
      workersLayer.append(g);
      return { g, route, i: 0, t: Math.random() };
    });
    labSvg?.insertBefore(workersLayer, $("[data-packet-gnome]"));

    let patrolRaf = 0, patrolLast = 0, labVisible = false;
    const patrolTick = (t) => {
      const dt = Math.min(0.05, (t - (patrolLast || t)) / 1000);
      patrolLast = t;
      for (const p of patrols) {
        const a = nodeById[p.route[p.i]], b = nodeById[p.route[(p.i + 1) % p.route.length]];
        const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
        p.t += (55 * dt) / len;
        if (p.t >= 1) { p.t = 0; p.i = (p.i + 1) % p.route.length; continue; }
        const x = a.x + (b.x - a.x) * p.t, y = a.y + (b.y - a.y) * p.t - 18;
        p.g.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${b.x < a.x ? -1 : 1} 1)`);
      }
      patrolRaf = labVisible && !document.hidden ? requestAnimationFrame(patrolTick) : 0;
      if (!patrolRaf) patrolLast = 0;
    };
    if ("IntersectionObserver" in window && labSvg) {
      new IntersectionObserver((es) => {
        labVisible = es[0].isIntersecting;
        if (labVisible && !patrolRaf) patrolRaf = requestAnimationFrame(patrolTick);
      }).observe(labSvg);
    }
    document.addEventListener("visibilitychange", () => { if (!document.hidden && labVisible && !patrolRaf) patrolRaf = requestAnimationFrame(patrolTick); });
  }

  // Los servidores entran en el rack al aparecer.
  if ("IntersectionObserver" in window && !reduceMotion) {
    const racked = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-racked");
        racked.unobserve(e.target);
      }
    }, { threshold: 0.08 });
    $$(".zone").forEach((z) => {
      const r = z.getBoundingClientRect();
      if (r.top > innerHeight) { z.classList.add("rack-in"); racked.observe(z); }
    });
  }

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
  // Una "visita" nueva si han pasado más de 30 min desde la anterior.
  const now = Date.now();
  let visits = store.get("visits", 0);
  if (now - store.get("lastSeen", 0) > 30 * 60 * 1000) visits += 1;
  store.set("visits", visits);
  store.set("lastSeen", now);

  function personalGreeting() {
    const P = T.personality;
    const d = new Date(), h = d.getHours();
    const time = h < 6 ? P.night : h < 13 ? P.morning : h < 21 ? P.afternoon : P.evening;
    const zones = found.size;
    let body = visits <= 1 ? H.greet : visits === 2 ? fill(P.visit_2, { zones }) : fill(P.visit_many, { n: visits, zones });
    let extra = "";
    if (d.getDay() === 0 || d.getDay() === 6) extra += " " + P.weekend;
    const pref = (navigator.language || "").slice(0, 2).toLowerCase();
    if ((pref === "es" || pref === "en") && pref !== T.lang) extra += " " + P.lang_hint;
    // Si ya saludamos por la hora, sobra el "¡Hola!" del principio.
    body = body.replace(/^(¡Hola!|Hi!)\s*/, "");
    return `${time} ${body}${extra}`;
  }

  setTimeout(() => {
    if (doc.classList.contains("quick-mode")) return;
    const tour = store.get("hermesTour", -1);
    if (!store.get("hermesGreeted", false)) {
      store.set("hermesGreeted", true);
      hermesMenu(personalGreeting());
    } else if (tour >= 0) {
      hermes.tour = tour;
      hermesSay(personalGreeting(), [
        { label: H.tour_next, run: () => tourGo(tour) },
        { label: H.choice_free, run: hermesFree },
      ], !store.get("hermesMin", false));
    } else if (!store.get("hermesMin", true)) {
      hermesMenu(personalGreeting());
    }
  }, 1400);

  // ------------------------------------------------------------ árbol que crece y antes/después
  if ("IntersectionObserver" in window && !reduceMotion) {
    const grow = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-grown");
        grow.unobserve(e.target);
      }
    }, { threshold: 0.2 });
    $$("[data-tree-svg], .tree").forEach((el) => grow.observe(el));
  } else {
    $$("[data-tree-svg], .tree").forEach((el) => el.classList.add("is-grown"));
  }
  const ba = $("[data-ba] .ba-frame");
  $("[data-ba-range]")?.addEventListener("input", (ev) => ba.style.setProperty("--ba", `${ev.target.value}%`));

})();
