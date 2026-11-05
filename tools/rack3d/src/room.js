// La sala alrededor del rack: paredes, el tablero de corcho con las notas,
// la mesa con la terminal, el teléfono y el PC, la ventana a Internet y la
// puerta al blog. Todo lo que se puede tocar lleva userData.obj.
//
// Las paredes son planos que solo se ven por dentro: al girar la cámara
// detrás de una, desaparece (como una casa de muñecas) con lo que cuelga de
// ella.

import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from "three";

const MONO = 'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace';
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

// Medidas de la sala (el rack mide ~3,2 de alto y está en el origen)
// Diorama visto desde la esquina: se ven la pared del fondo (tablero) y la
// de la izquierda (mesa, ventana y puerta); el rack queda cerca de la derecha.
export const ROOM = { left: -5.2, right: 2.2, back: -1.6, front: 3.2, h: 4.6 };

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
function tex(c, repeat) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// Parte el texto en líneas que quepan en `max` píxeles.
function wrap(g, text, max) {
  const out = [];
  let line = "";
  for (const w of String(text).split(/\s+/)) {
    const t = line ? line + " " + w : w;
    if (g.measureText(t).width > max && line) {
      out.push(line);
      line = w;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

function wallTexture() {
  const c = canvas(256, 256);
  const g = c.getContext("2d");
  g.fillStyle = "#121a29";
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(148,163,184,.09)";
  g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  g.fillStyle = "rgba(255,255,255,.025)";
  g.fillRect(0, 0, 256, 128);
  return tex(c, [8, 4]);
}

function floorTexture() {
  const c = canvas(256, 256);
  const g = c.getContext("2d");
  g.fillStyle = "#0b111c";
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(45,212,191,.16)";
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  g.fillStyle = "rgba(148,163,184,.05)";
  for (let i = 0; i < 6; i++) g.fillRect(40 + i * 32, 120, 14, 14);
  return tex(c, [9, 6]);
}

function corkTexture() {
  const c = canvas(256, 256);
  const g = c.getContext("2d");
  g.fillStyle = "#b07a45";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = Math.random() < 0.5 ? "rgba(80,45,15,.35)" : "rgba(255,230,190,.22)";
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.6, 1.6);
  }
  return tex(c, [3, 2]);
}

// Una nota de papel con su título (y una línea pequeña debajo).
function noteTexture(title, sub, bg, ink = "#1d2433") {
  const c = canvas(320, 256);
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, 320, 256);
  g.fillStyle = "rgba(0,0,0,.08)";
  g.fillRect(0, 0, 320, 18);
  g.fillStyle = ink;
  g.font = `800 40px ${SANS}`;
  g.textBaseline = "top";
  let y = 54;
  for (const l of wrap(g, title, 280).slice(0, 2)) {
    g.fillText(l, 20, y);
    y += 46;
  }
  if (sub) {
    g.font = `500 24px ${SANS}`;
    g.fillStyle = "rgba(29,36,51,.75)";
    for (const l of wrap(g, sub, 280).slice(0, 3)) {
      g.fillText(l, 20, y + 8);
      y += 30;
    }
  }
  return tex(c);
}

