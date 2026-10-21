'use strict';
/* ===== Shared utils, settings, waves, sun position, textures ===== */
const V3 = THREE.Vector3;
const DEG = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function angleWrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function approachAngle(cur, target, maxStep) { const d = angleWrap(target - cur); return cur + clamp(d, -maxStep, maxStep); }
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/* Settings (overridden by Wallpaper Engine user properties) */
const CFG = {
  zoom: 115,          // %
  camAngle: 135,      // initial camera azimuth, degrees
  camRotate: false,   // slow automatic orbit (no mouse control)
  camSpeed: 2,        // degrees per second
  camDir: 1,          // 1 = clockwise, -1 = counter-clockwise
  camElev: 35.264,    // isometric
  timeMode: 'real',
  fixedHour: 12,
  lat: 43.2,          // sun latitude (fixed, not a user setting)
  lon: -new Date().getTimezoneOffset() / 4,   // longitude estimated from the PC time zone (15° per hour)
  sens: 100,          // audio sensitivity, %
  fire: 100,          // fire intensity, %
  flyby: 5,           // fly-by frequency 0..10
  auto: true,         // automatic flight ops
  counts: { fa18: 4, f14: 2, f35: 2, e2d: 1, mq25: 1, mh60: 1, ch53: 1, ah1: 1, cmv22: 1 },  // air wing composition
  ddHelis: true,      // one transport helicopter on each destroyer
  numbers: { carrier: '07' },  // carrier hull number
  enemies: true,      // enemy aircraft & anti-ship missiles during combat
  shake: true,        // subtle camera shake on heavy hits
  missions: 5,        // how often flights leave on missions (0 = never)
  subtitles: true,    // Ace Combat style radio subtitles
  saveState: true,    // remember who is in the air / on a mission between sessions (js/persist.js)
  shadows: true,
  showPanel: true,
  panelPos: 'br',
  panelScale: 100,
  waves: 100,
  speed: 100,
  uiColor: '120,220,170'
};

/* ===== Waves (same formula in JS and GLSL) =====
   component: [kx, kz, omega, amplitude] ; phase = kx*x + kz*z + (kx*flow + omega)*t */
const WAVE = {
  amp: 1, flow: 2.2,
  comps: [[0.16, 0.07, 0.9, 0.34], [-0.05, 0.12, 0.7, 0.24], [0.41, 0.29, 1.7, 0.11], [0.73, -0.52, 2.4, 0.05]],
  phase: [0, 0, 0, 0]
};
function waveAdvance(dt) {
  for (let i = 0; i < 4; i++) {
    const c = WAVE.comps[i];
    WAVE.phase[i] = (WAVE.phase[i] + (c[0] * WAVE.flow + c[2]) * dt) % (Math.PI * 2);
  }
}
function waveH(x, z) {
  let h = 0;
  for (let i = 0; i < 4; i++) { const c = WAVE.comps[i]; h += c[3] * Math.sin(c[0] * x + c[1] * z + WAVE.phase[i]); }
  return h * WAVE.amp;
}
const WAVE_GLSL = (() => {
  const c = WAVE.comps, f = v => v.toFixed(4);
  let s = 'uniform vec4 uPh; uniform float uAmp;\nfloat waveH(vec2 p){ return uAmp*(';
  s += c.map((k, i) => `${f(k[3])}*sin(${f(k[0])}*p.x+${f(k[1])}*p.y+uPh[${i}])`).join('+');
  s += '); }\n';
  return s;
})();

/* ===== Sun position (simplified algorithm, ~0.5 deg accuracy) ===== */
function sunPosition(date, lat, lon) {
  const rad = DEG;
  const d = date.getTime() / 86400000 - 10957.5; // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  let gmst = (18.697374558 + 24.06570982441908 * d) % 24; if (gmst < 0) gmst += 24;
  const H = (gmst * 15 + lon) * rad - ra;
  const la = lat * rad;
  const elev = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(H));
  return { elev: elev / rad, az: az / rad };
}
function getNow() {
  const d = new Date();
  if (CFG.timeMode === 'fixed') {
    const h = CFG.fixedHour % 24;
    d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
  }
  return d;
}

/* ===== Time-of-day palette keyed by sun elevation ===== */
const SKY_KEYS = [
  { e: -90, sun: 0x7a90c0, si: 0.45, hs: 0x44557e, hg: 0x141a26, hi: 0.85, fog: 0x0b1424, water: 0x0f2a44, spec: 0x283143, smoke: 0x3a4250 },
  { e: -10, sun: 0x7a90c0, si: 0.45, hs: 0x44557e, hg: 0x141a26, hi: 0.85, fog: 0x0b1424, water: 0x0f2a44, spec: 0x283143, smoke: 0x3a4250 },
  { e: -4,  sun: 0x7080a8, si: 0.45, hs: 0x4a5078, hg: 0x161820, hi: 0.80, fog: 0x1c2240, water: 0x13284a, spec: 0x242739, smoke: 0x4a4e5c },
  { e: 0,   sun: 0xff7a40, si: 0.80, hs: 0x9a7a96, hg: 0x2a2024, hi: 0.85, fog: 0xb86a54, water: 0x2a4a66, spec: 0x3e2415, smoke: 0x6e6262 },
  { e: 6,   sun: 0xffa860, si: 0.95, hs: 0xaeb2c8, hg: 0x2c2622, hi: 0.72, fog: 0xcf9a7c, water: 0x285676, spec: 0x392b1c, smoke: 0x9a9090 },
  { e: 20,  sun: 0xfff2dc, si: 1.05, hs: 0xc4dcf0, hg: 0x3a3a36, hi: 0.62, fog: 0x9fc0da, water: 0x1c5a82, spec: 0x242b32, smoke: 0xb8b8b8 },
  { e: 90,  sun: 0xfff6e8, si: 1.10, hs: 0xc8e0f4, hg: 0x3a3a36, hi: 0.62, fog: 0x9fc0da, water: 0x1c5e88, spec: 0x242b32, smoke: 0xbcbcbc }
];
const _ca = new THREE.Color(), _cb = new THREE.Color();
function skyAt(elev) {
  let i = 0; while (i < SKY_KEYS.length - 2 && elev > SKY_KEYS[i + 1].e) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
  const t = clamp((elev - a.e) / (b.e - a.e), 0, 1);
  const out = {};
  for (const k of ['sun', 'hs', 'hg', 'fog', 'water', 'spec', 'smoke']) {
    _ca.setHex(a[k]); _cb.setHex(b[k]); out[k] = _ca.clone().lerp(_cb, t);
  }
  out.si = lerp(a.si, b.si, t); out.hi = lerp(a.hi, b.hi, t);
  return out;
}

/* ===== Canvas-generated textures ===== */
function radialTex(stops, size) {
  size = size || 64;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(s => gr.addColorStop(s[0], s[1]));
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
function smokeTex() {
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  for (let i = 0; i < 7; i++) {
    const x = s / 2 + rand(-10, 10), y = s / 2 + rand(-10, 10), r = rand(12, 22);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
  return new THREE.CanvasTexture(c);
}
const TEX = {
  glow: radialTex([[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,0.9)'], [0.4, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]),
  flash: radialTex([[0, 'rgba(255,255,240,1)'], [0.25, 'rgba(255,220,120,0.9)'], [0.6, 'rgba(255,120,30,0.3)'], [1, 'rgba(255,80,0,0)']]),
  soft: radialTex([[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]),
  smoke: smokeTex()
};
