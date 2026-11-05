// Lo de dentro de una unidad: cuando un recorrido pasa por ella, el cajón sale
// del armario, la tapa se desliza hacia dentro (como la de un servidor de
// verdad, sin tapar las unidades de arriba) y se ve la placa (con su nombre serigrafiado),
// el disipador que brilla mientras trabaja, la RAM, los discos y un ventilador
// que gira. Se construye la primera vez que hace falta y se reutiliza.

import { BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from "three";

export const OPEN = 0.72; // cuánto sale el cajón

const hidden = new MeshBasicMaterial({ visible: false });
const wallMat = new MeshStandardMaterial({ color: 0x2b3345, metalness: 0.7, roughness: 0.45 });
const sinkBase = new MeshStandardMaterial({ color: 0xb8c2d4, metalness: 0.85, roughness: 0.3, emissive: 0x22d3ee, emissiveIntensity: 0 });
const ramMat = new MeshStandardMaterial({ color: 0x14532d, metalness: 0.3, roughness: 0.6 });
const ramChip = new MeshStandardMaterial({ color: 0x111827, roughness: 0.5 });
const diskMat = new MeshStandardMaterial({ color: 0x9aa3b2, metalness: 0.8, roughness: 0.35 });
const fanMat = new MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6 });
const bladeMat = new MeshStandardMaterial({ color: 0x475569, roughness: 0.5 });
const ledBase = new MeshBasicMaterial({ color: 0x22d3ee });
const OK_C = 0x22d3ee;
const FAULT_C = 0xef4444;

let pcbTex = null;
function pcbTexture() {
  if (pcbTex) return pcbTex;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 464;
  const g = c.getContext("2d");
  g.fillStyle = "#0f3d2e";
  g.fillRect(0, 0, c.width, c.height);
  // Pistas: líneas finas en ángulo recto, como las de una placa de verdad
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = "rgba(180, 220, 120, .35)";
  g.lineWidth = 2;
  for (let i = 0; i < 70; i++) {
    let x = rnd() * c.width;
    let y = rnd() * c.height;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      if (k % 2) y += (rnd() - 0.5) * 160;
      else x += (rnd() - 0.5) * 220;
      g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = "rgba(220, 200, 120, .6)";
    g.beginPath();
    g.arc(x, y, 3, 0, Math.PI * 2);
    g.fill();
  }
  // Tornillos en las esquinas
  g.fillStyle = "#c9b27a";
  for (const [x, y] of [[18, 18], [494, 18], [18, 446], [494, 446]]) {
    g.beginPath();
    g.arc(x, y, 7, 0, Math.PI * 2);
    g.fill();
  }
  pcbTex = new CanvasTexture(c);
  pcbTex.colorSpace = SRGBColorSpace;
  pcbTex.anisotropy = 4;
  return pcbTex;
}

// El nombre de la unidad, serigrafiado en blanco sobre la placa
function silkscreen(slot, title) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const g = c.getContext("2d");
  g.fillStyle = "#f8fafc";
  g.font = '700 40px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  g.fillText(slot.toUpperCase().slice(0, 22), 8, 44);
  g.globalAlpha = 0.75;
  g.font = '500 24px ui-sans-serif, system-ui, sans-serif';
  g.fillText(title.slice(0, 40), 8, 82);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return new Mesh(new PlaneGeometry(0.46, 0.086), new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
}

