// Unidad del rack — mejora progresiva: la página se lee entera sin esto.
(() => {
  "use strict";
  const doc = document.documentElement;
  doc.classList.add("js");

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const D = JSON.parse($("#unit-data").textContent);
  const U = D.ui;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SVGNS = "http://www.w3.org/2000/svg";
  const snd = (name) => window.tpSound?.play(name);

  // Mismo almacén que la página principal (logros compartidos).
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
      if (i % 6 === 0) snd("tick");
      if (i >= text.length) {
        clearInterval(el._typing);
        el.classList.remove("is-typing");
        done?.();
      }
    }, 16);
  }

  // La unidad sale del rack: roce de raíles y arranque de ventiladores.
  snd2("slide");
  setTimeout(() => snd2("boot"), 900);
  function snd2(name) { window.tpSound?.play(name, { intro: true }); }

  // LED de actividad del frontal: parpadea cuando se mueve algo dentro.
  const actLed = $(".uf-leds .led-act");
  function blinkFace() {
    if (!actLed) return;
    actLed.classList.remove("is-blink");
    void actLed.offsetWidth;
    actLed.classList.add("is-blink");
  }

  // El frontal enseña el estado real de la máquina (el mismo dato que los
  // LEDs del laboratorio). Si no hay datos, se queda el estado fijo.
  if (D.live_nodes?.length) {
    fetch("/api/status", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const nodes = data?.homelab?.nodes;
        if (!nodes) return;
        const st = D.live_nodes.map((id) => nodes[id]).filter(Boolean);
        if (!st.length) return;
        const live = st.includes("down") ? "down" : st.every((x) => x === "off") ? "off" : "up";
        doc.querySelector("[data-unit]")?.classList.add("live-" + live);
        const el = $("[data-uf-state]");
        if (el) el.textContent = U["live_" + live];
      })
      .catch(() => {});
  }

  // El enanito que tira de la unidad también responde si lo pulsas.
  const faceGnome = $(".uf-gnome");
  faceGnome?.addEventListener("pointerdown", () => {
    window.tpSound?.gnome();
    faceGnome.classList.remove("is-poked");
    void faceGnome.offsetWidth;
    faceGnome.classList.add("is-poked");
  });

  // Las bahías se encienden al llegar a ellas.
  if (!reduceMotion && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) {
        e.target.classList.add("is-on");
        io.unobserve(e.target);
      }
    }, { rootMargin: "0px 0px -10% 0px" });
    $$(".bay").forEach((b) => { b.classList.add("will-power"); io.observe(b); });
  }

  // Logro: entrar en una unidad. Se guarda con los de la página principal.
  const unlocked = new Set(store.get("achievements", []));
  if (!unlocked.has("insider")) {
    unlocked.add("insider");
    store.set("achievements", [...unlocked]);
    setTimeout(() => {
      const el = document.createElement("div");
      el.className = "toast";
      el.setAttribute("role", "status");
      el.innerHTML = '<span class="toast-icon" aria-hidden="true">★</span><div><small></small><strong></strong><span class="toast-text"></span></div>';
      snd("achievement");
      el.querySelector("small").textContent = D.achievement.label;
      el.querySelector("strong").textContent = D.achievement.title;
      el.querySelector(".toast-text").textContent = D.achievement.text;
      $("[data-toasts]").append(el);
      setTimeout(() => {
        el.classList.add("is-leaving");
        setTimeout(() => el.remove(), 320);
      }, 4200);
    }, reduceMotion ? 300 : 1500);
  }

  // ------------------------------------------------------------ mapa y recorridos
  const podById = Object.fromEntries(D.pods.map((p) => [p.id, p]));
  const podEls = $$("[data-pod]");
  const podEl = (id) => podEls.find((n) => n.dataset.pod === id);
  const layer = $("[data-uflow-layer]");
  const packet = $("[data-upacket]");
  const glow = $("[data-upacket-glow]");
  const mapWrap = $("[data-umap-wrap]");
  const con = {
    title: $("[data-uconsole-title]"),
    step: $("[data-uconsole-step]"),
    text: $("[data-uconsole-text]"),
    trail: $("[data-uconsole-trail]"),
    chips: $("[data-uconsole-chips]"),
    controls: $("[data-uconsole-controls]"),
    play: $("[data-uflow-play]"),
  };
  const techName = Object.fromEntries($$("[data-skill]").map((b) => [b.dataset.skill, b.textContent]));
  const st = { flow: null, step: -1, playing: false, timer: 0, anim: 0 };

  function follow(id) {
    const p = podById[id];
    if (!mapWrap || !p || mapWrap.scrollWidth <= mapWrap.clientWidth) return;
    const x = (p.x / D.map_w) * mapWrap.scrollWidth - mapWrap.clientWidth / 2;
    mapWrap.scrollTo({ left: Math.max(0, x), behavior: reduceMotion ? "auto" : "smooth" });
  }

  function movePacket(x, y) {
    for (const c of [packet, glow]) { c.setAttribute("cx", x); c.setAttribute("cy", y); }
  }

  function setActive(id, path) {
    podEls.forEach((n) => {
      n.classList.toggle("is-active", n.dataset.pod === id);
      n.classList.toggle("is-dim", path ? !path.includes(n.dataset.pod) : false);
    });
  }

  function markGroups(ids) {
    const groups = new Set(ids.map((id) => podEl(id)?.dataset.group).filter(Boolean));
    $$(".lab-group").forEach((g) => g.classList.toggle("is-on", groups.has(g.dataset.group)));
  }

  function segment(from, to, animate, done) {
    const a = podById[from], b = podById[to];
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
    cancelAnimationFrame(st.anim);
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      movePacket(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e);
      path.style.strokeDashoffset = `${len * (1 - e)}`;
      if (k < 1) st.anim = requestAnimationFrame(tick);
      else {
        path.style.strokeDasharray = "";
        path.style.strokeDashoffset = "";
        snd("hop");
        blinkFace();
        done?.();
      }
    };
    st.anim = requestAnimationFrame(tick);
  }

  function chips(ids) {
    con.chips.replaceChildren(...ids.filter((t) => techName[t]).map((t) => {
      const li = document.createElement("li");
      li.textContent = techName[t];
      return li;
    }));
  }

  function narrate(flow, i) {
    con.title.textContent = flow.title;
    con.step.textContent = `${U.step} ${i + 1} ${U.of} ${flow.path.length}`;
    con.trail.replaceChildren(...flow.path.map((id, k) => {
      const li = document.createElement("li");
      li.textContent = podById[id].short;
      li.className = k < i ? "is-done" : k === i ? "is-now" : "";
      return li;
    }));
    chips([]);
    setActive(flow.path[i], flow.path);
    follow(flow.path[i]);
    podEl(flow.path[i])?.classList.add("is-visited");
    typeInto(con.text, flow.steps[i], () => {
      clearTimeout(st.timer);
      if (st.playing) st.timer = setTimeout(() => step(i + 1, true), 1500);
    });
  }

  function step(i, animate) {
    const flow = st.flow;
    if (!flow) return;
    clearTimeout(st.timer);
    if (i >= flow.path.length) return finish();
    if (i < 0) i = 0;
    if (!(i === st.step + 1 && i > 0)) {
      // Saltar atrás o empezar: se redibuja el camino sin animación.
      layer.replaceChildren();
      podEls.forEach((n) => n.classList.remove("is-visited"));
      for (let k = 1; k <= i; k++) segment(flow.path[k - 1], flow.path[k], false);
      for (let k = 0; k <= i; k++) podEl(flow.path[k])?.classList.add("is-visited");
      const p0 = podById[flow.path[i]];
      movePacket(p0.x, p0.y);
      st.step = i;
      return narrate(flow, i);
    }
    st.step = i;
    follow(flow.path[i]);
    segment(flow.path[i - 1], flow.path[i], animate, () => narrate(flow, i));
  }

  function setPlaying(on) {
    st.playing = on;
    con.play.textContent = on ? U.pause : U.play;
  }

  function finish() {
    setPlaying(false);
    $$("[data-uflow]").forEach((b) => { if (b.dataset.uflow === st.flow.id) b.classList.add("is-done"); });
    con.play.textContent = U.play;
  }

  function startFlow(id) {
    const flow = D.flows.find((f) => f.id === id);
    if (!flow) return;
    clearSkill();
    cancelAnimationFrame(st.anim);
    st.flow = flow;
    st.step = -1;
    $$("[data-uflow]").forEach((b) => b.classList.toggle("is-active", b.dataset.uflow === id));
    markGroups(flow.path);
    con.controls.hidden = false;
    setPlaying(true);
    step(0, false);
  }

  function stopFlow() {
    cancelAnimationFrame(st.anim);
    clearTimeout(st.timer);
    setPlaying(false);
    st.flow = null;
    $$("[data-uflow]").forEach((b) => b.classList.remove("is-active"));
    con.controls.hidden = true;
    con.trail.replaceChildren();
    layer.replaceChildren();
    podEls.forEach((n) => n.classList.remove("is-visited"));
  }

  $$("[data-uflow]").forEach((b) => b.addEventListener("click", (ev) => {
    ev.preventDefault();
    startFlow(b.dataset.uflow);
  }));
  con.play.addEventListener("click", () => {
    if (!st.flow) return;
    if (st.step >= st.flow.path.length - 1 && !st.playing) return startFlow(st.flow.id);
    setPlaying(!st.playing);
    if (st.playing) step(st.step + 1, true);
    else clearTimeout(st.timer);
  });
  $("[data-uflow-next]").addEventListener("click", () => { setPlaying(false); step(st.step + 1, true); });
  $("[data-uflow-prev]").addEventListener("click", () => { setPlaying(false); step(st.step - 1, false); });

  podEls.forEach((n) => n.addEventListener("click", (ev) => {
    ev.preventDefault();
    const p = podById[n.dataset.pod];
    stopFlow();
    clearSkill();
    markGroups([p.id]);
    setActive(p.id, null);
    movePacket(p.x, p.y);
    con.title.textContent = p.title;
    con.step.textContent = "";
    chips(p.tech);
    typeInto(con.text, p.text);
  }));

  // ------------------------------------------------------------ habilidades
  // Una habilidad enciende las piezas donde la usé. Se puede llegar con
  // #t=<id> desde la misión de la página principal.
  const panel = $("[data-skill-panel]");
  const vm = $(".unit-vm");
  let activeSkill = null;

  function clearSkill() {
    if (activeSkill === null) return;
    activeSkill = null;
    $$("[data-skill]").forEach((b) => b.setAttribute("aria-pressed", "false"));
    panel.hidden = true;
    podEls.forEach((n) => n.classList.remove("is-lit", "is-dim"));
    vm.classList.remove("is-lit");
    markGroups([]);
  }

  function showSkill(id, scroll) {
    const btn = $(`[data-skill="${CSS.escape(id)}"]`);
    if (!btn) return;
    stopFlow();
    activeSkill = id;
    $$("[data-skill]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    const lit = D.pods.filter((p) => p.tech.includes(id)).map((p) => p.id);
    podEls.forEach((n) => {
      n.classList.remove("is-active");
      n.classList.toggle("is-lit", lit.includes(n.dataset.pod));
      n.classList.toggle("is-dim", !lit.includes(n.dataset.pod));
    });
    vm.classList.toggle("is-lit", D.host_tech.includes(id));
    markGroups(lit);
    panel.hidden = false;
    $("[data-skill-name]").textContent = btn.textContent;
    const note = $(`[data-skill-note-for="${CSS.escape(id)}"] dd`)?.textContent || "";
    $("[data-skill-note]").textContent = note;
    $("[data-skill-all]").href = `${D.home}#skill=${encodeURIComponent(id)}`;
    con.title.textContent = btn.textContent;
    con.step.textContent = U.tech_title;
    con.trail.replaceChildren();
    chips([]);
    typeInto(con.text, note);
    if (scroll) $("#map").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }

  $$("[data-skill]").forEach((b) => b.addEventListener("click", () => {
    if (activeSkill === b.dataset.skill) return clearSkill();
    showSkill(b.dataset.skill, true);
  }));
  $("[data-skill-clear]").addEventListener("click", clearSkill);

  const fromHash = () => {
    const m = /^#t=([\w-]+)$/.exec(location.hash);
    if (m) showSkill(m[1], true);
  };
  addEventListener("hashchange", fromHash);
  // Tras abrirse la unidad, para que el desplazamiento caiga en su sitio.
  setTimeout(fromHash, reduceMotion ? 0 : 1300);

  // ------------------------------------------------------------ cálculo de XP
  const X = D.xp;
  const xp = X && $("[data-xp]");
  if (xp) {
  const xin = (k) => $(`[data-xp-in="${k}"]`, xp);
  const xout = (k) => $(`[data-xp-out="${k}"]`, xp);
  const base = xin("base");
  base.min = X.base_min;
  base.max = X.base_max;
  base.step = 10;
  base.value = X.base_default;
  const diffs = $("[data-xp-diffs]", xp);
  D.difficulties.forEach((name, i) => {
    const label = document.createElement("label");
    label.className = "xp-diff-opt";
    label.innerHTML = '<input type="radio" name="diff"><span></span>';
    const input = label.querySelector("input");
    input.value = String(i);
    input.checked = i === 1;
    label.querySelector("span").textContent = `${name} ×${X.difficulty[i]}`;
    diffs.append(label);
  });
  const fmt = new Intl.NumberFormat(D.lang, { maximumFractionDigits: 2 });

  function timeFactor(secs) {
    const i = X.time_limits.findIndex((lim) => secs < lim);
    return i === -1 ? X.time_slow : X.time_factors[i];
  }

  function levelFor(total) {
    return Math.floor(X.level_constant * Math.sqrt(total)) + 1;
  }

  function recalc() {
    const b = Number(base.value);
    const d = X.difficulty[Number($("input[name=diff]:checked", xp).value)];
    const acc = Number(xin("acc").value);
    const secs = Number(xin("time").value);
    const pf = X.accuracy_base + (acc / 100) * X.accuracy_weight;
    const tf = timeFactor(secs);
    const total = Math.round(b * d * pf * tf);
    xout("base").textContent = b;
    xout("acc").textContent = `${acc} %`;
    const m = Math.floor(secs / 60), s = secs % 60;
    xout("time").textContent = `${m}:${String(s).padStart(2, "0")} ${U.xp_minutes}`;
    $("[data-xp-total]", xp).textContent = total;
    $("[data-xp-math]", xp).textContent = `${b} × ${fmt.format(d)} × ${fmt.format(pf)} × ${fmt.format(tf)} = ${total}`;
    // Nivel tras diez misiones como esta y avance hacia el siguiente.
    const sum = total * 10;
    const lvl = levelFor(sum);
    const from = Math.pow((lvl - 1) / X.level_constant, 2);
    const to = Math.pow(lvl / X.level_constant, 2);
    $("[data-xp-level]", xp).textContent = lvl;
    $("[data-xp-bar]", xp).setAttribute("width", Math.max(2, Math.min(100, ((sum - from) / (to - from)) * 100)).toFixed(1));
    const big = $(".xp-big", xp);
    big.classList.remove("is-bump");
    void big.offsetWidth;
    big.classList.add("is-bump");
  }
  xp.addEventListener("input", recalc);
  xp.addEventListener("submit", (ev) => ev.preventDefault());
  recalc();
  }

  // ------------------------------------------------------------ VRAM
  // Cuánto del modelo cabe en la GPU con lo que hay abierto en el PC. Lo que
  // no cabe corre en la CPU y la velocidad cae: se interpola entre las
  // medidas reales.
  const V = D.vram, VT = D.vram_text;
  const vf = V && $("[data-vram]");
  if (vf) {
    const gib = (mib) => `${fmtV.format(mib / 1024)} GiB`;
    const fmtV = new Intl.NumberFormat(D.lang, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    const fmt1 = new Intl.NumberFormat(D.lang, { maximumFractionDigits: 1 });
    const kvBox = $("[data-vram-kv]", vf);
    V.kv.forEach(([id, mib], i) => {
      const l = document.createElement("label");
      l.className = "xp-diff-opt";
      l.innerHTML = '<input type="radio" name="kv"><span></span>';
      const inp = l.querySelector("input");
      inp.value = id;
      inp.checked = i === 0;
      l.querySelector("span").textContent = `${VT.kv_names[id]} · ${gib(mib)}`;
      kvBox.append(l);
    });
    const appBox = $("[data-vram-apps]", vf);
    V.apps.forEach((a) => {
      const l = document.createElement("label");
      l.className = "vram-app";
      l.innerHTML = '<input type="checkbox"><span></span>';
      const inp = l.querySelector("input");
      inp.name = a.id;
      inp.checked = a.on;
      l.querySelector("span").textContent = a.mib ? `${VT.app_names[a.id]} · ${a.mib} MiB` : VT.app_names[a.id];
      appBox.append(l);
    });
    const speedAt = (pct) => {
      const pts = V.speed;
      if (pct <= pts[0][0]) return pts[0][1] * (pct / pts[0][0]);
      for (let i = 1; i < pts.length; i++) {
        const [p0, s0] = pts[i - 1], [p1, s1] = pts[i];
        if (pct <= p1) return s0 + ((s1 - s0) * (pct - p0)) / (p1 - p0);
      }
      return pts[pts.length - 1][1];
    };
    const seg = (k) => $(`[data-vb="${k}"]`, vf);
    const out = (k) => $(`[data-vram-out="${k}"]`, vf);
    let lastFull = null;
    function recalcV() {
      const kvId = $("input[name=kv]:checked", vf).value;
      const kv = V.kv.find(([id]) => id === kvId)[1];
      const apps = V.apps.filter((a) => $(`input[name="${CSS.escape(a.id)}"]`, vf).checked).reduce((n, a) => n + a.mib, 0);
      const think = $("input[name=think]:checked", vf).value === "1";
      const model = V.model_mib + kv;
      const room = Math.max(0, V.total_mib - V.reserved_mib - apps);
      const onGpu = Math.min(model, room);
      const pct = Math.round((onGpu / model) * 100);
      const speed = speedAt(pct);
      const tokens = V.tokens_pick + (think ? V.tokens_write_think : V.tokens_write_direct);
      const secs = V.load_s + tokens / speed;
      const w = (mib) => `${Math.max(0, (mib / V.total_mib) * 100).toFixed(2)}%`;
      seg("reserved").style.width = w(V.reserved_mib);
      seg("apps").style.width = w(Math.min(apps, V.total_mib - V.reserved_mib));
      seg("model").style.width = w(onGpu);
      seg("free").style.width = w(Math.max(0, room - onGpu));
      const spill = $("[data-vram-spill]", vf);
      spill.classList.toggle("is-on", model > room);
      $("span", spill).style.width = `${Math.min(100, ((model - onGpu) / V.total_mib) * 100).toFixed(2)}%`;
      out("pct").textContent = `${pct} %`;
      out("speed").textContent = `${fmt1.format(speed)} tok/s`;
      out("time").textContent = `≈ ${fmt1.format(secs)} s`;
      out("free").textContent = gib(Math.max(0, room - onGpu));
      const full = pct >= 100;
      $("[data-vram-verdict]", vf).textContent = full ? VT.verdict_full : VT.verdict_split.replace("{gib}", gib(model - onGpu));
      $("[data-vram-verdict]", vf).classList.toggle("is-bad", !full);
      $("[data-vram-math]", vf).textContent = `${fmt1.format(V.load_s)} s + ${tokens} tok ÷ ${fmt1.format(speed)} tok/s = ${fmt1.format(secs)} s`;
      vf.classList.toggle("is-split", !full);
      if (lastFull !== null && lastFull !== full) snd(full ? "ok" : "err");
      else if (lastFull !== null) snd("seek");
      lastFull = full;
    }
    vf.addEventListener("input", recalcV);
    vf.addEventListener("submit", (ev) => ev.preventDefault());
    recalcV();
  }

  // ------------------------------------------------------------ bitácora
  const incs = $$("[data-inc]");
  const solved = new Set(store.get(`unit:${D.id}:solved`, []).filter((id) => incs.some((i) => i.dataset.inc === id)));
  const score = $("[data-inc-score]");
  const paintScore = () => { if (score) score.textContent = `${solved.size}/${incs.length} ${U.solved}`; };

  function markSolved(li, pick) {
    const answer = Number(li.dataset.answer);
    li.classList.add("is-solved");
    $$(".inc-opt", li).forEach((b) => {
      b.disabled = true;
      b.classList.toggle("is-right", Number(b.dataset.opt) === answer);
      if (pick !== undefined && Number(b.dataset.opt) === pick && pick !== answer) b.classList.add("is-wrong");
    });
    $("[data-inc-answer]", li).open = true;
  }

  incs.forEach((li) => {
    const answer = Number(li.dataset.answer);
    const fb = $("[data-inc-feedback]", li);
    if (solved.has(li.dataset.inc)) markSolved(li);
    $$(".inc-opt", li).forEach((b) => b.addEventListener("click", () => {
      const pick = Number(b.dataset.opt);
      if (pick !== answer) {
        b.classList.add("is-wrong");
        b.disabled = true;
        fb.textContent = U.incident_wrong;
        snd("err");
        li.classList.remove("is-shake");
        void li.offsetWidth;
        li.classList.add("is-shake");
        return;
      }
      fb.textContent = U.incident_right;
      snd("ok");
      markSolved(li);
      solved.add(li.dataset.inc);
      store.set(`unit:${D.id}:solved`, [...solved]);
      paintScore();
    }));
    // Quien abre la solución sin adivinar también la ve, pero no suma.
    $("[data-inc-answer]", li).addEventListener("toggle", (ev) => {
      if (ev.target.open && !li.classList.contains("is-solved")) $$(".inc-opt", li).forEach((b) => {
        b.disabled = true;
        b.classList.toggle("is-right", Number(b.dataset.opt) === answer);
      });
    });
  });
  paintScore();
})();
