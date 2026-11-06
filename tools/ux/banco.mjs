// Banco de pruebas de experiencia de la portada.
//
// Recorre la web como lo harían visitas típicas (RR. HH. con un minuto, un
// portátil pequeño, el móvil, alguien solo con teclado, quien mira un
// recorrido o juega al detective) y saca capturas y medidas: cuánto tarda la
// sala, si el CV y el contacto se ven y se pueden pulsar, qué paneles se
// pisan, textos cortados, botones pequeños, accesibilidad (axe) y errores.
//
//   node banco.mjs [--url http://127.0.0.1:8099] [--browser chromium|firefox]
//   node banco.mjs --gpu /usr/bin/google-chrome-stable   (Chrome del sistema
//     con la GPU de verdad: sin esperas largas y con fotogramas medidos)
//                  [--solo rrhh,movil] [--antes informes/<fecha>/informe.json]
//
// Deja en informes/<fecha>/ el informe (json y md) y las capturas. Con
// --antes compara las cifras con un informe anterior.

import { chromium, firefox } from "playwright";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") ? true : all[i + 1] ?? true]] : acc), []),
);
const URL_BASE = (args.url || "http://127.0.0.1:8099").replace(/\/$/, "");
const BROWSER = args.browser === "firefox" ? firefox : chromium;
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const OUT = args.out || `informes/${stamp}${args.browser === "firefox" ? "-firefox" : ""}`;
mkdirSync(OUT, { recursive: true });
const axeSrc = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
// Con WebGL por software (sin GPU) cada fotograma tarda ~1 s: se espera más
// y sin animaciones para que las capturas sean estables.
const GPU = typeof args.gpu === "string" ? args.gpu : null;
const SLOW = args.slow !== "no" && !GPU;
const WAIT_3D = SLOW ? 30000 : 6000;

const launch = () =>
  BROWSER.launch(
    GPU
      ? { executablePath: GPU, headless: true, args: ["--headless=new", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"] }
      : BROWSER === chromium
      ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"] }
      : // El sandbox de Firefox solo lee fuentes de las carpetas del
        // sistema: sin esto, con fuentes en otra ruta, todo sale en cajas.
        { firefoxUserPrefs: { "security.sandbox.content.level": 0 } },
  );

// ---- comprobaciones que se repiten en cada paso

// Paneles flotantes que no deberían pisarse entre sí
const OVERLAYS = [
  ".topbar", ".stage-id", ".stage-count", ".stage-controls", ".stage-hint", ".r3-caption", ".r3-card",
  ".r3-mission", ".r3-case", ".r3-done", ".r3-say", ".hermes-avatar", ".hermes-bubble", ".toast", ".zone.is-sheet",
];
async function checks(p) {
  return p.evaluate((OVERLAYS) => {
    const vis = (el) => {
      if (!el || el.closest("[hidden]")) return false;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    };
    const boxes = [];
    for (const sel of OVERLAYS) for (const el of document.querySelectorAll(sel)) if (vis(el)) boxes.push({ sel, el, r: el.getBoundingClientRect() });
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 4 && h > 4) overlaps.push(`${a.sel} ✕ ${b.sel} (${Math.round(w)}×${Math.round(h)} px)`);
      }
    // Texto cortado: botones y etiquetas cuyo contenido no cabe
    const clipped = [];
    for (const el of document.querySelectorAll("button, .btn, a.flow-btn, .r3-n, h2, h3")) {
      if (!vis(el)) continue;
      const s = getComputedStyle(el);
      if ((s.overflow === "hidden" || s.textOverflow === "ellipsis" || s.whiteSpace === "nowrap") && el.scrollWidth > el.clientWidth + 2) clipped.push((el.textContent || "").trim().slice(0, 40));
    }
    // Objetivos táctiles pequeños (menos de 32 px de alto o ancho)
    const small = [];
    for (const el of document.querySelectorAll("a, button, [role=button], input, select")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if ((r.width < 32 || r.height < 32) && !el.closest(".topbar nav, p, li p")) small.push(((el.getAttribute("aria-label") || el.textContent || "").trim() || el.tagName).slice(0, 30));
    }
    // ¿Se puede pulsar? (lo que hay encima en su centro es él mismo)
    // (vale con que uno de los que haya se pueda pulsar)
    const reachable = (sel) => {
      const els = [...document.querySelectorAll(sel)].filter(vis);
      if (!els.length) return "no visible";
      let why = "";
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (top && (el === top || el.contains(top))) return "sí";
        why = `tapado por ${top?.className || top?.tagName}`;
      }
      return why;
    };
    // Scroll horizontal de verdad: se intenta mover y se mira si se movió
    const y0 = scrollY;
    scrollTo(99999, y0);
    const hscroll = scrollX > 0;
    scrollTo(0, y0);
    // Filas que ocupan los mandos de la sala (más de 2 = se ve desordenado)
    const tops = new Set([...document.querySelectorAll(".stage-controls .btn")].filter(vis).map((b) => Math.round(b.getBoundingClientRect().top / 8)));
    return {
      sala: document.documentElement.classList.contains("room-mode"),
      filas_mandos: tops.size,
      overlaps,
      clipped,
      small: [...new Set(small)],
      hscroll,
      cv: reachable("[data-cv]"),
      contact: reachable('a[href="#contact"].btn, [data-r3-contact], .stage-id a[href="#contact"]'),
    };
  }, OVERLAYS);
}

