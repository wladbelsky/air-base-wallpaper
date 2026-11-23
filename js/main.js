'use strict';
/* ===== Scene, audio, base weapons, control panel, Wallpaper Engine properties ===== */
let scene, camera, renderer, sunLight, hemi, BASE;
let AIRCRAFT = [], FLYBYS = [], ALL_CIWS = [], ALL_AA = [], ALL_TANKS = [], ALL_SAMS = [], ALL_SHORAD = [];
const FX = {};
let airWingDirty = false;
let T = 0, paused = false, fpsLimit = 0, lastMs = 0, ready = false;
const ENV = { elev: 30, lightsOn: 0, lamps: 0, night: 0, hemiI: 1, ppu: 10, fogTint: new THREE.Color(0x9fc0da), smokeTint: new THREE.Color(0xbbbbbb), dustTint: new THREE.Color(0xa89878) };

/* ---- URL test parameters (for browser preview) ---- */
const QS = new URLSearchParams(location.search);
if (QS.has('hour')) { CFG.timeMode = 'fixed'; CFG.fixedHour = parseFloat(QS.get('hour')); }
if (QS.has('zoom')) CFG.zoom = parseFloat(QS.get('zoom'));
if (QS.has('season')) CFG.season = QS.get('season');
if (QS.has('weather')) CFG.weatherMode = QS.get('weather');

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
    if (has('bloom')) CFG.bloom = p.bloom.value;
    if (has('volumetric')) CFG.volumetric = p.volumetric.value;
    if (has('showpanel')) CFG.showPanel = p.showpanel.value;
    if (has('panelposition')) CFG.panelPos = p.panelposition.value;
    if (has('panelscale')) CFG.panelScale = p.panelscale.value;
    if (has('season') && !QS.has('season')) CFG.season = p.season.value;
    if (has('weather')) CFG.weather = p.weather.value;
    if (has('weathermode') && !QS.has('weather')) CFG.weatherMode = p.weathermode.value;
    if (has('uicolor')) CFG.uiColor = rgbFromWE(p.uicolor.value);
    if (has('subtitles')) CFG.subtitles = p.subtitles.value;
    if (has('savestate')) { CFG.saveState = p.savestate.value; if (!CFG.saveState) PERSIST.clear(); }
    if (has('missionfrequency')) CFG.missions = p.missionfrequency.value;
    if (has('camerashake')) CFG.shake = p.camerashake.value;
    if (has('enemies')) CFG.enemies = p.enemies.value;
    if (has('basename')) CFG.baseName = String(p.basename.value || '').trim().toUpperCase().slice(0, 20) || 'SAND ISLAND';
    for (const k of Object.keys(AIRCRAFT_TYPES)) if (has(k + 'count')) { const v = Math.round(p[k + 'count'].value); if (CFG.counts[k] !== v) { CFG.counts[k] = v; airWingDirty = true; } }
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
  const title = document.querySelector('#panel .title'); if (title) title.textContent = `◆ ${CFG.baseName} · BASE OPS`;
  if (!ready) return;
  for (const s of SITES) if (s.ui) s.ui.nm.textContent = s.name();
  sunLight.shadow.needsUpdate = CFG.shadows;   // (off: no shadow pass, intensity 0 — toggling castShadow would rebuild every material; on: renderFrame)
  updateCamera(); updateEnvironment();
  if (pipeline && VOLUME.on() && !VOLUME.active) dropPipeline();   // volumetric switched on: the next frame builds the pipeline with it
}

/* ---- init ---- */
/* WebGPURenderer: WebGPU where the browser has it (Wallpaper Engine's CEF does), else (or ?gl=webgl2) its WebGL 2 backend;
   the same node materials and passes on both. init() waits for the device: `ready` comes after it. */
async function init() {
  const canvas = document.getElementById('c');
  renderer = new THREE.WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance', trackTimestamp: GPU.timing,
    forceWebGL: QS.get('gl') === 'webgl2' || PERF.flags.gl === 'webgl2' || gpuFellBack() });
  // the device / context lost (a GPU reset, a driver update, sleep): WebGPURenderer stops drawing for good (WebGLRenderer
  // restored its context) — reload (PERSIST saves on pagehide); lost on WebGPU early on, or a second time within 10 min
  // (a driver resetting on our shaders: it reloaded on WebGPU for ever): WebGL 2 for this release
  const lost = renderer.onDeviceLost;
  renderer.onDeviceLost = (info) => {
    lost.call(renderer, info);                                     // (logs it, stops drawing)
    if (GPU.reloading) return; GPU.reloading = true;
    if (renderer.backend && renderer.backend.isWebGPUBackend) try {   // (not GPU.webgpu: unset while init() waits)
      const now = Date.now(), d = JSON.parse(localStorage.getItem(LOST_KEY) || 'null'), ts = (d && d.v === GL_VER ? d.t : []).filter(t => now - t < 600000);
      ts.push(now); localStorage.setItem(LOST_KEY, JSON.stringify({ v: GL_VER, t: ts }));
      if (performance.now() < 30000 || ts.length >= 2) localStorage.setItem(GL_KEY, JSON.stringify({ v: GL_VER, gl: 'webgl2' }));
    } catch (e) {}
    setTimeout(() => location.reload(), 2000);
  };
  await renderer.init();
  GPU.webgpu = !!renderer.backend.isWebGPUBackend;
  if (GPU.webgpu) watchGpuErrors();
  // render pipelines made (GPU.pipes): on WebGPU one made outside compileAsync blocks the GPU process — the fight's stalls
  // (renderer.info.memory.programs counts shader modules, shared by code: it barely moves). perfReport's hitch log, tests
  const crp = renderer.backend.createRenderPipeline; renderer.backend.createRenderPipeline = function () { GPU.pipes++; return crp.apply(this, arguments); };
  // Forward+ clustered lighting (WebGPU only: a compute pass bins the point / spot lights per screen tile and depth slice,
  // a fragment loops over its cluster's): many real lights are cheap — every searchlight, more flashes, the fires. On
  // the WebGL 2 backend the lights stay rationed (4 flash lights, 4 helicopter lights, spot lights hidden by day).
  GPU.clustered = GPU.webgpu && (QS.get('clustered') === '1' || PERF.flags.clustered === true);   // (experimental: its clusters don't fit our orthographic camera — the spots lit nothing)
  if (GPU.clustered) renderer.lighting = new THREE.ClusteredLighting(LIGHT_MAX);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;   // bright lights / flashes roll off instead of clipping; colours below ~0.8 untouched
  renderer.info.autoReset = false;                   // counted per frame (renderFrame), not per pass
  scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x9fc0da, 300, 800); scene.matrixWorldAutoUpdate = false;   // (renderFrame updates them, then BATCH.sync)
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 700);

  hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 0.6); scene.add(hemi);
  sunLight = new THREE.DirectionalLight(0xffffff, 1);
  sunLight.castShadow = true; sunLight.shadow.autoUpdate = false;   // (renderFrame asks for the map: SHADOW_EVERY)
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: -100, far: 400 });   // bounds: fitShadow()
  sunLight.shadow.bias = -0.0006; sunLight.shadow.normalBias = 0.03;
  scene.add(sunLight); scene.add(sunLight.target);

  BASE = buildBase(); scene.add(BASE.group); BASE.group.updateMatrixWorld(true);
  const M = BASE.mounts;
  ALL_CIWS = M.ciws; ALL_AA = M.aa; ALL_TANKS = M.tanks; ALL_SAMS = M.sams; ALL_SHORAD = M.shorad;
  [...ALL_CIWS, ...ALL_AA, ...ALL_TANKS, ...ALL_SHORAD].forEach(m => { mountRetarget(m); m.yaw = m.tYaw; m.pitch = m.tPitch; mountUpdate(m, 0); });
  ALL_SAMS.forEach(m => mountUpdate(m, 0));
  ALL_CIWS.forEach(m => m.radio = RADIO_NAMES.cram); ALL_AA.forEach(m => m.radio = RADIO_NAMES.cram); ALL_TANKS.forEach(m => m.radio = RADIO_NAMES.armor);
  ALL_SAMS.forEach(m => m.radio = RADIO_NAMES.patriot); ALL_SHORAD.forEach(m => m.radio = RADIO_NAMES.patriot);
  TERRAIN.build(seasonNow());

  FX.tracers = new Tracers(scene, 1200);
  FX.flash = new SpriteFX(scene, TEX.flash, THREE.AdditiveBlending, 160);   // (HDR with bloom: updateBloom, uK)
  FX.smoke = new SpriteFX(scene, TEX.smoke, THREE.NormalBlending, 420, true);   // (a burning structure keeps ~50 up)
  FX.scorch = new Scorch(scene, 120);
  FX.lights = new FlashLights(scene, GPU.clustered ? 24 : 4);
  FX.fire = new FlameFX(scene, 240);   // (structures, wrecks, units, crashes, explosions at once: ~25 a burning roof)
  FX.fireLights = new FireLights(scene, GPU.clustered ? 12 : 2);   // (2 without clustering: fixed, always in the scene — the light set never changes)
  if (!GPU.clustered) HELI_LIGHTS.build(scene);   // (before the air wing: the scene's lights are fixed from the start)
  WEATHER.build();
  // shells, rockets and bombs that reach the ground: dust, or a bomb hitting a structure
  FX.tracers.onSplash = (p, big) => {
    if (big >= 2.3) enemyBomb(p); else groundHit(p, big);
  };

  ready = true;
  window.addEventListener('resize', resize);
  buildUI(); buildAirWing(); applySettings(); resize(); updateEnvironment(); updateLights();
  warmShaders();
  requestAnimationFrame(frame);
}
/* compile now, under the start-up splash, every shader the scene and a fight need (enemy models, tracers, flashes,
   smoke…): the first frame and the first fight would otherwise stall on dozens of compiles (tens to hundreds of ms each in
   Wallpaper Engine's ANGLE / D3D). compileAsync hands them to the driver at once and waits for them off the main thread
   (KHR_parallel_shader_compile; without it they compile as before, one by one): the splash keeps moving meanwhile.
   compile() only takes visible objects (since r158): the idle FX pools, the hidden aircraft and the rest are shown for
   the call (compileVisible). The programs depend on the lights in view: the spot lights shown by night only are flipped
   for a second round (no stall at dusk / dawn). A program is made for where it draws: the bloom's HDR target or the
   screen — the active path only (toggling bloom compiles the other once). The enemy templates are built here (enemyMesh caches them) and only
   borrowed (targetScene: lit like the scene, not added to it) — no GPU buffers are made, nothing to dispose. The frame
   loop draws nothing until SHADERS_READY (a draw with a program still compiling would wait for it); frames under the
   splash make the shadow pass's programs (compile() doesn't) and the post-processing passes (bloom). */
