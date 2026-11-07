// Carga en un móvil con red lenta: lo que tarda en verse algo (FCP), en verse
// lo grande (LCP) y en estar todo (load), y cuánto se descarga, con la caché
// vacía. Red y CPU como el «4G lento» de Lighthouse: 150 ms de ida y vuelta,
// 1,6 Mbit/s de bajada, 750 kbit/s de subida y la CPU 4 veces más lenta.
//
//   node carga.mjs [--url https://titopinardogutierrez.com] [--veces 3]
//                  [--rutas /es/,/es/amp/,/es/blog/]
//
// Saca la mediana de cada cifra. Solo Chromium (la red y la CPU se frenan
// por CDP).
import { chromium, devices } from "playwright";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") ? true : all[i + 1] ?? true]);
    return acc;
  }, []),
);
const URL_BASE = (args.url || "https://titopinardogutierrez.com").replace(/\/$/, "");
const VECES = Number(args.veces) || 3;
const RUTAS = (args.rutas || "/es/,/es/amp/,/es/blog/,/es/blog/nat-hsts/").split(",");

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const filas = [];
for (const ruta of RUTAS) {
  const medidas = [];
  for (let i = 0; i < VECES; i++) {
    // Contexto nuevo cada vez: caché vacía, como quien entra por primera vez.
    const ctx = await browser.newContext({ ...devices["Pixel 7"] });
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    let bytes = 0;
    const tipos = {};
    cdp.on("Network.loadingFinished", (e) => (bytes += e.encodedDataLength));
    cdp.on("Network.responseReceived", (e) => (tipos[e.requestId] = e.type));
    await p.addInitScript(() => {
      window.__lcp = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lcp = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    const t0 = Date.now();
    await p.goto(URL_BASE + ruta, { waitUntil: "load", timeout: 120000 });
    const load = Date.now() - t0;
    await p.waitForTimeout(1500);
    const m = await p.evaluate(() => ({
      fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0,
      lcp: window.__lcp,
      ttfb: performance.getEntriesByType("navigation")[0]?.responseStart ?? 0,
      peticiones: performance.getEntriesByType("resource").length + 1,
    }));
    medidas.push({ ...m, load, kb: bytes / 1024 });
    await ctx.close();
  }
  const fila = { ruta };
  for (const k of ["ttfb", "fcp", "lcp", "load", "kb", "peticiones"]) fila[k] = Math.round(median(medidas.map((m) => m[k])));
  filas.push(fila);
  console.log(`${ruta}: FCP ${fila.fcp} ms · LCP ${fila.lcp} ms · load ${fila.load} ms · ${fila.kb} KB en ${fila.peticiones} peticiones (TTFB ${fila.ttfb} ms)`);
}
await browser.close();

console.log("\n| Página | TTFB | FCP | LCP | Todo cargado | Descarga | Peticiones |\n|---|---|---|---|---|---|---|");
for (const f of filas)
  console.log(`| \`${f.ruta}\` | ${f.ttfb} ms | ${f.fcp} ms | ${f.lcp} ms | ${f.load} ms | ${f.kb} KB | ${f.peticiones} |`);