async function axe(p) {
  await p.evaluate(axeSrc);
  const r = await p.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { resultTypes: ["violations"], runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, ejemplo: v.nodes[0]?.target?.join(" "), por_que: v.nodes[0]?.any?.[0]?.message?.slice(0, 160) }));
  });
  return r;
}

async function page(browser, name, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 },
    colorScheme: "dark",
    reducedMotion: SLOW ? "reduce" : "no-preference",
    // (Firefox no tiene modo móvil: allí basta con el tamaño)
    ...(BROWSER === chromium ? { isMobile: !!opts.mobile } : {}),
    hasTouch: !!opts.mobile,
    locale: "es-ES",
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(180000);
  const errors = [];
  p.on("pageerror", (e) => errors.push("js: " + e.message.slice(0, 160)));
  p.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push("consola: " + m.text().slice(0, 160));
  });
  const requests = [];
  p.on("request", (r) => requests.push(r.url()));
  // Sin enanitos ni sonido: no tapan lo que se mide
  await p.addInitScript(() => {
    try {
      localStorage.setItem("tp:gnomesOn", "false");
    } catch {}
  });
  const t0 = Date.now();
  await p.goto(`${URL_BASE}/es/?hora=13`, { waitUntil: "load" });
  return { ctx, p, errors, requests, t0 };
}

// Tiempo hasta que la sala está lista (lienzo con un fotograma dibujado)
async function waitRoom(p, t0) {
  try {
    await p.waitForFunction(() => document.querySelector("[data-r3-view] canvas"), null, { timeout: 60000 });
  } catch {
    return null;
  }
  const t = Date.now() - t0;
  await p.waitForTimeout(WAIT_3D);
  return t;
}

const shot = async (p, file) => {
  await p.screenshot({ path: `${OUT}/${file}.png` });
  return `${file}.png`;
};
const click = (p, sel) => p.evaluate((s) => document.querySelector(s)?.click(), sel);

// ---- las visitas