let SHADERS_READY = false;
// perfReport() state and the debug switches kept in localStorage (see perfReport, below frame())
const PERF = { recs: [],
  flags: (() => { try { return JSON.parse(localStorage.getItem('fab-perf') || '{}') || {}; } catch (e) { return {}; } })(),
  /* what a frame made: render pipelines (GPU.pipes), shader programs, batch growth / new batches (BATCH.ev) */
  counts() { return [GPU.pipes, renderer.info.memory.programs, BATCH.ev.grow, BATCH.ev.batch]; },
  gap() { return fpsLimit > 0 ? 1000 / fpsLimit : 1000 / 60; },   // the frame interval expected (at an FPS limit of 25 every frame was a 'hitch')
  sample(ms, sim, draw, c0) {   // into every report running (each perfReport() call has its own record)
    let lit = 0; scene.traverseVisible(o => { if ((o.isPointLight || o.isSpotLight) && o.intensity > 0) lit++; });
    const c = this.counts(), d = { pipes: c[0] - c0[0], programs: c[1] - c0[1], batchGrow: c[2] - c0[2], newBatch: c[3] - c0[3] };
    for (const r of this.recs) {
      for (const k in d) r.made[k] += d[k];
      // a hitch (> 50 ms since the last frame, or two frame intervals of a lower FPS limit): what this frame and the one before it made (a pipeline built in one frame
      // blocks the GPU process: the gap shows before the next) — the worst ones go into the report's hitchLog
      if (r.last && ms - r.last > Math.max(50, 2 * this.gap())) r.hitches.push({ at: +(T - r.T0).toFixed(1), ms: Math.round(ms - r.last), simMs: +sim.toFixed(1), renderMs: +draw.toFixed(1), made: d, before: r.pd, enemies: ENEMIES.length, combat: AUD.fighting });
      r.pd = d;
      if (r.last) r.frame.push(ms - r.last); r.last = ms;
      r.cpu.push(sim + draw); r.sim.push(sim); r.draw.push(draw); r.calls.push(renderer.info.render.drawCalls); r.lights.push(lit);
      if (GPU.timing) { r.gpu.push(GPU.ms.render); r.comp.push(GPU.ms.compute); }
    }
  }
};
const GPU = { webgpu: false, clustered: false, pipes: 0,   // which backend WebGPURenderer runs on (renderer.backend), clustered lights
  // ?gputime=1 / perfFlags({ gputime: true }) (debug): GPU time of the last frame's render / compute passes in ms, measured
  // twice a second (GPU.ms; timestamp queries)
  timing: QS.get('gputime') === '1' || PERF.flags.gputime === true, ms: { render: 0, compute: 0 }, tsT: 0 };
const LIGHT_MAX = 128;
/* safety net: WebGPU failing (a stream of validation errors in the first 30 s — once a nothing-drawn screen in WE) →
   remember it for this release (the cache-buster) and reload on the WebGL 2 backend; the next release tries WebGPU again */
const GL_KEY = 'fab.gl', LOST_KEY = 'fab.lost', GL_VER = ((document.querySelector('script[src*="main.js"]') || {}).src || '').replace(/^.*[?&]v=(\d+).*$/, '$1');
function gpuFellBack() { try { const d = JSON.parse(localStorage.getItem(GL_KEY) || 'null'); return !!d && d.v === GL_VER && d.gl === 'webgl2'; } catch (e) { return false; } }
function watchGpuErrors() {
  const dev = renderer.backend.device, t0 = performance.now(); let n = 0;
  if (dev && dev.addEventListener) dev.addEventListener('uncapturederror', () => {
    if (++n < 20 || performance.now() - t0 > 30000 || GPU.fellBack) return;
    GPU.fellBack = true; console.warn('WebGPU keeps failing: reloading on WebGL 2 for this release');
    try { localStorage.setItem(GL_KEY, JSON.stringify({ v: GL_VER, gl: 'webgl2' })); } catch (e) {}
    location.reload();
  });
}   // the clustered lighting's ceiling (point + spot lights in the scene)
function compileVisible(root, target) {
  const hid = [], bat = []; root.traverse(o => { if (!o.visible && !o.isLight) { hid.push(o); o.visible = true; } if (o.userData.batched && o.visible) bat.push(o); });
  for (const o of bat) o.visible = false;   // (drawn by their batches: no program of their own)
  // (for the default target: setting the scene pass's target here, while it was still 1×1, broke that pass for good on
  // WebGPU — its textures were destroyed on the resize; the frames under the splash make the pass's variants)
  const p = renderer.compileAsync(root, camera, target);   // (it collects the objects now: they can hide again)
  for (const o of bat) o.visible = true; for (const o of hid) o.visible = false;
  return p;
}
/* one frame through the pipeline with every hidden object shown and every empty instanced pool drawing one instance */
function warmFrame() {
  const hid = [], cnt = [];
  scene.traverse(o => { if (!o.visible && !o.isLight) { hid.push(o); o.visible = true; } if ((o.isInstancedMesh || o.isSprite) && o.count === 0) { cnt.push(o); o.count = 1; } });
  renderFrame();
  for (const o of hid) o.visible = false; for (const o of cnt) o.count = 0;
}
async function warmShaders() {
  if (QS.get('warm') === '0') { SHADERS_READY = true; return; }   // (the tests skip it: SwiftShader compiles synchronously, ~4 s a boot)
  const g = new THREE.Group();
  for (const k of ['cruise', 'ballistic', ...Object.keys(ENEMY_TYPES), ...Object.keys(HELI_TYPES), ...Object.keys(ARMOR_TYPES)]) g.add(enemyMesh(k));
  for (const k of Object.keys(ARMOR_TYPES)) { const w = enemyMesh(k); w.traverse(o => { if (o.isMesh) o.material = M(0x2c2a26); }); g.add(w); }   // the wrecks' batch (wreckArmor)
  for (const k of Object.keys(VEH_BUILD)) g.add((VEH_TEMPLATES[k] || (VEH_TEMPLATES[k] = VEH_BUILD[k]())).clone());   // the ground vehicles (crane parts, hoses: drawn on their own)
  const fly = Object.keys(FLYBY_JETS).flatMap(k => [0, 1, 2].map(() => { const m = FLYBY_JETS[k](); FLYBY_MODELS[k].push(m); m.setFold(0); g.add(m.group); return m; }));   // fly-by jets built now, 3 a type (a fly-by takes 1–3; once lazily, mid-fight)
  BATCH.prefill(scene); BATCH.prefill(g);
  scene.updateMatrixWorld(); BATCH.sync();   // the batches exist (their programs are compiled with the rest)
  const spots = [...new Set([...SEARCHLIGHTS.filter(s => s.light).map(s => s.light), ...HELI_LIGHTS.pool])], flip = () => spots.forEach(l => { l.visible = !l.visible; });
  try {
    await compileVisible(scene); await compileVisible(g, scene);   // (one at a time: WebGPURenderer.compileAsync isn't re-entrant)
    if (!SHADERS_READY) { flip(); await compileVisible(scene); await compileVisible(g, scene); }   // (not once the loop runs — the 15 s fallback: its updateLights sets them)
  } catch (e) { console.warn('shader warm-up', e); }
  spots.forEach(l => { l.visible = GPU.clustered || ENV.lightsOn > 0; });   // as updateLights has them (a flip back after the loop had set them left them wrong)
  // frames of the real pipeline with the enemies in view (the camera's middle) and everything hidden or empty shown
  // (warmFrame), in both states of the night-only spot lights: what compileAsync made for its own context, the scene
  // pass draws in the RenderPipeline's — its variants, the shadow-pass (depth) programs and the post-processing passes
  // were otherwise built the first time each was drawn (mid-fight: the first tracers, a wreck, a scramble)
  g.position.copy(CAM_TGT); g.children.forEach((m, i) => m.position.set((i % 6 - 2.5) * 4, 6, Math.floor(i / 6) * 4 - 4));
  if (!SHADERS_READY) { scene.add(g); warmFrame(); flip(); warmFrame(); flip(); scene.remove(g); }   // (not once the loop runs — the 15 s fallback: the frame with every hidden thing shown would be on screen)
  for (const m of fly) m.group.removeFromParent();
  spots.forEach(l => { l.visible = GPU.clustered || ENV.lightsOn > 0; });
  renderFrame();
  SHADERS_READY = true;
}

/* ---- air wing from the per-type counts (a fresh build: everything starts at its home) ---- */
let airWingBuiltAt = 0;
function buildAirWing() {
  airWingDirty = false; airWingBuiltAt = T;
  AIRCRAFT.forEach(a => a.dispose()); AIRCRAFT = []; AIRWAR.passes.length = 0; missionWorldReset();
  AIRFIELD.reset();
  // homes go round-robin across types (the shelters are shared out between the fighter types)
  const plan = [];
  const queues = [...FIXED_ORDER, ...HELI_ORDER].map(k => ({ k, n: CFG.counts[k] || 0, i: 0, cs: callsignsFor(k, CFG.counts[k] || 0) }));
  let left = true;
  while (left) { left = false; for (const q of queues) if (q.i < q.n) { plan.push({ k: q.k, cs: q.cs[q.i++] }); left = true; } }
  for (const it of plan) AIRCRAFT.push(new AIRCRAFT_TYPES[it.k]({ callsign: it.cs }));
  AIRFIELD.updateMarks();
  buildList();
  // the last session's aircraft in the air / on missions come back (js/persist.js); otherwise part of the air wing
  // goes up right away: two flights (or lead sections)
  const restored = PERSIST.restore();
  if (CFG.auto && !restored) { autoLaunch(); autoLaunch(); }
  autoTimer = rand(8, 14);
}
/* A count changed: the air wing adapts in place. New aircraft join at a free home (callsigns continue the flights);
   aircraft over the new count retire — they land first and leave once parked (retireAircraft).
   Right after a fresh build (settings applied at start-up) it simply rebuilds. */
function syncAirWing() {
  if (T - airWingBuiltAt < 3) { buildAirWing(); return; }
  airWingDirty = false;
  for (const k of [...FIXED_ORDER, ...HELI_ORDER]) {
    const cs = callsignsFor(k, CFG.counts[k] || 0), mine = AIRCRAFT.filter(a => a.spec.key === k);
    for (const a of mine) a.retiring = !cs.includes(a.callsign);                 // back in if it was retiring
    for (const c of cs) if (!mine.some(a => a.callsign === c)) AIRCRAFT.push(new AIRCRAFT_TYPES[k]({ callsign: c }));
  }
  AIRFIELD.updateMarks();
  buildList();
}
/* retiring aircraft come back and leave the air wing once they are parked (nothing on the runway is held then) */
function retireAircraft() {
  let gone = false;
  for (let i = AIRCRAFT.length - 1; i >= 0; i--) {
    const a = AIRCRAFT[i]; if (!a.retiring) continue;
    if (isDown(a) && a.t > 1) { a.dispose(); AIRCRAFT.splice(i, 1); gone = true; }
    else if (a.state === 'ready') { a.state = 'parked'; a.t = 0; }                  // not pushed back yet: the launch is called off (the tug turns away)
    else if (a.state === 'spinup') { a.state = 'spindown'; a.t = 0; }               // a helicopter not off its pad yet: shuts down
    else if (a.canLand()) a.requestLand();
  }
  if (gone) { AIRFIELD.updateMarks(); buildList(); }
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  updateCamera();
}
/* ---- one frame on screen: a RenderPipeline — the scene pass (half-float, multisampled: HDR), + the bloom of what is
   brighter than its threshold (lights, flashes, fire, tracers, lightning: HDR colours > 1) when CFG.bloom; the pipeline
   tone maps / encodes the result. The scene is always drawn into the linear target (bloom on or off), so the sprite
   and beam curves (SPRITE_AG / SPRITE_CP / BEAM_G) are fixed. Built on first use; toggling bloom swaps the output node. */
