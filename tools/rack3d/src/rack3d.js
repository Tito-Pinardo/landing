// Rack 3D de la portada.
//
// Un armario de 19" con una unidad por cada servidor de la lista del rack
// (las <li data-rack-unit> de la página, que siguen siendo la versión
// accesible y la de sin WebGL). Se gira arrastrando, se acerca con la rueda
// o con los botones, y al pulsar una unidad sale del armario como un cajón y
// la cámara vuela hasta ella.
//
// Lo que pasa en la lista se ve en el armario: al filtrar por una habilidad
// (clases is-match / is-dim) se encienden las unidades que la usan, y el
// estado real (live-up / live-off / live-down) cambia sus luces.
//
// Nada de estilos en línea: la CSP no los deja. Las posiciones de la ficha y
// la etiqueta se mueven con style.setProperty (CSSOM, que sí está permitido).
//
// Se empaqueta con esbuild (tools/rack3d) en static/rack3d.min.js.

import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Points,
  PointsMaterial,
  Raycaster,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  Spherical,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  ACESFilmicToneMapping,
  QuadraticBezierCurve3,
  SphereGeometry,
} from "three";
import { buildRoom, ROOM } from "./room.js";
import { buildGnomes } from "./gnomes.js";

const U = 0.1; // 1U
const W = 1.0; // ancho interior
const D = 0.9; // fondo de una unidad
const FRONT = 0.5; // z del frontal del armario
const SLOT_W = 1024;
const SLOT_H = 96;