const SCENARIOS = {
  // Alguien de RR. HH. con un minuto en un portátil normal
  async rrhh(b) {
    const { ctx, p, errors, t0 } = await page(b, "rrhh");
    const out = { pasos: [] };
    out.sala_ms = await waitRoom(p, t0);
    out.pasos.push({ paso: "entrada", captura: await shot(p, "rrhh-1-entrada"), ...(await checks(p)) });
    // ¿Qué se puede tocar? Barrido con el ratón: cuántas cosas reaccionan
    const cv = await p.$("[data-r3-view] canvas");
    if (cv) {
      const box = await cv.boundingBox();
      const seen = new Set();
      for (let y = 0.15; y < 0.95; y += 0.1)
        for (let x = 0.05; x < 0.95; x += 0.08) {
          await p.mouse.move(box.x + box.width * x, box.y + box.height * y);
          const t = await p.evaluate(() => {
            const t = document.querySelector("[data-r3-tip]");
            return t && !t.hidden ? t.textContent.split("—")[0].trim() : "";
          });
          if (t) seen.add(t);
        }
      out.tocables = seen.size;
    }
    await click(p, "[data-r3-mission-start]");
    await p.waitForTimeout(3000);
    out.pasos.push({ paso: "misión", captura: await shot(p, "rrhh-2-mision"), ...(await checks(p)) });
    out.axe = await axe(p);
    out.errores = errors;
    await ctx.close();
    return out;
  },

  // Portátil pequeño
  async portatil(b) {
    const { ctx, p, errors, t0 } = await page(b, "portatil", { viewport: { width: 1280, height: 720 } });
    const out = { pasos: [] };
    out.sala_ms = await waitRoom(p, t0);
    out.pasos.push({ paso: "entrada", captura: await shot(p, "portatil-1-entrada"), ...(await checks(p)) });
    await click(p, '.topbar a[href="#lab"]');
    await p.waitForTimeout(4000);
    out.pasos.push({ paso: "hoja del laboratorio", captura: await shot(p, "portatil-2-lab"), ...(await checks(p)) });
    out.errores = errors;
    await ctx.close();
    return out;
  },

  // Sin WebGL (o apagado): la página de siempre en un ordenador
  async sin3d(b) {
    if (BROWSER !== chromium) return { omitida: "solo en Chromium" };
    const nb = await chromium.launch({ args: ["--disable-webgl", "--disable-webgl2", "--no-sandbox"] });
    try {
      const { ctx, p, errors } = await page(nb, "sin3d");
      await p.waitForTimeout(4000);
      const out = { pasos: [] };
      out.pasos.push({ paso: "entrada", captura: await shot(p, "sin3d-1-entrada"), ...(await checks(p)) });
      await p.evaluate(() => document.querySelector("[data-stage]")?.scrollIntoView());
      await p.waitForTimeout(800);
      out.pasos.push({ paso: "la sala (lista)", captura: await shot(p, "sin3d-2-sala"), ...(await checks(p)) });
      // Lo que se sale por la derecha aunque no haya scroll (queda cortado)
      out.cortado_derecha = await p.evaluate(() => [...document.querySelectorAll("main *")].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(e).position !== "fixed";
      }).length);
      out.errores = errors.filter((e) => !/WebGL/.test(e));
      await ctx.close();
      return out;
    } finally {
      await nb.close();
    }
  },

  // Móvil: sin 3D, página de siempre
  async movil(b) {
    const { ctx, p, errors, requests } = await page(b, "movil", { viewport: { width: 390, height: 844 }, mobile: true });
    await p.waitForTimeout(4000);
    const out = { pasos: [] };
    out.descarga_3d = requests.some((u) => u.includes("rack3d"));
    out.lienzo = !!(await p.$("[data-r3-view] canvas"));
    out.pasos.push({ paso: "entrada", captura: await shot(p, "movil-1-entrada"), ...(await checks(p)) });
    await p.evaluate(() => scrollTo(0, document.body.scrollHeight / 3));
    await p.waitForTimeout(800);
    out.pasos.push({ paso: "a un tercio", captura: await shot(p, "movil-2-tercio"), ...(await checks(p)) });
    out.alto_pagina = await p.evaluate(() => Math.round(document.documentElement.scrollHeight / innerHeight));
    out.axe = await axe(p);
    out.errores = errors;
    await ctx.close();
    return out;
  },

  // Solo con teclado: ¿se llega a todo y se ve dónde está el foco?
  async teclado(b) {
    const { ctx, p, errors, t0 } = await page(b, "teclado");
    await waitRoom(p, t0);
    const seq = [];
    for (let i = 0; i < 45; i++) {
      await p.keyboard.press("Tab");
      seq.push(
        await p.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          // ¿Se nota el foco? Se compara su aspecto con foco y sin él
          const look = () => {
            const s = getComputedStyle(el);
            const after = getComputedStyle(el, "::after"); // anillo en una capa encima
            return [s.outlineStyle + s.outlineWidth + s.outlineColor, s.borderColor, s.boxShadow, s.backgroundColor, s.color, after.content + after.boxShadow].join("|");
          };
          const on = look();
          el.blur();
          const off = look();
          el.focus({ preventScroll: true });
          const r = el.getBoundingClientRect();
          const ring = on !== off;
          return {
            txt: ((el.getAttribute("aria-label") || el.textContent || "").trim() || el.tagName).slice(0, 32),
            visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight,
            anillo: ring,
          };
        }),
      );
    }
    const f = seq.filter(Boolean);
    const out = {
      paradas: f.length,
      invisibles: f.filter((x) => !x.visible).map((x) => x.txt),
      sin_anillo: f.filter((x) => x.visible && !x.anillo).map((x) => x.txt),
      llega_cv: f.findIndex((x) => /CV/i.test(x.txt)),
      llega_contacto: f.findIndex((x) => /Contact/i.test(x.txt)),
      llega_3d: f.findIndex((x) => /sala|rack|3D/i.test(x.txt)),
    };
    await p.keyboard.press("Tab");
    out.captura = await shot(p, "teclado-foco");
    // Dentro de la sala: enfocar la vista, ir con las flechas y abrir con Intro
    await p.focus("[data-r3-view]");
    const dichos = [];
    for (let i = 0; i < 3; i++) {
      await p.keyboard.press("ArrowRight");
      await p.waitForTimeout(SLOW ? 1500 : 300);
      dichos.push(await p.evaluate(() => document.querySelector(".r3-sr")?.textContent || ""));
    }
    out.sala_teclado = dichos;
    out.captura_sala = await shot(p, "teclado-sala");
    await p.keyboard.press("Enter");
    await p.waitForTimeout(SLOW ? 6000 : 1500);
    out.sala_intro_abre = await p.evaluate(() => document.documentElement.classList.contains("has-sheet"));
    out.captura_intro = await shot(p, "teclado-intro");
    await p.keyboard.press("Escape");
    await p.waitForTimeout(SLOW ? 3000 : 600);
    out.sala_esc_vuelve = await p.evaluate(() => !document.documentElement.classList.contains("has-sheet") && document.activeElement === document.querySelector("[data-r3-view]"));
    out.errores = errors;
    await ctx.close();
    return out;
  },

  // Un recorrido: ¿el texto tapa lo que se está enseñando?
  async recorrido(b) {
    const { ctx, p, errors, t0 } = await page(b, "recorrido");
    await waitRoom(p, t0);
    await click(p, "[data-r3-flows]");
    await p.waitForTimeout(3000);
    await click(p, '[data-flow="visit"]');
    const out = { pasos: [] };
    // Fluidez con la cámara siguiendo al paquete: fotogramas en 4 s y el
    // percentil 95 del tiempo entre ellos (con SwiftShader no significa nada).
    if (!SLOW) {
      Object.assign(out, await p.evaluate(() => new Promise((ok) => {
        const t = [];
        const f = (now) => { t.push(now); if (now - t[0] < 4000) requestAnimationFrame(f); else {
          const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
          ok({ fps: Math.round((1000 * d.length) / (t.at(-1) - t[0])), frame_p95_ms: Math.round(d[Math.floor(d.length * 0.95)] * 10) / 10 });
        } };
        requestAnimationFrame(f);
      })));
      out.gpu = await p.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl2");
        const e = gl?.getExtension("WEBGL_debug_renderer_info");
        return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : "?";
      });
    }
    for (let k = 0; k < 5; k++) {
      await p.evaluate(() => {
        const c = document.querySelector("[data-r3-cap-play]");
        if (c?.textContent.includes("⏸")) c.click();
      });
      await p.waitForTimeout(SLOW ? 9000 : 2500);
      // Qué parte del centro de la escena (donde está lo que se enseña)
      // queda debajo del texto del paso
      const tapa = await p.evaluate(() => {
        const v = document.querySelector("[data-r3-view]").getBoundingClientRect();
        const c = document.querySelector("[data-r3-caption]");
        if (!c || c.hidden) return 0;
        const r = c.getBoundingClientRect();
        const cx0 = v.left + v.width * 0.3, cx1 = v.left + v.width * 0.7, cy0 = v.top + v.height * 0.25, cy1 = v.top + v.height * 0.75;
        const w = Math.max(0, Math.min(r.right, cx1) - Math.max(r.left, cx0));
        const h = Math.max(0, Math.min(r.bottom, cy1) - Math.max(r.top, cy0));
        return Math.round((100 * w * h) / ((cx1 - cx0) * (cy1 - cy0)));
      });
      out.pasos.push({ paso: `parada ${k + 1}`, centro_tapado_pct: tapa, captura: await shot(p, `recorrido-${k + 1}`), ...(await checks(p)) });
      await click(p, "[data-r3-cap-next]");
    }
    out.errores = errors;
    await ctx.close();
    return out;
  },

  // Detective: el panel con un aviso de logro encima
  async detective(b) {
    const { ctx, p, errors, t0 } = await page(b, "detective");
    await waitRoom(p, t0);
    await click(p, "[data-r3-case-start]");
    await p.waitForTimeout(2000);
    await click(p, "[data-r3-case-list] button");
    await p.waitForTimeout(SLOW ? 6000 : 1500);
    const out = { pasos: [] };
    out.pasos.push({ paso: "caso elegido", captura: await shot(p, "detective-1"), ...(await checks(p)) });
    // Un aviso de logro de prueba, como el que sale al resolver
    await p.evaluate(() => {
      const t = document.querySelector("[data-toasts]");
      if (!t) return;
      const el = document.createElement("div");
      el.className = "toast";
      el.innerHTML = "<div><small>Logro</small><strong>Prueba</strong><span>Un aviso de logro de prueba del banco.</span></div>";
      t.append(el);
    });
    await p.waitForTimeout(800);
    out.pasos.push({ paso: "con aviso de logro", captura: await shot(p, "detective-2-aviso"), ...(await checks(p)) });
    out.errores = errors;
    await ctx.close();
    return out;
  },
};