let pipeline = null, bloomNode = null, sceneOut = null, pipeBloom = null, scenePass = null;
/* the final grade, on screen colours (after the tone mapping and the sRGB encoding): the linear light made the picture
   more contrasty and saturated than before r187 (the shade side and the ground darker, the sunlit side warmer) — halfway
   back: saturation × sat toward the luminance, contrast × con around mid. Day and night have their own (updateBloom
   eases between them by ENV.night): by day measured on WE screenshots (spread 0.116 → 0.143, saturation 0.063 →
   0.111); at night on three night scenes rendered with the pre-r187 code and now (mean 0.21 → 0.18, spread 0.072 →
   0.099, saturation 0.070 → 0.109, the darkest 5 % 0.11 → 0.055: darker and harder) — the night's pivot 0.33 lifts
   the mean a little too, to the midpoint */
const GRADE = { day: { sat: 0.87, con: 0.9, mid: 0.44 }, night: { sat: 0.8, con: 0.87, mid: 0.33 }, u: null };
function gradeOut(n) {
  const { renderOutput, luminance, mix, vec3, uniform } = THREE.TSL;
  if (!GRADE.u) GRADE.u = { sat: uniform(GRADE.day.sat), con: uniform(GRADE.day.con), mid: uniform(GRADE.day.mid) };
  const U = GRADE.u, c = renderOutput(n), rgb = c.rgb, l = luminance(rgb);
  const s = mix(vec3(l), rgb, U.sat), g = s.sub(U.mid).mul(U.con).add(U.mid);
  return THREE.TSL.vec4(g, c.a);
}
function buildPipeline() {
  pipeline = new THREE.RenderPipeline(renderer); pipeline.outputColorTransform = false;   // (gradeOut does it, then grades)
  const sp = scenePass = THREE.TSL.pass(scene, camera, { samples: 4 });
  sceneOut = sp.getTextureNode('output');
  if (VOLUME.on()) sceneOut = sceneOut.add(VOLUME.build());   // light shafts in the haze, added before the bloom
  bloomNode = THREE.bloom(sceneOut, 0.5, 0.45, 1);
  updateBloom();
}
function dropPipeline() { pipeline.dispose(); scenePass.dispose(); bloomNode.dispose(); pipeline = bloomNode = sceneOut = scenePass = pipeBloom = null; }
/* ---- volumetric light (WebGPU; ?vol=1 forces it on the WebGL 2 backend): the searchlights' beams lit in the haze ----
   A box over the base (VOL_LAYER: only its own low-res pass draws it) with a VolumeNodeMaterial: the ray through it is
   marched in steps and every light (clustered, WebGPU: cheap) scatters into it by the haze's density — beams from the
   real spot lights, glow around flashes and fires. Density by the hour and the weather (thick in fog and rain, none by a
   clear day); the meshed beams (coneMaterial) are hidden meanwhile. Rendered at a quarter of the resolution. */
const VOL_LAYER = 2;
const VOLUME = {
  mesh: null, density: null, active: false, blank: false,
  on() { return CFG.volumetric && (GPU.webgpu || QS.get('vol') === '1'); },
  live() { return this.active && CFG.volumetric; },   // built and switched on (switched off later: hidden, its pass idle)
  build() {
    const { uniform, Fn, vec2, vec3, smoothstep, screenCoordinate, screenUV, interleavedGradientNoise } = THREE.TSL;
    this.density = uniform(0);
    const m = new THREE.VolumeNodeMaterial({ steps: GPU.webgpu ? 20 : 12 });
    m.offsetNode = interleavedGradientNoise(screenCoordinate);   // (dithered start: no banding)
    m.scatteringNode = Fn(({ positionRay }) => vec3(this.density.mul(smoothstep(42, 2, positionRay.y))));   // thinner with height
    this.rd = uniform(new THREE.Vector3(0, -1, 0)); this.ird = uniform(new THREE.Vector3(1, -1, 1)); this.top = uniform(44);
    m.setupLightingModel = () => new VolumeModel(this.rd, this.ird, this.top, new THREE.Vector3(-120, 0, -89), new THREE.Vector3(120, 44, 81));
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(240, 44, 170), m); this.mesh.position.set(0, 22, -4);
    this.mesh.layers.set(VOL_LAYER); this.mesh.frustumCulled = false; scene.add(this.mesh);
    // its pass clears to black / transparent: with the renderer's clear colour (the sky) it was added over the whole frame
    const vp = THREE.TSL.pass(scene, camera, { depthBuffer: false }), up = vp.updateBefore, cc = new THREE.Color();
    // nothing in the haze (a clear day, switched off): cleared once, then not drawn (its target stays black)
    vp.updateBefore = function (frame) {
      if (!VOLUME.mesh.visible && VOLUME.blank) return;
      VOLUME.blank = !VOLUME.mesh.visible;
      renderer.getClearColor(cc); const a = renderer.getClearAlpha(); renderer.setClearColor(0x000000, 0); try { return up.call(this, frame); } finally { renderer.setClearColor(cc, a); }   // (a throw left the sky black)
    };
    vp.setLayers(new THREE.Layers()); vp.getLayers().set(VOL_LAYER); vp.setResolutionScale(0.25);
    this.vp = vp; this.active = true;
    // blurred back up (3×3 Gaussian, one low-res texel apart, bilinear): the dithered ray starts (a texel = 4×4 pixels)
    // showed as a checkerboard in the floodlights' beams
    const t = vp.getTextureNode('output'), tx = this.texel = uniform(new THREE.Vector2(1, 1));
    const at = (x, y) => t.sample(screenUV.add(vec2(x, y).mul(tx)));
    return at(0, 0).mul(4).add(at(1, 0).add(at(-1, 0)).add(at(0, 1)).add(at(0, -1)).mul(2))
      .add(at(1, 1).add(at(-1, 1)).add(at(1, -1)).add(at(-1, -1))).div(16);
  },
  dens() { return (0.025 + 0.09 * WEATHER.fog + 0.03 * WEATHER.rain) * Math.max(ENV.lamps, ENV.lightsOn); },
  /* how much of a real light's beam the volume draws: in a clear night's thin haze its beam is barely there (a light
     pool on the ground with no beam to it — the helicopters' lights looked cut off), the meshed cone stays; it hands
     over as the haze thickens (rain: about half, fog: all) */
  cover() { return this.live() ? smoothstep(0.03, 0.09, this.dens()) : 0; },
  update() {
    if (!this.active) return;
    const d = this.dens();
    // drawn from where it shows (cover > 0; a clear night's 0.025 is a faint haze the meshed cones draw for it): below,
    // the mesh hidden and the pass idle — a scene traversal and a full-screen clear less every night frame
    this.density.value = d; this.mesh.visible = CFG.volumetric && d > 0.03;
    const rt = this.vp.renderTarget; this.texel.value.set(1 / Math.max(1, rt.width), 1 / Math.max(1, rt.height));
    const rd = camera.getWorldDirection(this.rd.value), inv = v => 1 / (Math.abs(v) < 1e-5 ? 1e-5 : v);
    this.ird.value.set(inv(rd.x), inv(rd.y), inv(rd.z));
    // the march's ceiling: the highest light that is on + 6 (the lamps are 5–11 up: the rays' 44 to the box's top were
    // ~3× the steps through the beams; a flak burst's flash lifts it while it lasts)
    if (!this.lights) { this.lights = []; scene.traverse(o => { if (o.isLight && o.layers.isEnabled(VOL_LAYER)) this.lights.push(o); }); }
    let top = 0; for (const l of this.lights) if (l.visible && l.intensity > 0) top = Math.max(top, _vt.setFromMatrixPosition(l.matrixWorld).y);
    this.top.value = clamp(top + 6, 8, 44);
  }
};
const _vt = new V3();
/* the volume's ray march (r187's VolumetricLightingModel, adapted to our camera): r187 marches from the camera's position
   to the box's far side — 160 away, its 20 steps were ~11 long, a beam ~2 wide by its lamp fell between them and the
   dithered starts lit it in some low-res texels only (a grid of blocks by the floodlights' and the helicopters' lamps).
   Here the rays are parallel (orthographic: along the view) and marched only through the box (~4 a step), and a light is
   softened within ~1.5 of it (1/d² → 1/(d² + 1.5²): the spike at the lamp itself showed as bright blocks). */
const VOL_R0 = 2;
class VolumeModel extends THREE.LightingModel {
  constructor(rd, ird, top, bmin, bmax) { super(); Object.assign(this, { rd, ird, top, bmin, bmax }); this.scat = THREE.TSL.property('vec3'); }
  start(builder) {
    const { float, vec3, vec4, min, max, property, Loop, positionWorld, cameraViewMatrix } = THREE.TSL, { material } = builder;
    const { rd, ird, scat } = this, out = this.out = property('vec3');
    // the ray through this far-side point, clipped to the box below the lights' ceiling `top` (slab test; ird = 1 / the
    // view direction; P is its far end: t ≤ 0)
    const P = positionWorld, hi = vec3(this.bmax.x, this.top, this.bmax.z), t1 = vec3(this.bmin).sub(P).mul(ird), t2 = hi.sub(P).mul(ird);
    const a = min(t1, t2), b = max(t1, t2), tn = max(max(a.x, a.y), a.z), tf = min(min(b.x, b.y), b.z).min(0);
    const len = tf.sub(tn).max(0).toVar(), from = P.add(rd.mul(tn)).toVar();
    const steps = THREE.TSL.uniform('int').onRenderUpdate(({ material }) => material.steps);   // (a uniform as in r187: changed without a rebuild)
    const dt = len.div(float(steps)).toVar(), dist = float(0).toVar(), trans = vec3(1).toVar();
    if (material.offsetNode) dist.addAssign(material.offsetNode.mul(dt));
    out.assign(vec3(0));
    Loop(steps, () => {
      const pr = from.add(rd.mul(dist)).toVar();
      builder.context.positionWorld = pr; builder.context.shadowPositionWorld = pr; builder.context.positionView = cameraViewMatrix.mul(vec4(pr, 1)).xyz;
      scat.assign(vec3(0));
      const sn = material.scatteringNode({ positionRay: pr });
      super.start(builder);
      scat.mulAssign(sn);
      out.addAssign(scat.mul(0.01).mul(trans).mul(dt));   // in-scattered light, front to back (Beer's law as r187)
      trans.mulAssign(scat.mul(-0.01).mul(dt).exp());
      dist.addAssign(dt);
    });
  }
  direct({ lightNode, lightColor }, builder) {
    if (lightNode.isAnalyticLightNode !== true || lightNode.light.distance === undefined) return;   // (the sun, the sky: no)
    const { dot, lightPosition } = THREE.TSL, l = lightColor.xyz.toVar();
    if (lightNode.shadowNode !== null) l.mulAssign(lightNode.shadowNode);
    const d = builder.context.positionWorld.sub(lightPosition(lightNode.light)), d2 = dot(d, d);
    this.scat.addAssign(l.mul(d2.div(d2.add(VOL_R0 * VOL_R0))));
  }
  finish(builder) { builder.context.outgoingLight.assign(this.out); }
}
/* the glow follows the light: stronger at night (the lamps, the windows, a flash in the dark), a high threshold by day
   (sunlit snow / white roofs stay out of it). The emitters are HDR (colours > 1: what glows) only with bloom on — without
   it they would just be brighter than they always were. */
