'use strict';
/* ===== Scene, audio, gunfire, flight-deck panel, Wallpaper Engine properties ===== */
let scene, camera, renderer, sunLight, hemi, water, waterUniforms, CARRIER;
let SHIPS = [], AIRCRAFT = [], FLYBYS = [], ALL_CIWS = [], ALL_GUNS = [];
const FX = {};
let airWingDirty = false;
let T = 0, paused = false, fpsLimit = 0, lastMs = 0, ready = false;
const ENV = { elev: 30, lightsOn: 0, night: 0, ppu: 10, smokeTint: new THREE.Color(0xbbbbbb), splashTint: new THREE.Color(0xffffff) };

/* ---- URL test parameters (for browser preview) ---- */
const QS = new URLSearchParams(location.search);
if (QS.has('hour')) { CFG.timeMode = 'fixed'; CFG.fixedHour = parseFloat(QS.get('hour')); }
if (QS.has('zoom')) CFG.zoom = parseFloat(QS.get('zoom'));

/* ---- Wallpaper Engine properties ---- */
function rgbFromWE(str) { return str.split(' ').map(c => Math.round(clamp(parseFloat(c), 0, 1) * 255)).join(','); }
window.wallpaperPropertyListener = {
  applyUserProperties(p) {
    const has = k => p[k] !== undefined && p[k] !== null;
    if (has('zoom')) CFG.zoom = p.zoom.value;
    if (has('camerarotate')) CFG.camRotate = p.camerarotate.value;
    if (has('rotationspeed')) CFG.camSpeed = p.rotationspeed.value;
    if (has('rotationdirection')) CFG.camDir = parseInt(p.rotationdirection.value, 10) || 1;
    if (has('timemode')) CFG.timeMode = p.timemode.value;
    if (has('fixedhour')) CFG.fixedHour = p.fixedhour.value;
    if (has('audiosensitivity')) CFG.sens = p.audiosensitivity.value;
    if (has('fireintensity')) CFG.fire = p.fireintensity.value;
    if (has('flybyfrequency')) CFG.flyby = p.flybyfrequency.value;
    if (has('autoflight')) CFG.auto = p.autoflight.value;
    if (has('shadows')) CFG.shadows = p.shadows.value;
    if (has('showpanel')) CFG.showPanel = p.showpanel.value;
    if (has('panelposition')) CFG.panelPos = p.panelposition.value;
    if (has('panelscale')) CFG.panelScale = p.panelscale.value;
    if (has('waveheight')) CFG.waves = p.waveheight.value;
    if (has('shipspeed')) CFG.speed = p.shipspeed.value;
    if (has('uicolor')) CFG.uiColor = rgbFromWE(p.uicolor.value);
    if (has('subtitles')) CFG.subtitles = p.subtitles.value;
    if (has('savestate')) { CFG.saveState = p.savestate.value; if (!CFG.saveState) PERSIST.clear(); }
    if (has('missionfrequency')) CFG.missions = p.missionfrequency.value;
    if (has('camerashake')) CFG.shake = p.camerashake.value;
    if (has('enemies')) CFG.enemies = p.enemies.value;
    if (has('carriernumber')) CFG.numbers.carrier = p.carriernumber.value;
    for (const k of Object.keys(AIRCRAFT_TYPES)) if (has(k + 'count')) { const v = Math.round(p[k + 'count'].value); if (CFG.counts[k] !== v) { CFG.counts[k] = v; airWingDirty = true; } }
    if (has('ddhelis') && CFG.ddHelis !== p.ddhelis.value) { CFG.ddHelis = p.ddhelis.value; airWingDirty = true; }
    applySettings();
  },
  applyGeneralProperties(p) { if (p.fps !== undefined) fpsLimit = p.fps; },
  setPaused(v) { paused = v; if (v) PERSIST.save(); }
};

function applySettings() {
  const panel = document.getElementById('panel');
  if (panel) {
    panel.style.display = CFG.showPanel ? '' : 'none';
    panel.className = 'pos-' + CFG.panelPos + (panel.classList.contains('collapsed') ? ' collapsed' : '');
    panel.style.setProperty('--ui', CFG.uiColor);
    panel.style.setProperty('--scale', CFG.panelScale / 100);
    const chk = document.getElementById('autoChk'); if (chk) chk.checked = CFG.auto;
  }
  const title = document.querySelector('#panel .title'); if (title) title.textContent = `◆ CV-${CFG.numbers.carrier} · FLIGHT DECK CONTROL`;
  if (!ready) return;
  setShipNumbers();
  sunLight.castShadow = CFG.shadows;
  updateCamera(); updateEnvironment();
}

/* ---- init ---- */
function init() {
  const canvas = document.getElementById('c');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, precision: 'highp', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x9fc0da, 300, 800);
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 700);

  hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 0.6); scene.add(hemi);
  sunLight = new THREE.DirectionalLight(0xffffff, 1);
  sunLight.castShadow = CFG.shadows;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: -100, far: 400 });   // bounds: fitShadow()
  sunLight.shadow.bias = -0.0006; sunLight.shadow.normalBias = 0.03;
  scene.add(sunLight); scene.add(sunLight.target);

  buildWater();
  CARRIER = buildCarrier(); scene.add(CARRIER.group);
  const d1 = buildDestroyer(-1); d1.group.position.set(5, 0, -21);
  const d2 = buildDestroyer(1); d2.group.position.set(-6, 0, 20);
  scene.add(d1.group); scene.add(d2.group);
  SHIPS = [CARRIER, d1, d2];
  SHIPS.forEach(s => { s.base = s.group.position.clone(); s.ciws.forEach(m => m.ship = s); s.guns.forEach(m => m.ship = s); ALL_CIWS.push(...s.ciws); ALL_GUNS.push(...s.guns); });
  [...ALL_CIWS, ...ALL_GUNS].forEach(m => { mountRetarget(m); m.yaw = m.tYaw; m.pitch = m.tPitch; });

  FX.tracers = new Tracers(scene, 1000);
  FX.flash = new SpriteFX(scene, TEX.flash, THREE.AdditiveBlending, 120);
  FX.smoke = new SpriteFX(scene, TEX.smoke, THREE.NormalBlending, 220, true);
  FX.splash = new Splashes(scene, 20);
  FX.foam = new Foam(scene, 2800);
  FX.lights = new FlashLights(scene, 4);
  FX.tracers.onSplash = (p, big) => {
    FX.splash.spawn(p, big);
    for (let i = 0; i < 2; i++) FX.smoke.spawn(new V3(p.x, p.y + 0.5, p.z), { s0: big * 1.2, s1: big * 3, life: 1.4, a0: 0.4, color: 0xffffff, v: new V3(-WAVE.flow, 1.2, 0) });
  };

  CARRIER.group.updateMatrixWorld(true);
  CARRIER.deckY = CARRIER_DECK_Y; CARRIER.radio = RADIO_NAMES.carrier;
  CARRIER.rams = [{ pos: new V3(8.2, 2.4, -3.75), dir: new V3(0.3, 0.4, -1) }, { pos: new V3(-13.5, 2.4, 3.6), dir: new V3(-0.3, 0.4, 1) }];
  [d1, d2].forEach((d, i) => { d.deckY = 1.13; d.vls = [new V3(3.5, 1.2, -0.1), new V3(3.9, 1.2, 0.1), new V3(4.2, 1.2, -0.1)]; d.radio = RADIO_NAMES.escorts[i]; d.pad = { x: -6.75, z: 0, yaw: 0 }; });

  ready = true;
  window.addEventListener('resize', resize);
  buildUI(); buildAirWing(); applySettings(); resize(); updateEnvironment();
  requestAnimationFrame(frame);
}