// ---- informe

const only = args.solo ? String(args.solo).split(",") : Object.keys(SCENARIOS);
const browser = await launch();
const report = { fecha: new Date().toISOString(), url: URL_BASE, navegador: args.browser || "chromium", visitas: {} };
for (const name of only) {
  const t = Date.now();
  process.stdout.write(`· ${name}… `);
  try {
    report.visitas[name] = await SCENARIOS[name](browser);
  } catch (e) {
    report.visitas[name] = { fallo: String(e).slice(0, 300) };
  }
  console.log(`${Math.round((Date.now() - t) / 1000)} s`);
}
await browser.close();

// Cifras que se comparan de una vuelta a otra (menos es mejor)
function score(r) {
  const v = r.visitas;
  const all = Object.values(v).flatMap((x) => x.pasos || []);
  return {
    "paneles que se pisan": all.reduce((n, s) => n + (s.overlaps?.length || 0), 0),
    "textos cortados": all.reduce((n, s) => n + (s.clipped?.length || 0), 0),
    "botones pequeños (móvil)": v.movil?.pasos?.reduce((n, s) => Math.max(n, s.small?.length || 0), 0) ?? null,
    "scroll horizontal": all.filter((s) => s.hscroll).length,
    "elementos cortados a la derecha (sin 3D)": v.sin3d?.cortado_derecha ?? null,
    "mandos en más de 2 filas": all.filter((s) => s.filas_mandos > 2).length,
    // (en la sala siempre deben estar a mano; en la página, solo al entrar)
    "CV o contacto sin poder pulsar": Object.values(v).flatMap((x) => (x.pasos || []).filter((s, i) => s.sala || i === 0)).filter((s) => s.cv !== "sí" || s.contact !== "sí").length,
    "fallos de accesibilidad (axe)": [v.rrhh?.axe, v.movil?.axe].reduce((n, a) => n + (a?.reduce((m, x) => m + (x.impact === "serious" || x.impact === "critical" ? 1 : 0), 0) || 0), 0),
    "paradas de teclado invisibles": v.teclado?.invisibles?.length ?? null,
    "foco sin anillo": v.teclado?.sin_anillo?.length ?? null,
    "sala sin teclado": v.teclado?.sala_teclado ? Number(!(v.teclado.sala_teclado.every(Boolean) && v.teclado.sala_intro_abre && v.teclado.sala_esc_vuelve)) : null,
    "centro tapado en recorridos (% medio)": v.recorrido?.pasos ? Math.round(v.recorrido.pasos.reduce((n, s) => n + s.centro_tapado_pct, 0) / v.recorrido.pasos.length) : null,
    "errores JS": Object.values(v).reduce((n, x) => n + (x.errores?.length || 0), 0),
    "visitas que fallan": Object.values(v).filter((x) => x.fallo).length,
  };
}
report.cifras = score(report);
writeFileSync(`${OUT}/informe.json`, JSON.stringify(report, null, 2));