// `u`: la unidad (con su mesh); w, h, d: medidas de la caja; bodyMat: el
// metal de la tapa.
export function buildInside(u, w, h, d, bodyMat, hingeZ) {
  const g = new Group();
  const sinkMat = sinkBase.clone(); // cada cajón brilla por su cuenta
  const floor = -h / 2 + 0.004;
  // Placa
  const pcb = new Mesh(new PlaneGeometry(w - 0.05, d - 0.06), new MeshStandardMaterial({ map: pcbTexture(), roughness: 0.75 }));
  pcb.rotation.x = -Math.PI / 2;
  pcb.position.y = floor;
  pcb.receiveShadow = true;
  g.add(pcb);
  // Paredes por dentro (las de la caja solo se ven desde fuera)
  for (const x of [-w / 2 + 0.006, w / 2 - 0.006]) {
    const wall = new Mesh(new BoxGeometry(0.008, h * 0.92, d - 0.01), wallMat);
    wall.position.set(x, 0, 0);
    g.add(wall);
  }
  const back = new Mesh(new BoxGeometry(w - 0.02, h * 0.92, 0.008), wallMat);
  back.position.set(0, 0, -d / 2 + 0.006);
  g.add(back);
  // Disipador con aletas sobre la CPU: es lo que se enciende al trabajar
  const sink = new Group();
  const base = new Mesh(new BoxGeometry(0.17, 0.012, 0.17), sinkMat);
  sink.add(base);
  for (let k = 0; k < 8; k++) {
    const fin = new Mesh(new BoxGeometry(0.006, 0.045, 0.16), sinkMat);
    fin.position.set(-0.075 + k * 0.0215, 0.028, 0);
    sink.add(fin);
  }
  sink.position.set(0.1, floor + 0.006, 0.12);
  g.add(sink);
  // RAM a los lados del disipador
  for (let k = 0; k < 4; k++) {
    const stick = new Mesh(new BoxGeometry(0.008, 0.036, 0.24), ramMat);
    stick.position.set(-0.04 - k * 0.022, floor + 0.018, 0.12);
    g.add(stick);
    for (let j = 0; j < 4; j++) {
      const chip = new Mesh(new BoxGeometry(0.003, 0.02, 0.035), ramChip);
      chip.position.set(stick.position.x + 0.005, floor + 0.02, 0.03 + j * 0.06);
      g.add(chip);
    }
  }
  // Dos discos al fondo y un ventilador delante de ellos
  for (const x of [-0.3, -0.16]) {
    const disk = new Mesh(new BoxGeometry(0.11, 0.026, 0.16), diskMat);
    disk.position.set(x, floor + 0.013, -0.22);
    g.add(disk);
  }
  const fanBox = new Mesh(new BoxGeometry(0.13, 0.06, 0.02), fanMat);
  fanBox.position.set(0.28, floor + 0.03, -0.08);
  g.add(fanBox);
  const fan = new Group();
  for (let k = 0; k < 5; k++) {
    const blade = new Mesh(new BoxGeometry(0.05, 0.012, 0.003), bladeMat);
    blade.position.x = 0.025;
    const arm = new Group();
    arm.rotation.z = (k / 5) * Math.PI * 2;
    blade.rotation.x = 0.4;
    arm.add(blade);
    fan.add(arm);
  }
  fan.add(new Mesh(new CylinderGeometry(0.012, 0.012, 0.01, 10).rotateX(Math.PI / 2), bladeMat));
  fan.position.set(0.28, floor + 0.03, -0.068);
  fan.scale.setScalar(0.85);
  g.add(fan);
  // LED de la placa
  const ledMat = ledBase.clone();
  const led = new Mesh(new BoxGeometry(0.016, 0.008, 0.016), ledMat);
  led.position.set(0.36, floor + 0.004, 0.33);
  g.add(led);
  // Nombre serigrafiado
  const label = silkscreen(u.slot, u.title);
  label.rotation.x = -Math.PI / 2;
  label.position.set(-0.2, floor + 0.002, 0.33);
  g.add(label);

  // Tapa en dos trozos: el de atrás (dentro del armario) fijo y el de
  // delante, que se desliza hacia atrás por encima y queda dentro del armario.
  const lidT = 0.006;
  const rearLen = hingeZ + d / 2;
  const rear = new Mesh(new BoxGeometry(w, lidT, rearLen), bodyMat);
  rear.position.set(0, h / 2 - lidT / 2, -d / 2 + rearLen / 2);
  g.add(rear);
  const hinge = new Group();
  hinge.position.set(0, h / 2, hingeZ);
  const flapLen = d / 2 - hingeZ;
  const flap = new Mesh(new BoxGeometry(w, lidT, flapLen), bodyMat);
  flap.position.set(0, -lidT / 2, flapLen / 2);
  flap.castShadow = true;
  hinge.add(flap);
  g.add(hinge);

  g.visible = false;
  u.mesh.add(g);
  const topMat = u.mesh.material[2];
  return {
    lid: 0,
    // Dónde se posa el paquete al llegar: encima del disipador
    cpu: () => u.mesh.localToWorld(new Vector3(0.1, floor + 0.07, 0.12)),
    centre: () => u.mesh.localToWorld(new Vector3(0, floor, 0.08)),
    // `fault`: en el modo detective, la pieza con la avería brilla en rojo
    update(dt, now, still, hot, fault = false) {
      const col = fault ? FAULT_C : OK_C;
      if (sinkMat.emissive.getHex() !== col) {
        sinkMat.emissive.setHex(col);
        ledMat.color.setHex(col);
      }
      const want = hot && u.out > OPEN * 0.9 ? 1 : 0;
      const before = this.lid;
      if (still) this.lid = want;
      else this.lid += (want - this.lid) * Math.min(1, dt * 5);
      if (Math.abs(this.lid - want) < 0.002) this.lid = want;
      hinge.position.z = hingeZ - flapLen * this.lid;
      hinge.position.y = h / 2 + (this.lid > 0 ? 0.002 : 0) + 0.006 * Math.sin(Math.PI * this.lid);
      const shown = hot || this.lid > 0.001 || u.out > 0.2;
      g.visible = shown;
      u.mesh.material[2] = shown ? hidden : topMat;
      sinkMat.emissiveIntensity = hot ? (fault ? 0.7 + 0.3 * Math.sin(now / 90) : 0.5 + 0.4 * Math.sin(now / 160)) : 0;
      ledMat.visible = !fault || still || Math.sin(now / 120) > 0;
      if (!still && shown) fan.rotation.z -= dt * 18;
      return shown && (!still || this.lid !== before);
    },
  };
}