/* ---- air wing from the per-type counts (a fresh build: everything starts on deck / in the hangar) ---- */
let airWingBuiltAt = 0;
function buildAirWing() {
  airWingDirty = false; airWingBuiltAt = T;
  AIRCRAFT.forEach(a => a.dispose()); AIRCRAFT = []; AIRWAR.passes.length = 0; missionWorldReset();
  HELI_LIGHTS.n = 0;
  resetDeck();
  const fixedSpots = DECK.fixedSpots.slice(0, DECK.INITIAL_DECK), heliSpots = DECK.heliSpots.slice();
  // deck spots go round-robin across types, everything else lives in the hangar
  const plan = [];
  const queues = FIXED_ORDER.map(k => ({ k, n: CFG.counts[k] || 0, i: 0, cs: callsignsFor(k, CFG.counts[k] || 0) }));
  let left = true;
  while (left) { left = false; for (const q of queues) if (q.i < q.n) { plan.push({ k: q.k, cs: q.cs[q.i++] }); left = true; } }
  for (const it of plan) {
    const spot = fixedSpots.shift();
    AIRCRAFT.push(new AIRCRAFT_TYPES[it.k]({ callsign: it.cs, host: CARRIER, home: spot ? 'deck' : 'hangar', spot }));
  }
  for (const k of HELI_ORDER) {
    const n = CFG.counts[k] || 0, cs = callsignsFor(k, n);
    for (let i = 0; i < n; i++) {
      const spot = heliSpots.shift();
      AIRCRAFT.push(new AIRCRAFT_TYPES[k]({ callsign: cs[i], host: CARRIER, home: spot ? 'deck' : 'hangar', spot: spot || DECK.heliPad }));
    }
    if (k === 'mh60' && CFG.ddHelis) {       // one transport helicopter per destroyer
      SHIPS.slice(1).forEach((d, i) => AIRCRAFT.push(new MH60({ callsign: CALLSIGNS.ddheli[i], host: d, home: 'deck', spot: d.pad })));
    }
  }
  buildList();
  // the last session's aircraft in the air / on missions come back (js/persist.js); otherwise part of the air wing
  // goes up right away: two flights (or lead sections)
  const restored = PERSIST.restore();
  if (CFG.auto && !restored) { autoLaunch(); autoLaunch(); }
  autoTimer = rand(8, 14);
}
/* A count changed: the air wing adapts in place. New aircraft join in the hangar (callsigns continue the flights);
   aircraft over the new count retire — they land first and leave once on deck / in the hangar (retireAircraft).
   Right after a fresh build (settings applied at start-up) it simply rebuilds. */
function syncAirWing() {
  if (T - airWingBuiltAt < 3) { buildAirWing(); return; }
  airWingDirty = false;
  for (const k of [...FIXED_ORDER, ...HELI_ORDER]) {
    const cs = callsignsFor(k, CFG.counts[k] || 0), mine = AIRCRAFT.filter(a => a.spec.key === k && a.host === CARRIER);
    for (const a of mine) a.retiring = !cs.includes(a.callsign);                 // back in if it was retiring
    for (const c of cs) if (!mine.some(a => a.callsign === c))
      AIRCRAFT.push(new AIRCRAFT_TYPES[k]({ callsign: c, host: CARRIER, home: 'hangar', spot: AIRCRAFT_TYPES[k].prototype instanceof Helicopter ? DECK.heliPad : null }));
  }
  SHIPS.slice(1).forEach((d, i) => {                                             // the destroyers' helicopters
    const a = AIRCRAFT.find(x => x.host === d);
    if (a) a.retiring = !CFG.ddHelis;
    else if (CFG.ddHelis) AIRCRAFT.push(new MH60({ callsign: CALLSIGNS.ddheli[i], host: d, home: 'deck', spot: d.pad }));
  });
  buildList();
}
/* retiring aircraft come back and leave the air wing once they are down (no lift, catapult or pass is held then) */
function retireAircraft() {
  let gone = false;
  for (let i = AIRCRAFT.length - 1; i >= 0; i--) {
    const a = AIRCRAFT[i]; if (!a.retiring) continue;
    if (isDown(a)) { a.dispose(); AIRCRAFT.splice(i, 1); gone = true; }
    else if (a.canLand()) a.requestLand();
  }
  if (gone) buildList();
}

/* Faceted water. The facet normal is computed in the vertex shader from the three
   displaced corners of each triangle (passed as attributes) instead of screen-space
   derivatives — those lose precision on mobile GPUs and caused washed-out water. */