const COLORS = {
  live: "#2dd4bf",
  lab: "#a78bfa",
  retired: "#64748b",
  up: "#4ade80",
  off: "#64748b",
  down: "#f87171",
  amber: "#fbbf24",
  activity: "#38bdf8",
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = MathUtils.clamp;

// ------------------------------------------------------------ texturas
function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Corta el texto con «…» para que quepa en `max` píxeles.
function fit(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

const MONO = 'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace';

// Un frontal de 1U: orejas con tornillos, número de unidad, huecos de los
// LED (las luces son puntos 3D aparte, para que parpadeen), nombre, datos y
// la rejilla de ventilación.
function drawFace(g, y, u, n) {
  const h = SLOT_H;
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, "#2a3346");
  grad.addColorStop(0.08, "#1b2232");
  grad.addColorStop(0.92, "#141a27");
  grad.addColorStop(1, "#0b0f18");
  g.fillStyle = grad;
  g.fillRect(0, y, SLOT_W, h);
  // Orejas
  for (const x of [0, SLOT_W - 44]) {
    g.fillStyle = "#3a4458";
    g.fillRect(x, y + 2, 44, h - 4);
    g.fillStyle = "#0b0f18";
    for (const sy of [y + 24, y + h - 24]) {
      g.beginPath();
      g.arc(x + 22, sy, 7, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Franja de estado
  g.fillStyle = COLORS[u.status] || COLORS.live;
  g.fillRect(48, y + 10, 6, h - 20);
  // Número
  g.fillStyle = "#7c8aa5";
  g.font = `600 20px ${MONO}`;
  g.textBaseline = "middle";
  g.fillText("U" + String(n).padStart(2, "0"), 64, y + h / 2);
  // Huecos de los LED
  g.fillStyle = "#05070c";
  for (const lx of [122, 146]) {
    g.beginPath();
    g.arc(lx, y + h / 2, 8, 0, Math.PI * 2);
    g.fill();
  }
  // Nombre y datos
  g.fillStyle = "#e6edf7";
  g.font = `700 34px ${MONO}`;
  g.fillText(fit(g, u.slot, 520), 172, y + 34);
  g.fillStyle = "#93a1b8";
  g.font = `500 21px ${MONO}`;
  g.fillText(fit(g, u.specs, 520), 172, y + 68);
  // Rejilla
  g.fillStyle = "#070a11";
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 18; col++) {
      const vx = 716 + col * 14 + (row % 2 ? 7 : 0);
      const vy = y + 20 + row * 14;
      g.beginPath();
      g.arc(vx, vy, 4.2, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Asa
  g.strokeStyle = "#566179";
  g.lineWidth = 5;
  roundRect(g, 680, y + 14, 16, h - 28, 6);
  g.stroke();
  // Brillo del canto
  g.fillStyle = "rgba(255,255,255,.07)";
  g.fillRect(0, y, SLOT_W, 2);
}

// Panel de parcheo (arriba) y bandeja de ventiladores (abajo).
function drawPatch(g, y) {
  g.fillStyle = "#1a2030";
  g.fillRect(0, y, SLOT_W, SLOT_H);
  for (let i = 0; i < 24; i++) {
    const x = 70 + i * 37;
    g.fillStyle = "#06080d";
    g.fillRect(x, y + 30, 28, 24);
    g.fillStyle = i % 5 === 0 ? "#38bdf8" : i % 3 === 0 ? "#fbbf24" : "#2dd4bf";
    g.fillRect(x + 4, y + 58, 20, 4);
  }
  g.fillStyle = "#93a1b8";
  g.font = `600 16px ${MONO}`;
  g.fillText("PATCH · 24 × RJ45 · 10 GbE", 70, y + 16);
}

function drawFans(g, y) {
  g.fillStyle = "#151a26";
  g.fillRect(0, y, SLOT_W, SLOT_H);
  for (let i = 0; i < 6; i++) {
    const cx = 120 + i * 156;
    g.strokeStyle = "#2c3446";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, y + SLOT_H / 2, 36, 0, Math.PI * 2);
    g.stroke();
    for (let r = 10; r < 36; r += 8) {
      g.beginPath();
      g.arc(cx, y + SLOT_H / 2, r, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

// La trasera de una unidad: fuentes, puertos y una etiqueta.
function drawRear() {
  const c = makeCanvas(512, 48);
  const g = c.getContext("2d");
  g.fillStyle = "#121722";
  g.fillRect(0, 0, 512, 48);
  g.fillStyle = "#1f2737";
  g.fillRect(16, 6, 90, 36);
  g.fillRect(114, 6, 90, 36);
  g.fillStyle = "#05070c";
  for (let i = 0; i < 4; i++) g.fillRect(240 + i * 30, 16, 22, 18);
  g.fillRect(380, 18, 40, 14);
  g.fillStyle = "#4ade80";
  g.fillRect(96, 10, 5, 5);
  g.fillRect(194, 10, 5, 5);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// Chapa perforada de los laterales y el suelo de la sala.
function perforated() {
  const c = makeCanvas(64, 64);
  const g = c.getContext("2d");
  g.fillStyle = "#1e2534";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#0d111a";
  for (let y = 8; y < 64; y += 16) for (let x = 8; x < 64; x += 16) g.fillRect(x - 3, y - 3, 6, 6);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

function floorTexture() {
  const c = makeCanvas(512, 512);
  const g = c.getContext("2d");
  const r = g.createRadialGradient(256, 256, 10, 256, 256, 256);
  r.addColorStop(0, "rgba(45,212,191,.20)");
  r.addColorStop(0.55, "rgba(45,212,191,.06)");
  r.addColorStop(1, "rgba(45,212,191,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = "rgba(148,163,184,.16)";
  g.lineWidth = 1;
  for (let i = 0; i <= 512; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 512);
    g.moveTo(0, i);
    g.lineTo(512, i);
    g.stroke();
  }
  // Se apaga hacia los bordes
  const m = g.createRadialGradient(256, 256, 120, 256, 256, 256);
  m.addColorStop(0, "rgba(0,0,0,0)");
  m.addColorStop(1, "rgba(0,0,0,1)");
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = m;
  g.fillRect(0, 0, 512, 512);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function glowSprite() {
  const c = makeCanvas(64, 64);
  const g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.25, "rgba(255,255,255,.65)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

// Etiqueta de la placa de arriba del armario.
function badgeTexture(text) {
  const c = makeCanvas(512, 64);
  const g = c.getContext("2d");
  g.fillStyle = "#0d121c";
  g.fillRect(0, 0, 512, 64);
  g.fillStyle = "#2dd4bf";
  g.font = `800 30px ${MONO}`;
  g.textBaseline = "middle";
  g.fillText(text, 24, 33);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------ la escena
export function mount(stage, opts = {}) {
  const view = stage.querySelector("[data-r3-view]");
  const items = [...stage.querySelectorAll("[data-rack-unit]")];
  if (!view || !items.length) return null;

  const reduce = opts.reduce || (() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const sound = (s) => window.tpSound?.play(s);

  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.domElement.className = "r3-canvas";
  view.append(renderer.domElement);

  // Estado del bucle de dibujo (antes que nada: todo llama a wake()).
  let raf = 0;
  let visible = true;
  let last = performance.now();
  let lastDraw = 0;
  let dirty = true;

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.05, 60);

  // ---- datos de las unidades (de la lista de la página)
  const units = items.map((li, i) => ({
    i,
    id: li.dataset.rackUnit,
    li,
    a: li.querySelector("a"),
    url: li.querySelector("a")?.getAttribute("href") || "#",
    slot: li.querySelector(".ru-name strong")?.textContent.trim() || li.dataset.rackUnit,
    specs: li.querySelector(".ru-name small")?.textContent.trim() || "",
    title: li.querySelector(".ru-text")?.textContent.trim() || "",
    tagline: li.querySelector(".ru-tagline")?.textContent.trim() || "",
    status: [...li.classList].find((c) => c.startsWith("status-"))?.slice(7) || "live",
    out: 0,
    outTo: 0,
    glow: 0,
    glowTo: 0,
  }));
  const N = units.length;
  const slots = N + 2; // panel de parcheo + unidades + ventiladores
  const H = (slots + 2) * U; // + aire arriba y abajo
  const BASE = 0.12; // zócalo
  const topY = BASE + H - U * 1.5;
  const slotY = (s) => topY - s * U; // centro del hueco s (0 = parcheo)

  // ---- atlas con todos los frontales
  const atlas = makeCanvas(SLOT_W, SLOT_H * slots);
  {
    const g = atlas.getContext("2d");
    drawPatch(g, 0);
    units.forEach((u, i) => drawFace(g, (i + 1) * SLOT_H, u, i + 1));
    drawFans(g, (slots - 1) * SLOT_H);
  }
  const faceTex = new CanvasTexture(atlas);
  faceTex.colorSpace = SRGBColorSpace;
  faceTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // Caja de 1U con el frontal apuntando a su franja del atlas.
  function slotBox(s, w, h, d) {
    const geo = new BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    // Caras de BoxGeometry: +x, -x, +y, -y, +z (frontal), -z; 4 vértices cada una.
    const v0 = 1 - (s + 1) / slots;
    const v1 = 1 - s / slots;
    const pad = 0.5 / atlas.height;
    for (let k = 16; k < 20; k++) {
      const u = uv.getX(k);
      const v = uv.getY(k);
      uv.setXY(k, u, v > 0.5 ? v1 - pad : v0 + pad);
    }
    uv.needsUpdate = true;
    return geo;
  }

  const bodyMat = new MeshStandardMaterial({ color: 0x232a3a, metalness: 0.75, roughness: 0.42 });
  const rearMat = new MeshStandardMaterial({ map: drawRear(), metalness: 0.5, roughness: 0.6 });
  const rack = new Group();
  scene.add(rack);

  // ---- armario
  const frameMat = new MeshStandardMaterial({ color: 0x151a24, metalness: 0.6, roughness: 0.5 });
  const perf = perforated();
  perf.repeat.set(6, 22);
  const sideMat = new MeshStandardMaterial({ map: perf, color: 0x9aa6bd, metalness: 0.55, roughness: 0.55, transparent: true, opacity: 0.94 });
  const postGeo = new BoxGeometry(0.06, H, 0.06);
  for (const x of [-W / 2 - 0.05, W / 2 + 0.05]) {
    for (const z of [FRONT - 0.03, -FRONT + 0.03]) {
      const p = new Mesh(postGeo, frameMat);
      p.position.set(x, BASE + H / 2, z);
      p.castShadow = true;
      rack.add(p);
    }
  }
  // Raíles con agujeros
  const railTex = perforated();
  railTex.repeat.set(1, slots * 2);
  const railMat = new MeshStandardMaterial({ map: railTex, color: 0xc4cbda, metalness: 0.8, roughness: 0.35 });
  for (const x of [-W / 2 - 0.012, W / 2 + 0.012]) {
    const r = new Mesh(new BoxGeometry(0.03, H - 0.06, 0.012), railMat);
    r.position.set(x, BASE + H / 2, FRONT - 0.06);
    rack.add(r);
  }
  // Techo, suelo y zócalo
  const capGeo = new BoxGeometry(W + 0.18, 0.05, FRONT * 2 + 0.04);
  const roof = new Mesh(capGeo, frameMat);
  roof.position.set(0, BASE + H + 0.025, 0);
  roof.castShadow = true;
  rack.add(roof);
  const plinth = new Mesh(new BoxGeometry(W + 0.18, BASE, FRONT * 2 + 0.04), frameMat);
  plinth.position.set(0, BASE / 2, 0);
  plinth.receiveShadow = true;
  rack.add(plinth);
  // Laterales (uno, el de la izquierda; el derecho queda abierto para ver
  // los cables y las unidades al girar)
  const side = new Mesh(new BoxGeometry(0.012, H, FRONT * 2 - 0.08), sideMat);
  side.position.set(-W / 2 - 0.085, BASE + H / 2, 0);
  side.castShadow = true;
  rack.add(side);
  // Placa de arriba
  const badge = new Mesh(new BoxGeometry(0.62, 0.075, 0.01), new MeshStandardMaterial({ map: badgeTexture(opts.badge || "TP · HOMELAB"), emissive: 0x0b3b36, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.5 }));
  badge.position.set(0, BASE + H - 0.055, FRONT + 0.006);
  rack.add(badge);

  // ---- parcheo y ventiladores
  const patch = new Mesh(slotBox(0, W, U * 0.92, 0.18), [bodyMat, bodyMat, bodyMat, bodyMat, new MeshStandardMaterial({ map: faceTex, metalness: 0.4, roughness: 0.55 }), bodyMat]);
  patch.position.set(0, slotY(0), FRONT - 0.15);
  rack.add(patch);
  const fans = new Mesh(slotBox(slots - 1, W, U * 0.92, 0.3), [bodyMat, bodyMat, bodyMat, bodyMat, new MeshStandardMaterial({ map: faceTex, metalness: 0.4, roughness: 0.55 }), bodyMat]);
  fans.position.set(0, slotY(slots - 1), FRONT - 0.21);
  rack.add(fans);

  // ---- unidades
  const pickables = [];
  for (const u of units) {
    const face = new MeshStandardMaterial({ map: faceTex, metalness: 0.35, roughness: 0.5, emissive: new Color(COLORS.live), emissiveIntensity: 0 });
    face.emissiveMap = faceTex;
    const geo = slotBox(u.i + 1, W - 0.01, U * 0.9, D);
    const m = new Mesh(geo, [bodyMat, bodyMat, bodyMat, bodyMat, face, rearMat]);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.unit = u;
    u.baseZ = FRONT - D / 2 - 0.01;
    m.position.set(0, slotY(u.i + 1), u.baseZ);
    u.mesh = m;
    u.face = face;
    rack.add(m);
    pickables.push(m);
  }

  // ---- LED: dos por unidad (estado y actividad), con halo aditivo
  const ledPos = new Float32Array(N * 2 * 3);
  const ledCol = new Float32Array(N * 2 * 3);
  const ledGeo = new BufferGeometry();
  ledGeo.setAttribute("position", new BufferAttribute(ledPos, 3));
  ledGeo.setAttribute("color", new BufferAttribute(ledCol, 3));
  const sprite = glowSprite();
  const leds = new Points(ledGeo, new PointsMaterial({ size: 0.05, map: sprite, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true }));
  leds.frustumCulled = false;
  scene.add(leds);
  const ledX = (k) => -W / 2 + ((k === 0 ? 122 : 146) / SLOT_W) * W;
  const tmp = new Color();

  // ---- cables por detrás: de cada unidad al panel de parcheo
  const cableCols = [0x38bdf8, 0xfbbf24, 0x2dd4bf, 0xf472b6, 0xa78bfa];
  const cables = [];
  units.forEach((u, i) => {
    const y = slotY(i + 1);
    const x0 = -0.3 + (i % 5) * 0.12;
    const back = -FRONT + 0.04;
    const pts = [
      new Vector3(x0, y, back + 0.02),
      new Vector3(x0 + 0.02, y, back - 0.06),
      new Vector3(W / 2 - 0.06 - (i % 4) * 0.025, y + 0.05, back - 0.09),
      new Vector3(W / 2 - 0.06 - (i % 4) * 0.025, slotY(0) - 0.05, back - 0.09),
      new Vector3(-0.4 + (i % 24) * 0.035, slotY(0), back + 0.2),
    ];
    const curve = new CatmullRomCurve3(pts);
    const tube = new Mesh(new TubeGeometry(curve, 40, 0.006, 5, false), new MeshStandardMaterial({ color: cableCols[i % cableCols.length], roughness: 0.6, metalness: 0.1 }));
    rack.add(tube);
    cables.push(curve);
  });
  // Paquetes que corren por los cables (se ven al girar el armario)
  const PKT = Math.min(24, N);
  const pktPos = new Float32Array(PKT * 3);
  const pktGeo = new BufferGeometry();
  pktGeo.setAttribute("position", new BufferAttribute(pktPos, 3));
  const packets = new Points(pktGeo, new PointsMaterial({ size: 0.045, map: sprite, color: 0x7dd3fc, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  packets.frustumCulled = false;
  scene.add(packets);
  const pktState = Array.from({ length: PKT }, (_, k) => ({ c: (k * 7) % N, t: Math.random(), v: 0.18 + Math.random() * 0.25 }));

  // ---- sala: suelo con rejilla que se apaga y sombra
  const floor = new Mesh(new CircleGeometry(2.6, 64), new MeshBasicMaterial({ map: floorTexture(), transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.004;
  scene.add(floor);

  // ---- la sala: paredes, tablero, mesa, ventana y puerta
  const L = opts.labels || {};
  const room = buildRoom(scene, { labels: L, zones: opts.zones || [] });
  for (const m of room.objects) pickables.push(m);
  // Los enanitos de la web viven aquí (si no se han apagado en el panel)
  const gnomes = buildGnomes(scene);
  gnomes.visible = opts.gnomes !== false;
  for (const m of gnomes.meshes) {
    m.userData.obj.label = L.gnome || "";
    pickables.push(m);
  }

  // ---- luces
  const hemi = new HemisphereLight(0xbfd7ff, 0x0b0f18, 0.55);
  scene.add(hemi);
  scene.add(new AmbientLight(0x6070a0, 0.25));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(2.6, 5.5, 4.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -7;
  key.shadow.bias = -0.0008;
  scene.add(key);
  const rim = new DirectionalLight(0x2dd4bf, 1.6);
  rim.position.set(-3, 2.5, -3);
  scene.add(rim);
  // Luz de servicio por detrás, para ver el cableado al girarlo
  const backLight = new DirectionalLight(0xdbe7ff, 1.5);
  backLight.position.set(1.5, 3, -4.5);
  scene.add(backLight);
  const backFill = new PointLight(0x7dd3fc, 2.2, 5);
  backFill.position.set(0.4, BASE + H * 0.6, -1.6);
  scene.add(backFill);
  const fill = new PointLight(0x818cf8, 1.2, 8);
  fill.position.set(-2, 1.4, 2.5);
  scene.add(fill);
  // Lámpara sobre la mesa y luz cálida de la puerta
  const lamp = new PointLight(0xffe4b5, 2.4, 4.5);
  lamp.position.set(ROOM.left + 1.4, 3.0, 0.95);
  scene.add(lamp);
  // El sol entra por la ventana (sin sombras: sería otro mapa de sombras)
  const sun = new DirectionalLight(0xfff4dc, 0);
  sun.position.copy(room.anchors.sunFrom);
  sun.target.position.set(0, 0, 0.6);
  scene.add(sun, sun.target);

  // ---- la hora de casa (Madrid) manda en la luz; ?hora=19 la fuerza
  const homeClock = new Intl.DateTimeFormat("en-GB", { timeZone: opts.timeZone || "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  function applyTime() {
    let h;
    let text;
    if (typeof opts.hour === "number") {
      h = opts.hour;
      text = `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
    } else {
      text = homeClock.format(new Date());
      const [hh, mm] = text.split(":").map(Number);
      h = hh + mm / 60;
    }
    const d = room.setTime(h, text);
    gnomes.setAsleep(h >= 23 || h < 7); // como en la página: duermen de 23 a 7
    sun.intensity = d.sun;
    sun.color.set(d.sunCol);
    hemi.intensity = d.hemi;
    lamp.intensity = d.lamp;
    // De noche la luz del techo baja y manda la lámpara de la mesa
    key.intensity = 1.5 + (d.sun / 2.4) * 1.1;
    stage.dataset.daylight = d.sun > 1.8 ? "day" : d.sun > 0.2 ? "dusk" : "night";
    wake();
  }

  // Una luz que sigue a la unidad elegida
  const spot = new PointLight(0x2dd4bf, 0, 1.6);
  scene.add(spot);

  // ---- cámara: órbita propia (sin OrbitControls, para que pese menos)
  const center = new Vector3(0, BASE + H / 2, 0);
  // Distancia para que quepa algo de `w` de ancho y `h` de alto.
  function fitBox(w, h) {
    const vfov = MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(0.3, camera.aspect));
    return Math.max(w / 2 / Math.tan(hfov / 2), h / 2 / Math.tan(vfov / 2));
  }
  const rackR = () => fitR;
  const roomCenter = new Vector3(ROOM.left + 3.0, 2.0, 0.7);
  const VIEWS = {
    // La sala entera; en vertical (móvil) se recorta por los lados.
    room: { target: roomCenter, theta: 0.6, phi: 1.18, fit: () => fitBox(camera.aspect < 0.9 ? 7.2 : 8.2, 5.3) * 0.86 },
    overview: { target: center.clone(), theta: 0.42, phi: 1.36, fit: rackR },
    front: { target: center.clone(), theta: 0.0, phi: 1.5, fit: rackR },
    side: { target: center.clone(), theta: 1.25, phi: 1.42, fit: rackR },
    back: { target: center.clone(), theta: Math.PI - 0.35, phi: 1.38, fit: rackR },
    board: { target: room.anchors.board.clone(), theta: 0.0, phi: 1.52, fit: () => fitBox(3.7, 2.7) },
    desk: { target: room.deskPos.clone().add(new Vector3(0, 0.3, 0)), theta: Math.PI / 2 - 0.35, phi: 1.3, fit: () => fitBox(3.6, 2.8) },
    door: { target: room.anchors.door.clone(), theta: Math.PI / 2 - 0.2, phi: 1.42, fit: () => fitBox(2.4, 3) },
    window: { target: room.anchors.internet.clone().add(new Vector3(0, -0.2, 0.3)), theta: Math.PI / 2, phi: 1.45, fit: () => fitBox(2.6, 1.9) },
  };
  const HOME = "room";
  const sph = new Spherical(6, 1.36, 0.42);
  const target = center.clone();
  const anim = { on: false, t0: 0, dur: 1, from: null, to: null };
  let fitR = 6;

  function fitRadius() {
    const aspect = Math.max(0.3, camera.aspect);
    const vfov = MathUtils.degToRad(camera.fov);
    const needH = (H + BASE + 0.4) / 2 / Math.tan(vfov / 2);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const needW = (W + 0.6) / 2 / Math.tan(hfov / 2);
    return Math.max(needH, needW) * 0.94;
  }

  function flyTo(t, theta, phi, r, dur = 1.1) {
    const to = { target: t.clone(), theta, phi, r };
    // Por el camino más corto alrededor del armario
    let th = sph.theta;
    while (to.theta - th > Math.PI) th += Math.PI * 2;
    while (th - to.theta > Math.PI) th -= Math.PI * 2;
    sph.theta = th;
    if (reduce()) {
      target.copy(to.target);
      sph.set(to.r, to.phi, to.theta);
      anim.on = false;
      wake();
      return;
    }
    anim.from = { target: target.clone(), theta: sph.theta, phi: sph.phi, r: sph.radius };
    anim.to = to;
    anim.t0 = performance.now();
    anim.dur = dur * 1000;
    anim.on = true;
    wake();
  }

  function goView(name, keepNote = false) {
    const v = VIEWS[name] || VIEWS[HOME];
    current = name;
    select(null, true);
    if (!keepNote) activeNote(null);
    flyTo(v.target, v.theta, v.phi, v.fit());
    stage.querySelectorAll("[data-r3-cam]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.r3Cam === name)));
  }

  // ---- selección
  let selected = null;
  let hovered = null;
  let current = HOME;
  let highlight = null; // Set de ids encendidos al filtrar
  const inspected = new Set(opts.inspected || []);
  const card = stage.querySelector("[data-r3-card]");
  const tip = stage.querySelector("[data-r3-tip]");
  const count = stage.querySelector("[data-r3-count]");

  function paintCount() {
    if (count) count.textContent = `${inspected.size}/${N}`;
    stage.style.setProperty("--r3-progress", String(inspected.size / N));
  }
  paintCount();

  function fillCard(u, animate = false) {
    if (!card) return;
    card.hidden = !u;
    if (!u) return;
    const set = (sel, text) => {
      const el = card.querySelector(sel);
      if (el) el.textContent = text;
    };
    set("[data-r3-slot]", u.slot);
    set("[data-r3-title]", u.title);
    set("[data-r3-tagline]", u.tagline);
    set("[data-r3-specs]", u.specs);
    set("[data-r3-state]", u.li.querySelector("[data-ru-state]")?.textContent.trim() || "");
    set("[data-r3-n]", `U${String(u.i + 1).padStart(2, "0")}`);
    card.dataset.status = u.li.classList.contains("live-down") ? "down" : u.li.classList.contains("live-off") ? "off" : u.status;
    const link = card.querySelector("[data-r3-link]");
    if (link) link.href = u.a?.getAttribute("href") || u.url;
    if (!animate) return;
    card.classList.remove("is-new");
    void card.offsetWidth;
    card.classList.add("is-new");
  }

  function select(u, silent = false) {
    if (selected === u) return;
    if (selected) selected.outTo = 0;
    selected = u;
    fillCard(u, true);
    stage.classList.toggle("has-selection", !!u);
    if (!u) {
      spot.intensity = 0;
      stage.dispatchEvent(new CustomEvent("rack3d:select", { bubbles: true, detail: { id: null } }));
      wake();
      return;
    }
    u.outTo = 0.34;
    if (!silent) sound("seek");
    if (!inspected.has(u.id)) {
      inspected.add(u.id);
      paintCount();
      stage.dispatchEvent(new CustomEvent("rack3d:inspected", { bubbles: true, detail: { id: u.id, n: inspected.size, total: N, ids: [...inspected] } }));
    }
    stage.dispatchEvent(new CustomEvent("rack3d:select", { bubbles: true, detail: { id: u.id } }));
    missionCheck("unit", u.id);
    // La cámara, delante y a un lado, con la unidad un poco a la izquierda
    // si la ficha ocupa la derecha.
    // La ficha va abajo: la unidad se queda en el tercio de arriba.
    const y = slotY(u.i + 1);
    const r = camera.aspect < 0.8 ? 3.1 : 2.5;
    const visibleH = 2 * r * Math.tan(MathUtils.degToRad(camera.fov / 2));
    const t = new Vector3(0.08, y - visibleH * 0.3, FRONT + 0.34);
    flyTo(t, 0.36, 1.5, r, 1.0);
    spot.position.set(0.3, y + 0.2, FRONT + 1.1);
    spot.intensity = 2.5;
    current = null;
    stage.querySelectorAll("[data-r3-cam]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  }

  const byId = (id) => units.find((u) => u.id === id);
  function step(d) {
    const i = selected ? selected.i : d > 0 ? -1 : N;
    select(units[(i + d + N) % N]);
  }

  // ---- lo que pasa en la lista se ve en el armario
  function readList() {
    const any = items.some((li) => li.classList.contains("is-match"));
    highlight = any ? new Set(units.filter((u) => u.li.classList.contains("is-match")).map((u) => u.id)) : null;
    for (const u of units) {
      u.glowTo = highlight ? (highlight.has(u.id) ? 1 : 0) : 0;
      u.dim = !!highlight && !highlight.has(u.id);
      u.live = u.li.classList.contains("live-down") ? "down" : u.li.classList.contains("live-off") ? "off" : u.li.classList.contains("live-up") ? "up" : null;
    }
    if (selected) fillCard(selected);
    wake();
  }
  const mo = new MutationObserver(readList);
  items.forEach((li) => mo.observe(li, { attributes: true, attributeFilter: ["class"] }));
  items.forEach((li) => {
    const st = li.querySelector("[data-ru-state]");
    if (st) mo.observe(st, { childList: true, characterData: true, subtree: true });
  });
  readList();

  // ---- ratón, dedo y teclado
  const ray = new Raycaster();
  const ndc = new Vector2();
  const el = renderer.domElement;
  let drag = null;
  let lastInput = performance.now();

  function pick(ev) {
    const r = el.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false).find((h) => h.object.visible && h.object.parent?.visible !== false && isShown(h.object));
    return hit ? hit.object.userData.unit || hit.object.userData.obj : null;
  }
  // ¿Se ve? (las paredes de detrás se esconden con lo que cuelga de ellas)
  function isShown(o) {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  function showTip(u, ev) {
    if (!tip) return;
    tip.hidden = !u || !!drag?.moved;
    if (!u) return;
    tip.textContent = u.kind ? u.label : u.slot + (u.title ? " — " + u.title : "");
    const r = stage.getBoundingClientRect();
    tip.style.setProperty("--x", `${ev.clientX - r.left}px`);
    tip.style.setProperty("--y", `${ev.clientY - r.top}px`);
  }

  el.addEventListener("pointerdown", (ev) => {
    drag = { x: ev.clientX, y: ev.clientY, theta: sph.theta, phi: sph.phi, moved: false, id: ev.pointerId, touch: ev.pointerType === "touch" };
    anim.on = false;
    lastInput = performance.now();
  });
  addEventListener("pointermove", (ev) => {
    if (drag && ev.pointerId === drag.id) {
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      // Con el dedo, un gesto vertical es para bajar por la página.
      if (!drag.moved && drag.touch && Math.abs(dy) > Math.abs(dx)) {
        drag = null;
        return;
      }
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) {
        sph.theta = drag.theta - dx * 0.008;
        sph.phi = clamp(drag.phi - dy * 0.006, 0.45, 1.68);
        stage.classList.add("is-dragging");
        current = null;
        lastInput = performance.now();
        wake();
      }
      return;
    }
    if (ev.target !== el) return;
    const u = pick(ev);
    if (u !== hovered) {
      if (hovered) hovered.hover = false;
      hovered = u;
      if (u) {
        u.hover = true;
        sound("tick");
      }
      el.classList.toggle("is-pointing", !!u);
      wake();
    }
    showTip(u, ev);
  });
  addEventListener("pointerup", (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    stage.classList.remove("is-dragging");
    if (moved || ev.target !== el) return;
    const u = pick(ev);
    if (u?.kind) act(u);
    else if (u) select(u === selected ? null : u);
    else if (selected) select(null);
  });
  el.addEventListener("pointerleave", () => {
    if (hovered) hovered.hover = false;
    hovered = null;
    if (tip) tip.hidden = true;
    el.classList.remove("is-pointing");
    wake();
  });
  el.addEventListener("dblclick", (ev) => {
    const u = pick(ev);
    if (u && !u.kind) location.href = u.a?.getAttribute("href") || u.url;
  });
  // Rueda: solo con el puntero encima y sin robar el scroll de la página
  // salvo para acercar o alejar de verdad.
  el.addEventListener("wheel", (ev) => {
    if (!ev.ctrlKey && !stage.classList.contains("is-engaged")) return;
    ev.preventDefault();
    zoom(ev.deltaY > 0 ? 1.12 : 0.89);
  }, { passive: false });
  el.addEventListener("pointerdown", () => stage.classList.add("is-engaged"));
  stage.addEventListener("pointerleave", () => stage.classList.remove("is-engaged"));

  function zoom(f) {
    anim.on = false;
    sph.radius = clamp(sph.radius * f, 1.2, VIEWS[HOME].fit() * 1.25);
    lastInput = performance.now();
    wake();
  }

  stage.querySelectorAll("[data-r3-cam]").forEach((b) => b.addEventListener("click", () => {
    sound("hop");
    goView(b.dataset.r3Cam);
  }));
  stage.querySelectorAll("[data-r3-zoom]").forEach((b) => b.addEventListener("click", () => zoom(b.dataset.r3Zoom === "in" ? 0.8 : 1.25)));
  stage.querySelector("[data-r3-close]")?.addEventListener("click", () => goView(HOME));
  stage.querySelector("[data-r3-prev]")?.addEventListener("click", () => step(-1));
  stage.querySelector("[data-r3-next]")?.addEventListener("click", () => step(1));

  // La lista sigue siendo la forma de llegar con el teclado: al enfocar una
  // fila, su unidad sale en el armario.
  units.forEach((u) => u.a?.addEventListener("focus", () => select(u, true)));
  stage.addEventListener("keydown", (ev) => {
    if (ev.target.closest("input, textarea")) return;
    if (ev.key === "Escape" && (selected || current !== HOME)) {
      goView(HOME);
      ev.preventDefault();
    } else if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && ev.target === el.parentElement) {
      step(ev.key === "ArrowDown" ? 1 : -1);
      ev.preventDefault();
    }
  });

  // ---- recorrido guiado: la cámara pasa por varias unidades sola
  let tour = null;
  function tourStop() {
    if (!tour) return;
    clearTimeout(tour.timer);
    tour = null;
    stage.classList.remove("is-touring");
    stage.querySelector("[data-r3-tour]")?.setAttribute("aria-pressed", "false");
  }
  function tourNext() {
    if (!tour) return;
    if (tour.k >= tour.ids.length) {
      tourStop();
      goView(HOME);
      return;
    }
    const u = byId(tour.ids[tour.k++]);
    if (u) select(u);
    tour.timer = setTimeout(tourNext, reduce() ? 6000 : 4200);
  }
  function tourStart(ids) {
    tourStop();
    tour = { ids: ids?.length ? ids : units.filter((u) => u.status === "live").slice(0, 8).map((u) => u.id), k: 0, timer: 0 };
    stage.classList.add("is-touring");
    stage.querySelector("[data-r3-tour]")?.setAttribute("aria-pressed", "true");
    tourNext();
  }
  stage.querySelector("[data-r3-tour]")?.addEventListener("click", () => (tour ? tourStop() : tourStart(opts.tour)));
  el.addEventListener("pointerdown", tourStop);

  // ---- tocar las cosas de la sala
  const send = (name, detail = {}) => stage.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  let noteOn = null;
  function activeNote(id) {
    for (const o of room.notes) o.active = o.id === id;
    noteOn = id;
    wake();
  }
  // Vuela al tablero y destaca la nota; `scroll` pide a la página que baje
  // hasta esa zona.
  function showNote(id, scroll = true) {
    if (!room.notes.some((o) => o.id === id)) return false;
    if (current !== "board") goView("board", true);
    activeNote(id);
    if (scroll) send("rack3d:note", { id });
    return true;
  }
  function act(o) {
    sound("hop");
    lastInput = performance.now();
    tourStop();
    switch (o.kind) {
      case "note":
        showNote(o.id);
        missionCheck("note", o.id);
        break;
      case "photo":
        showNote("about");
        missionCheck("note", "about");
        break;
      case "cv":
        goView("board");
        send("rack3d:cv");
        break;
      case "terminal":
        goView("desk");
        setTimeout(() => send("rack3d:terminal"), reduce() ? 0 : 900);
        break;
      case "phone":
        goView("desk");
        setTimeout(() => send("rack3d:contact"), reduce() ? 0 : 700);
        break;
      case "pc":
        playFlow("ask");
        break;
      case "window":
        playFlow("visit");
        break;
      case "gnome": {
        // Dormido se despierta enfadado; de día, a la tercera se harta
        const mood = gnomes.poke(o.gnome);
        const lines = opts.gnomeLines || {};
        const pool = { wake: lines.angry, angry: lines.angry, fed_up: lines.fed_up }[mood] || lines.click;
        if (pool?.length) say(o.gnome, pool[Math.floor(Math.random() * pool.length)], mood !== "click");
        send("rack3d:gnome", { mood });
        break;
      }
      case "door":
        goView("door");
        room.door.openTo = 1;
        setTimeout(() => { if (opts.blogUrl) location.href = opts.blogUrl; }, reduce() ? 200 : 1300);
        break;
    }
    missionCheck(o.kind, o.id);
  }

  // Bocadillo de un enanito, pegado encima de su gorro
  const bubble = document.createElement("div");
  bubble.className = "r3-say";
  bubble.hidden = true;
  view.append(bubble);
  let talker = null;
  let talkUntil = 0;
  const headV = new Vector3();
  function say(g, text, angry = false) {
    talker = g;
    bubble.textContent = text;
    bubble.classList.toggle("is-angry", angry);
    bubble.hidden = false;
    talkUntil = performance.now() + (angry ? 4500 : 3200);
    wake();
  }
  function sayTick(now) {
    if (!talker) return false;
    if (now > talkUntil || !gnomes.visible) {
      talker = null;
      bubble.hidden = true;
      return false;
    }
    headV.copy(gnomes.headOf(talker)).project(camera);
    bubble.style.setProperty("--x", `${((headV.x + 1) / 2) * view.clientWidth}px`);
    bubble.style.setProperty("--y", `${((1 - headV.y) / 2) * view.clientHeight}px`);
    return true;
  }

  // ---- recorridos: un paquete de luz viaja por la sala paso a paso
  const flows = opts.flows || [];
  const nodeUnit = opts.nodeUnit || {};
  const nodeTitle = opts.nodeTitle || {};
  const caption = stage.querySelector("[data-r3-caption]");
  const capSet = (sel, text) => {
    const e = caption?.querySelector(sel);
    if (e) e.textContent = text;
  };
  const pktMesh = new Mesh(new SphereGeometry(0.07, 16, 12), new MeshBasicMaterial({ color: 0xe0f2fe }));
  const TRAIL = 14;
  const trailPos = new Float32Array(TRAIL * 3);
  const trailGeo = new BufferGeometry();
  trailGeo.setAttribute("position", new BufferAttribute(trailPos, 3));
  const trail = new Points(trailGeo, new PointsMaterial({ size: 0.32, map: sprite, color: 0x38bdf8, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  trail.frustumCulled = false;
  const pktLight = new PointLight(0x38bdf8, 0, 2.2);
  pktMesh.visible = trail.visible = false;
  scene.add(pktMesh, trail, pktLight);
  let player = null;

  function anchorFor(node) {
    if (room.anchors[node]) return room.anchors[node].clone();
    const u = byId(nodeUnit[node]);
    if (u) return new Vector3(0.25, slotY(u.i + 1), FRONT + 0.32);
    return room.anchors.internet.clone();
  }
  function hotOff() {
    for (const u of units) u.hot = false;
    for (const m of room.objects) m.userData.obj.active = m.userData.obj.kind === "note" && m.userData.obj.id === noteOn;
  }
  function hotOn(node) {
    const u = byId(nodeUnit[node]);
    if (u && !room.anchors[node]) u.hot = true;
    const kind = { internet: "window", cloudflare: "window", movil: "phone", pc: "pc", casa: "terminal" }[node];
    if (kind) for (const m of room.objects) if (m.userData.obj.kind === kind) m.userData.obj.active = true;
  }
  function stepTo(i) {
    const f = player.f;
    i = clamp(i, 0, f.path.length - 1);
    player.i = i;
    const from = anchorFor(f.path[Math.max(0, i - 1)]);
    const to = anchorFor(f.path[i]);
    const mid = from.clone().lerp(to, 0.5);
    mid.y += 0.5 + from.distanceTo(to) * 0.18;
    player.curve = new QuadraticBezierCurve3(from, mid, to);
    player.t = i === 0 ? 1 : 0;
    player.hold = 0;
    hotOff();
    hotOn(f.path[i]);
    capSet("[data-r3-cap-step]", (L.flow_step || "{n}/{total}").replace("{n}", i + 1).replace("{total}", f.path.length));
    capSet("[data-r3-cap-node]", nodeTitle[f.path[i]] || f.path[i]);
    capSet("[data-r3-cap-text]", f.steps[i] || "");
    caption?.classList.remove("is-new");
    void caption?.offsetWidth;
    caption?.classList.add("is-new");
    sound("tick");
    wake();
  }
  function playFlow(id) {
    const f = flows.find((x) => x.id === id);
    if (!f || !caption) return;
    tourStop();
    if (current !== HOME) goView(HOME);
    else select(null, true);
    player = { f, i: 0, t: 1, hold: 0, playing: true, curve: null };
    caption.hidden = false;
    capSet("[data-r3-cap-title]", f.title);
    stage.classList.add("is-playing");
    pktMesh.visible = trail.visible = true;
    pktLight.intensity = 2;
    const p0 = anchorFor(f.path[0]);
    for (let k = 0; k < TRAIL; k++) trailPos.set([p0.x, p0.y, p0.z], k * 3);
    paintPlay();
    stepTo(0);
    send("rack3d:flow", { id });
    missionCheck("flow", id);
  }
  function stopFlow(finished = false) {
    if (!player) return;
    const id = player.f.id;
    player = null;
    hotOff();
    if (caption) caption.hidden = true;
    stage.classList.remove("is-playing");
    pktMesh.visible = trail.visible = false;
    pktLight.intensity = 0;
    wake();
  }
  function paintPlay() {
    const b = caption?.querySelector("[data-r3-cap-play]");
    if (b && player) {
      b.textContent = player.playing ? "⏸" : "▶";
      b.setAttribute("aria-label", player.playing ? L.pause || "" : L.play || "");
    }
  }
  caption?.querySelector("[data-r3-cap-close]")?.addEventListener("click", () => stopFlow());
  caption?.querySelector("[data-r3-cap-play]")?.addEventListener("click", () => {
    if (!player) return;
    player.playing = !player.playing;
    paintPlay();
    wake();
  });
  caption?.querySelector("[data-r3-cap-next]")?.addEventListener("click", () => {
    if (!player) return;
    if (player.i >= player.f.path.length - 1) return stopFlow(true);
    stepTo(player.i + 1);
  });
  caption?.querySelector("[data-r3-cap-prev]")?.addEventListener("click", () => player && stepTo(player.i - 1));

  // Avanza el paquete; devuelve true mientras haya algo que animar.
  function playerTick(now, dt, still) {
    if (!player) return false;
    const p = player;
    if (p.t < 1) {
      p.t = still ? 1 : Math.min(1, p.t + dt / 0.9);
    } else if (p.playing) {
      p.hold += dt;
      const need = Math.max(2.4, (p.f.steps[p.i] || "").length * 0.045);
      if (p.hold > need) {
        if (p.i >= p.f.path.length - 1) {
          stopFlow(true);
          return true;
        }
        stepTo(p.i + 1);
      }
    }
    const pos = p.curve.getPoint(ease(p.t));
    pktMesh.position.copy(pos);
    pktLight.position.copy(pos);
    pktMesh.scale.setScalar(1 + 0.25 * Math.sin(now / 120));
    trailPos.copyWithin(3, 0, (TRAIL - 1) * 3);
    trailPos[0] = pos.x;
    trailPos[1] = pos.y;
    trailPos[2] = pos.z;
    trailGeo.attributes.position.needsUpdate = true;
    return true;
  }

  // La lista de recorridos vive en el laboratorio; el botón lo abre.
  stage.querySelector("[data-r3-flows]")?.addEventListener("click", () => send("rack3d:note", { id: "lab" }));

  // ---- misión para quien tiene poco tiempo: cuatro retos guiados
  const M = opts.mission || [];
  const mPanel = stage.querySelector("[data-r3-mission]");
  const mDone = stage.querySelector("[data-r3-mission-done]");
  let mission = null;
  function pulse(target, on) {
    if (!target) return;
    if (target.kind === "unit") {
      const u = byId(target.id);
      if (u) u.pulse = on;
    } else {
      const kind = target.kind === "flow" ? "window" : target.kind;
      for (const m of room.objects) {
        const o = m.userData.obj;
        if (o.kind === kind && (kind !== "note" || o.id === target.id)) o.pulse = on;
      }
    }
    wake();
  }
  function missionShow() {
    const st = M[mission.k];
    const set = (sel, t) => {
      const e = mPanel.querySelector(sel);
      if (e) e.textContent = t;
    };
    set("[data-r3-m-step]", (L.mission_step || "{n}/{total}").replace("{n}", mission.k + 1).replace("{total}", M.length));
    set("[data-r3-m-text]", st.text);
    const hint = mPanel.querySelector("[data-r3-m-hint]");
    hint.textContent = st.hint;
    hint.hidden = true;
    mission.busy = false;
    mPanel.classList.remove("is-ok", "is-new");
    void mPanel.offsetWidth;
    mPanel.classList.add("is-new");
    clearTimeout(mission.timer);
    mission.timer = setTimeout(() => {
      hint.hidden = false;
      pulse(st.target, true);
    }, 12000);
  }
  function missionStart() {
    if (!mPanel || !M.length) return;
    stopFlow();
    goView(HOME);
    mission = { k: 0, timer: 0 };
    mPanel.hidden = false;
    if (mDone) mDone.hidden = true;
    stage.classList.add("is-mission");
    missionShow();
    send("rack3d:mission", { state: "start" });
  }
  function missionEnd(done) {
    if (!mission) return;
    clearTimeout(mission.timer);
    for (const st of M) pulse(st.target, false);
    mission = null;
    mPanel.hidden = true;
    stage.classList.remove("is-mission");
    if (done && mDone) {
      mDone.hidden = false;
      sound("achievement");
      send("rack3d:mission", { state: "done" });
    }
  }
  function missionCheck(kind, id) {
    if (!mission || mission.busy || mission.k >= M.length) return;
    const t = M[mission.k].target;
    // La ventana también vale lanzando «tu visita» desde el menú (teclado).
    const ok = (t.kind === kind && t.id === id) || (t.kind === "window" && kind === "flow" && id === "visit");
    if (!ok) return;
    pulse(t, false);
    clearTimeout(mission.timer);
    mPanel.classList.add("is-ok");
    mission.busy = true;
    sound("ok");
    mission.k += 1;
    mission.timer = setTimeout(() => (mission && mission.k >= M.length ? missionEnd(true) : mission && missionShow()), 1400);
  }
  stage.querySelector("[data-r3-mission-start]")?.addEventListener("click", () => (mission ? missionEnd(false) : missionStart()));
  mPanel?.querySelector("[data-r3-m-skip]")?.addEventListener("click", () => missionEnd(false));
  mDone?.querySelector("[data-r3-m-close]")?.addEventListener("click", () => {
    mDone.hidden = true;
  });

  // ---- hoja abierta encima: el centro de la imagen se corre para que lo
  // que se enseña quede en la parte libre (dx a la izquierda, dy arriba).
  const shift = { x: 0, y: 0, tx: 0, ty: 0 };
  function inset(dx, dy) {
    shift.tx = dx || 0;
    shift.ty = dy || 0;
    if (reduce()) {
      shift.x = shift.tx;
      shift.y = shift.ty;
      applyShift();
    }
    wake();
  }
  function applyShift() {
    const w = view.clientWidth;
    const h = view.clientHeight;
    if (!w || !h) return;
    if (Math.abs(shift.x) < 0.5 && Math.abs(shift.y) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(w, h, shift.x, shift.y, w, h);
  }
  function shiftTick(dt) {
    if (Math.abs(shift.x - shift.tx) < 0.5 && Math.abs(shift.y - shift.ty) < 0.5) {
      if (shift.x !== shift.tx || shift.y !== shift.ty) {
        shift.x = shift.tx;
        shift.y = shift.ty;
        applyShift();
      }
      return false;
    }
    const k = Math.min(1, dt * 7);
    shift.x += (shift.tx - shift.x) * k;
    shift.y += (shift.ty - shift.y) * k;
    applyShift();
    return true;
  }

  // ---- tamaño
  function resize() {
    const w = view.clientWidth;
    const h = view.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    applyShift();
    camera.updateProjectionMatrix();
    fitR = fitRadius();
    if (!selected && current && VIEWS[current] && !anim.on) sph.radius = VIEWS[current].fit();
    wake();
  }
  new ResizeObserver(resize).observe(view);

  // ---- calidad automática: si dibujar cuesta, primero menos píxeles y
  // luego sin sombras (portátiles con gráfica integrada, software).
  // Mide el intervalo entre fotogramas (a 30 fps en reposo son ~33 ms).
  const costs = [];
  let chain = false; // ¿este fotograma viene justo después de otro?
  let level = 0;
  function adapt(ms) {
    if (level >= 3) return;
    costs.push(ms);
    if (costs.length < 6) return;
    costs.sort((a, b) => a - b);
    const med = costs[costs.length >> 1];
    costs.length = 0;
    if (med < 50) return;
    level += 1;
    if (level === 1 && renderer.getPixelRatio() <= 1) level = 2;
    if (level === 1) renderer.setPixelRatio(1);
    else if (level === 2) {
      renderer.shadowMap.enabled = false;
      key.castShadow = false;
      scene.traverse((o) => {
        if (o.material) for (const m of [o.material].flat()) m.needsUpdate = true;
      });
    } else renderer.setPixelRatio(0.6);
    resize();
  }

  // ---- bucle: solo dibuja cuando se ve, y a 30 fps si no pasa nada
  function wake() {
    dirty = true;
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(tick);
  }
  new IntersectionObserver((es) => {
    visible = es[0].isIntersecting;
    if (visible) wake();
  }).observe(view);
  document.addEventListener("visibilitychange", () => !document.hidden && wake());

  function tick(now) {
    raf = 0;
    // rAF puede dar una marca anterior a la última performance.now()
    const gap = now - last;
    const dt = clamp(gap / 1000, 0, 0.05);
    last = now;
    const chained = chain;
    chain = false;
    const still = reduce();
    let busy = false;

    if (anim.on) {
      const k = clamp((now - anim.t0) / anim.dur, 0, 1);
      const e = ease(k);
      target.lerpVectors(anim.from.target, anim.to.target, e);
      sph.theta = MathUtils.lerp(anim.from.theta, anim.to.theta, e);
      sph.phi = MathUtils.lerp(anim.from.phi, anim.to.phi, e);
      sph.radius = MathUtils.lerp(anim.from.r, anim.to.r, e);
      if (k >= 1) anim.on = false;
      busy = true;
    } else if (!still && !selected && !drag && !player && (current === HOME || current === "overview") && now - lastInput > 5000) {
      // Al rato sin tocar nada, la cámara se balancea despacio.
      const amp = current === HOME ? 0.22 : 0.42;
      sph.theta = VIEWS[current].theta + Math.sin((now - lastInput - 5000) / 5200) * amp;
      busy = true;
    }

    for (const u of units) {
      const out = u.outTo + (u.hover && u !== selected ? 0.05 : 0) + (u.hot && u !== selected ? 0.12 : 0);
      if (Math.abs(u.out - out) > 0.0005) {
        u.out += (out - u.out) * Math.min(1, dt * (still ? 60 : 9));
        busy = true;
      } else u.out = out;
      u.mesh.position.z = u.baseZ + u.out;
      const g = Math.max(u.glowTo, u.hover ? 0.55 : 0, u === selected ? 0.8 : 0, u.hot ? 0.9 : 0, u.pulse ? 0.4 + 0.4 * Math.sin(now / 220) : 0);
      if (u.pulse) busy = true;
      if (Math.abs(u.glow - g) > 0.002) {
        u.glow += (g - u.glow) * Math.min(1, dt * 8);
        busy = true;
      }
      u.face.emissiveIntensity = u.glow * 0.55;
      u.face.color.setScalar(u.dim ? 0.35 : 1);
    }

    // LED: estado fijo y actividad que parpadea
    for (const u of units) {
      const y = slotY(u.i + 1);
      const z = u.mesh.position.z + D / 2 + 0.004;
      for (let k = 0; k < 2; k++) {
        const j = (u.i * 2 + k) * 3;
        ledPos[j] = ledX(k);
        ledPos[j + 1] = y;
        ledPos[j + 2] = z;
        let c;
        if (k === 0) {
          c = u.live === "down" ? COLORS.down : u.live === "off" || u.status === "retired" ? COLORS.off : u.status === "lab" ? COLORS.lab : COLORS.up;
          let a = 1;
          if (u.live === "down") a = still ? 1 : 0.35 + 0.65 * (Math.sin(now / 160) > 0 ? 1 : 0);
          tmp.set(c).multiplyScalar(a * (u.dim ? 0.3 : 1));
        } else {
          const on = u.live !== "off" && u.status !== "retired" && (still ? true : Math.sin(now / (90 + (u.i % 7) * 23) + u.i * 1.7) > 0.35);
          tmp.set(COLORS.activity).multiplyScalar(on ? (u.dim ? 0.25 : 0.9) : 0.08);
        }
        ledCol[j] = tmp.r;
        ledCol[j + 1] = tmp.g;
        ledCol[j + 2] = tmp.b;
      }
    }
    ledGeo.attributes.position.needsUpdate = true;
    ledGeo.attributes.color.needsUpdate = true;
    if (!still) busy = true; // parpadeo

    // Paquetes por los cables
    for (let k = 0; k < PKT; k++) {
      const p = pktState[k];
      if (!still) p.t += dt * p.v;
      if (p.t > 1) {
        p.t = 0;
        p.c = (p.c + 5) % N;
      }
      const v = cables[p.c].getPointAt(clamp(p.t, 0, 1));
      pktPos[k * 3] = v.x;
      pktPos[k * 3 + 1] = v.y;
      pktPos[k * 3 + 2] = v.z;
    }
    pktGeo.attributes.position.needsUpdate = true;

    if (playerTick(now, dt, still)) busy = true;
    if (shiftTick(dt)) busy = true;
    if (gnomes.update(dt, now, still, camera.position)) busy = true;

    camera.position.setFromSpherical(sph).add(target);
    camera.lookAt(target);
    if (room.update(camera.position, dt)) busy = true;
    if (sayTick(now)) busy = true;

    // Con todo quieto, se dibuja a 30 fps (los LED no necesitan más).
    const needFull = anim.on || drag || dirty;
    if (needFull || now - lastDraw > 33) {
      // render() vuelve antes de que la GPU acabe: lo que mide el coste de
      // verdad es el tiempo entre fotogramas seguidos.
      if (chained) adapt(gap);
      renderer.render(scene, camera);
      lastDraw = now;
      dirty = false;
    }
    if (busy && visible && !document.hidden) {
      raf = requestAnimationFrame(tick);
      chain = true;
    }
  }

  applyTime();
  setInterval(applyTime, 60000);
  resize();
  sph.radius = VIEWS[HOME].fit();
  goView(HOME);
  stage.classList.add("is-3d");
  if (opts.focus && byId(opts.focus)) setTimeout(() => select(byId(opts.focus), true), 400);

  return {
    focus(id) {
      tourStop();
      const u = byId(id);
      if (u) select(u);
    },
    view(name) {
      tourStop();
      if (player || mission) return;
      if (name.startsWith("note:")) return showNote(name.slice(5), false);
      if (VIEWS[name] && name !== current) goView(name);
    },
    note(id) {
      tourStop();
      if (player || mission) return activeNote(id);
      return showNote(id, false);
    },
    inset,
    gnomes(on) {
      gnomes.visible = on;
      wake();
    },
    mark(id) {
      if (!player && !mission) activeNote(id);
    },
    play: playFlow,
    mission: missionStart,
    tour: tourStart,
    get selected() {
      return selected?.id || null;
    },
  };
}
