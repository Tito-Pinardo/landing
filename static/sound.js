// Sonido de sala de servidores, sintetizado con Web Audio: no hay ficheros
// de audio ni nada que descargar. Ventiladores de fondo, relés al pulsar,
// pitidos de arranque y el traqueteo de los discos cuando pasa un paquete.
//
// Se puede apagar (botón de la barra superior o `sound off` en la terminal) y
// la elección se guarda en este navegador. Los navegadores no dejan sonar
// nada hasta que la persona interactúa con la página, así que todo arranca
// con el primer clic o tecla.
(() => {
  "use strict";
  document.documentElement.classList.add("js");

  const KEY = "tp:sound";
  const read = () => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  };
  const write = (v) => {
    try { localStorage.setItem(KEY, v); } catch { /* sin almacenamiento */ }
  };
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let enabled = read() !== "off" && !!Ctx;
  let ctx = null;
  let master = null;
  let hum = null;
  let noiseBuf = null;

  function boot() {
    if (ctx || !Ctx) return;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = enabled ? 1 : 0;
    master.connect(ctx.destination);
    // Un segundo de ruido blanco que reutilizan todos los sonidos.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startHum();
  }

  function noise(loop) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = !!loop;
    return src;
  }

  // Ventiladores: ruido marrón filtrado con un leve vaivén, el zumbido de la
  // fuente y el silbido agudo de los ventiladores de 1U.
  function startHum() {
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(master);
    const air = noise(true);
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 520;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.05;
    air.connect(low).connect(airGain).connect(out);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(airGain.gain);
    const whine = noise(true);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 3100;
    band.Q.value = 9;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.006;
    whine.connect(band).connect(whineGain).connect(out);
    const mains = ctx.createOscillator();
    mains.frequency.value = 100;
    const mainsGain = ctx.createGain();
    mainsGain.gain.value = 0.006;
    mains.connect(mainsGain).connect(out);
    for (const n of [air, whine, lfo, mains]) n.start();
    // Los ventiladores arrancan poco a poco, como al encender el servidor.
    out.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
    hum = out;
  }

  function env(gain, t, peak, attack, release) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  function tone(freq, t, len, type = "square", peak = 0.05, glide) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + len);
    const g = ctx.createGain();
    env(g, t, peak, 0.004, len);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  function burst(t, len, freq, peak, type = "highpass", q = 1) {
    const src = noise();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, peak, 0.001, len);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + len + 0.05);
  }

  const sounds = {
    // Relé / tecla mecánica.
    click(t) { burst(t, 0.018, 2400, 0.16); burst(t + 0.012, 0.03, 900, 0.05, "bandpass", 4); },
    // Pitido corto de la BIOS al arrancar.
    beep(t) { tone(988, t, 0.11, "square", 0.035); },
    // Arranque: pitido, relés y un barrido de los ventiladores.
    boot(t) {
      tone(988, t, 0.12, "square", 0.035);
      for (let i = 0; i < 3; i++) burst(t + 0.25 + i * 0.09, 0.02, 2600, 0.12);
      const src = noise();
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 2;
      f.frequency.setValueAtTime(200, t + 0.3);
      f.frequency.exponentialRampToValueAtTime(1800, t + 1.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.09, t + 1.0);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      src.connect(f).connect(g).connect(master);
      src.start(t + 0.3);
      src.stop(t + 2.3);
    },
    // La unidad sale por los raíles: roce metálico y un tope al final.
    slide(t) {
      const src = noise();
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 6;
      f.frequency.setValueAtTime(700, t);
      f.frequency.linearRampToValueAtTime(1500, t + 0.8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.08);
      g.gain.setValueAtTime(0.06, t + 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      src.connect(f).connect(g).connect(master);
      src.start(t);
      src.stop(t + 0.9);
      burst(t + 0.86, 0.06, 300, 0.2, "lowpass");
      burst(t + 0.87, 0.02, 3000, 0.08);
    },
    // Disco duro buscando: unos cuantos chasquidos irregulares.
    seek(t) {
      const n = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) burst(t + i * (0.025 + Math.random() * 0.03), 0.008, 1800 + Math.random() * 1500, 0.05 + Math.random() * 0.04);
    },
    // Llega el paquete a una pieza.
    hop(t) { tone(1320, t, 0.05, "sine", 0.03, 1760); sounds.seek(t + 0.02); },
    // Teclear del narrador (muy flojo).
    tick(t) { burst(t, 0.006, 3500, 0.025); },
    ok(t) { tone(880, t, 0.09, "square", 0.03); tone(1320, t + 0.1, 0.14, "square", 0.03); },
    err(t) { tone(150, t, 0.22, "sawtooth", 0.05); },
    // Logro: tres notas que suben.
    achievement(t) { [784, 988, 1319].forEach((f, i) => tone(f, t + i * 0.09, 0.12, "triangle", 0.05)); },
  };

  // Sonidos de entrada (abrir una unidad): si el audio aún no puede sonar,
  // esperan un momento al primer gesto y, si tarda, se descartan.
  let pending = null;

  let lastTick = 0;
  function play(name, opts) {
    if (opts?.intro && (!ctx || ctx.state !== "running")) {
      pending = { name, at: Date.now() };
      return;
    }
    if (!enabled || !ctx || !sounds[name]) return;
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime + 0.01;
    if (name === "tick") {
      if (t - lastTick < 0.05) return;
      lastTick = t;
    }
    sounds[name](t);
  }

  function set(on) {
    enabled = on && !!Ctx;
    write(on ? "on" : "off");
    if (on) boot();
    if (master) master.gain.setTargetAtTime(enabled ? 1 : 0, ctx.currentTime, 0.08);
    if (on && ctx?.state === "suspended") ctx.resume();
    paint();
    if (on) play("beep");
  }

  const btns = () => document.querySelectorAll("[data-sound-toggle]");
  function paint() {
    for (const b of btns()) {
      b.setAttribute("aria-pressed", String(enabled));
      b.classList.toggle("is-on", enabled);
      const label = enabled ? b.dataset.labelOn : b.dataset.labelOff;
      b.title = label;
      b.setAttribute("aria-label", label);
    }
  }

  // El primer gesto despierta el audio; los clics en botones y enlaces
  // suenan a relé sin que cada script tenga que pedirlo.
  const wake = () => {
    if (!enabled) return;
    boot();
    if (ctx.state === "suspended") ctx.resume();
    if (pending && Date.now() - pending.at < 2500) play(pending.name);
    pending = null;
  };
  addEventListener("pointerdown", wake, { capture: true, passive: true });
  addEventListener("keydown", wake, { capture: true });
  addEventListener("click", (ev) => {
    const el = ev.target.closest?.("button, a, summary, input, label");
    if (el && !el.matches("[data-sound-toggle]")) play("click");
  }, { capture: true, passive: true });
  // Pestaña en segundo plano: se paran los ventiladores.
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else if (enabled) ctx.resume();
  });

  document.addEventListener("DOMContentLoaded", () => {
    paint();
    for (const b of btns()) b.addEventListener("click", () => set(!enabled));
  });

  window.tpSound = { play, set, get enabled() { return enabled; } };
})();