let HDR = 1;
function updateBloom() {
  HDR = CFG.bloom ? 1 : 0;
  const k = HDR * (0.35 + 0.65 * ENV.lightsOn);   // (by day a flame stays a flame, not a red ball)
  FX.flash.uK.value = 1 + 1.1 * k; FX.fire.uK.value = 1 + 1.3 * k; FX.tracers.mesh.material.color.setScalar(1 + 1.2 * k);
  if (WEATHER.bolt) WEATHER.bolt.material.color.setRGB(0.75, 0.8, 1).multiplyScalar(1 + 3 * HDR);   // the lightning bolt: HDR white with bloom, white without
  if (!pipeline) return;
  if (pipeBloom !== CFG.bloom) { pipeBloom = CFG.bloom; pipeline.outputNode = gradeOut(CFG.bloom ? sceneOut.add(bloomNode) : sceneOut); pipeline.needsUpdate = true; }
  const D = GRADE.day, N = GRADE.night, kn = ENV.night; GRADE.u.sat.value = lerp(D.sat, N.sat, kn); GRADE.u.con.value = lerp(D.con, N.con, kn); GRADE.u.mid.value = lerp(D.mid, N.mid, kn);
  bloomNode.strength.value = lerp(0.5, 0.7, ENV.night); bloomNode.threshold.value = lerp(1.4, 0.55, ENV.lightsOn); bloomNode.radius.value = 0.55;   // (BloomNode: a weaker scale than the old UnrealBloomPass)
}
/* the shadow map is drawn every second frame while the wallpaper runs at 50 fps or more (frameAvg, ms between drawn
   frames): its pass is about a third of the draw calls; the map and its matrix are updated together (ShadowNode), so a
   frame between them just reuses the last one. Below 50 fps (and in the tests, which draw no frame()) every frame. */
let frameAvg = 0, shadowN = 0;
function renderFrame() {
  renderer.info.reset();
  if (CFG.shadows && (++shadowN % 2 === 0 || !(frameAvg > 0 && frameAvg < 20))) { fitShadow(); sunLight.shadow.needsUpdate = true; }
  scene.updateMatrixWorld(); BATCH.sync();   // (the renderer doesn't update the matrices again: matrixWorldAutoUpdate off)
  if (!pipeline) buildPipeline();
  pipeline.render();
}
function updateCamera() {
  const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
  const viewH = 60 * 100 / CFG.zoom;
  camera.left = -viewH * aspect / 2; camera.right = viewH * aspect / 2; camera.top = viewH / 2; camera.bottom = -viewH / 2;
  camera.updateProjectionMatrix();
  ENV.ppu = h / viewH;
  WEATHER.applyFog();
  updateCameraPose();
}
const CAM_D = 160, CAM_TGT = new V3(0, 2.5, -4);
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

/* ---- time of day, season & lighting ---- */
const _hg = new THREE.Color();
function updateEnvironment() {
  const season = seasonNow(); if (season !== TERRAIN.season) TERRAIN.build(season);   // a new month, or the setting changed
  const S = SEASONS[season];
  const sp = sunPosition(getNow(), CFG.lat, CFG.lon);
  ENV.elev = sp.elev;
  const k = skyAt(sp.elev); WEATHER.apply(k, sp.elev);
  const dirOf = (az, el) => new V3(Math.sin(az * DEG) * Math.cos(el * DEG), Math.sin(el * DEG), -Math.cos(az * DEG) * Math.cos(el * DEG));
  const sunDir = dirOf(sp.az, Math.max(sp.elev, 7)), moonDir = dirOf(sp.az + 160, 42);
  const dir = sunDir.lerp(moonDir, smoothstep(-2, -7, sp.elev)).normalize();
  sunLight.position.copy(dir).multiplyScalar(150); sunLight.target.position.set(0, 0, 0);
  sunLight.color.copy(k.sun); sunLight.intensity = sunLightK(k.si, k.hi);
  // the ground's bounce light takes the season's colour (snow: bright), as dark as the hour wants
  _hg.setHex(S.hg).multiplyScalar(lerp(0.35, 1, smoothstep(-8, 12, sp.elev)));
  hemi.color.copy(k.hs); hemi.groundColor.copy(k.hg).lerp(_hg, 0.6); hemi.intensity = ENV.hemiI = skyLight(k.hi);
  // shadows: crisp under a high sun, soft and long at dusk; fainter by moonlight
  sunLight.shadow.radius = lerp(3.5, 1.3, smoothstep(4, 35, sp.elev)) + 4 * WEATHER.oc;                  // (overcast: soft
  sunLight.shadow.intensity = lerp(0.8, 1, smoothstep(-7, 2, sp.elev)) * (1 - 0.75 * WEATHER.oc) * (CFG.shadows ? 1 : 0);       //  and faint)
  scene.fog.color.copy(k.fog); renderer.setClearColor(k.fog); ENV.fogTint.copy(k.fog);
  ENV.smokeTint.copy(k.smoke);
  ENV.dustTint.setHex(S.ground).lerp(k.smoke, 0.45);
  ENV.lightsOn = 1 - smoothstep(-3, 5, sp.elev);
  ENV.lamps = Math.max(ENV.lightsOn, WEATHER.lamps());   // lamps on in the fog / a storm by day too (not the real spot lights: ENV.lightsOn)
  ENV.night = 1 - smoothstep(-10, 1, sp.elev);
  updateBloom();
  BASE.winMat.emissive.setHex(0xffc27a).multiplyScalar((0.75 + 0.85 * HDR) * ENV.lamps);   // HDR: lit windows glow (bloom)
}

/* ---- audio ---- */
/* Sound must last ARM_DELAY seconds before the base opens fire — short notification sounds never trigger it.
   Combat is latched (updateArming): when the sound stops, the base holds for DISARM_DELAY seconds ("no more
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

/* ---- base weapons ---- */
const _p = new V3(), _d = new V3();
const muzzleSmoke = (p, d, k) => FX.smoke.spawn(p.clone().addScaledVector(d, 0.4), { s0: 0.9 * k, s1: 4 * k, life: 2.2, a0: 0.5, smoke: true, v: d.clone().multiplyScalar(3).add(new V3(WIND.x * 1.3, 0.5, WIND.z * 1.3)), drag: 0.9 });
let aaTurn = 0, tankTurn = 0;
/* twin 35 mm: a pair of shells at the tracked target's lead point, or a burst into the sky */
function fireAA(m, strength) {
  m.mi = (m.mi + 1) % 2; m.muzzle = m.muzzles[m.mi];
  mountMuzzle(m, _p, _d);
  const tgt = m.track && enemyAlive(m.track) ? m.track : null, speed = 80;
  const aim = tgt ? leadPoint(tgt, _p, speed) : _p.clone().addScaledVector(_d, 50), tt = aim.distanceTo(_p) / speed, dir = aim.sub(_p).normalize();
  FX.tracers.spawn(_p, dir.clone().multiplyScalar(speed), { life: tt, len: 1.4, w: 0.25, color: 0xffb050 });
  FX.flash.spawn(_p.clone().addScaledVector(dir, 0.4), { s0: 2.0 * Math.min(1.5, strength), s1: 3, life: 0.11, a0: 1 });
  muzzleSmoke(_p, dir, 0.8); FX.lights.flash(_p, 3, 0.14);
  if (tgt) queueHit(tgt, { chance: 0.45, dmg: 1, src: m, delay: tt }); else FLAK.push({ at: T + tt, p: _p.clone().addScaledVector(dir, 50) });
  m.recoil = 1;
}
/* tank gun: at a column in range (a flat, fast round, the hit rolled on arrival); otherwise a round far out past the wire */
function fireTank(m, strength) {
  if (m.downT > 0) return;
  mountMuzzle(m, _p, _d);
  const tgt = m.track && enemyAlive(m.track) ? m.track : null;
  let v;
  if (tgt) { const tt = tgt.p.distanceTo(_p) / 75; v = tgt.p.clone().setY(tgt.p.y + 0.5).sub(_p).normalize().multiplyScalar(75); FX.tracers.spawn(_p, v, { life: tt, len: 1.6, w: 0.22, color: 0xffd090 }); queueHit(tgt, { chance: 0.55, dmg: 2, src: m, delay: tt }); }
  else { v = _d.clone().multiplyScalar(70); v.y += 2; FX.tracers.spawn(_p, v, { life: 4, len: 1.6, w: 0.22, color: 0xffd090, grav: 1.5, splash: 1.4 }); }
  FX.flash.spawn(_p.clone().addScaledVector(_d, 0.6), { s0: 3.0 * Math.min(1.4, strength), s1: 4.5, life: 0.14, a0: 1 });
  for (let i = 0; i < 3; i++) FX.smoke.spawn(_p.clone().addScaledVector(_d, 0.5 + i * 0.6), { s0: 1, s1: 4.5, life: 2.4, a0: 0.55, smoke: true, v: _d.clone().multiplyScalar(rand(2, 4)).add(new V3(WIND.x, 0.5, WIND.z)), drag: 0.9 });
  const g = m.yawG.position; for (let i = 0; i < 3; i++) FX.smoke.spawn(new V3(g.x + rand(-1, 1), 0.3, g.z + rand(-1, 1)), { s0: 0.8, s1: 2.6, life: 1.6, a0: 0.35, color: ENV.dustTint, v: drift(1, 0.6), drag: 0.8 });   // the blast kicks up dust
  FX.lights.flash(_p, 4, 0.18);
  m.recoil = 1; if (!tgt) mountRetarget(m);
  if (Math.random() < 0.15) RADIO.say(RADIO_NAMES.armor, radioLine(COMBAT.tank), { role: 'ground', cat: 'combat', prio: 0 });
}
/* ---- heavy-music weapons: flak airbursts, Patriot / NASAMS, Stingers ---- */
const FLAK = [];
let camShake = 0;
function fireFlak() {
  const g = pick(ALL_AA.filter(m => !(m.downT > 0))); if (!g || g.flakCd > 0) return;   // (a gun knocked out doesn't fire: DAMAGE)
  g.flakCd = 0.35;
  g.tYaw = g.center + rand(-g.half, g.half); g.tPitch = rand(0.8, 1.2);       // high into the sky over a random bearing, burst at altitude
  g.mi = (g.mi + 1) % 2; g.muzzle = g.muzzles[g.mi];
  mountMuzzle(g, _p, _d);
  const dir = _d.clone(); dir.y = Math.max(dir.y, 0.55); dir.normalize();
  const dist = rand(35, 60), speed = 70, tt = dist / speed;
  FX.tracers.spawn(_p, dir.clone().multiplyScalar(speed), { life: tt, len: 1.3, w: 0.25, color: 0xffc070 });
  FX.flash.spawn(_p.clone().addScaledVector(_d, 0.5), { s0: 2.0, s1: 3.0, life: 0.1, a0: 1 });
  FX.smoke.spawn(_p.clone(), { s0: 0.8, s1: 3.5, life: 1.8, a0: 0.45, smoke: true, v: new V3(WIND.x * 1.3, 0.6, WIND.z * 1.3), drag: 0.9 });
  g.recoil = 1;
  FLAK.push({ at: T + tt, p: _p.clone().addScaledVector(dir, dist) });
}
function updateFlak(dt) {
  for (const g of ALL_AA) g.flakCd = Math.max(0, (g.flakCd || 0) - dt);
  for (let i = FLAK.length - 1; i >= 0; i--) {
    const f = FLAK[i]; if (T < f.at) continue;
    FX.flash.spawn(f.p, { s0: 3.2, s1: 5.5, life: 0.18, a0: 1 });
    for (let k = 0; k < 3; k++) FX.smoke.spawn(f.p.clone().add(new V3(rand(-0.8, 0.8), rand(-0.5, 0.5), rand(-0.8, 0.8))), { s0: 1.4, s1: 4.8, life: 3.2, a0: 0.7, color: 0x2e3034, v: drift(0.6, 0.15), drag: 0.6 });
    FX.lights.flash(f.p, 3, 0.15);
    FLAK.splice(i, 1);
  }
}
/* LANCER's kill probabilities (a hit = 2 damage: one kills a fighter, a helicopter or a missile; bombers take 2–3) */
const SAM_PK = { patriot: 0.9, nasams: 0.85, stinger: 0.78 };
function spawnGuidedMissile(p, v, turnAt, dir, speed, life, big, target, chance, src) {
  MISSILES.push({ p, v, life, smokeT: 0, guided: { turnAt, dir, speed, age: 0 }, big, target: target || null, chance: chance || 0.75, dmg: 2, src, speed });
}
/* Patriot (ballistic missiles first, then bombers / bandits) or NASAMS (cruise missiles, helicopters, bandits): out of a
   canister. With enemies on, only at a target in range (a launch into the empty sky burnt the launcher's cooldown);
   with them off the launches are the show they always were */