function buildWater() {
  let geo = new THREE.PlaneGeometry(900, 900, 180, 180); geo.rotateX(-Math.PI / 2); geo = geo.toNonIndexed();
  const pos = geo.attributes.position, n = pos.count;
  const tri = [new Float32Array(n * 2), new Float32Array(n * 2), new Float32Array(n * 2)];
  for (let t = 0; t < n; t += 3) for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) {
    tri[c][(t + k) * 2] = pos.getX(t + c); tri[c][(t + k) * 2 + 1] = pos.getZ(t + c);
  }
  geo.setAttribute('triA', new THREE.BufferAttribute(tri[0], 2));
  geo.setAttribute('triB', new THREE.BufferAttribute(tri[1], 2));
  geo.setAttribute('triC', new THREE.BufferAttribute(tri[2], 2));
  waterUniforms = { uPh: { value: new THREE.Vector4() }, uAmp: { value: 1 } };
  const mat = new THREE.MeshPhongMaterial({ color: 0x1c5a82, specular: 0x506070, shininess: 60 });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uPh = waterUniforms.uPh; sh.uniforms.uAmp = waterUniforms.uAmp;
    sh.vertexShader = 'attribute vec2 triA;\nattribute vec2 triB;\nattribute vec2 triC;\n' + WAVE_GLSL + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `
        vec3 wA = vec3(triA.x, waveH(triA), triA.y), wB = vec3(triB.x, waveH(triB), triB.y), wC = vec3(triC.x, waveH(triC), triC.y);
        vec3 objectNormal = normalize(cross(wB - wA, wC - wA));
        if (objectNormal.y < 0.0) objectNormal = -objectNormal;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y += waveH(position.xz);');
  };
  water = new THREE.Mesh(geo, mat); water.receiveShadow = true; scene.add(water);
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  updateCamera();
}
function updateCamera() {
  const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
  const viewH = 60 * 100 / CFG.zoom;
  camera.left = -viewH * aspect / 2; camera.right = viewH * aspect / 2; camera.top = viewH / 2; camera.bottom = -viewH / 2;
  camera.updateProjectionMatrix();
  ENV.ppu = h / viewH;
  scene.fog.near = CAM_D - 30; scene.fog.far = CAM_D + 260;
  updateCameraPose();
}
const CAM_D = 160, CAM_TGT = new V3(0, 2.5, 1);
let camAz = CFG.camAngle * DEG;
function updateCameraPose() {
  const el = CFG.camElev * DEG;
  camera.position.set(CAM_TGT.x + Math.cos(el) * Math.cos(camAz) * CAM_D, CAM_TGT.y + Math.sin(el) * CAM_D, CAM_TGT.z + Math.cos(el) * Math.sin(camAz) * CAM_D);
  if (camShake > 0.001) {
    const a = camShake * camShake * 0.35;
    camera.position.x += rand(-a, a); camera.position.y += rand(-a, a); camera.position.z += rand(-a, a);
  }
  camera.lookAt(CAM_TGT);
}

/* ---- time of day & lighting ---- */
function updateEnvironment() {
  const sp = sunPosition(getNow(), CFG.lat, CFG.lon);
  ENV.elev = sp.elev;
  const k = skyAt(sp.elev);
  const dirOf = (az, el) => new V3(Math.sin(az * DEG) * Math.cos(el * DEG), Math.sin(el * DEG), -Math.cos(az * DEG) * Math.cos(el * DEG));
  const sunDir = dirOf(sp.az, Math.max(sp.elev, 7)), moonDir = dirOf(sp.az + 160, 42);
  const dir = sunDir.lerp(moonDir, smoothstep(-2, -7, sp.elev)).normalize();
  sunLight.position.copy(dir).multiplyScalar(150); sunLight.target.position.set(0, 0, 0);
  sunLight.color.copy(k.sun); sunLight.intensity = k.si;
  hemi.color.copy(k.hs); hemi.groundColor.copy(k.hg); hemi.intensity = k.hi;
  scene.fog.color.copy(k.fog); renderer.setClearColor(k.fog);
  water.material.color.copy(k.water); water.material.specular.copy(k.spec);
  ENV.smokeTint.copy(k.smoke);
  ENV.splashTint.copy(k.smoke).lerp(new THREE.Color(0xffffff), 0.35);
  ENV.lightsOn = 1 - smoothstep(-3, 5, sp.elev);
  ENV.night = 1 - smoothstep(-10, 1, sp.elev);
  FX.foam.bright = lerp(0.13, 0.3, smoothstep(-8, 10, sp.elev));
  SHIPS.forEach(s => s.winMat.emissive.setHex(0xffc27a).multiplyScalar(0.75 * ENV.lightsOn));
}

/* ---- audio ---- */
/* Sound must last ARM_DELAY seconds before the fleet opens fire — short notification sounds never trigger it.
   Combat is latched (updateArming): when the sound stops, the fleet holds for DISARM_DELAY seconds ("no more
   contacts" — no new enemies, passes or missions) and only then stands down; sound lasting RESUME_DELAY seconds in the
   meantime resumes the fight (a notification ping doesn't). */
const ARM_DELAY = 5, DISARM_DELAY = 5, RESUME_DELAY = 1;
const AUD = { level: 0, lastActive: -99, soundStart: -1, wasArmed: false, raw: new Float32Array(128), demo: false, combat: false, holdUntil: 0,
  get active() { return RT() - this.lastActive < 1.6; },
  get hot() { return this.soundStart >= 0 && this.active && RT() - this.soundStart >= ARM_DELAY; },   // long enough to fight
  get armed() { return this.combat; },                        // engaged: aircraft in combat, no missions
  get holding() { return this.holdUntil > 0; },
  get fighting() { return this.combat && !this.holding; } };  // armed and not holding: enemies, passes, weapons, chatter
function updateArming() {
  if (!AUD.combat) { AUD.combat = AUD.hot; return; }
  // during the hold only sound that keeps going for RESUME_DELAY s brings the fight back
  if (AUD.active && (!AUD.holding || AUD.lastActive - AUD.soundStart >= RESUME_DELAY)) {
    if (AUD.holding) {
      AUD.holdUntil = 0; const [w, role] = hq(); RADIO.say(w, radioLine(COMBAT.resume), { role, cat: 'combat', prio: 3 });
      if (enemyOnAir() && Math.random() < 0.6) enemySay(ENEMY_NAMES.hq, ENEMY_LINES.again, null, { delay: 1.5 });
    }
    return;
  }
  if (!AUD.holding) {
    AUD.holdUntil = RT() + DISARM_DELAY; const [w, role] = hq(); RADIO.say(w, radioLine(COMBAT.lull), { role, cat: 'combat', prio: 3 });
    if (enemyOnAir() && Math.random() < 0.6) enemySay(ENEMY_NAMES.hq, ENEMY_LINES.withdraw, null, { delay: 1.5 });
  }
  else if (RT() >= AUD.holdUntil) { AUD.holdUntil = 0; AUD.combat = false; }   // updateChatter says COMBAT.end
}
function RT() { return performance.now() / 1000; }   // real-time clock (independent of FPS limits)
const BANDS = {
  low:  { from: 0, to: 4,   thr: 0.10, ratio: 1.35, gap: 0.2,  hist: [], prev: 0, last: -9, val: 0, fh: [], peak: 0.2, norm: 0 },
  mid:  { from: 6, to: 22,  thr: 0.05, ratio: 1.30, gap: 0.12, hist: [], prev: 0, last: -9, val: 0, fh: [], peak: 0.2, norm: 0 },
  high: { from: 26, to: 56, thr: 0.03, ratio: 1.30, gap: 0.10, hist: [], prev: 0, last: -9, val: 0, fh: [], peak: 0.2, norm: 0 }
};
const PREV_RAW = new Float32Array(128);
AUD.heavy = 0;   // 0..1 — how dense/loud the music is right now (auto-gained)
function onAudio(arr) {
  if (!ready) return;
  for (let i = 0; i < 128; i++) AUD.raw[i] = Math.min(1, arr[i] || 0);
  const sens = Math.max(0.1, CFG.sens / 100); let tot = 0;
  for (const key in BANDS) {
    const b = BANDS[key]; let e = 0, n = 0;
    for (let i = b.from; i <= b.to; i++) { e += AUD.raw[i] + AUD.raw[64 + i]; n += 2; }
    e /= n;
    let avg = e; if (b.hist.length) { avg = 0; for (const h of b.hist) avg += h; avg /= b.hist.length; }
    b.hist.push(e); if (b.hist.length > 40) b.hist.shift();
    const thr = b.thr / sens, ratio = 1 + (b.ratio - 1) / sens;
    // spectral flux: rises in individual bins catch hits even inside a dense, compressed mix
    let flux = 0;
    for (let i = b.from; i <= b.to; i++) flux += Math.max(0, AUD.raw[i] - PREV_RAW[i]) + Math.max(0, AUD.raw[64 + i] - PREV_RAW[64 + i]);
    flux /= n;
    let fm = 0, fs = 0; for (const f of b.fh) fm += f; fm /= Math.max(1, b.fh.length);
    for (const f of b.fh) fs += (f - fm) * (f - fm); fs = Math.sqrt(fs / Math.max(1, b.fh.length));
    b.fh.push(flux); if (b.fh.length > 30) b.fh.shift();
    const energyHit = e > thr && e > avg * ratio && e > b.prev * 1.04;
    const fluxHit = e > thr * 0.6 && flux > fm + fs * (1.6 / sens) && flux > 0.02 / sens;
    if ((energyHit || fluxHit) && RT() - b.last > b.gap) {
      b.last = RT(); onBeat(key, clamp(Math.max(e / Math.max(avg, 0.01), 1 + flux / Math.max(fm, 0.005) * 0.15), 1, 3));
    }
    // automatic gain: normalised loudness per band
    b.peak = Math.max(e, b.peak * 0.9985, 0.05); b.norm = e / b.peak;
    b.prev = e; b.val = e; tot += e;
  }
  PREV_RAW.set(AUD.raw);
  const dense = (BANDS.mid.norm * 0.5 + BANDS.low.norm * 0.3 + BANDS.high.norm * 0.2) * smoothstep(0.03, 0.12, (BANDS.mid.val + BANDS.low.val) / 2);
  AUD.heavy += (dense - AUD.heavy) * (dense > AUD.heavy ? 0.08 : 0.02);
  AUD.level = tot / 3;
  if (AUD.level > 0.012) { if (AUD.soundStart < 0 || !AUD.active) AUD.soundStart = RT(); AUD.lastActive = RT(); }
  else if (!AUD.active) AUD.soundStart = -1;
}
/* Browser-only demo beat (controlled from the settings panel) */
const DEMO = { on: false, bpm: 124, level: 1, pauses: true, notifyUntil: 0 };
const FILE_AUDIO = { playing: false };           // filled in by settings.js (browser only)
function demoAudio() {
  if (FILE_AUDIO.playing) return;                   // the audio file feeds onAudio() itself
  const t = performance.now() / 1000, arr = new Array(128).fill(0);
  if (!DEMO.on) { onAudio(arr); return; }
  const beat = 60 / DEMO.bpm, ph = t % beat, bi = Math.floor(t / beat), bar = Math.floor(bi / 4) % 12;
  if (DEMO.pauses && bar >= 10) { onAudio(arr); return; } // silent bars to test the 'no music' state
  const kick = Math.exp(-ph * 14), snare = (bi % 2 === 1) ? Math.exp(-ph * 12) : 0, hat = Math.exp(-(t % (beat / 2)) * 30);
  for (let i = 0; i < 64; i++) {
    let v = 0.03 * Math.random();
    if (i < 6) v += 0.8 * kick; if (i >= 6 && i < 24) v += 0.55 * snare + 0.08; if (i >= 26) v += 0.35 * hat * (1 - i / 80);
    arr[i] = arr[64 + i] = v * DEMO.level;
  }
  onAudio(arr);
}

/* ---- gunfire ---- */
const _p = new V3(), _d = new V3();
let gunTurn = 0;
function fireGun(m, strength) {
  mountMuzzle(m, _p, _d);
  const tgt = m.track && enemyAlive(m.track) && Math.random() < 0.7 ? m.track : null;
  if (tgt) {                                       // AA mode: shell flies straight at the lead point
    const speed = 80, aim = leadPoint(tgt, _p, speed), tt = aim.distanceTo(_p) / speed, dir = aim.sub(_p).normalize();
    FX.tracers.spawn(_p, dir.clone().multiplyScalar(speed), { life: tt, len: 1.6, w: 0.3, color: 0xffb050 });
    FX.flash.spawn(_p.clone().addScaledVector(dir, 0.5), { s0: 2.4 * Math.min(1.5, strength), s1: 3.6, life: 0.13, a0: 1 });
    for (let i = 0; i < 2; i++) FX.smoke.spawn(_p.clone().addScaledVector(dir, 0.4 + i * 0.5), { s0: 0.9, s1: 4, life: 2.2, a0: 0.5, smoke: true, v: dir.clone().multiplyScalar(3).add(new V3(-WAVE.flow * 1.3, 0.5, 0)), drag: 0.9 });
    FX.lights.flash(_p, 4, 0.16);
    queueHit(tgt, { chance: 0.5, dmg: 1, src: m.ship, delay: tt });
    m.recoil = 1; return;
  }
  const v = _d.clone().multiplyScalar(rand(38, 50));
  FX.tracers.spawn(_p, v, { life: 6, len: 1.5, w: 0.3, color: 0xffb050, grav: 12, splash: 1.1 });
  FX.flash.spawn(_p.clone().addScaledVector(_d, 0.5), { s0: 2.4 * Math.min(1.5, strength), s1: 3.6, life: 0.13, a0: 1 });
  FX.flash.spawn(_p.clone().addScaledVector(_d, 1.4), { s0: 1.4, s1: 2.2, life: 0.09, a0: 0.8 });
  for (let i = 0; i < 3; i++) FX.smoke.spawn(_p.clone().addScaledVector(_d, 0.4 + i * 0.5), { s0: 0.9, s1: 4.5, life: 2.4, a0: 0.55, smoke: true, v: _d.clone().multiplyScalar(rand(2, 4.5)).add(new V3(-WAVE.flow * 1.3, 0.5, 0)), drag: 0.9 });
  FX.lights.flash(_p, 4, 0.16);
  m.recoil = 1; mountRetarget(m);
}
/* ---- heavy-music weapons: flak airbursts, VLS and RAM missiles ---- */
const FLAK = [];
let camShake = 0;
function fireFlak() {
  const g = pick(ALL_GUNS); if (!g || g.flakCd > 0) return;
  g.flakCd = 0.35;
  // aim high into the sky over a random bearing, burst at altitude
  g.tYaw = g.center + rand(-g.half, g.half); g.tPitch = rand(0.7, 1.1);
  mountMuzzle(g, _p, _d);
  const dir = _d.clone(); dir.y = Math.max(dir.y, 0.55); dir.normalize();
  const dist = rand(35, 60), speed = 70, tt = dist / speed;
  const burst = _p.clone().addScaledVector(dir, dist);
  FX.tracers.spawn(_p, dir.clone().multiplyScalar(speed), { life: tt, len: 1.3, w: 0.25, color: 0xffc070 });
  FX.flash.spawn(_p.clone().addScaledVector(_d, 0.5), { s0: 2.0, s1: 3.0, life: 0.1, a0: 1 });
  FX.smoke.spawn(_p.clone(), { s0: 0.8, s1: 3.5, life: 1.8, a0: 0.45, smoke: true, v: new V3(-WAVE.flow * 1.3, 0.6, 0), drag: 0.9 });
  g.recoil = 1;
  FLAK.push({ at: T + tt, p: burst });
}
function updateFlak(dt) {
  for (const g of ALL_GUNS) g.flakCd = Math.max(0, (g.flakCd || 0) - dt);
  for (let i = FLAK.length - 1; i >= 0; i--) {
    const f = FLAK[i]; if (T < f.at) continue;
    FX.flash.spawn(f.p, { s0: 3.2, s1: 5.5, life: 0.18, a0: 1 });
    for (let k = 0; k < 3; k++) FX.smoke.spawn(f.p.clone().add(new V3(rand(-0.8, 0.8), rand(-0.5, 0.5), rand(-0.8, 0.8))), { s0: 1.4, s1: 4.8, life: 3.2, a0: 0.7, color: 0x2e3034, v: new V3(-WAVE.flow * 0.6, 0.15, 0), drag: 0.6 });
    FX.lights.flash(f.p, 3, 0.15);
    FLAK.splice(i, 1);
  }
}
function spawnGuidedMissile(p, v, turnAt, dir, speed, life, big, target, chance, src) {
  MISSILES.push({ p, v, life, smokeT: 0, guided: { turnAt, dir, speed, age: 0 }, big, target: target || null, chance: chance || 0.75, dmg: 2, src, speed });
}
function launchVLS() {
  const ships = SHIPS.filter(s => s.vls && (s.vlsCd || 0) <= 0); if (!ships.length) return;
  const s = pick(ships); s.vlsCd = 3.2;
  const cell = pick(s.vls), p = cell.clone(); s.group.localToWorld(p);
  const out = s.side;   // always away from the carrier
  const ang = rand(0, TAU), dir = new V3(Math.cos(ang), rand(0.15, 0.45), Math.sin(ang) * 0.6 + out * 0.8).normalize();
  const bandits = CFG.enemies ? ENEMIES.filter(e => e.kind === 'bandit' && !e.duel && enemyAlive(e)) : [];
  spawnGuidedMissile(p, new V3(0, 16, 0), 0.7, dir, 45, 6, true, bandits.length ? pick(bandits) : null, 0.82, s);
  for (let i = 0; i < 6; i++) FX.smoke.spawn(p.clone().add(new V3(rand(-0.5, 0.5), rand(0, 0.6), rand(-0.5, 0.5))), { s0: 1.2, s1: 4.5, life: 2.6, a0: 0.7, smoke: true, v: new V3(rand(-1, 1) - WAVE.flow, rand(0.5, 1.5), rand(-1, 1)), drag: 0.8 });
  FX.flash.spawn(p, { s0: 3, s1: 4, life: 0.25, a0: 1 }); FX.lights.flash(p, 4, 0.4);
  if (Math.random() < 0.5) RADIO.say(s.radio || RADIO_NAMES.carrier, radioLine(COMBAT.vls), { role: 'ship', cat: 'combat', prio: 0 });
}
function launchRAM() {
  if (!CARRIER.rams || (CARRIER.ramCd || 0) > 0) return;
  CARRIER.ramCd = 1.2;
  const l = pick(CARRIER.rams), p = l.pos.clone(); CARRIER.group.localToWorld(p);
  const dir = l.dir.clone(); dir.x += rand(-0.4, 0.4); dir.y = rand(0.25, 0.6); dir.normalize();
  const tgt = CFG.enemies ? (nearestEnemy(p, ['vampire'], 90) || nearestEnemy(p, ['bandit'], 90)) : null;
  spawnGuidedMissile(p, dir.clone().multiplyScalar(20), 0.2, dir, 60, 4, false, tgt, 0.75, CARRIER);
  FX.flash.spawn(p, { s0: 1.6, s1: 2.2, life: 0.12, a0: 1 });
}

let ciwsGap = 0;
function startCIWS(dur) {
  if (RT() < ciwsGap) return;                                           // short pause between new bursts
  if (ALL_CIWS.filter(m => m.burst > 0).length >= 2) return;          // never more than 2 mounts at once
  const idle = ALL_CIWS.filter(m => m.burst <= 0 && (m.cd || 0) <= 0);   // mounts rest between bursts
  if (!idle.length) return;
  const tracked = idle.filter(k => enemyAlive(k.track));            // mounts with a target in range go first
  const m = tracked.length ? pick(tracked) : pick(idle);
  m.burst = dur * (1 + AUD.heavy * 0.3); m.acc = 0; m.burstTarget = enemyAlive(m.track) ? m.track : null;
  ciwsGap = RT() + 0.4;
}
function onBeat(band, strength) {
  const f = CFG.fire / 100;
  if (f <= 0 || !AUD.fighting || paused) return;   // no frames run while paused: spawned missiles/shells would only pile up
  resolveHits(true);                     // projectiles that reached a target score on the beat
  const heavy = AUD.heavy;
  if (band === 'low' && strength > 1.5 && CFG.shake) camShake = Math.min(1, camShake + 0.35 + heavy * 0.4);
  // heavy passages: vertical missile launches and RAM salvos on the biggest hits
  if (band === 'low' && heavy > 0.55 && strength > 1.6 && Math.random() < 0.5 * f) launchVLS();
  if (band !== 'low' && heavy > 0.6 && Math.random() < 0.12 * f) launchRAM();
  // flak barrage over the fleet while it's heavy
  if (band === 'mid' && heavy > 0.45 && Math.random() < (0.35 + heavy * 0.5) * f) fireFlak();
  if (band === 'low') {
    if (Math.random() < Math.min(1, f)) {
      const g = ALL_GUNS[gunTurn++ % ALL_GUNS.length]; fireGun(g, strength);
      if ((strength > 1.8 && Math.random() < 0.5) || f > 1.5) fireGun(ALL_GUNS[gunTurn++ % ALL_GUNS.length], strength);
    }
    for (const fb of FLYBYS) if (Math.random() < 0.45) fb.fireMissile();
  } else if (band === 'mid') {
    startCIWS(rand(0.12, 0.28) * Math.max(0.5, f));
    for (const fb of FLYBYS) fb.fireGuns(0.28);
  } else if (band === 'high') {
    if (Math.random() < 0.35 * f) startCIWS(0.1);
  }
  AIRWAR.onBeat(band, f);               // fighters and attack helicopters on their passes (js/airwar.js)
}
function updateMounts(dt) {
  const hunting = CFG.enemies && ENEMIES.length;
  for (const m of ALL_GUNS) {
    if (hunting) { mountMuzzle(m, _p, _d); m.track = nearestEnemy(_p, ['bandit'], 85); if (m.track) aimMountAt(m, leadPoint(m.track, _p, 80)); } else m.track = null;
    mountUpdate(m, dt);
  }
  if (hunting) for (const m of ALL_CIWS) {
    mountMuzzle(m, _p, _d);
    m.track = nearestEnemy(_p, ['vampire'], 60) || nearestEnemy(_p, ['bandit'], 45);
    if (m.track) aimMountAt(m, leadPoint(m.track, _p, 95));
  }
  SHIPS.forEach(s => { s.vlsCd = Math.max(0, (s.vlsCd || 0) - dt); s.ramCd = Math.max(0, (s.ramCd || 0) - dt); });

  for (const m of ALL_CIWS) {
    mountUpdate(m, dt);
    m.cd = Math.max(0, (m.cd || 0) - dt);
    if (m.burst > 0) {
      m.burst -= dt; m.acc += dt; m.tYaw += rand(-0.6, 0.6) * dt;
      // this mount's muzzle every frame, shots or not: _p is shared and may still hold another mount's
      mountMuzzle(m, _p, _d);
      if (enemyAlive(m.burstTarget)) _d.copy(leadPoint(m.burstTarget, _p, 95)).sub(_p).normalize();
      let shots = 0;
      while (m.acc > 1 / 45) {
        m.acc -= 1 / 45; shots++;
        const v = _d.clone().multiplyScalar(95); v.x += rand(-2.5, 2.5); v.y += rand(-2.5, 2.5); v.z += rand(-2.5, 2.5);
        FX.tracers.spawn(_p, v, { life: 1.1, len: 1.9, w: 0.11, color: Math.random() < 0.5 ? 0xff9a40 : 0xffd070 });
        if (Math.random() < 0.6) FX.flash.spawn(_p.clone().addScaledVector(_d, 0.2), { s0: 0.8, s1: 1.0, life: 0.05, a0: 0.95 });
      }
      if (shots && Math.random() < 0.3) FX.lights.flash(_p, 2.2, 0.06);
      if (Math.random() < dt * 14) FX.smoke.spawn(_p.clone(), { s0: 0.4, s1: 1.8, life: 1.2, a0: 0.35, smoke: true, v: new V3(-WAVE.flow * 1.3, 0.4, 0) });
      if (m.burst <= 0) {
        if (enemyAlive(m.burstTarget) && m.burstTarget.p.distanceTo(_p) < 65) queueHit(m.burstTarget, { chance: m.burstTarget.kind === 'vampire' ? (m.lastDitch ? 0.85 : 0.65) : 0.25, dmg: 1, src: m.ship });
        m.lastDitch = false;
        m.burstTarget = null; mountRetarget(m); m.cd = rand(0.5, 1.1);
      }
    }
  }
}

/* ---- auto flight ops: whole flights or their lead section, never random singles ---- */
let autoTimer = 6, flybyTimer = rand(8, 14);
const csNum = a => +((/\s(\d+)$/.exec(a.callsign) || [0, 0])[1]);
/* flights = aircraft sharing a callsign (WARDOG 1…4), in callsign order */
function flightGroups() {
  const g = new Map();
  for (const a of AIRCRAFT) { const base = flightOf(a); if (!g.has(base)) g.set(base, []); g.get(base).push(a); }
  for (const list of g.values()) list.sort((a, b) => csNum(a) - csNum(b));
  return g;
}
const isDown = a => a.state === 'parked' || a.state === 'hangar';
// not launching or landing right now (an aircraft holding in orbit for its turn to land is landing)
const settled = a => isDown(a) || ((a.state === 'orbit' || a.onMission || a.inCombat) && !a.landReq);
function wpick(cands) { let r = Math.random() * cands.reduce((s, c) => s + c.w, 0); for (const c of cands) if ((r -= c.w) <= 0) return c; return cands[cands.length - 1]; }
const flightSize = n => n >= 4 && Math.random() < 0.5 ? 2 : n;   // a four-ship flight goes as a pair or as all four
// in combat: flights come back to rearm now and then (a try on 30 % of the ticks, after 2 min up), the AWACS and a tanker already up stay up
const CBT_RECOVER_P = 0.3, CBT_SORTIE = 120;
const TANKER_STATION = 300;   // in peace the tanker stays up at least 5 min (refuelling passes need it on station)
const engaged = a => a.inCombat && !a.landReq && !a.tank;   // a flight away refuelling isn't fighting
function autoLaunch(joinOnly) {
  const cands = [], armed = AUD.armed;
  for (const all of flightGroups().values()) {
    if (!all.every(settled) || all[0].spec.tanker) continue;   // the tanker goes up for refuelling passes only (TANKER / scrambleSupport)
    const down = all.filter(isDown); if (!down.length) continue;
    const split = down.length < all.length;     // part of the flight is already up: send the rest to join it
    if (joinOnly && !split) continue;
    const n = split ? down.length : flightSize(down.length);
    const w = (split ? 4 : 1) + down.filter(a => a.state === 'parked').length * 0.5;
    cands.push({ list: down.slice(0, n), w: armed && down[0].spec.armed ? w * 3 : w });   // in combat fighters go first
  }
  if (!cands.length) return false;
  for (const a of wpick(cands).list) a.requestLaunch();
  return true;
}
/* combat: the AWACS goes up first if it is on deck (one type per call); the tanker isn't scrambled (no refuelling in combat) */
function scrambleSupport() {
  const sup = AIRCRAFT.filter(a => a.isAwacs && !a.retiring);
  for (const key of new Set(sup.map(a => a.spec.key))) {
    const kind = sup.filter(a => a.spec.key === key);
    if (kind.some(a => !isDown(a))) continue;
    const all = flightGroups().get(flightOf(kind[0]));
    if (!all.every(settled)) continue;
    for (const a of all.filter(isDown)) a.requestLaunch();
    return true;
  }
  return false;
}
function autoRecover() {
  const armed = AUD.armed;
  if (armed && Math.random() > CBT_RECOVER_P) return false;
  const groups = [...flightGroups().values()], cands = [];
  for (const all of groups) {
    if (!all.every(settled) || all.some(a => a.onMission || a.tank) || (armed && all.some(a => a.isSupport))) continue;
    const air = all.filter(a => (a.state === 'orbit' || a.inCombat) && !a.landReq);
    // a pair whose flight-mates are still on deck waits for them to join instead of being recovered
    // the tanker isn't recovered while a refuelling pass is due (TANKER.update would launch it again right away)
    const minUp = armed ? CBT_SORTIE : all[0].spec.tanker ? (TANKER.timer < 120 ? Infinity : TANKER_STATION) : 25;
    if (!air.length || air.length < all.length || air.some(a => a.airT < minUp)) continue;
    // an armed flight leaves the fight only while another one stays engaged
    if (armed && air[0].spec.armed && combatOn() && !groups.some(l => l !== all && l.some(engaged))) continue;
    cands.push({ list: air, w: armed ? 1 : 1 + Math.min(...air.map(a => a.airT)) / 60 });   // peace: longest on station first
  }
  if (!cands.length) return false;
  for (const a of wpick(cands).list) a.requestLand();
  return true;
}
function autoFlight(dt) {
  if (!CFG.auto) return;
  autoTimer -= dt; if (autoTimer > 0) return;
  autoTimer = rand(10, 20);
  // now and then a flight on station moves to a new orbit distance (the lead picks, the wingmen follow)
  if (!combatOn() && Math.random() < 0.2) {
    const onStation = [...flightGroups().values()].filter(l => l.every(a => a.state === 'orbit' && !a.landReq));
    if (onStation.length) pick(onStation).forEach((a, i) => a.pickOrbit(false, i === 0));
  }
  if (AUD.armed && scrambleSupport()) return;
  // a pair already up is usually joined by the rest of its flight, even past the air wing cap
  if (Math.random() < 0.7 && autoLaunch(true)) return;
  const busy = AIRCRAFT.filter(a => !isDown(a)).length;
  const N = AIRCRAFT.length;
  if ((busy < Math.max(3, N * 0.5) || (busy < N * 0.65 && Math.random() < 0.25)) && autoLaunch()) return;
  autoRecover();
}
function updateFlybys(dt) {
  if (CFG.flyby > 0) {
    flybyTimer -= dt;
    if (flybyTimer <= 0) { FLYBYS.push(new Flyby()); const mean = lerp(90, 10, (CFG.flyby - 1) / 9); flybyTimer = rand(0.6, 1.4) * mean; }
  }
  for (const f of FLYBYS) f.update(dt);
  for (let i = FLYBYS.length - 1; i >= 0; i--) if (FLYBYS[i].dead) FLYBYS.splice(i, 1);
  for (let i = MISSILES.length - 1; i >= 0; i--) {
    const m = MISSILES[i]; m.life -= dt; m.smokeT += dt;
    const boosting = m.guided && m.guided.age < m.guided.turnAt;
    if (m.guided) {                      // vertical launch, then pitch over toward the target bearing
      const gd = m.guided; gd.age += dt;
      if (boosting) m.v.y += 10 * dt;
      else if (!enemyAlive(m.target)) m.v.lerp(gd.dir.clone().multiplyScalar(gd.speed), Math.min(1, dt * 2.2));
    }
    if (m.target && !boosting) {         // homing on an enemy; the hit itself is resolved on the beat
      const e = m.target;
      if (enemyAlive(e)) {
        const to = e.p.clone().sub(m.p), d = to.length(); to.normalize();
        if (m.arrived) { m.p.copy(e.p).addScaledVector(to, -1.2); m.v.copy(e.v); m.life = Math.max(m.life, 0.2); }
        else {
          m.v.lerp(to.multiplyScalar(Math.max(m.speed || 50, e.v.length() + 25)), Math.min(1, dt * 4));
          if (d < 3) { m.arrived = true; queueHit(e, { chance: m.chance, dmg: m.dmg, src: m.src, missile: m }); }
        }
      } else m.target = null;
    }
    // motor glow at a fixed 30 Hz: per-frame spawns ate the shared flash pool (cutting explosions short) and scaled with FPS
    if ((m.guided || m.glow) && (m.glowT = (m.glowT || 0) - dt) <= 1e-4) { m.glowT += 1 / 30; FX.flash.spawn(m.p, { s0: m.big ? 1.3 : 0.9, s1: m.big ? 1.1 : 0.7, life: 0.075, a0: 1 }); }
    m.p.addScaledVector(m.v, dt);
    const iv = m.small ? 0.06 : m.big ? 0.018 : 0.025;
    while (m.smokeT > iv) { m.smokeT -= iv; FX.smoke.spawn(m.p.clone(), m.big ? { s0: 0.8, s1: 3.2, life: 3.0, a0: 0.6, smoke: true, v: new V3(-WAVE.flow, 0.3, 0) } : m.small ? { s0: 0.3, s1: 1.3, life: 1.2, a0: 0.4, smoke: true, v: new V3(-WAVE.flow, 0.2, 0) } : { s0: 0.5, s1: 2.4, life: 2.2, a0: 0.5, smoke: true, v: new V3(-WAVE.flow, 0.3, 0) }); }
    if (m.life <= 0 || m.p.y < waveH(m.p.x, m.p.z)) MISSILES.splice(i, 1);
  }
}

/* ---- ships: motion, radars, searchlights, wake ---- */
const _w = new V3(), _sq = new THREE.Quaternion();
function updateShips(dt) {
  for (const s of SHIPS) {
    const b = s.base, L = s.len / 2, k = s.bob;
    const h0 = waveH(b.x, b.z), hb = waveH(b.x + L, b.z), hs = waveH(b.x - L, b.z), hp = waveH(b.x, b.z - 2.5), hst = waveH(b.x, b.z + 2.5);
    s.group.position.y = h0 * k * 0.6;
    s.group.rotation.z = Math.atan((hb - hs) / (2 * L)) * k;
    s.group.rotation.x = -Math.atan((hst - hp) / 5) * k * 0.6;
    s.group.updateMatrixWorld(true);
    s.radars.forEach((r, i) => r.rotation.y += dt * (i ? 0.9 : 1.6));
    for (const e of s.wakeEmit) {
      e.acc = (e.acc || 0) + e.rate * dt * clamp(WAVE.flow / 2.2, 0.2, 2);
      while (e.acc > 1) {
        e.acc -= 1; _w.copy(e.p); s.group.localToWorld(_w);
        FX.foam.emit(_w.x + rand(-0.3, 0.3), _w.z + rand(-0.25, 0.25), rand(-0.3, 0.3), rand(e.vz[0], e.vz[1]), e.life * rand(0.7, 1.1));
      }
    }
    for (const f of s.floods) { _w.copy(f.localAim); s.group.localToWorld(_w); f.holder.lookAt(_w); }
    if (s.searchlights) for (const sl of s.searchlights) {
      const sw = sl.sweep, ang = sw.base + Math.sin(T * sw.speed + sw.ph) * sw.amp;
      _w.set(Math.cos(ang), 0, -Math.sin(ang)).multiplyScalar(sw.dist); _w.y = -3;
      _w.applyQuaternion(s.group.quaternion).add(s.group.position); _w.y = 0;
      sl.holder.lookAt(_w);
    }
  }
}
function updateLights() {
  for (const m of NAV_MATS) {
    let a = ENV.lightsOn; const b = m.userData.blink;
    if (b) { const ph = ((T / b.period) + (b.phase || 0)) % 1; a *= ph < b.duty ? 1 : 0; }
    m.opacity = a; m.size = m.userData.scale * ENV.ppu;
  }
  for (const s of SEARCHLIGHTS) {
    const on = ENV.lightsOn * s.enabled;
    // hidden by day: a visible spot light costs every lit fragment even at zero intensity (toggles only at dusk/dawn)
    if (s.light) { s.light.intensity = s.o.intensity * on; s.light.visible = ENV.lightsOn > 0; }
    if (s.cone) s.cone.material.uniforms.uOpacity.value = s.o.coneOpacity * on * (0.45 + 0.55 * ENV.night);
  }
  FX.foam.mat.size = 1.05 * ENV.ppu;
}

/* ---- missions beyond the screen edge (only while there is no music) ---- */
let missionTimer = rand(25, 45);
const LAUNCHING = new Set(['lift_wait', 'lift_prep', 'roll_out', 'lift_up', 'queued', 'taxi_out', 'hold', 'launch', 'climb',
  'tow_pad', 'unfold', 'spinup', 'lift', 'depart']);
function updateMissions(dt) {
  if (CFG.missions <= 0 || AUD.armed) return;
  missionTimer -= dt; if (missionTimer > 0) return;
  missionTimer = rand(0.6, 1.4) * lerp(45, 5, (CFG.missions - 1) / 9);   // time between departures
  for (let n = 0; n < 2; n++) if (!dispatchFlight()) break;              // up to two flights per call
}
function dispatchFlight() {
  const cands = []; let onStation = 0;
  for (const [base, all] of flightGroups()) {
    if (all.some(a => LAUNCHING.has(a.state))) continue;
    const ready = all.filter(a => !isDown(a) && !a.onMission);
    if (!ready.length || ready.some(a => a.state !== 'orbit' || a.landReq)) continue;
    if (ready[0].spec.missions && !ready[0].spec.missions.length) continue;   // no missions (tanker): not a flight on station either
    onStation++;                                             // counts a pair left behind while the other is away
    // never send part of a flight while its other part is away; members on deck don't block (manual ops)
    if (!all.some(a => a.onMission) && ready.every(a => a.airT > 15)) cands.push({ base, ready, full: ready.length === all.length, size: all.length });
  }
  // several flights can be away at once, but one flight always stays on station over the fleet
  if (!cands.length || onStation <= 1) return false;
  // assembled flights first; a partly launched flight only goes when no flight is complete
  const full = cands.filter(c => c.full), g = pick(full.length ? full : cands);
  // a four-ship flight goes as all four or as one of its pairs (lead or second section)
  if (g.ready.length > 2 && flightSize(g.ready.length) === 2) { const sec = Math.random() < 0.5 ? 2 : 0; g.ready = g.ready.slice(sec, sec + 2); }
  // the mission itself (type, legs, radio) lives in js/missions.js
  const Type = pickMission(g.ready[0]); if (!Type) return false;
  new Type(g.ready, g.size).start();
  return true;
}

/* ---- combat radio chatter while armed ---- */
let chatterTimer = 3;
function updateChatter(dt) {
  const armed = AUD.armed;
  const awacs = AIRCRAFT.find(a => a.isAwacs && a.airborne);
  const hq = awacs ? [awacs.callsign, 'awacs'] : [RADIO_NAMES.carrier, 'ship'];
  const C = { cat: 'combat', prio: 0 };
  // the 5-second safety check before combat: unknown contacts... then either combat or a false alarm
  const arming = AUD.active && AUD.soundStart >= 0 && !armed;
  if (arming && !AUD.wasArming) RADIO.q = RADIO.q.filter(m => m.cat !== 'alert');   // a pending "false alarm" is obsolete now
  if (arming && !AUD.wasArming && T > (AUD.alertCd || 0)) {
    AUD.alertCd = T + 6; AUD.alerted = true;
    RADIO.say(hq[0], radioLine(LINES.unknownContacts, { B: bearingWords(rand(0, TAU)) }), { role: hq[1], cat: 'alert', prio: 3 });
  }
  if (!arming && AUD.wasArming && !armed && AUD.alerted) {
    AUD.alerted = false;
    RADIO.say(hq[0], radioLine(LINES.falseAlarm), { role: hq[1], cat: 'alert', prio: 3 });
  }
  if (armed && !AUD.wasArmed) RADIO.q = RADIO.q.filter(m => m.cat !== 'alert');
  if (armed) AUD.alerted = false;
  AUD.wasArming = arming;
  if (armed && !AUD.wasArmed) { RADIO.say(hq[0], radioLine(COMBAT.start), { role: hq[1], cat: 'combat', prio: 3 }); chatterTimer = rand(3, 5); }
  if (!armed && AUD.wasArmed) RADIO.say(hq[0], radioLine(COMBAT.end), { role: hq[1], prio: 2, delay: 1 });
  AUD.wasArmed = armed;
  if (!AUD.fighting) return;
  chatterTimer -= dt; if (chatterTimer > 0) return;
  chatterTimer = rand(3.5, 7) * (1 - 0.45 * STRESS.level);       // more radio traffic as stress builds
  if (RADIO.q.filter(m => m.cat === 'combat').length > 1) return;
  // fighters and helicopters talk about their own passes (js/airwar.js); here the AWACS, the ships and the enemy
  const foes = CFG.enemies ? ENEMIES.filter(e => e.cs && enemyAlive(e)) : [];
  if (foes.length && Math.random() < 0.15 + 0.25 * STRESS.level) enemySay(pick(foes).cs, ENEMY_LINES.chatter, null, { prio: 1 });
  else if (awacs && Math.random() < 0.45) awacs.say(radioLine(COMBAT.awacs), C);
  else RADIO.say(pick(RADIO_NAMES.escorts), radioLine(COMBAT.ship), { role: 'ship', cat: 'combat', prio: 0 });
}

/* ---- control panel ---- */
let uiTimer = 0, meterTimer = 0, envTimer = 0;
/* The aircraft list is paged, not scrolled: Wallpaper Engine passes clicks but no mouse wheel to the wallpaper.
   The pager (◀ n/N ▶ + a chip per aircraft type) only shows when the rows don't fit into 42 % of the window. */
const PAGER = { page: 0, size: 0, rowH: 0, shownH: 0, rows: [], chips: [] };   // shownH: the row height the page was laid out with
function pageSize() {
  const r = PAGER.rows.find(r => r.offsetHeight > 0); if (r) PAGER.rowH = r.offsetHeight;   // measured while shown (none while collapsed)
  return Math.max(4, Math.floor(innerHeight * 0.42 / (CFG.panelScale / 100) / (PAGER.rowH || 23)));
}
function showPage() {
  const n = PAGER.rows.length, size = PAGER.size = pageSize(), pages = Math.max(1, Math.ceil(n / size)); PAGER.shownH = PAGER.rowH;
  const page = PAGER.page = clamp(PAGER.page, 0, pages - 1), from = pages > 1 ? page * size : 0, to = pages > 1 ? from + size : n;
  PAGER.rows.forEach((r, i) => { r.style.display = i >= from && i < to ? '' : 'none'; });
  for (const c of PAGER.chips) c.el.classList.toggle('on', c.first < to && c.last >= from);
  document.getElementById('pager').hidden = pages <= 1;
  document.getElementById('pgInfo').textContent = `${page + 1}/${pages}`;
  // a fixed height while paged: the last, shorter page doesn't shrink the (bottom-anchored) panel under the cursor
  document.getElementById('list').style.minHeight = pages > 1 ? size * (PAGER.rowH || 23) + 'px' : '';
}
function buildList() {
  const list = document.getElementById('list'); list.innerHTML = '';
  // group flights together: by type, then callsign (JOKER 1, JOKER 2, … QUEEN 1 …)
  const typeOrder = [...FIXED_ORDER, ...HELI_ORDER];
  const csKey = cs => { const m = /^(.*?)(?:\s+(\d+))?$/.exec(cs); return [m[1], +(m[2] || 0)]; };
  const sorted = AIRCRAFT.slice().sort((a, b) => {
    const t = typeOrder.indexOf(a.spec.key) - typeOrder.indexOf(b.spec.key); if (t) return t;
    const [an, ai] = csKey(a.callsign), [bn, bi] = csKey(b.callsign);
    const gi = (k, n) => { const i = CALLSIGNS[k].indexOf(n.replace(/-\d+$/, '')); return i < 0 ? 99 : i; };
    const ga = gi(a.spec.key, an), gb = gi(b.spec.key, bn);
    return (ga - gb) || an.localeCompare(bn) || (ai - bi);
  });
  sorted.forEach(a => {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<span class="tp">${a.spec.tag}</span><span class="nm"></span><span class="st"></span><button class="act"></button>`;
    row.querySelector('.nm').textContent = a.callsign + (a.host !== CARRIER ? ' ⚓' : '');
    const btn = row.querySelector('button');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (a.canLaunch()) a.requestLaunch(); else if (a.canLand()) a.requestLand();
      updateUI();
    });
    a.ui = { row, st: row.querySelector('.st'), btn };
    list.appendChild(row);
  });
  // pages: one chip per type, jumping to the page with its first aircraft
  PAGER.rows = sorted.map(a => a.ui.row); PAGER.chips = [];
  const types = document.getElementById('pgTypes'); types.innerHTML = '';
  sorted.forEach((a, i) => {
    const c = PAGER.chips[PAGER.chips.length - 1];
    if (c && c.key === a.spec.key) { c.last = i; return; }
    const el = document.createElement('span'); el.className = 'chip'; el.textContent = a.spec.tag;
    const chip = { key: a.spec.key, el, first: i, last: i }; PAGER.chips.push(chip);
    el.addEventListener('click', () => { PAGER.page = Math.floor(chip.first / PAGER.size); showPage(); });
    types.appendChild(el);
  });
  showPage();
  updateUI();
}
function buildUI() {
  document.getElementById('allUp').onclick = () => { AIRCRAFT.forEach(a => a.canLaunch() && a.requestLaunch()); updateUI(); };
  document.getElementById('allDown').onclick = () => { AIRCRAFT.forEach(a => a.canLand() && a.requestLand()); updateUI(); };
  document.getElementById('autoChk').onchange = e => { CFG.auto = e.target.checked; };
  const turnPage = d => { const pages = Math.ceil(PAGER.rows.length / PAGER.size); PAGER.page = (PAGER.page + d + pages) % pages; showPage(); };
  document.getElementById('pgPrev').onclick = () => turnPage(-1);
  document.getElementById('pgNext').onclick = () => turnPage(1);
  document.getElementById('collapse').onclick = () => {
    const p = document.getElementById('panel'); p.classList.toggle('collapsed');
    document.getElementById('collapse').textContent = p.classList.contains('collapsed') ? '+' : '–';
  };
  const meter = document.getElementById('meter');
  for (let i = 0; i < 28; i++) meter.appendChild(document.createElement('i'));
  // ship callsigns, for reference
  const fleet = document.getElementById('fleet');
  SHIPS.forEach(s => {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = '<span class="tp"></span><span class="nm"></span><span class="st"></span>';
    row.querySelector('.tp').textContent = s === CARRIER ? 'CVN' : 'DDG';
    row.querySelector('.nm').innerHTML = '<b></b><i></i>';
    row.querySelector('.nm b').textContent = s.radio;
    row.querySelector('.nm i').textContent = s === CARRIER ? 'carrier' : s.side < 0 ? 'escort · port' : 'escort · stbd';
    s.ui = { st: row.querySelector('.st') };
    fleet.appendChild(row);
  });
}
function updateUI() {
  // window / panel size or the row height changed: lay the pages out again (read before the writes below: no forced reflow)
  if (PAGER.rows.length && (pageSize() !== PAGER.size || PAGER.rowH !== PAGER.shownH)) showPage();
  const now = getNow();
  document.getElementById('clock').textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const e = ENV.elev;
  document.getElementById('daystate').textContent = (e > 6 ? 'DAY' : e > -6 ? 'TWILIGHT' : 'NIGHT');
  const as = document.getElementById('audiostate');
  const arming = AUD.active && !AUD.armed && AUD.soundStart >= 0;
  // fleet status: patrol in silence, unknown contacts while the sound arms, combat once armed
  as.textContent = (AUD.holding ? `◐ NO CONTACTS · ${Math.max(0, AUD.holdUntil - RT()).toFixed(0)}s` : AUD.armed ? '● COMBAT' : arming ? `◌ UNKNOWN CONTACTS · ${Math.max(0, ARM_DELAY - (RT() - AUD.soundStart)).toFixed(0)}s` : '○ ON PATROL') + (FILE_AUDIO.playing ? ' (FILE)' : AUD.demo && DEMO.on ? ' (DEMO)' : '');
  as.className = AUD.armed ? 'on' : '';
  const th = document.getElementById('threat');
  if (th) { const n = Math.round(STRESS.level * 10); th.textContent = '▮'.repeat(n) + '▯'.repeat(10 - n) + '  ' + STRESS.label; th.className = 'lv' + Math.min(3, Math.floor(STRESS.level * 4)); }
  let airN = 0;
  for (const a of AIRCRAFT) {
    const [txt, cls] = a.retiring ? ['RETIRING', 'wait'] : a.status; a.ui.st.textContent = txt; a.ui.st.className = 'st ' + cls;
    if (a.state !== 'parked' && a.state !== 'hangar') airN++;
    const b = a.ui.btn;
    if (a.canLaunch()) { b.textContent = 'LAUNCH'; b.disabled = false; b.className = 'act up'; }
    else if (a.canLand()) { b.textContent = 'RECOVER'; b.disabled = false; b.className = 'act down'; }
    else if (a.landReq) { b.textContent = 'QUEUED'; b.disabled = true; b.className = 'act'; }
    else { b.textContent = '···'; b.disabled = true; b.className = 'act'; }
  }
  document.getElementById('count').textContent = `${airN}/${AIRCRAFT.length}`;
  const engaged = AUD.armed && CFG.fire > 0;
  for (const s of SHIPS) {
    const [txt, cls] = SHIP_FIRES.some(f => f.ship === s) ? ['DAMAGED', 'wait'] : engaged ? ['ENGAGING', 'busy'] : ['ON STATION', 'deck'];
    s.ui.st.textContent = txt; s.ui.st.className = 'st ' + cls;
  }
  const chk = document.getElementById("autoChk"); if (chk.checked !== CFG.auto) chk.checked = CFG.auto;
}
function updateMeter() {
  const bars = document.getElementById('meter').children;
  for (let i = 0; i < bars.length; i++) {
    const bin = Math.floor(Math.pow(i / bars.length, 1.4) * 60);
    const v = (AUD.raw[bin] + AUD.raw[64 + bin]) / 2;
    bars[i].style.transform = `scaleY(${Math.max(0.06, Math.min(1, v * 1.4))})`;
  }
}

