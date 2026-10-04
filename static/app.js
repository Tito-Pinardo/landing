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
  $$("[data-cv]").forEach((a) => a.addEventListener("click", () => unlock("recruiter")));

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
    filterBy(tech, $(".skill-name", b).textContent);
    $("#quests").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }));
  $("[data-filter-clear]")?.addEventListener("click", () => filterBy(null));

  // ------------------------------------------------------------ mapa del homelab
  const lab = $(".lab");
  const labNodes = $$(".lab-node");
  const opened = new Set(store.get("nodes", []));
  const wide = matchMedia("(min-width: 700px)");

  function selectNode(id, focusPanel) {
    labNodes.forEach((n) => n.classList.toggle("is-active", n.dataset.node === id));
    labNodes.forEach((n) => n.classList.toggle("is-seen", opened.has(n.dataset.node)));
    $$(".lab-link").forEach((l) => l.classList.toggle("is-on", l.dataset.a === id || l.dataset.b === id));
    $$("[data-node-info]").forEach((i) => i.classList.toggle("is-active", i.dataset.nodeInfo === id));
    opened.add(id);
    store.set("nodes", [...opened]);
    if (opened.size >= 5) unlock("architect");
    if (focusPanel && !wide.matches) $(`#node-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  if (lab && labNodes.length) {
    lab.classList.add("has-panel");
    labNodes.forEach((n) => n.addEventListener("click", (ev) => {
      ev.preventDefault();
      selectNode(n.dataset.node, true);
    }));
    // Al cargar se muestra el servidor central, sin contar como "abierto".
    const first = "proxmox";
    labNodes.forEach((n) => n.classList.toggle("is-active", n.dataset.node === first));
    $$(".lab-link").forEach((l) => l.classList.toggle("is-on", l.dataset.a === first || l.dataset.b === first));
    $$("[data-node-info]").forEach((i) => i.classList.toggle("is-active", i.dataset.nodeInfo === first));
  }

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
})();
