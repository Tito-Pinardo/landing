// Los enanitos de la web, ahora paseando por la sala: van de un sitio a otro
// esquivando el rack y la mesa, se paran a mirar, saltan si los tocas y de
// noche (hora de casa) duermen sentados contra la pared. Si despiertas a uno,
// se levanta enfadado, rojo y pataleando, te mira, refunfuña y vuelve a la
// cama; de día, si lo molestas tres veces seguidas, se harta y se va.

import { CanvasTexture, Color, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace } from "three";
import { ROOM } from "./room.js";

const COLORS = [[0xef4444, 0x2563eb], [0x16a34a, 0x7c3aed], [0xf59e0b, 0x0891b2], [0xdb2777, 0x15803d], [0x0ea5e9, 0xb45309]];
const SKIN = new Color(0xf5c9a0);
const RAGE = new Color(0xe11d48);
const beardMat = new MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.9 });
const bootMat = new MeshStandardMaterial({ color: 0x3f2a1d, roughness: 0.8 });
const noseMat = new MeshStandardMaterial({ color: 0xf29b84, roughness: 0.6 });
const eyeMat = new MeshStandardMaterial({ color: 0x111827, roughness: 0.4 });
const ANGRY_TIME = 4.5; // segundos pataleando
const FED_UP = 3; // toques seguidos para hartarse de día