function launchSAM(kind) {
  if (kind === 'patriot' && DAMAGE.patriotDown()) return;                                   // its radar knocked out
  const cands = ALL_SAMS.filter(m => m.sam === kind && (m.cd || 0) <= 0 && !(m.downT > 0)); if (!cands.length) return;
  // a ready launcher with a target in range (picking the launcher first sat out a target only another one reached)
  const kinds = kind === 'patriot' ? [['ballistic'], ['bandit']] : [['cruise', 'heli'], ['bandit']];
  let m = null, tgt = null;
  if (CFG.enemies) {
    for (let i = 0, i0 = randi(0, cands.length - 1); i < cands.length; i++) { const c = cands[(i0 + i) % cands.length], q = mountPos(c), t = nearestEnemy(q, kinds[0], 160) || nearestEnemy(q, kinds[1], 120); if (t) { m = c; tgt = t; break; } }
    if (!m) return;
  } else m = pick(cands);
  m.muzzle = pick(m.cells); mountMuzzle(m, _p, _d);
  const p = _p.clone(), out = _d.clone();
  m.cd = kind === 'patriot' ? 3.2 : 2.2;
  const dir = tgt ? tgt.p.clone().sub(p).normalize() : out.clone();
  spawnGuidedMissile(p, out.clone().multiplyScalar(18), kind === 'patriot' ? 0.6 : 0.35, dir, kind === 'patriot' ? 55 : 48, 6, kind === 'patriot', tgt, kind === 'patriot' ? SAM_PK.patriot : SAM_PK.nasams, m);
  for (let i = 0; i < 6; i++) FX.smoke.spawn(p.clone().add(new V3(rand(-0.5, 0.5), rand(-0.3, 0.3), rand(-0.5, 0.5))), { s0: 1.2, s1: 4.5, life: 2.6, a0: 0.7, smoke: true, v: out.clone().multiplyScalar(-rand(1, 3)).add(new V3(WIND.x, 0.5, WIND.z)), drag: 0.8 });
  FX.flash.spawn(p, { s0: 3, s1: 4, life: 0.25, a0: 1 }); FX.lights.flash(p, 4, 0.4);
  if (Math.random() < 0.5) RADIO.say(m.radio, radioLine(COMBAT.patriot), { role: 'ground', cat: 'combat', prio: 0 });
}
/* Avenger: a Stinger at the nearest helicopter / cruise missile / low bandit */
function launchStinger() {
  const ready = ALL_SHORAD.filter(s => (s.cd || 0) <= 0 && !(s.downT > 0)).sort((a, b) => !!b.track - !!a.track); if (!ready.length) return;
  // the first ready Avenger with a target (tracking first): the first in the list alone once sat out a helicopter the
  // other one had in range; nothing in range: all kept ready
  let m = ready[0], tgt = null;
  if (CFG.enemies) { m = null; for (const c of ready) { const t = c.track || nearestEnemy(mountPos(c), ['heli', 'cruise', 'bandit'], 80); if (t) { m = c; tgt = t; break; } } if (!m) return; }
  m.mi = (m.mi + 1) % 2; m.muzzle = m.muzzles[m.mi];
  mountMuzzle(m, _p, _d);
  const p = _p.clone(), dir = _d.clone();
  m.cd = 1.4;
  spawnGuidedMissile(p, dir.clone().multiplyScalar(20), 0.2, dir, 60, 4, false, tgt, SAM_PK.stinger, m);
  FX.flash.spawn(p, { s0: 1.6, s1: 2.2, life: 0.12, a0: 1 });
}
const _mp = new V3(); const mountPos = m => { m.pitchG.updateWorldMatrix(true, false); return _mp.setFromMatrixPosition(m.pitchG.matrixWorld); };   // a mount's pivot (choosing a launcher)
let ciwsGap = 0;
function startCIWS(dur) {
  if (RT() < ciwsGap) return;                                           // short pause between new bursts
  if (ALL_CIWS.filter(m => m.burst > 0).length >= 2) return;          // never more than 2 mounts at once
  const idle = ALL_CIWS.filter(m => m.burst <= 0 && (m.cd || 0) <= 0 && !(m.downT > 0));   // mounts rest between bursts
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
  // heavy passages: Patriot launches on the biggest hits (always at an incoming ballistic missile), NASAMS and Stingers
  const tbm = ENEMIES.some(e => e.kind === 'ballistic' && enemyAlive(e));
  // (LANCER: from moderately loud passages on — heavy > 0.35; it once needed > 0.55 and a big hit, and the base looked
  // defenceless)
  if (band === 'low' && ((heavy > 0.35 && strength > 1.2 && Math.random() < 0.5 * f) || (tbm && Math.random() < 0.7))) launchSAM('patriot');
  if (band !== 'low' && heavy > 0.35 && Math.random() < 0.18 * f) launchSAM('nasams');
  if (band === 'high' && heavy > 0.35 && Math.random() < 0.22 * f) launchStinger();
  // flak barrage over the base while it's heavy
  if (band === 'mid' && heavy > 0.45 && Math.random() < (0.35 + heavy * 0.5) * f) fireFlak();
  if (band === 'low') {
    if (Math.random() < Math.min(1, f)) {
      const t = ALL_TANKS[tankTurn++ % ALL_TANKS.length]; if (t) fireTank(t, strength);
      if (((strength > 1.8 && Math.random() < 0.5) || f > 1.5) && ALL_TANKS.length) fireTank(ALL_TANKS[tankTurn++ % ALL_TANKS.length], strength);
    }
    for (const fb of FLYBYS) if (Math.random() < 0.45) fb.fireMissile();
  } else if (band === 'mid') {
    startCIWS(rand(0.12, 0.28) * Math.max(0.5, f));
    const aa = ALL_AA.filter(m => m.track); if (aa.length && Math.random() < 0.8 * f) fireAA(aa[aaTurn++ % aa.length], strength);
    for (const fb of FLYBYS) fb.fireGuns(0.28);
  } else if (band === 'high') {
    if (Math.random() < 0.35 * f) startCIWS(0.1);
  }
  AIRWAR.onBeat(band, f);               // fighters, gunships and attack helicopters on their passes (js/airwar.js)
}
/* a unit knocked out (DAMAGE) tracks nothing; a gun's barrel droops */
const knockedOut = m => { if (!(m.downT > 0)) return false; m.track = null; if (m.pmin != null && !m.sam) m.tPitch = m.pmin; return true; };
function updateMounts(dt) {
  const hunting = CFG.enemies && ENEMIES.length;
  for (const m of ALL_AA) {
    if (!knockedOut(m) && hunting) { mountMuzzle(m, _p, _d); m.track = nearestEnemy(_p, ['bandit', 'heli'], 85); if (m.track) aimMountAt(m, leadPoint(m.track, _p, 80)); } else m.track = null;
    mountUpdate(m, dt);
  }
  for (const m of ALL_TANKS) {
    if (knockedOut(m)) { mountUpdate(m, dt); continue; }
    if (hunting) { mountMuzzle(m, _p, _d); m.track = nearestEnemy(_p, ['armor'], 110); if (m.track) aimMountAt(m, m.track.p); } else m.track = null;
    if (!m.track && (m.scanT = (m.scanT ?? rand(2, 8)) - dt) <= 0) { m.scanT = rand(5, 12); mountRetarget(m); m.tPitch = rand(m.pmin, m.pmin + 0.1); }   // nothing to shoot: the crew looks around
    mountUpdate(m, dt);
  }
  for (const m of ALL_SHORAD) {
    if (!knockedOut(m) && hunting) { mountMuzzle(m, _p, _d); m.track = nearestEnemy(_p, ['heli', 'cruise'], 70) || nearestEnemy(_p, ['bandit'], 60); if (m.track) aimMountAt(m, m.track.p); } else m.track = null;
    mountUpdate(m, dt); m.cd = Math.max(0, (m.cd || 0) - dt);
  }
  for (const m of ALL_SAMS) {             // the launchers slew toward the threat sector, at their fixed elevation
    const t = hunting && !knockedOut(m) && !(m.sam === 'patriot' && DAMAGE.patriotDown()) && (nearestEnemy(m.yawG.position, m.sam === 'patriot' ? ['ballistic', 'bandit'] : ['cruise', 'heli', 'bandit'], 150));
    if (t) { _al.copy(t.p); m.yawG.parent.worldToLocal(_al); const a = Math.atan2(-(_al.z - m.yawG.position.z), _al.x - m.yawG.position.x); m.tYaw = m.center + clamp(angleWrap(a - m.center), -m.half, m.half); }
    mountUpdate(m, dt); m.cd = Math.max(0, (m.cd || 0) - dt);
  }
  if (hunting) for (const m of ALL_CIWS) {
    if (knockedOut(m)) continue;
    mountMuzzle(m, _p, _d);
    m.track = nearestEnemy(_p, ['cruise'], 60) || nearestEnemy(_p, ['heli'], 50) || nearestEnemy(_p, ['bandit'], 45);
    if (m.track) aimMountAt(m, leadPoint(m.track, _p, 95));
  }
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
      if (Math.random() < dt * 14) FX.smoke.spawn(_p.clone(), { s0: 0.4, s1: 1.8, life: 1.2, a0: 0.35, smoke: true, v: new V3(WIND.x * 1.3, 0.4, WIND.z * 1.3) });
      if (m.burst <= 0) {
        if (enemyAlive(m.burstTarget) && m.burstTarget.p.distanceTo(_p) < 65) queueHit(m.burstTarget, { chance: m.burstTarget.kind === 'cruise' ? (m.lastDitch ? 0.85 : 0.65) : 0.25, dmg: 1, src: m });
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
const isDown = a => a.state === 'parked';
// not launching or landing right now (an aircraft holding in orbit for its turn to land is landing)
const settled = a => isDown(a) || ((a.state === 'orbit' || a.onMission || a.inCombat) && !a.landReq);
function wpick(cands) { let r = Math.random() * cands.reduce((s, c) => s + c.w, 0); for (const c of cands) if ((r -= c.w) <= 0) return c; return cands[cands.length - 1]; }
const flightSize = n => n >= 4 && Math.random() < 0.5 ? 2 : n;   // a four-ship flight goes as a pair or as all four
// in combat: flights come back to rearm now and then (a try on 30 % of the ticks, after 2 min up), the AWACS and a tanker already up stay up
const CBT_RECOVER_P = 0.3, CBT_SORTIE = 120;
const TANKER_STATION = 300;   // in peace a tanker stays up at least 5 min (refuelling passes need it on station)
const engaged = a => a.inCombat && !a.landReq && !a.tank;   // a flight away refuelling isn't fighting
function autoLaunch(joinOnly) {
  const cands = [], armed = AUD.armed;
  for (const all of flightGroups().values()) {
    if (!all.every(settled) || all[0].spec.tanker) continue;   // tankers go up for refuelling passes only (TANKER / scrambleSupport)
    const down = all.filter(isDown), ready = down.filter(a => a.canLaunch()); if (!ready.length) continue;   // (not the damaged ones)
    const split = down.length < all.length;     // part of the flight is already up: send the rest to join it
    if (joinOnly && !split) continue;
    const n = split ? ready.length : flightSize(ready.length);
    const w = (split ? 4 : 1) + ready.length * 0.5;
    cands.push({ list: ready.slice(0, n), w: armed && ready[0].spec.armed ? w * 3 : w });   // in combat fighters go first
  }
  if (!cands.length) return false;
  for (const a of wpick(cands).list) a.requestLaunch();
  return true;
}
/* combat: the AWACS goes up first if it is down (one type per call); the tankers aren't scrambled (no refuelling in combat) */
function scrambleSupport() {
  const sup = AIRCRAFT.filter(a => a.isAwacs && !a.retiring);
  for (const key of new Set(sup.map(a => a.spec.key))) {
    const kind = sup.filter(a => a.spec.key === key);
    if (kind.some(a => !isDown(a))) continue;
    const all = flightGroups().get(flightOf(kind[0]));
    if (!all.every(settled)) continue;
    if (!all.some(a => a.canLaunch())) continue;
    for (const a of all) a.requestLaunch();
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
    // a pair whose flight-mates are still down waits for them to join instead of being recovered
    // a tanker isn't recovered while a refuelling pass is due (TANKER.update would launch it again right away)
    const minUp = armed ? CBT_SORTIE : all[0].spec.tanker ? (TANKER.timer < 300 ? Infinity : TANKER_STATION) : 25;
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
    if (m.guided) {                      // out of the canister, then pitch over toward the target bearing
      const gd = m.guided; gd.age += dt;
      if (boosting) m.v.addScaledVector(m.v.clone().normalize(), 22 * dt);
      else if (!enemyAlive(m.target)) m.v.lerp(gd.dir.clone().multiplyScalar(gd.speed), Math.min(1, dt * 2.2));
    }
    if (m.target && !boosting) {         // homing on an enemy; the hit itself is resolved on the beat
      const e = m.target;
      if (enemyAlive(e)) {
        const to = e.p.clone().sub(m.p), d = to.length(); to.normalize();
        if (m.arrived) { m.p.copy(e.p).addScaledVector(to, -1.2); m.v.copy(e.v); m.life = Math.max(m.life, 0.2); }
        else {
          // steered at where the target will be (a lead of the time to it, ≤ 1.5 s: a pure chase of a ballistic missile
          // coming down at 40–70 never caught it), and it has arrived within what the two close in one step (≥ 3: closing at
          // ~100 / s they passed through each other between two steps)
          const sp = Math.max(m.speed || 50, e.v.length() + 25), lead = e.p.clone().addScaledVector(e.v, Math.min(1.5, d / sp)).sub(m.p).normalize();
          const reach = Math.max(3, (m.v.length() + e.v.length()) * dt);
          m.v.lerp(lead.multiplyScalar(sp), Math.min(1, dt * 4));
          // (a SAM at a cruise / ballistic missile scores on arrival, not on the next beat: the missile had often landed first)
          if (d < reach) { m.arrived = true; queueHit(e, { chance: m.chance, dmg: m.dmg, src: m.src, missile: m, now: m.src && m.src.radio === RADIO_NAMES.patriot && (e.kind === 'cruise' || e.kind === 'ballistic') }); }
        }
      } else m.target = null;
    }
    // motor glow at a fixed 30 Hz: per-frame spawns ate the shared flash pool (cutting explosions short) and scaled with FPS
    if ((m.guided || m.glow) && (m.glowT = (m.glowT || 0) - dt) <= 1e-4) { m.glowT += 1 / 30; FX.flash.spawn(m.p, { s0: m.big ? 1.3 : 0.9, s1: m.big ? 1.1 : 0.7, life: 0.075, a0: 1 }); }
    m.p.addScaledVector(m.v, dt);
    const iv = m.small ? 0.06 : m.big ? 0.018 : 0.025, sv = new V3(WIND.x, 0.3, WIND.z);
    while (m.smokeT > iv) { m.smokeT -= iv; FX.smoke.spawn(m.p.clone(), m.big ? { s0: 0.8, s1: 3.2, life: 3.0, a0: 0.6, smoke: true, v: sv } : m.small ? { s0: 0.3, s1: 1.3, life: 1.2, a0: 0.4, smoke: true, v: sv } : { s0: 0.5, s1: 2.4, life: 2.2, a0: 0.5, smoke: true, v: sv }); }
    if (m.life <= 0 || m.p.y < groundH(m.p.x, m.p.z)) { if (m.p.y < groundH(m.p.x, m.p.z) && !m.arrived) groundHit(m.p, m.small ? 0.8 : 1.2); MISSILES.splice(i, 1); }
  }
}

/* ---- the base: radar, searchlights (guard towers sweep the ground outside, the sky lights the sky) ---- */
const _w = new V3();
function updateSite(dt) {
  for (const r of BASE.radars) r.rotation.y = (r.rotation.y + dt * 1.4) % TAU;
  // air-defence radars in a fight: the AA guns' search antennas spin up (and run down after); the Patriot radar's head
  // slews toward the nearest air threat (looked for again every 3 s) and back to its sector in peace — a phased array, it
  // doesn't spin
  const armed = AUD.armed;
  for (const m of BASE.mounts.aa) if (m.search) { m.sv = (m.sv || 0) + clamp((armed && !(m.downT > 0) ? 4 : 0) - (m.sv || 0), -1.5 * dt, 1.5 * dt); if (m.sv) m.search.rotation.y = (m.search.rotation.y + m.sv * dt) % TAU; }
  const pr = BASE.patriotRadar;
  if (pr && pr.head) {
    const up = !(pr.downT > 0);                                                             // knocked out: it stops where it points
    if (pr.tgt && !(armed && up && enemyAlive(pr.tgt))) pr.tgt = null;
    if (armed && up && (!pr.tgt || (pr.pickT = (pr.pickT || 0) - dt) <= 0)) {
      pr.pickT = 3; let best = 1e9;
      for (const e of ENEMIES) if (e.kind !== 'armor' && enemyAlive(e)) { const d = Math.hypot(e.p.x - pr.position.x, e.p.z - pr.position.z); if (d < best) { best = d; pr.tgt = e; } }
    }
    const want = pr.tgt ? angleWrap(Math.atan2(-(pr.tgt.p.z - pr.position.z), pr.tgt.p.x - pr.position.x) - pr.rotation.y) : armed || !up ? pr.head.rotation.y : 0;
    pr.head.rotation.y = angleWrap(approachAngle(pr.head.rotation.y, want, dt * 0.35));
  }
  for (const sl of BASE.guards) {
    const sw = sl.sweep, ang = sw.base + Math.sin(T * sw.speed + sw.ph) * sw.amp, h = sl.holder.position;
    sl.holder.lookAt(_w.set(h.x + Math.cos(ang) * sw.dist, 0, h.z - Math.sin(ang) * sw.dist));
  }
  // sky lights: each keeps its own target (the nearest bandit / helicopter, kept while it lives, a pause before the
  // next) or sweeps the sky; either way the beam slews (yaw / elevation at a limited, eased rate), it never jumps
  for (const sl of BASE.skyLights) {
    const s = sl.sky, h = sl.holder.position;
    if (sl.yaw == null) { sl.yaw = sl.sweep = s.ph; sl.el = s.elev; sl.wy = sl.we = 0; }
    if (sl.tgt && !(AUD.armed && enemyAlive(sl.tgt))) { sl.tgt = null; sl.pause = 1.5; }
    if (!sl.tgt && AUD.armed && (sl.pause = (sl.pause || 0) - dt) <= 0) {
      let best = 1e9; for (const e of ENEMIES) if ((e.kind === 'bandit' || e.kind === 'heli') && !e.duel && enemyAlive(e)) { const d = e.p.distanceTo(h); if (d < best) { best = d; sl.tgt = e; } }
      if (!sl.tgt) sl.pause = 1;
    }
    let ty, te;
    if (sl.tgt) { const p = sl.tgt.p; ty = Math.atan2(p.z - h.z, p.x - h.x); te = Math.atan2(p.y - h.y, Math.hypot(p.x - h.x, p.z - h.z)); sl.sweep = sl.yaw; }
    else { sl.sweep += Math.min(s.speed, SKY_SLEW * 0.8) * dt; ty = sl.sweep; te = s.elev + Math.sin(T * 0.13 + s.ph) * 0.25; }   // the sweep carries on from where it points
    const dy = Math.atan2(Math.sin(ty - sl.yaw), Math.cos(ty - sl.yaw)), de = te - sl.el;
    sl.wy += clamp(clamp(dy * 2, -SKY_SLEW, SKY_SLEW) - sl.wy, -dt, dt); sl.we += clamp(clamp(de * 2, -SKY_SLEW, SKY_SLEW) - sl.we, -dt, dt);
    sl.yaw += sl.wy * dt; sl.el = clamp(sl.el + sl.we * dt, 0.15, 1.45);
    sl.aim = (sl.aim || new V3()).set(h.x + Math.cos(sl.yaw) * Math.cos(sl.el) * 40, h.y + Math.sin(sl.el) * 40, h.z + Math.sin(sl.yaw) * Math.cos(sl.el) * 40);
    sl.holder.lookAt(sl.aim);
  }
}
const SKY_SLEW = 0.5;   // rad/s: the sky lights' fastest swing (reached gradually: 1 rad/s²)
/* a pooled light (HELI_LIGHTS) takes its searchlight's place and aim; dark while the helicopter is hidden */
const shownTree = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
function followLight(s) {
  s.holder.updateWorldMatrix(true, false); const m = s.holder.matrixWorld;
  s.light.position.setFromMatrixPosition(m); s.light.target.position.set(0, 0, 10).applyMatrix4(m);
}
function updateLights() {
  for (const m of NAV_MATS) {
    let a = m.userData.day ? Math.max(ENV.lamps, 0.75) : ENV.lamps; const b = m.userData.blink;   // vehicle beacons flash by day too
    if (b) { const ph = ((T / b.period) + (b.phase || 0)) % 1; a *= ((ph + 1) % 1) < b.duty ? 1 : 0; }
    m.opacity = a; m.size = m.userData.scale * ENV.ppu; m.color.setScalar(1 + 1.6 * HDR * ENV.lamps);   // HDR at night: the lamps glow (bloom)
  }
  const spotsOn = GPU.clustered || ENV.lightsOn > 0;
  for (const l of HELI_LIGHTS.pool) { l.visible = spotsOn; l.intensity = 0; }   // (the ones in use: below)
  if (!GPU.clustered) HELI_LIGHTS.assign();
  for (const s of SEARCHLIGHTS) {
    if (s.follow && s.light) followLight(s);
    const on = ENV.lightsOn * s.enabled * (s.follow && !shownTree(s.holder) ? 0 : 1), beam = Math.max(ENV.lamps, ENV.lightsOn) * s.enabled * (1 + 1.2 * WEATHER.fog + 0.5 * WEATHER.rain);   // (beams thicker in fog and rain)
    // hidden by day: a visible spot light costs every lit fragment even at zero intensity (toggles only at dusk/dawn);
    // clustered (WebGPU): always shown — a light out of its cluster costs nothing, and no toggle rebuilds the lights
    if (s.light) { s.light.intensity = s.o.intensity * on * SPOT_K; s.light.visible = spotsOn; }
    // a real light's beam: the volume draws its covered share of what the light gives (ENV.lightsOn: VOLUME.cover, by the
    // haze); the cone the rest, and the lamps' share beyond the light (by day in fog the spot light is hidden)
    const vol = VOLUME.live() && s.light, k = vol ? beam * (1 - VOLUME.cover() * ENV.lightsOn / Math.max(1e-3, ENV.lamps)) : beam;
    if (s.cone) { s.cone.material.uOpacity.value = s.o.coneOpacity * k * (0.45 + 0.55 * Math.max(ENV.night, WEATHER.fog * 0.6)); s.cone.visible = !vol || k > 1e-3; }
  }
  VOLUME.update();
}

/* ---- missions beyond the screen edge (only while there is no music) ---- */
let missionTimer = rand(25, 45);
const LAUNCHING = new Set(['ready', 'pushback', 'taxi_out', 'hold_short', 'lineup', 'takeoff_roll', 'climb', 'spinup', 'lift', 'depart']);
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
    if (ready[0].spec.missions && !ready[0].spec.missions.length) continue;   // no missions (tankers): not a flight on station either
    onStation++;                                             // counts a pair left behind while the other is away
    // never send part of a flight while its other part is away; members on the ground don't block (manual ops)
    if (!all.some(a => a.onMission) && ready.every(a => a.airT > 15)) cands.push({ base, ready, full: ready.length === all.length, size: all.length });
  }
  // several flights can be away at once, but one flight always stays on station over the base
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
  const hqs = awacs ? [awacs.callsign, 'awacs'] : [RADIO_NAMES.tower, 'tower'];
  const C = { cat: 'combat', prio: 0 };
  // the 5-second safety check before combat: unknown contacts... then either combat or a false alarm
  const arming = AUD.active && AUD.soundStart >= 0 && !armed;
  if (arming && !AUD.wasArming) RADIO.q = RADIO.q.filter(m => m.cat !== 'alert');   // a pending "false alarm" is obsolete now
  if (arming && !AUD.wasArming && T > (AUD.alertCd || 0)) {
    AUD.alertCd = T + 6; AUD.alerted = true;
    RADIO.say(hqs[0], radioLine(LINES.unknownContacts, { B: bearingWords(rand(0, TAU)) }), { role: hqs[1], cat: 'alert', prio: 3 });
  }
  if (!arming && AUD.wasArming && !armed && AUD.alerted) {
    AUD.alerted = false;
    RADIO.say(hqs[0], radioLine(LINES.falseAlarm), { role: hqs[1], cat: 'alert', prio: 3 });
  }
  if (armed && !AUD.wasArmed) RADIO.q = RADIO.q.filter(m => m.cat !== 'alert');
  if (armed) AUD.alerted = false;
  AUD.wasArming = arming;
  if (armed && !AUD.wasArmed) { RADIO.say(hqs[0], radioLine(COMBAT.start), { role: hqs[1], cat: 'combat', prio: 3 }); chatterTimer = rand(3, 5); }
  if (!armed && AUD.wasArmed) RADIO.say(hqs[0], radioLine(COMBAT.end), { role: hqs[1], prio: 2, delay: 1 });
  AUD.wasArmed = armed;
  if (!AUD.fighting) return;
  chatterTimer -= dt; if (chatterTimer > 0) return;
  chatterTimer = rand(3.5, 7) * (1 - 0.45 * STRESS.level);       // more radio traffic as stress builds
  if (RADIO.q.filter(m => m.cat === 'combat').length > 1) return;
  // fighters and helicopters talk about their own passes (js/airwar.js); here the AWACS, the base's defences and the enemy
  const foes = CFG.enemies ? ENEMIES.filter(e => e.cs && enemyAlive(e)) : [];
  if (foes.length && Math.random() < 0.15 + 0.25 * STRESS.level) enemySay(pick(foes).cs, ENEMY_LINES.chatter, null, { prio: 1 });
  else if (awacs && Math.random() < 0.45) awacs.say(radioLine(COMBAT.awacs), C);
  else RADIO.say(pick(RADIO_NAMES.defense), radioLine(COMBAT.base), { role: 'ground', cat: 'combat', prio: 0 });
}