function photoTexture(name, role) {
  const c = canvas(256, 320);
  const g = c.getContext("2d");
  g.fillStyle = "#fbfaf6";
  g.fillRect(0, 0, 256, 320);
  const grad = g.createLinearGradient(0, 0, 0, 220);
  grad.addColorStop(0, "#2dd4bf");
  grad.addColorStop(1, "#4f46e5");
  g.fillStyle = grad;
  g.fillRect(16, 16, 224, 200);
  g.fillStyle = "#fff";
  g.font = `900 92px ${SANS}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("TP", 128, 118);
  g.fillStyle = "#1d2433";
  g.font = `800 24px ${SANS}`;
  g.fillText(name, 128, 248);
  g.font = `500 17px ${SANS}`;
  g.fillStyle = "#566074";
  wrap(g, role, 220).slice(0, 2).forEach((l, i) => g.fillText(l, 128, 276 + i * 20));
  return tex(c);
}

function screenTexture(lines) {
  const c = canvas(512, 320);
  const g = c.getContext("2d");
  g.fillStyle = "#0a0f19";
  g.fillRect(0, 0, 512, 320);
  g.fillStyle = "#16233a";
  g.fillRect(0, 0, 512, 28);
  ["#f87171", "#fbbf24", "#4ade80"].forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(18 + i * 18, 14, 5, 0, Math.PI * 2);
    g.fill();
  });
  g.font = `600 20px ${MONO}`;
  g.textBaseline = "top";
  lines.forEach((l, i) => {
    g.fillStyle = l.startsWith("$") ? "#2dd4bf" : "#c7d2e4";
    g.fillText(l, 16, 44 + i * 28);
  });
  return tex(c);
}

function skyTexture(labels) {
  const c = canvas(512, 352);
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 352);
  grad.addColorStop(0, "#0b1430");
  grad.addColorStop(0.7, "#1f2b5c");
  grad.addColorStop(1, "#3b2f63");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 352);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.6})`;
    g.fillRect(Math.random() * 512, Math.random() * 220, 1.6, 1.6);
  }
  // Ciudad
  g.fillStyle = "#070b18";
  let x = 0;
  while (x < 512) {
    const w = 24 + Math.random() * 40;
    const h = 40 + Math.random() * 90;
    g.fillRect(x, 352 - h, w, h);
    g.fillStyle = "rgba(251,191,36,.6)";
    for (let k = 0; k < 6; k++) if (Math.random() < 0.5) g.fillRect(x + 4 + Math.random() * (w - 10), 352 - h + 8 + Math.random() * (h - 16), 3, 4);
    g.fillStyle = "#070b18";
    x += w + 2;
  }
  // Nube (Cloudflare) y el planeta (Internet)
  g.fillStyle = "rgba(249,115,22,.9)";
  for (const [cx, cy, r] of [[150, 96, 34], [190, 80, 42], [232, 98, 30], [190, 110, 30]]) {
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#fff";
  g.font = `700 20px ${SANS}`;
  g.textAlign = "center";
  g.fillText(labels.cloud, 190, 160);
  g.strokeStyle = "#7dd3fc";
  g.lineWidth = 4;
  g.beginPath();
  g.arc(400, 92, 44, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.ellipse(400, 92, 18, 44, 0, 0, Math.PI * 2);
  g.moveTo(356, 92);
  g.lineTo(444, 92);
  g.stroke();
  g.fillText(labels.internet, 400, 162);
  return tex(c);
}

function signTexture(text, color = "#2dd4bf") {
  const c = canvas(256, 80);
  const g = c.getContext("2d");
  g.fillStyle = "#0b111c";
  g.fillRect(0, 0, 256, 80);
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.strokeRect(4, 4, 248, 72);
  g.fillStyle = color;
  g.font = `800 38px ${MONO}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 42);
  return tex(c);
}

const PAPER = ["#fff3a6", "#c9f0ff", "#ffd6e5", "#d7f7c8", "#fffdf6", "#ffe4c4"];

// opts.labels: textos; opts.zones: [{id, title}]
export function buildRoom(scene, opts) {
  const L = opts.labels;
  const objects = [];
  const anchors = {};
  const walls = { back: new Group(), left: new Group(), right: new Group() };
  for (const w of Object.values(walls)) scene.add(w);
  const W = ROOM.right - ROOM.left;
  const cx = (ROOM.left + ROOM.right) / 2;

  // Material que se ilumina al pasar por encima (emissive)
  const hl = (m, color = 0x2dd4bf) => {
    m.emissive = new Color(color);
    m.emissiveIntensity = 0;
    return m;
  };
  function obj(mesh, data, mats) {
    mesh.userData.obj = { ...data, mats: mats || [mesh.material].flat(), glow: 0, mesh };
    objects.push(mesh);
    return mesh.userData.obj;
  }

  // ---- suelo y paredes
  const floor = new Mesh(new PlaneGeometry(W, ROOM.front - ROOM.back), new MeshLambertMaterial({ map: floorTexture() }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, (ROOM.front + ROOM.back) / 2);
  floor.receiveShadow = true;
  scene.add(floor);
  // Suelo y paredes ocupan casi toda la pantalla: material barato (sin PBR).
  const wallMat = new MeshLambertMaterial({ map: wallTexture() });
  const back = new Mesh(new PlaneGeometry(W, ROOM.h), wallMat);
  back.position.set(cx, ROOM.h / 2, ROOM.back);
  back.receiveShadow = true;
  walls.back.add(back);
  const depth = ROOM.front - ROOM.back;
  const left = new Mesh(new PlaneGeometry(depth, ROOM.h), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(ROOM.left, ROOM.h / 2, ROOM.back + depth / 2);
  walls.left.add(left);
  const right = new Mesh(new PlaneGeometry(depth, ROOM.h), wallMat);
  right.rotation.y = -Math.PI / 2;
  right.position.set(ROOM.right, ROOM.h / 2, ROOM.back + depth / 2);
  walls.right.add(right);
  // Rodapié con una línea de luz
  const strip = new MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.55 });
  const sb = new Mesh(new BoxGeometry(W, 0.02, 0.02), strip);
  sb.position.set(cx, 0.08, ROOM.back + 0.02);
  walls.back.add(sb);

  // ---- tablero de corcho en la pared del fondo
  const board = new Group();
  const BW = 3.5;
  const BH = 1.9;
  board.position.set(-2.9, 2.35, ROOM.back + 0.05);
  walls.back.add(board);
  const frame = new Mesh(new BoxGeometry(BW + 0.16, BH + 0.16, 0.06), new MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.7 }));
  frame.castShadow = true;
  board.add(frame);
  const cork = new Mesh(new PlaneGeometry(BW, BH), new MeshLambertMaterial({ map: corkTexture() }));
  cork.position.z = 0.032;
  board.add(cork);
  anchors.board = board.localToWorld(new Vector3(0, 0, 0.1));
  const notes = [];
  const zones = opts.zones || [];
  const NW = 0.72;
  const NH = 0.56;
  const cols = 3;
  zones.slice(0, 6).forEach((z, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const mat = hl(new MeshStandardMaterial({ map: noteTexture(z.title, z.sub, PAPER[i % PAPER.length]), roughness: 0.9 }), 0xfbbf24);
    const m = new Mesh(new PlaneGeometry(NW, NH), mat);
    m.position.set(-BW / 2 + 0.5 + col * 0.84, BH / 2 - 0.45 - row * 0.74, 0.04 + i * 0.001);
    m.rotation.z = ((i * 37) % 7 - 3) * 0.018;
    m.castShadow = true;
    board.add(m);
    const pin = new Mesh(new CylinderGeometry(0.035, 0.035, 0.03, 12), new MeshStandardMaterial({ color: [0xe23b3b, 0x2563eb, 0xf59e0b, 0x16a34a][i % 4], roughness: 0.4 }));
    pin.rotation.x = Math.PI / 2;
    pin.position.set(m.position.x, m.position.y + NH / 2 - 0.06, 0.06);
    board.add(pin);
    const o = obj(m, { kind: "note", id: z.id, label: z.title, base: m.position.clone() });
    notes.push(o);
    anchors["note:" + z.id] = board.localToWorld(m.position.clone().add(new Vector3(0, 0, 0.05)));
  });
  // Foto de carné y el CV
  const photo = new Mesh(new PlaneGeometry(0.42, 0.52), hl(new MeshStandardMaterial({ map: photoTexture(L.name, L.role), roughness: 0.8 })));
  photo.position.set(BW / 2 - 0.36, 0.42, 0.045);
  photo.rotation.z = 0.05;
  board.add(photo);
  obj(photo, { kind: "photo", label: L.photo });
  const cv = new Mesh(new PlaneGeometry(0.42, 0.52), hl(new MeshStandardMaterial({ map: noteTexture(L.cv_title, L.cv_sub, "#ffffff", "#0f766e"), roughness: 0.8 })));
  cv.position.set(BW / 2 - 0.36, -0.36, 0.045);
  cv.rotation.z = -0.06;
  board.add(cv);
  obj(cv, { kind: "cv", label: L.cv });
  // Rótulo del tablero
  const bsign = new Mesh(new PlaneGeometry(1.0, 0.31), new MeshBasicMaterial({ map: signTexture(L.board_sign, "#fbbf24") }));
  bsign.position.set(0, BH / 2 + 0.3, 0.02);
  board.add(bsign);

  // ---- ventana con la ciudad de noche: por ahí entra y sale Internet
  const win = new Group();
  win.position.set(ROOM.left + 0.03, 2.8, 0.95);
  win.rotation.y = Math.PI / 2;
  walls.left.add(win);
  const sky = new Mesh(new PlaneGeometry(1.6, 1.1), new MeshBasicMaterial({ map: skyTexture({ cloud: "Cloudflare", internet: "Internet" }) }));
  sky.position.z = 0.01;
  win.add(sky);
  // El cielo es MeshBasicMaterial (no tiene emissive): brilla el marco.
  const wf = hl(new MeshStandardMaterial({ color: 0x2b3446, metalness: 0.6, roughness: 0.4 }));
  obj(sky, { kind: "window", label: L.window }, [wf]);
  for (const [w, h, x, y] of [[1.72, 0.06, 0, 0.58], [1.72, 0.06, 0, -0.58], [0.06, 1.2, -0.83, 0], [0.06, 1.2, 0.83, 0], [0.04, 1.1, 0, 0]]) {
    const b = new Mesh(new BoxGeometry(w, h, 0.06), wf);
    b.position.set(x, y, 0.04);
    win.add(b);
  }
  anchors.internet = win.localToWorld(new Vector3(0.33, 0.25, 0.1));
  anchors.cloudflare = win.localToWorld(new Vector3(-0.15, 0.24, 0.1));

  // ---- mesa: pantalla con la terminal, teclado, teléfono, PC y una planta
  const desk = new Group();
  desk.position.set(ROOM.left + 0.62, 0, 0.95);
  desk.rotation.y = Math.PI / 2;
  walls.left.add(desk);
  const wood = new MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.6 });
  const top = new Mesh(new BoxGeometry(2.1, 0.07, 0.95), wood);
  top.position.y = 1.15;
  top.castShadow = top.receiveShadow = true;
  desk.add(top);
  const legMat = new MeshStandardMaterial({ color: 0x1b2230, metalness: 0.6, roughness: 0.4 });
  for (const x of [-0.98, 0.98]) for (const z of [-0.4, 0.4]) {
    const leg = new Mesh(new BoxGeometry(0.06, 1.12, 0.06), legMat);
    leg.position.set(x, 0.56, z);
    desk.add(leg);
  }
  // Pantalla
  const screenMat = new MeshBasicMaterial({ map: screenTexture(["$ neofetch", "OS: Proxmox VE · 26 × 1U", "$ ls /rack", "router traefik landing …", "$ _"]) });
  const scr = new Mesh(new PlaneGeometry(1.0, 0.62), screenMat);
  scr.position.set(-0.1, 1.72, -0.22);
  desk.add(scr);
  const bezel = new Mesh(new BoxGeometry(1.08, 0.7, 0.04), hl(new MeshStandardMaterial({ color: 0x111827, metalness: 0.5, roughness: 0.4 })));
  bezel.position.set(-0.1, 1.72, -0.245);
  desk.add(bezel);
  const stand = new Mesh(new BoxGeometry(0.08, 0.36, 0.06), legMat);
  stand.position.set(-0.1, 1.36, -0.27);
  desk.add(stand);
  obj(scr, { kind: "terminal", label: L.terminal }, [bezel.material]);
  obj(bezel, { kind: "terminal", label: L.terminal });
  const kb = new Mesh(new BoxGeometry(0.62, 0.03, 0.2), new MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6 }));
  kb.position.set(-0.1, 1.2, 0.12);
  desk.add(kb);
  obj(kb, { kind: "terminal", label: L.terminal });
  // Teléfono: escribirme
  const phone = new Mesh(new BoxGeometry(0.14, 0.02, 0.27), hl(new MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3, metalness: 0.4 }), 0x4ade80));
  phone.position.set(0.62, 1.2, 0.12);
  phone.rotation.y = -0.3;
  desk.add(phone);
  const phoneScreen = new Mesh(new PlaneGeometry(0.11, 0.22), new MeshBasicMaterial({ color: 0x2dd4bf }));
  phoneScreen.rotation.x = -Math.PI / 2;
  phoneScreen.position.set(0, 0.011, 0);
  phone.add(phoneScreen);
  obj(phone, { kind: "phone", label: L.phone });
  anchors.movil = desk.localToWorld(new Vector3(0.62, 1.3, 0.12));
  // Taza
  const mug = new Mesh(new CylinderGeometry(0.06, 0.055, 0.13, 16), new MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 }));
  mug.position.set(0.85, 1.25, -0.2);
  desk.add(mug);
  // PC de juegos (el de las GPU de Hermes) bajo la mesa, con su tira RGB
  const tower = new Mesh(new BoxGeometry(0.32, 0.8, 0.72), hl(new MeshStandardMaterial({ color: 0x111827, metalness: 0.6, roughness: 0.35 }), 0xf472b6));
  tower.position.set(0.68, 0.42, -0.02);
  tower.castShadow = true;
  desk.add(tower);
  const rgb = new Mesh(new BoxGeometry(0.01, 0.7, 0.03), new MeshBasicMaterial({ color: 0xf472b6 }));
  rgb.position.set(-0.165, 0, 0.3);
  tower.add(rgb);
  obj(tower, { kind: "pc", label: L.pc });
  anchors.pc = desk.localToWorld(new Vector3(0.5, 0.8, 0.35));
  anchors.casa = desk.localToWorld(new Vector3(-0.1, 1.72, -0.15));
  // Planta
  const pot = new Mesh(new CylinderGeometry(0.12, 0.09, 0.2, 16), new MeshStandardMaterial({ color: 0xb45309, roughness: 0.8 }));
  pot.position.set(-0.85, 1.29, -0.22);
  desk.add(pot);
  for (let k = 0; k < 5; k++) {
    const leaf = new Mesh(new ConeGeometry(0.05, 0.36, 6), new MeshStandardMaterial({ color: 0x15803d, roughness: 0.7 }));
    leaf.position.set(-0.85 + Math.cos(k * 1.3) * 0.05, 1.52, -0.22 + Math.sin(k * 1.3) * 0.05);
    leaf.rotation.set(Math.cos(k) * 0.4, 0, Math.sin(k * 2) * 0.4);
    desk.add(leaf);
  }

  // ---- puerta al blog en la pared de la derecha
  const doorG = new Group();
  doorG.position.set(ROOM.left + 0.02, 0, -0.9);
  walls.left.add(doorG);
  const hinge = new Group(); // gira por el canto
  hinge.position.set(0, 0, -0.55);
  doorG.add(hinge);
  const doorMat = hl(new MeshStandardMaterial({ color: 0x46566f, metalness: 0.3, roughness: 0.5 }));
  const door = new Mesh(new BoxGeometry(0.06, 2.3, 1.1), doorMat);
  door.position.set(0.03, 1.15, 0.55);
  door.castShadow = true;
  hinge.add(door);
  const knob = new Mesh(new CylinderGeometry(0.03, 0.03, 0.12, 10), new MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.9, roughness: 0.2 }));
  knob.rotation.z = Math.PI / 2;
  knob.position.set(0.08, 1.1, 0.95);
  hinge.add(knob);
  const doorFrame = new MeshStandardMaterial({ color: 0x1e293b });
  for (const [h, d, y, z] of [[2.42, 0.08, 1.21, -0.04], [2.42, 0.08, 1.21, 1.14], [0.08, 1.26, 2.38, 0.55]]) {
    const f = new Mesh(new BoxGeometry(0.1, h, d), doorFrame);
    f.position.set(0.03, y, z - 0.55);
    doorG.add(f);
  }
  const glowBehind = new Mesh(new PlaneGeometry(1.06, 2.26), new MeshBasicMaterial({ color: 0xfef3c7 }));
  glowBehind.rotation.y = Math.PI / 2;
  glowBehind.position.set(0.005, 1.15, 0);
  doorG.add(glowBehind);
  const dsign = new Mesh(new PlaneGeometry(0.9, 0.28), new MeshBasicMaterial({ map: signTexture(L.door_sign) }));
  dsign.rotation.y = Math.PI / 2;
  dsign.position.set(0.05, 2.62, 0);
  doorG.add(dsign);
  const doorObj = obj(door, { kind: "door", label: L.door });
  obj(dsign, { kind: "door", label: L.door }, [doorMat]);
  doorObj.hinge = hinge;
  doorObj.open = 0;
  doorObj.openTo = 0;
  anchors.door = doorG.localToWorld(new Vector3(0.4, 1.3, 0));

  return {
    objects,
    anchors,
    notes,
    door: doorObj,
    board,
    deskPos: desk.localToWorld(new Vector3(-0.1, 1.6, -0.2)),
    // Cada pared y lo que cuelga de ella solo se ve desde dentro.
    update(camPos, dt) {
      walls.back.visible = camPos.z > ROOM.back;
      walls.left.visible = camPos.x > ROOM.left;
      walls.right.visible = camPos.x < ROOM.right;
      let busy = false;
      for (const m of objects) {
        const o = m.userData.obj;
        const g = Math.max(o.hover ? 0.5 : 0, o.pulse ? 0.35 + 0.35 * Math.sin(performance.now() / 220) : 0, o.active ? 0.45 : 0);
        if (Math.abs(o.glow - g) > 0.003 || o.pulse) {
          o.glow += (g - o.glow) * Math.min(1, dt * 10);
          for (const mat of o.mats) if ("emissiveIntensity" in mat) mat.emissiveIntensity = o.glow;
          busy = true;
        }
        if (o.kind === "note") {
          const lift = o.hover || o.active ? 0.05 : 0;
          m.position.z += (o.base.z + lift - m.position.z) * Math.min(1, dt * 10);
        }
      }
      const d = doorObj;
      if (Math.abs(d.open - d.openTo) > 0.002) {
        d.open += (d.openTo - d.open) * Math.min(1, dt * 4);
        d.hinge.rotation.y = d.open * 1.4;
        busy = true;
      }
      return busy;
    },
  };
}
