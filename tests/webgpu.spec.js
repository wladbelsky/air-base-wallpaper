// Real WebGPU (the `webgpu` project: a headed Chromium with SwiftShader through Vulkan, under xvfb-run). The rest of the
// suite runs WebGPURenderer's WebGL 2 backend: a WebGPU-only failure (once: nothing drawn in Wallpaper Engine, a stream of
// GPUValidationErrors) would never show there. The harness fails a test on any console error — three.js logs every
// uncaptured WebGPU error as one.
const { test, expect } = require('./support/harness');

/* the frame just rendered, read back through a 2D canvas: mean colour and saturation of a rectangle (CSS pixels) */
const look = (wp, [x, y, w, h]) => wp.run(([x, y, w, h]) => {
  __t.render();
  const c = renderer.domElement, sx = c.width / innerWidth, sy = c.height / innerHeight;
  const cv = window.__rb || (window.__rb = document.createElement('canvas')); cv.width = Math.round(w * sx); cv.height = Math.round(h * sy);
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(c, x * sx, y * sy, w * sx, h * sy, 0, 0, cv.width, cv.height);
  const d = g.getImageData(0, 0, cv.width, cv.height).data, s = [0, 0, 0]; let sat = 0;
  for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); }
  const n = d.length / 4; return { c: s.map(v => v / n), sat: sat / n };
}, [x, y, w, h]);

test('a summer day on WebGPU: the warm-up, the passes and the volume draw without a GPU error; the frame is the scene, not washed out', async ({ wp }) => {
  await wp.boot({ gl: 'webgpu', warm: true, query: '?hour=12&season=summer' });
  expect(await wp.run(() => GPU.webgpu), 'a WebGPU device (the webgpu project runs a headed browser: xvfb-run)').toBe(true);
  for (let i = 0; i < 4; i++) { await wp.sim(5); await wp.run(() => __t.render()); }
  const r = await look(wp, [40, 360, 600, 300]);
  expect(await wp.run(() => [VOLUME.active, renderer.info.render.drawCalls > 50])).toEqual([true, true]);
  // the desert in the sun: warm and saturated (a volume pass cleared to the sky colour once paled the whole frame)
  expect(r.sat, `saturation of ${r.c}`).toBeGreaterThan(30);
  expect(r.c[0], `red over blue: ${r.c}`).toBeGreaterThan(r.c[2] + 15);
});

test('a night storm in a fight on WebGPU: rain, lightning, fog, bloom, the volume, enemies — no GPU error', async ({ wp }) => {
  await wp.boot({ gl: 'webgpu', warm: true, query: '?hour=23&season=summer&weather=storm' });
  await wp.run(() => { __t.render(); __t.forceFight(); STRESS.level = 0.8; });
  for (let i = 0; i < 12; i++) { const r = await wp.sim(5, { audio: true }); expect(r.violations).toEqual([]); await wp.run(() => __t.render()); }
  const s = await wp.run(() => ({ kinds: [...new Set(ENEMIES.map(e => e.kind))], vol: VOLUME.density.value, drops: WEATHER.drops.count }));
  expect(s.kinds.length).toBeGreaterThan(0);
  expect(s.vol).toBeGreaterThan(0);
  expect(s.drops).toBeGreaterThan(100);
  const r = await look(wp, [0, 0, 640, 360]);
  expect(r.c.reduce((a, b) => a + b) / 3, `a night frame ${r.c}`).toBeLessThan(120);
});

test('a WebGPU device that keeps failing falls back to WebGL 2 for this release (and is tried again on the next)', async ({ wp, page, errors }) => {
  await wp.boot({ gl: 'webgpu' });
  expect(await wp.run(() => GPU.webgpu)).toBe(true);
  const nav = page.waitForNavigation();
  await wp.run(() => { const dev = renderer.backend.device; for (let i = 0; i < 25; i++) dev.dispatchEvent(new GPUUncapturedErrorEvent('uncapturederror', { error: new GPUValidationError('test') })); });
  await nav;
  await page.waitForFunction(() => typeof ready !== 'undefined' && ready, null, { timeout: 30000 });
  const r = await wp.run(() => ({ webgpu: GPU.webgpu, saved: JSON.parse(localStorage.getItem(GL_KEY)), ver: GL_VER }));
  expect(r.webgpu, 'reloaded on WebGL 2').toBe(false);
  expect(r.saved).toEqual({ v: r.ver, gl: 'webgl2' });
  // another release (cache-buster) tries WebGPU again
  expect(await wp.run(() => { localStorage.setItem(GL_KEY, JSON.stringify({ v: 'old', gl: 'webgl2' })); return gpuFellBack(); })).toBe(false);
  errors.length = 0;   // (the simulated errors were logged)
});