// Zonas por las que no se pasa (rectángulos en el suelo: x0, x1, z0, z1)
const BLOCKED = [
  [-0.85, 0.85, -0.85, 0.85], // rack
  [ROOM.left, ROOM.left + 1.35, -0.25, 2.15], // mesa
];
const free = (x, z) => x > ROOM.left + 0.25 && x < ROOM.right - 0.3 && z > ROOM.back + 0.25 && z < ROOM.front - 0.4 && !BLOCKED.some(([a, b, c, d]) => x > a && x < b && z > c && z < d);
function clearPath(x0, z0, x1, z1) {
  for (let k = 1; k <= 12; k++) {
    const t = k / 12;
    if (!free(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
  }
  return true;
}
// Un sitio libre al que se llegue en línea recta (`far`: lejos de donde está)
function pickTarget(g, far = false) {
  let best = null;
  for (let i = 0; i < 24; i++) {
    const x = ROOM.left + 0.4 + Math.random() * (ROOM.right - ROOM.left - 0.8);
    const z = ROOM.back + 0.4 + Math.random() * (ROOM.front - ROOM.back - 0.8);
    if (!free(x, z) || !clearPath(g.root.position.x, g.root.position.z, x, z)) continue;
    const d = Math.hypot(x - g.root.position.x, z - g.root.position.z);
    if (!far) return [x, z];
    if (!best || d > best[2]) best = [x, z, d];
  }
  return best && [best[0], best[1]];
}

function textSprite(draw, w, h, sx, sy) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"));
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  const s = new Sprite(new SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(sx, sy, 1);
  s.visible = false;
  return s;
}
// «Zzz» encima de quien duerme
const zzz = () => textSprite((g) => {
  g.fillStyle = "#e0f2fe";
  for (const [size, x, y] of [[40, 10, 52], [30, 50, 36], [22, 84, 22]]) {
    g.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`;
    g.fillText("z", x, y);
  }
}, 128, 64, 0.3, 0.15);
// La vena de enfado (cuatro arcos rojos), como la de los cómics
const rage = () => textSprite((g) => {
  g.strokeStyle = "#ef4444";
  g.lineWidth = 9;
  g.lineCap = "round";
  for (const [cx, cy, a] of [[20, 20, 0], [44, 20, Math.PI / 2], [44, 44, Math.PI], [20, 44, -Math.PI / 2]]) {
    g.beginPath();
    g.arc(cx, cy, 13, a, a + Math.PI / 2);
    g.stroke();
  }
}, 64, 64, 0.17, 0.17);

function makeGnome(i) {
  const [hatC, tunicC] = COLORS[i % COLORS.length];
  const root = new Group();
  const body = new Group(); // lo que bota al andar y salta
  root.add(body);
  const tunic = new Mesh(new ConeGeometry(0.13, 0.26, 14), new MeshStandardMaterial({ color: tunicC, roughness: 0.7 }));
  tunic.position.y = 0.2;
  // Cada uno con su cara: se pone roja cuando se enfada
  const faceMat = new MeshStandardMaterial({ color: SKIN.clone(), roughness: 0.7 });
  const head = new Mesh(new SphereGeometry(0.075, 14, 10), faceMat);
  head.position.y = 0.36;
  const beard = new Mesh(new ConeGeometry(0.07, 0.15, 12), beardMat);
  beard.rotation.x = Math.PI;
  beard.position.set(0, 0.29, 0.035);
  const hat = new Mesh(new ConeGeometry(0.085, 0.24, 14), new MeshStandardMaterial({ color: hatC, roughness: 0.6 }));
  hat.position.y = 0.52;
  hat.rotation.z = 0.12;
  const nose = new Mesh(new SphereGeometry(0.022, 8, 6), noseMat);
  nose.position.set(0, 0.35, 0.075);
  // Cejas: rectas normalmente, en uve cuando se enfada
  const brows = [-1, 1].map((side) => {
    const b = new Mesh(new CylinderGeometry(0.006, 0.006, 0.035, 6), eyeMat);
    b.rotation.z = Math.PI / 2;
    b.position.set(side * 0.028, 0.405, 0.064);
    b.userData.side = side;
    return b;
  });
  const eyes = [-0.028, 0.028].map((x) => {
    const e = new Mesh(new SphereGeometry(0.011, 6, 4), eyeMat);
    e.position.set(x, 0.38, 0.066);
    return e;
  });
  const legs = [-0.045, 0.045].map((x) => {
    const pivot = new Group();
    pivot.position.set(x, 0.1, 0);
    const leg = new Mesh(new CylinderGeometry(0.022, 0.026, 0.1, 8), bootMat);
    leg.position.y = -0.05;
    pivot.add(leg);
    return pivot;
  });
  body.add(tunic, head, beard, hat, nose, ...brows, ...eyes, ...legs);
  for (const m of [tunic, head, beard, hat]) m.castShadow = true;
  return { root, body, legs, hat, brows, faceMat };
}

// Sitios donde se echan a dormir, sentados contra la pared
// (lejos de la puerta, para no taparla)
const BEDS = [
  [-3.9, ROOM.back + 0.3, 0],
  [-2.4, ROOM.back + 0.3, 0],
  [1.4, ROOM.back + 0.3, 0],
];

export function buildGnomes(scene, n = 3) {
  const list = [];
  const meshes = [];
  const group = new Group();
  scene.add(group);
  const starts = [[-2.2, 1.6], [1.4, 1.9], [-1.6, -0.6]];
  let asleep = false;

  function standPose(g) {
    g.body.rotation.set(0, 0, 0);
    g.body.position.y = 0;
    g.legs.forEach((l) => (l.rotation.x = 0));
    g.z.visible = false;
  }
  function sleepPose(g) {
    const [x, z, ry] = g.bed;
    g.root.position.set(x, 0, z);
    g.root.rotation.y = ry;
    g.body.rotation.set(-0.25, 0, 0); // apoyado hacia atrás
    g.body.position.y = -0.08;
    g.legs.forEach((l) => (l.rotation.x = -1.3));
    g.z.visible = true;
    g.state = "sleep";
  }
  function walkTo(g, target, speed, then) {
    g.target = target;
    g.speed = speed;
    g.then = then;
    g.state = target ? "walk" : then === "bed" ? "sleep" : "idle";
    if (!target && then === "bed") sleepPose(g);
  }
  function calm(g) {
    g.rage.visible = false;

  }

  for (let i = 0; i < n; i++) {
    const g = makeGnome(i + Math.floor(Math.random() * 3));
    g.root.position.set(starts[i][0], 0, starts[i][1]);
    g.root.rotation.y = Math.random() * Math.PI * 2;
    g.root.scale.setScalar(1.35);
    g.bed = BEDS[i % BEDS.length];
    Object.assign(g, { state: "idle", wait: 0.5 + Math.random() * 2, target: null, phase: Math.random() * 10, jump: 0, vy: 0, annoy: 0, mad: 0, angryT: 0 });
    g.z = zzz();
    g.z.position.set(0.12, 0.62, 0);
    g.rage = rage();
    g.rage.position.set(0.1, 0.62, 0);
    g.root.add(g.z, g.rage);
    const obj = { kind: "gnome", gnome: g, label: "", glow: 0, mats: [] };
    g.root.traverse((m) => {
      if (m.isMesh) {
        m.userData.obj = obj;
        meshes.push(m);
      }
    });
    group.add(g.root);
    list.push(g);
  }

  return {
    group,
    meshes,
    headOf: (g) => g.body.localToWorld(g.hat.position.clone().setY(0.72)),
    set visible(v) {
      group.visible = v;
    },
    get visible() {
      return group.visible;
    },
    setAsleep(v) {
      if (v === asleep) return;
      asleep = v;
      for (const g of list) {
        calm(g);
        g.target = null;
        if (v) sleepPose(g);
        else {
          standPose(g);
          g.state = "idle";
          g.wait = Math.random() * 2;
        }
      }
    },
    // Lo han tocado: devuelve cómo reacciona ("wake", "angry", "fed_up" o
    // "click") para que se elija la frase.
    poke(g) {
      g.vy = 1.6;
      g.jump = 0.0001;
      g.annoy += 1;
      let mood = "click";
      if (g.state === "sleep") mood = "wake";
      else if (g.state === "angry") mood = "angry";
      else if (g.annoy >= FED_UP) mood = "fed_up";
      if (mood !== "click") {
        if (g.state === "sleep") standPose(g);
        g.state = "angry";
        g.angryT = ANGRY_TIME;
        g.target = null;
        g.rage.visible = true;
      } else if (g.state === "walk") {
        g.state = "idle";
        g.wait = 1.5;
      }
      return mood;
    },
    // Devuelve true si algo se ha movido. `cam`: dónde está la cámara (a
    // quien le despierta lo mira de frente).
    update(dt, now, still, cam) {
      if (!group.visible) return false;
      let moved = false;
      for (const g of list) {
        // Pegado a la cámara (recorridos de cerca) taparía lo que se enseña
        // con una cabeza gigante en primer plano: se esconde mientras tanto.
        if (cam) {
          const near = Math.hypot(g.root.position.x - cam.x, g.root.position.z - cam.z) < 1.1;
          if (g.root.visible === near) {
            g.root.visible = !near;
            moved = true;
          }
        }
        g.annoy = Math.max(0, g.annoy - dt * 0.5);
        // La cara se pone roja al enfadarse y se le pasa poco a poco
        const madTo = g.state === "angry" ? 1 : 0;
        if (Math.abs(g.mad - madTo) > 0.01) {
          g.mad += (madTo - g.mad) * Math.min(1, dt * (madTo ? 6 : 1.5));
          g.faceMat.color.copy(SKIN).lerp(RAGE, g.mad * 0.75);
          // Cejas en uve: el extremo de dentro baja
          g.brows.forEach((b) => (b.rotation.z = Math.PI / 2 - b.userData.side * 0.55 * g.mad));
          moved = true;
        }
        // Salto
        if (g.jump > 0) {
          g.vy -= 9 * dt;
          g.jump = Math.max(0, g.jump + g.vy * dt);
          g.body.position.y = (g.state === "sleep" ? -0.08 : 0) + g.jump;
          if (g.jump === 0) g.vy = 0;
          moved = true;
        }
        if (g.state === "sleep") {
          g.z.position.y = 0.62 + Math.sin(now / 600 + g.phase) * 0.04;
          g.z.material.opacity = 0.6 + 0.4 * Math.sin(now / 900 + g.phase);
          if (!still) moved = true;
          continue;
        }
        if (g.state === "angry") {
          g.angryT -= dt;
          // Mira a quien le ha molestado y patalea
          if (cam) {
            const want = Math.atan2(cam.x - g.root.position.x, cam.z - g.root.position.z);
            let diff = Math.atan2(Math.sin(want - g.root.rotation.y), Math.cos(want - g.root.rotation.y));
            g.root.rotation.y += diff * Math.min(1, dt * 10);
          }
          if (!still) {
            g.phase += dt * 22;
            const s = Math.sin(g.phase);
            g.legs[0].rotation.x = Math.max(0, s) * 0.9;
            g.legs[1].rotation.x = Math.max(0, -s) * 0.9;
            g.body.rotation.z = Math.sin(now / 55) * 0.08;
            if (g.jump === 0 && Math.random() < dt * 2.5) {
              g.vy = 0.9;
              g.jump = 0.0001;
            }
            g.rage.scale.setScalar(0.17 * (1 + 0.25 * Math.abs(Math.sin(now / 120))));
          }
          if (g.angryT <= 0) {
            g.body.rotation.z = 0;
            calm(g);
            // De noche vuelve a su sitio a dormir; de día se va lejos, rápido
            if (asleep) walkTo(g, clearPath(g.root.position.x, g.root.position.z, g.bed[0], g.bed[1]) ? [g.bed[0], g.bed[1]] : null, 0.5, "bed");
            else walkTo(g, pickTarget(g, true), 1.1, "idle");
            g.annoy = 0;
          }
          moved = true;
          continue;
        }
        if (still) continue;
        if (g.state === "idle") {
          g.wait -= dt;
          g.legs.forEach((l) => (l.rotation.x *= 0.8));
          g.hat.rotation.z = 0.12 + Math.sin(now / 700 + g.phase) * 0.04;
          if (g.wait <= 0 && !asleep) {
            walkTo(g, pickTarget(g), 0.45, "idle");
            g.wait = 1 + Math.random() * 2;
          }
          moved = true;
          continue;
        }
        // Andando hacia el objetivo
        const [tx, tz] = g.target;
        const dx = tx - g.root.position.x;
        const dz = tz - g.root.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.05) {
          g.legs.forEach((l) => (l.rotation.x = 0));
          if (g.then === "bed") sleepPose(g);
          else {
            g.state = "idle";
            g.wait = 1 + Math.random() * 4;
          }
          continue;
        }
        const step = Math.min(d, g.speed * dt);
        g.root.position.x += (dx / d) * step;
        g.root.position.z += (dz / d) * step;
        // Gira poco a poco hacia donde va
        const want = Math.atan2(dx, dz);
        const diff = Math.atan2(Math.sin(want - g.root.rotation.y), Math.cos(want - g.root.rotation.y));
        g.root.rotation.y += diff * Math.min(1, dt * 8);
        g.phase += dt * 11 * (g.speed / 0.45);
        const s = Math.sin(g.phase);
        g.legs[0].rotation.x = s * 0.6;
        g.legs[1].rotation.x = -s * 0.6;
        if (g.jump === 0) g.body.position.y = Math.abs(s) * 0.025;
        moved = true;
      }
      return moved;
    },
  };
}