/* ---- control panel ---- */
let uiTimer = 0, meterTimer = 0, envTimer = 0;
/* The aircraft list is paged, not scrolled: Wallpaper Engine passes clicks but no mouse wheel to the wallpaper.
   The pager (◀ n/N ▶ + a chip per aircraft type) only shows when the rows don't fit into 42 % of the window. */
const PAGER = { page: 0, size: 0, rowH: 0, shownH: 0, rows: [], chips: [] };   // shownH: the row height the page was laid out with
function pageSize() {
  const r = PAGER.rows.find(r => r.offsetHeight > 0); if (r) PAGER.rowH = r.offsetHeight;   // measured while shown (none while collapsed)
  return Math.max(4, Math.floor(innerHeight * 0.38 / (CFG.panelScale / 100) / (PAGER.rowH || 23)));
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
  // group flights together: by type, then callsign (MOBIUS 1, MOBIUS 2, … GARUDA 1 …)
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
    row.querySelector('.nm').textContent = a.callsign;
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
/* the base's sites on the panel: tower, air defence battery, tank platoon, point defence; DAMAGED while a fire burns on
   one of theirs or a unit of theirs is knocked out (DAMAGE), the tower's RUNWAY CLOSED while a crater is repaired */
const anyDown = l => l.some(m => m.downT > 0);
const SITES = [
  { tp: 'TWR', name: () => 'TOWER', desc: 'ATC · runway', fires: ['TOWER', 'OPS', 'RUNWAY', 'HANGAR', 'HAS', 'FUEL'], down: () => false, busy: () => AIRFIELD.rwy.size || AIRFIELD.arrivals.size },
  { tp: 'SAM', name: () => RADIO_NAMES.patriot, desc: 'Patriot · NASAMS', fires: ['PATRIOT'], down: () => DAMAGE.patriotDown() || anyDown(ALL_SAMS), busy: () => ENEMIES.some(e => (e.kind === 'ballistic' || e.kind === 'bandit') && enemyAlive(e)) },
  { tp: 'ARM', name: () => RADIO_NAMES.armor, desc: 'tank platoon', fires: [], down: () => anyDown(ALL_TANKS), busy: () => ENEMIES.some(e => e.kind === 'armor' && enemyAlive(e)) },
  { tp: 'C-RAM', name: () => RADIO_NAMES.cram, desc: 'point defence', fires: ['FIRE STN'], down: () => anyDown(ALL_CIWS) || anyDown(ALL_AA) || anyDown(ALL_SHORAD), busy: () => ENEMIES.some(e => (e.kind === 'cruise' || e.kind === 'heli') && enemyAlive(e)) }
];
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
  const sites = document.getElementById('sites');
  for (const s of SITES) {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = '<span class="tp"></span><span class="nm"><b></b><i></i></span><span class="st"></span>';
    row.querySelector('.tp').textContent = s.tp; row.querySelector('.nm b').textContent = s.name(); row.querySelector('.nm i').textContent = s.desc;
    s.ui = { st: row.querySelector('.st'), nm: row.querySelector('.nm b') };
    sites.appendChild(row);
  }
}
/* the panel's DOM is written only where a value changed (4×/s: a rewrite invalidates style and layout every time) */
const setTxt = (el, t) => { if (el._t !== t) { el._t = t; el.textContent = t; } };
const setCls = (el, c) => { if (el._c !== c) { el._c = c; el.className = c; } };
const UI_EL = {}, uiEl = id => UI_EL[id] || (UI_EL[id] = document.getElementById(id));
let uiMinute = -1;
function updateUI() {
  if (!CFG.showPanel) return;                                // hidden: nothing to show (it catches up when shown)
  // window / panel size or the row height changed: lay the pages out again (read before the writes below: no forced reflow)
  if (PAGER.rows.length && (pageSize() !== PAGER.size || PAGER.rowH !== PAGER.shownH)) showPage();
  const now = getNow(), mi = now.getHours() * 60 + now.getMinutes();
  if (mi !== uiMinute) { uiMinute = mi; setTxt(uiEl('clock'), now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); }
  const e = ENV.elev;
  setTxt(uiEl('daystate'), (e > 6 ? 'DAY' : e > -6 ? 'TWILIGHT' : 'NIGHT') + ' · ' + TERRAIN.season.toUpperCase());
  const as = uiEl('audiostate');
  const arming = AUD.active && !AUD.armed && AUD.soundStart >= 0;
  // base status: on alert in silence, unknown contacts while the sound arms, air raid once armed
  setTxt(as, (AUD.holding ? `◐ NO CONTACTS · ${Math.max(0, AUD.holdUntil - RT()).toFixed(0)}s` : AUD.armed ? '● AIR RAID' : arming ? `◌ UNKNOWN CONTACTS · ${Math.max(0, ARM_DELAY - (RT() - AUD.soundStart)).toFixed(0)}s` : '○ ON ALERT') + (FILE_AUDIO.playing ? ' (FILE)' : AUD.demo && DEMO.on ? ' (DEMO)' : ''));
  setCls(as, AUD.armed ? 'on' : '');
  const th = uiEl('threat');
  if (th) { const n = Math.round(STRESS.level * 10); setTxt(th, '▮'.repeat(n) + '▯'.repeat(10 - n) + '  ' + STRESS.label); setCls(th, 'lv' + Math.min(3, Math.floor(STRESS.level * 4))); }
  let airN = 0;
  for (const a of AIRCRAFT) {
    const [txt, cls] = a.retiring ? ['RETIRING', 'wait'] : a.status; setTxt(a.ui.st, txt); setCls(a.ui.st, 'st ' + cls);
    if (a.state !== 'parked') airN++;
    const b = a.ui.btn, [bt, bd, bc] = a.canLaunch() ? ['LAUNCH', false, 'act up'] : a.canLand() ? ['RECOVER', false, 'act down'] : a.landReq ? ['QUEUED', true, 'act'] : ['···', true, 'act'];
    setTxt(b, bt); setCls(b, bc); if (b.disabled !== bd) b.disabled = bd;
  }
  setTxt(uiEl('count'), `${airN}/${AIRCRAFT.length}`);
  const engaged = AUD.armed && CFG.fire > 0;
  for (const s of SITES) {
    const hit = BASE_FIRES.some(f => s.fires.includes(f.name)) || s.down();
    const [txt, cls] = s.tp === 'TWR' && DAMAGE.rwy ? ['RUNWAY CLOSED', 'wait'] : hit ? ['DAMAGED', 'wait'] : engaged && s.busy() ? ['ENGAGING', 'busy'] : s.tp === 'TWR' && s.busy() ? ['RUNWAY IN USE', 'air'] : ['ON ALERT', 'deck'];
    setTxt(s.ui.st, txt); setCls(s.ui.st, 'st ' + cls);
  }
  const chk = uiEl('autoChk'); if (chk.checked !== CFG.auto) chk.checked = CFG.auto;
}
function updateMeter() {
  if (!CFG.showPanel) return;
  const bars = uiEl('meter').children;
  for (let i = 0; i < bars.length; i++) {
    const bin = Math.floor(Math.pow(i / bars.length, 1.4) * 60);
    const v = (AUD.raw[bin] + AUD.raw[64 + bin]) / 2, k = Math.round(Math.max(0.06, Math.min(1, v * 1.4)) * 100);   // (whole percent: unchanged bars aren't touched)
    if (bars[i]._k !== k) { bars[i]._k = k; bars[i].style.transform = `scaleY(${k / 100})`; }
  }
}

