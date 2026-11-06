// Firefox del sistema por WebDriver BiDi (sin Playwright): la sala 3D con la
// GPU de verdad. Firefox en headless no crea contexto GL; para tener GPU sin
// abrir ventanas en el escritorio, dentro de un KWin invisible:
//   kwin_wayland --virtual --socket banco-ux --width 1440 --height 900 &
//   WAYLAND_DISPLAY=banco-ux MOZ_ENABLE_WAYLAND=1 FF_VENTANA=1 \
//     node firefox-gpu.mjs https://titopinardogutierrez.com informes/ff-gpu
// Saca: si entra en la sala y cuánto tarda, la GPU, fotogramas en reposo y
// en un recorrido, violaciones de CSP, errores de consola y capturas.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
const URL_BASE = process.argv[2] || "https://titopinardogutierrez.com";
const OUT = process.argv[3] || "informes/ff-gpu";
const [W, H] = (process.argv[4] || "1440x900").split("x").map(Number);
mkdirSync(OUT, { recursive: true });
const prof = mkdtempSync("/tmp/ffprof-");
writeFileSync(prof + "/user.js", 'user_pref("webgl.force-enabled", true);\nuser_pref("dom.webdriver.enabled", true);\n');
const port = 9300 + Math.floor(Math.random() * 500);
const ff = spawn("firefox", [...(process.env.FF_VENTANA ? [] : ["--headless"]), "--no-remote", "--profile", prof, "--remote-debugging-port", String(port), `--width=${W}`, `--height=${H}`], { stdio: ["ignore", "ignore", "pipe"] });
let ws;
for (let i = 0; i < 40 && !ws; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try { ws = await new Promise((ok, ko) => { const s = new WebSocket(`ws://127.0.0.1:${port}/session`); s.onopen = () => ok(s); s.onerror = ko; }); } catch { ws = null; }
}
let id = 0; const wait = new Map(); const logs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } else if (d.method === "log.entryAdded") logs.push(`${d.params.level}: ${d.params.text}`.slice(0, 200)); };
const cmd = (method, params = {}) => new Promise((ok) => { const i = ++id; wait.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await cmd("session.new", { capabilities: {} });
await cmd("session.subscribe", { events: ["log.entryAdded"] });
await cmd("script.addPreloadScript", { functionDeclaration: `() => { window.__csp = 0; document.addEventListener("securitypolicyviolation", () => window.__csp++); }` });
const tree = await cmd("browsingContext.getTree", {});
const ctx = tree.result.contexts[0].context;
const ev = async (expr) => { const r = await cmd("script.evaluate", { expression: expr, target: { context: ctx }, awaitPromise: true }); return r.result?.result?.value ?? r; };
const shot = async (name) => { const r = await cmd("browsingContext.captureScreenshot", { context: ctx }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, "base64")); };
const t0 = Date.now();
await cmd("browsingContext.navigate", { context: ctx, url: `${URL_BASE}/es/?hora=13`, wait: "complete" });
let room = false;
for (let i = 0; i < 40 && !room; i++) { await sleep(500); room = await ev(`document.documentElement.classList.contains("room-mode") && !!document.querySelector("[data-r3-view] canvas")`); }
const res = { ventana: `${W}x${H}`, sala: room, sala_ms: Date.now() - t0 };
res.gpu = await ev(`(() => { const gl = document.createElement("canvas").getContext("webgl2"); const e = gl && gl.getExtension("WEBGL_debug_renderer_info"); return gl ? (e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : "sin webgl2"; })()`);
await sleep(3000);
await shot("1-sala");
res.scroll_h = await ev(`(() => { scrollTo(50, 0); const x = scrollX; scrollTo(0, 0); return x > 0; })()`);
const fps = `new Promise((ok) => { const t = []; const f = (n) => { t.push(n); if (n - t[0] < 4000) requestAnimationFrame(f); else { const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b); ok(JSON.stringify({ fps: Math.round(1000 * d.length / (t.at(-1) - t[0])), p95: Math.round(d[Math.floor(d.length * .95)] * 10) / 10 })); } }; requestAnimationFrame(f); })`;
res.reposo = JSON.parse(await ev(fps));
// Un recorrido con la cámara siguiendo al paquete
await ev(`document.querySelector("[data-r3-flows]")?.click()`);
await sleep(1500);
await ev(`document.querySelector('[data-flow="visit"]')?.click()`);
await sleep(1500);
res.recorrido = JSON.parse(await ev(fps));
await shot("2-recorrido");
await sleep(4000);
await shot("3-recorrido");
await ev(`document.querySelector("[data-r3-cap-stop], [data-r3-cap-close]")?.click()`);
// Una unidad del rack (la del centro de la vista)
await sleep(1500);
res.csp = await ev(`window.__csp`);
res.errores = logs.filter((l) => l.startsWith("error"));
res.avisos = logs.filter((l) => l.startsWith("warn")).slice(0, 8);
writeFileSync(`${OUT}/informe.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
await cmd("session.end").catch(() => {});
ff.kill();
process.exit(0);
