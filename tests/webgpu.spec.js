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

test('a real light keeps its meshed beam in a clear night (the thin haze barely shows it), hands it to the volume in fog', async ({ wp }) => {
  await wp.boot({ gl: 'webgpu', query: '?hour=23&season=summer' });
  await wp.run(() => { __t.render(); AIRCRAFT.filter(a => a.lit).forEach(a => a.requestLaunch()); });
  await wp.sim(40);
  const beam = () => wp.run(() => { updateLights(); const s = AIRCRAFT.find(a => a.lit && a.state === 'orbit').searchlights[0]; return { live: VOLUME.live(), cone: s.cone.visible, op: s.cone.material.uOpacity.value }; });
  const clear = await beam();
  expect(clear.live).toBe(true);
  expect(clear.cone, 'a helicopter\'s beam in a clear night (only a light pool, cut off, without it)').toBe(true);
  expect(clear.op).toBeGreaterThan(0.2);
  await wp.run(() => { __t.props({ weathermode: 'fog' }); });
  await wp.sim(240);
  const fog = await beam();
  expect(fog.cone, 'in fog the volume draws it').toBe(false);
});