/* ---- main loop ---- */
let frameDue = 0;
function frame(ms) {
  requestAnimationFrame(frame);
  if (paused) { lastMs = ms; for (const r of PERF.recs) { if (r.last) r.pauses++; r.last = 0; } return; }   // (a pause isn't one long frame)
  if (!SHADERS_READY) { if (RT() > 15) SHADERS_READY = true; else { lastMs = ms; return; } }   // (compiling under the splash; never stuck behind it)
  if (fpsLimit > 0) {
    // due times advance in whole intervals, so the limit holds on any refresh rate (75 / 144 Hz…)
    if (ms < frameDue - 2) return;
    frameDue += 1000 / fpsLimit; if (frameDue <= ms) frameDue = ms + 1000 / fpsLimit;
  }
  // simulate the real elapsed time in sub-steps of at most 50 ms: low FPS limits don't slow the world down
  const gap = ms - lastMs; if (gap > 0 && gap < 250) frameAvg = frameAvg ? frameAvg * 0.95 + gap * 0.05 : gap;
  const el = clamp((ms - lastMs) / 1000, 0, 0.25); lastMs = ms;
  const n = Math.max(1, Math.ceil(el / 0.05)), dt = el / n;
  const on = PERF.recs.length > 0, t0 = on ? performance.now() : 0, c0 = on ? PERF.counts() : null;
  for (let i = 0; i < n * TIME_SCALE; i++) step(dt);
  const t1 = on ? performance.now() : 0;
  renderFrame();
  if (on) PERF.sample(ms, t1 - t0, performance.now() - t1, c0);
  if (GPU.timing && ms - GPU.tsT > 500) {
    GPU.tsT = ms;
    renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER).then(v => { GPU.ms.render = v || 0; }, () => {});
    renderer.resolveTimestampsAsync(THREE.TimestampQuery.COMPUTE).then(v => { GPU.ms.compute = v || 0; }, () => {});
  }
}
/* ---- performance report on a real GPU. In Wallpaper Engine: Settings → General → "CEF devtools port" (e.g. 8080),
   open http://localhost:8080 in Chrome, pick the wallpaper, then in its console:
     perfReport(60)                   — measures 60 s and logs a summary (frame times, CPU, GPU, draw calls, lights)
     perfFlags({ gputime: true })     — GPU timing (timestamp queries) from the next load (F5 in the devtools)
     perfFlags({ gl: 'webgl2' })      — the next load on the WebGL 2 backend (compare with WebGPU)
     perfFlags({ clustered: true })   — the next load with clustered lighting (experimental, WebGPU)
     perfFlags({})                    — back to normal
   The flags live in localStorage (WE passes no URL parameters); ?gputime=1 / ?gl=webgl2 / ?clustered=1 in a browser. ---- */