/* ---- elevators & jet blast deflectors ---- */
function updateDeckMachinery(dt) {
  for (const L of CARRIER.lifts) {
    L.y += clamp(L.target - L.y, -0.55 * dt, 0.55 * dt);
    L.grp.position.y = L.y;
  }
  CARRIER.jbds.forEach((j, i) => {
    const c = FD.cats[i], up = c.busy && (c.busy.state === 'hold' || c.busy.state === 'launch') ? 1 : 0;
    j.a += clamp(up - j.a, -dt * 0.9, dt * 0.9);
    j.piv.rotation.z = -j.a * 1.05;
  });
}

/* ---- main loop ---- */
let frameDue = 0;
function frame(ms) {
  requestAnimationFrame(frame);
  if (paused) { lastMs = ms; return; }
  if (fpsLimit > 0) {
    // due times advance in whole intervals, so the limit holds on any refresh rate (75 / 144 Hz…)
    if (ms < frameDue - 2) return;
    frameDue += 1000 / fpsLimit; if (frameDue <= ms) frameDue = ms + 1000 / fpsLimit;
  }
  // simulate the real elapsed time in sub-steps of at most 50 ms: low FPS limits don't slow the world down
  const el = clamp((ms - lastMs) / 1000, 0, 0.25); lastMs = ms;
  const n = Math.max(1, Math.ceil(el / 0.05)), dt = el / n;
  for (let i = 0; i < n * TIME_SCALE; i++) step(dt);
  if (CFG.shadows) fitShadow();
  renderer.render(scene, camera);
}
/* The sun's shadow camera covers just the visible sea: the light-space bounds of the screen corners at sea level.
   Anything casting onto the screen lies above that area along the light, however far out or high (a jet climbing
   out); a fixed box cut such shadows off. Follows zoom, window size and the rotating camera. */