test('perfReport on WebGPU with GPU timing (?gputime=1: timestamp queries) — no GPU error', async ({ wp }) => {
  await wp.boot({ gl: 'webgpu', query: '?hour=12&gputime=1' });
  // (SwiftShader takes seconds a frame: the frames run back to back, the report's timer fires after them; its timestamp
  // queries are resolved twice a second of frame time)
  const r = await wp.run(() => {
    const f = ms => { renderer._nodes.nodeFrame.update(); frame(ms); };
    const p = perfReport(0.05); for (let i = 1; i <= 6; i++) f(i * 600);
    return p;
  });
  expect(r.backend).toBe('WebGPU');
  expect(r.frames).toBe(6);
  expect(r.drawCalls).toBeGreaterThan(50);
  expect(typeof r.gpuMs, 'GPU timing on').toBe('number');
});

test('the volume\'s beams are smooth by the lamps (no grid of low-res blocks) in the rain on WebGPU', async ({ wp }) => {
  await wp.boot({ gl: 'webgpu', query: '?hour=23&season=summer&weather=rain' });
  await wp.run(() => __t.render());
  await wp.sim(200);
  // the volume's own share of the frame (drawn with and without it) at a floodlight mast at the default zoom, against
  // the same march in 200 steps: the difference is the march's noise, the grid by the lamps (r187's march from the
  // camera's position: 22 %; marched through the whole box: 4.4 %; under the lights' ceiling: ~0.8 %)
  const r = await wp.run(() => {
    CFG.zoom = 90; const m = BASE_LAYOUT.masts[0]; CAM_TGT.set(m[0], 0, m[1]); updateCamera();
    const c = renderer.domElement, W = c.width, H = c.height, mat = VOLUME.mesh.material, st = mat.steps;
    const grab = () => { __t.render(); const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'); g.drawImage(c, 0, 0); return g.getImageData(0, 0, W, H).data; };
    const vol = () => { const a = grab(); VOLUME.mesh.visible = false; VOLUME.blank = false; const b = grab(); VOLUME.mesh.visible = true; const D = new Float32Array(W * H); for (let i = 0; i < W * H; i++) D[i] = a[i * 4] + a[i * 4 + 1] + a[i * 4 + 2] - b[i * 4] - b[i * 4 + 1] - b[i * 4 + 2]; return D; };
    const D = vol(); mat.steps = 200; const R = vol(); mat.steps = st;
    let e = 0, s = 0, n = 0; for (let i = 0; i < W * H; i++) if (R[i] > 30) { e += Math.abs(D[i] - R[i]); s += R[i]; n++; }
    return { noise: e / s, n, top: VOLUME.top.value };
  });
  expect(r.n, 'the beam is there').toBeGreaterThan(2000);
  expect(r.top, 'the march stops under the lights\' ceiling').toBeLessThan(20);
  expect(r.noise, 'the march\'s noise in the volume\'s light').toBeLessThan(0.02);
});

test('a foggy day: the volume adds no veil over the frame (it once took the scene\'s fog: the fog colour over everything)', async ({ wp }) => {
  await wp.boot({ gl: 'webgpu', query: '?hour=12&season=summer&weather=fog' });
  await wp.run(() => __t.render());
  await wp.sim(150);
  const r = await wp.run(() => {
    const mean = () => { __t.render(); const c = renderer.domElement, cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height; const g = cv.getContext('2d'); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, cv.width, cv.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; };
    const vis = VOLUME.mesh.visible, on = mean(); VOLUME.mesh.visible = false; VOLUME.blank = false; const off = mean(); VOLUME.mesh.visible = vis;
    return { vis, d: on - off };
  });
  expect(r.vis, 'the volume is on (the lamps in fog)').toBe(true);
  expect(r.d, 'what the volume adds to the mean level (0–255; with the fog: +25)').toBeLessThan(2);
});

test('a real light keeps its meshed beam in a clear night (the thin haze barely shows it), hands it to the volume in fog', async ({ wp }) => {
  await wp.boot({ gl: 'webgpu', query: '?hour=23&season=summer' });
  await wp.run(() => { __t.render(); AIRCRAFT.filter(a => a.lit).forEach(a => a.requestLaunch()); });
  await wp.sim(40);
  // a helicopter's light on screen, else a floodlight mast's (every one is real)
  const beam = () => wp.run(() => { updateLights(); const h = AIRCRAFT.find(a => a.lit && a.searchlights[0].enabled > 0.9 && a.searchlights[0].light), s = h ? h.searchlights[0] : BASE.floods[0];
    return { heli: !!h, live: VOLUME.live(), cone: s.cone.visible, op: s.cone.material.uOpacity.value / s.o.coneOpacity }; });
  const clear = await beam();
  expect(clear.live).toBe(true);
  expect(clear.heli, 'a lit helicopter up').toBe(true);
  expect(clear.cone, 'a helicopter\'s beam in a clear night (only a light pool, cut off, without it)').toBe(true);
  expect(clear.op, 'its cone at most of its opacity').toBeGreaterThan(0.6);
  await wp.run(() => { __t.props({ weathermode: 'fog' }); });
  await wp.sim(200);
  await wp.run(() => { AIRCRAFT.filter(a => a.lit).forEach(a => a.canLaunch() && a.requestLaunch()); });
  await wp.sim(40);
  const fog = await beam();
  expect(fog.cone, 'in fog the volume draws it').toBe(false);
});

test('night: a lit helicopter hidden and shown again (a combat pass, a mission) compiles nothing — its light is pooled in the scene', async ({ wp }) => {
  await wp.boot({ gl: 'webgpu', query: '?hour=23&season=summer' });
  await wp.run(() => { __t.render(); AIRCRAFT.filter(a => a.lit).forEach(a => a.requestLaunch()); });
  await wp.sim(40);
  const r = await wp.run(() => {
    __t.render(); __t.render();
    const a = AIRCRAFT.find(a => a.lit && a.state === 'orbit' && a.searchlights[0].light), s = a.searchlights[0], p0 = renderer.info.memory.programs, l = s.light;
    const lit0 = l.intensity, inScene = l.parent === scene;
    a.mesh.visible = false; updateLights(); __t.render(); const dark = l.intensity;   // (back in the pool, or another one's)
    if (l.intensity > 0 && HELI_LIGHTS.sls.some(o => o.light === l)) return { inScene, lit0, dark: 0, d: 0, pos: 0, moved: true };
    a.mesh.visible = true; updateLights(); __t.render(); __t.render();
    return { inScene, lit0, dark, d: renderer.info.memory.programs - p0, pos: s.light.position.distanceTo(s.holder.getWorldPosition(new THREE.Vector3())) };
  });
  expect(r.inScene, 'the light lives in the scene, not in the helicopter').toBe(true);
  expect(r.lit0).toBeGreaterThan(0);
  expect(r.dark, 'dark while its helicopter is hidden').toBe(0);
  expect(r.d, 'no new programs').toBe(0);
  expect(r.pos, 'it follows the searchlight').toBeLessThan(0.01);
});

test('WebGPU: after the warm-up a scramble, a fly-by and a fight build no new programs and grow no batch (once: a stall mid-fight)', async ({ wp }) => {
  await wp.boot({ gl: 'webgpu', warm: true, query: '?hour=12&season=summer' });
  const p0 = await wp.run(() => (__t.render(), GPU.pipes || renderer.info.memory.programs)), ev0 = await wp.run(() => ({ ...(BATCH.ev || {}) }));
  await wp.run(() => { AIRCRAFT.forEach(a => a.canLaunch() && a.requestLaunch()); FLYBYS.push(new Flyby()); });
  for (let i = 0; i < 6; i++) { await wp.sim(5); await wp.run(() => __t.render()); }
  await wp.run(() => { __t.forceFight(); STRESS.level = 0.8; });
  for (let i = 0; i < 10; i++) { await wp.sim(5, { audio: true }); await wp.run(() => __t.render()); }
  const r = await wp.run(() => ({ p: GPU.pipes || renderer.info.memory.programs, kinds: [...new Set(ENEMIES.map(e => e.kind))], ev: { ...(BATCH.ev || {}) } }));
  expect(r.kinds.length, 'the fight is on').toBeGreaterThan(0);
  expect(r.p, `render pipelines after a scramble and a fight (${r.kinds})`).toBe(p0);
  expect(r.ev).toEqual(ev0);
});


// a batch resized once drawn must rebind (BATCH: bm.material.needsUpdate): its render object kept the textures it was
// built with — the warm-up's last resize once froze every batch's matrices at the warm-up frames: in WE the models
// stood where the templates had been (a cluster of vehicles mid-screen) while their sprite lights moved on
test('WebGPU: after the warm-up and a scramble every batch draws from its current matrices texture (no frozen models)', async ({ wp }) => {
  await wp.boot({ gl: 'webgpu', warm: true, query: '?hour=12&season=summer' });
  await wp.run(() => { __t.render(); AIRCRAFT.forEach(a => a.canLaunch() && a.requestLaunch()); });
  for (let i = 0; i < 4; i++) { await wp.sim(5); await wp.run(() => __t.render()); }
  const r = await wp.run(() => {
    // force one batch to grow once drawn too (the fallback): it must rebind as well
    const G = [...BATCH.groups.values()][0], gid = G.geos.values().next().value.id;
    while (G.bm._instanceInfo.filter(i => i.active).length < G.bm.maxInstanceCount) { const i = G.bm.addInstance(gid); G.bm.setVisibleAt(i, false); }
    const m = [...BATCH.live].find(r => r.G === G).m, twin = m.clone(); scene.add(twin); __t.render(); scene.remove(twin); __t.render();
    return [...BATCH.groups.values()].filter(G => !(renderer.backend.get(G.bm._matricesTexture) || {}).texture).length;
  });
  expect(r, 'batches drawing from a stale (replaced) matrices texture').toBe(0);
});