function perfFlags(f) { try { localStorage.setItem('fab-perf', JSON.stringify(f || {})); } catch (e) { return 'localStorage unavailable'; } return 'saved — reload to apply: ' + JSON.stringify(f || {}); }
function perfReport(sec = 30) {
  const r = { frame: [], cpu: [], sim: [], draw: [], gpu: [], comp: [], calls: [], lights: [], last: 0, pauses: 0, T0: T, t0: performance.now(),
    hitches: [], pd: null, made: { pipes: 0, programs: 0, batchGrow: 0, newBatch: 0 } }; PERF.recs.push(r);
  console.log(`perfReport: measuring ${sec} s…`);
  return new Promise(res => setTimeout(() => {
    PERF.recs.splice(PERF.recs.indexOf(r), 1);
    const avg = a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null;
    const p95 = a => a.length ? +[...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)].toFixed(2) : null;
    const b = BATCH.stats();
    const out = {
      backend: GPU.webgpu ? 'WebGPU' : 'WebGL 2', fellBack: gpuFellBack(), clustered: GPU.clustered, volumetric: VOLUME.active, bloom: CFG.bloom,
      shadows: CFG.shadows, fpsLimit, size: `${renderer.domElement.width}x${renderer.domElement.height}`, night: +ENV.night.toFixed(2),
      combat: AUD.armed, weather: WEATHER.kind, aircraft: AIRCRAFT.length, enemies: ENEMIES.length, frames: r.cpu.length,
      // simulated seconds per real second: 1 at any frame rate (below 1 only when frames take over 0.25 s, or paused)
      simRate: +((T - r.T0) / Math.max(1e-3, (performance.now() - r.t0) / 1000)).toFixed(3), fps: r.frame.length ? +(1000 / avg(r.frame)).toFixed(1) : 0,
      frameMs: avg(r.frame), frameMsP95: p95(r.frame), frameMsMax: r.frame.length ? +Math.max(...r.frame).toFixed(1) : null,
      hitches: r.frame.filter(t => t > Math.max(33.4, 1.5 * PERF.gap())).length,   // frames longer than two vsyncs (1.5 intervals of a lower FPS limit): visible stutter
      pauses: r.pauses,   // WE paused the wallpaper (another window in front…): those gaps aren't frames
      cpuMs: avg(r.cpu), cpuMsP95: p95(r.cpu), cpuMsMax: r.cpu.length ? +Math.max(...r.cpu).toFixed(1) : null,
      simMs: avg(r.sim), simMsP95: p95(r.sim), renderMs: avg(r.draw), renderMsP95: p95(r.draw),   // (cpuMs = the simulation steps + renderFrame's CPU side)
      gpuMs: GPU.timing ? avg(r.gpu) : 'perfFlags({ gputime: true }) + reload', gpuComputeMs: GPU.timing ? avg(r.comp) : null,
      drawCalls: avg(r.calls), lights: avg(r.lights), lightsMax: r.lights.length ? Math.max(...r.lights) : 0,
      batches: b.batches, batchInstances: b.instances,
      programs: renderer.info.memory.programs, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
      made: r.made,   // made while measuring (after the warm-up all should stay 0: each one is a likely stall)
      hitchLog: r.hitches.sort((a, b) => b.ms - a.ms).slice(0, 10)   // the worst hitches and what was made around them
    };
    console.log('perfReport ' + JSON.stringify(out)); res(out);
  }, sec * 1000));
}
/* The sun's shadow camera covers just the visible ground: the light-space bounds of the screen corners at ground level.
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
  const m = 6;   // buildings and trees just off the screen edge
  if (Math.abs(sc.left - (x0 - m)) + Math.abs(sc.right - (x1 + m)) + Math.abs(sc.bottom - (y0 - m)) + Math.abs(sc.top - (y1 + m)) < 0.5) return;
  sc.left = x0 - m; sc.right = x1 + m; sc.bottom = y0 - m; sc.top = y1 + m; sc.updateProjectionMatrix();
}
const TIME_SCALE = Math.max(1, Math.round(parseFloat(QS.get('ts') || '1')));
/* start-up splash: covers the first seconds, when settings / WE properties may rebuild and restore the air wing */
let splash = document.getElementById('splash');
function step(dt) {
  T += dt;
  if (splash && T > 3.2 && SHADERS_READY) { const s = splash; splash = null; s.classList.add('off'); setTimeout(() => s.remove(), 700); }
  updateArming();
  updateSite(dt);
  updateMounts(dt);
  for (const a of AIRCRAFT) a.update(dt);
  AIRFIELD.update(dt);
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
  FX.scorch.update(dt);
  FX.lights.update(dt, 0.6 + ENV.night * 0.8);
  FX.fire.update(dt); FX.fireLights.update(dt, 0.6 + ENV.night * 0.8);
  WEATHER.update(dt);
  TERRAIN.update(dt);
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