const _shc = new V3(), _shi = new THREE.Matrix4(), SCREEN_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
function fitShadow() {
  const sc = sunLight.shadow.camera;
  camera.updateMatrixWorld();
  _shi.lookAt(sunLight.position, sunLight.target.position, sc.up).setPosition(sunLight.position).invert();   // = the shadow camera's view
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of SCREEN_CORNERS) {
    AIRWAR.groundAt(c[0], c[1], 0, _shc).applyMatrix4(_shi);
    x0 = Math.min(x0, _shc.x); x1 = Math.max(x1, _shc.x); y0 = Math.min(y0, _shc.y); y1 = Math.max(y1, _shc.y);
  }
  const m = 4;   // waves, ships' sides
  if (Math.abs(sc.left - (x0 - m)) + Math.abs(sc.right - (x1 + m)) + Math.abs(sc.bottom - (y0 - m)) + Math.abs(sc.top - (y1 + m)) < 0.5) return;
  sc.left = x0 - m; sc.right = x1 + m; sc.bottom = y0 - m; sc.top = y1 + m; sc.updateProjectionMatrix();
}
const TIME_SCALE = Math.max(1, Math.round(parseFloat(QS.get('ts') || '1')));
let wcAcc = 0;
/* start-up splash: covers the first seconds, when settings / WE properties may rebuild and restore the air wing */
let splash = document.getElementById('splash');
function step(dt) {
  T += dt;
  if (splash && T > 3.2) { const s = splash; splash = null; s.classList.add('off'); setTimeout(() => s.remove(), 700); }
  updateArming();
  WAVE.flow = 2.2 * CFG.speed / 100; WAVE.amp = CFG.waves / 100;
  waveAdvance(dt);
  waterUniforms.uPh.value.set(WAVE.phase[0], WAVE.phase[1], WAVE.phase[2], WAVE.phase[3]); waterUniforms.uAmp.value = WAVE.amp;

  updateShips(dt);
  wcAcc += dt * 35 * WAVE.amp; // whitecaps
  while (wcAcc > 1) { wcAcc--; FX.foam.emit(rand(-120, 120), rand(-120, 120), rand(-0.3, 0.3), rand(-0.3, 0.3), rand(1.5, 3.5)); }
  updateMounts(dt);
  updateDeckMachinery(dt);
  for (const a of AIRCRAFT) a.update(dt);
  retireAircraft();
  missionWorldUpdate(dt);
  PERSIST.update(dt);
  updateFlak(dt);
  camShake = Math.max(0, camShake - dt * 3);
  if (CFG.camRotate || camShake > 0) { if (CFG.camRotate) camAz += CFG.camDir * CFG.camSpeed * DEG * dt; updateCameraPose(); }
  autoFlight(dt);
  updateFlybys(dt);
  FX.tracers.update(dt);
  FX.flash.update(dt);
  FX.smoke.update(dt, ENV.smokeTint, camera);
  FX.splash.update(dt, WAVE.flow, ENV.splashTint);
  FX.foam.update(dt, WAVE.flow);
  FX.lights.update(dt, 0.6 + ENV.night * 0.8);
  STRESS.update(dt);
  updateCombat(dt);
  AIRWAR.update(dt);
  updateChatter(dt);
  updateMissions(dt);
  RADIO.update(dt);
  if (airWingDirty && ready) syncAirWing();
  updateLights();

  envTimer -= dt; if (envTimer <= 0) { envTimer = 2; updateEnvironment(); }
  uiTimer -= dt; if (uiTimer <= 0) { uiTimer = 0.25; updateUI(); }
  meterTimer -= dt; if (meterTimer <= 0) { meterTimer = 0.05; updateMeter(); }
}

init();