let before = null;
if (args.antes && existsSync(args.antes)) before = JSON.parse(readFileSync(args.antes, "utf8")).cifras;
const md = [`# Banco de experiencia · ${report.fecha.slice(0, 16)} · ${report.navegador}`, "", "| Cifra | " + (before ? "Antes | " : "") + "Ahora |", "|---|" + (before ? "---|" : "") + "---|"];
for (const [k, val] of Object.entries(report.cifras)) md.push(`| ${k} | ${before ? (before[k] ?? "—") + " | " : ""}${val ?? "—"} |`);
md.push("", "## Detalle", "");
for (const [name, v] of Object.entries(report.visitas)) {
  md.push(`### ${name}`);
  if (v.fallo) md.push(`- **falló:** ${v.fallo}`);
  for (const k of ["sala_teclado", "sala_intro_abre", "sala_esc_vuelve", "gpu", "fps", "frame_p95_ms", "cortado_derecha", "omitida", "sala_ms", "tocables", "descarga_3d", "lienzo", "alto_pagina", "paradas", "llega_cv", "llega_contacto", "llega_3d"]) if (k in v) md.push(`- ${k}: ${v[k]}`);
  for (const k of ["invisibles", "sin_anillo"]) if (v[k]?.length) md.push(`- ${k}: ${v[k].join(" · ")}`);
  for (const s of v.pasos || []) {
    const bits = [];
    if (s.overlaps?.length) bits.push(`se pisan: ${s.overlaps.join("; ")}`);
    if (s.clipped?.length) bits.push(`cortados: ${s.clipped.join(" · ")}`);
    if (s.small?.length && name === "movil") bits.push(`pequeños: ${s.small.slice(0, 12).join(" · ")}`);
    if (s.hscroll) bits.push("scroll horizontal");
    if (s.filas_mandos > 2) bits.push(`mandos en ${s.filas_mandos} filas`);
    if (s.cv && s.cv !== "sí") bits.push(`CV: ${s.cv}`);
    if (s.contact && s.contact !== "sí") bits.push(`contacto: ${s.contact}`);
    if ("centro_tapado_pct" in s) bits.push(`centro tapado ${s.centro_tapado_pct} %`);
    md.push(`- ${s.paso} (${s.captura}): ${bits.join(" | ") || "bien"}`);
  }
  for (const a of v.axe || []) md.push(`- axe ${a.impact}: ${a.id} ×${a.n} — ${a.help} (${a.ejemplo})${a.por_que ? " — " + a.por_que : ""}`);
  for (const e of v.errores || []) md.push(`- error: ${e}`);
  md.push("");
}
writeFileSync(`${OUT}/informe.md`, md.join("\n"));
console.log(md.slice(0, 4 + Object.keys(report.cifras).length).join("\n"));
console.log(`\ninforme: ${OUT}/informe.md`);
