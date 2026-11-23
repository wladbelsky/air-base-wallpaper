// Weather (js/weather.js): the default looks as it always did; rain, fog and storms render, settle and stay bounded;
// the auto cycle changes and is remembered; lightning adds no lights; winter rain falls as snow
const { test, expect } = require('./support/harness');

const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const sat = c => Math.max(...c) - Math.min(...c);
const lights = () => { let n = 0; scene.traverse(o => { if (o.isLight) n++; }); return n; };

test('default: nothing of the weather is drawn, the same frame as clear', async ({ wp }) => {
  await wp.boot();
  await wp.sim(20);
  const r = await wp.run(() => {
    const d = { mode: CFG.weatherMode, kind: WEATHER.kind, vis: [WEATHER.drops.visible, WEATHER.splash.visible, WEATHER.bolt.visible, FX.mist.mesh.visible], calls: (__t.render(), renderer.info.render.drawCalls), fog: [scene.fog.near, scene.fog.far] };
    __t.props({ weathermode: 'clear' });
    return Object.assign(d, { calls2: (__t.render(), renderer.info.render.drawCalls) });
  });
  expect(r.mode).toBe('default');
  expect(r.kind).toBe('clear');
  expect(r.vis).toEqual([false, false, false, false]);
  expect(r.calls2).toBe(r.calls);
});

for (const kind of ['rain', 'fog', 'storm']) test(`${kind}: settles, renders without GL errors, pools bounded, no new lights`, async ({ wp }) => {
  await wp.boot({ query: '?season=autumn' });
  const n0 = await wp.run(`(${lights})()`);
  await wp.run((k) => __t.props({ weathermode: k }), kind);
  let maxDrops = 0;
  for (let i = 0; i < 8; i++) {
    const r = await wp.sim(30);
    expect(r.violations).toEqual([]);
    maxDrops = Math.max(maxDrops, await wp.run(() => WEATHER.drops.count));
  }
  const r = await wp.run(() => { __t.render(); return { err: renderer.getContext().getError(), w: [WEATHER.oc, WEATHER.rain, WEATHER.fog, WEATHER.wind, WEATHER.wet], mist: FX.mist.live.length, strikes: WEATHER.strikes }; });
  expect(r.err).toBe(0);
  const tg = await wp.run((k) => WX_TARGET[k], kind);
  expect(r.w[0]).toBeCloseTo(tg.oc, 1); expect(r.w[1]).toBeCloseTo(tg.rain, 1); expect(r.w[2]).toBeCloseTo(tg.fog, 1);
  expect(maxDrops).toBeLessThanOrEqual(1800);
  if (tg.rain) { expect(maxDrops, 'rain falling').toBeGreaterThan(200); expect(r.w[4], 'wet').toBeGreaterThan(0.5); }
  if (tg.fog > 0.5) expect(r.mist, 'fog banks').toBeGreaterThan(5);
  if (kind === 'storm') expect(r.strikes, 'lightning').toBeGreaterThan(2);
  expect(await wp.run(`(${lights})()`), 'no lights added').toBe(n0);
  const g = await wp.run(() => __t.geometries());
  expect(g.leaked, g.leakedTypes.join()).toBe(0);
});

test('fog greys the day and closes in; the runway lights come on', async ({ wp }) => {
  await wp.boot({ query: '?hour=12&season=spring' });
  await wp.sim(5);
  const clear = await wp.run(() => ({ c: __t.sample(0, 0, 640, 360), far: scene.fog.far, lamps: ENV.lamps }));
  await wp.run(() => __t.props({ weathermode: 'fog' }));
  await wp.sim(240);
  const fog = await wp.run(() => ({ c: __t.sample(0, 0, 640, 360), far: scene.fog.far, lamps: ENV.lamps, real: SEARCHLIGHTS.filter(s => s.light && s.light.visible).length }));
  expect(sat(fog.c), `colour ${fog.c} vs clear ${clear.c}`).toBeLessThan(sat(clear.c) * 0.8);
  expect(fog.far).toBeLessThan(clear.far - 100);
  expect(clear.lamps).toBe(0);
  expect(fog.lamps, 'lamps on in the fog').toBeGreaterThan(0.5);
  expect(fog.real, 'the real spot lights stay off by day (a light shown recompiles every program)').toBe(0);
  // a mist bank faces the camera: none reaches into the ground (its lower half was cut off along a straight line)
  const low = await wp.run(() => FX.mist.items.filter(it => it.on && it.p.y < it.s1 * 0.5 * Math.cos(CFG.camElev * DEG)).length);
  expect(low, 'mist banks cut by the ground').toBe(0);
});

test('a storm at night: lightning flashes the sky light and draws a bolt', async ({ wp }) => {
  await wp.boot({ query: '?hour=23&season=summer&weather=storm' });
  await wp.sim(200);
  const r = await wp.until(() => WEATHER.bolt.visible, 60);
  expect(r.done, 'a strike').toBe(true);
  const s = await wp.run(() => ({ bolt: WEATHER.bolt.count, flash: WEATHER.flash, hemi: hemi.intensity / ENV.hemiI }));
  expect(s.bolt).toBeGreaterThan(4);
  expect(s.hemi).toBeGreaterThan(1.5);
  await wp.sim(1);
  expect(await wp.run(() => [WEATHER.bolt.visible, hemi.intensity / ENV.hemiI < 1.05])).toEqual([false, true]);
});

test('winter: the rain falls as snow, no lightning', async ({ wp }) => {
  await wp.boot({ query: '?season=winter&weather=storm' });
  await wp.sim(200);
  const r = await wp.run(() => ({ drops: WEATHER.drops.count, strikes: WEATHER.strikes, snow: TERRAIN.weather.pts.visible, wet: WEATHER.wet }));
  expect(r.drops).toBe(0);
  expect(r.strikes).toBe(0);
  expect(r.snow).toBe(true);
  expect(r.wet).toBe(0);
});

test('auto: a new kind every 15-40 min, remembered over a reload', async ({ wp }) => {
  await wp.boot({ query: '?weather=auto' });
  await wp.run(() => { WEATHER.timer = 0; });
  const seen = new Set();
  for (let i = 0; i < 12; i++) { await wp.sim(1); seen.add(await wp.run(() => WEATHER.kind)); await wp.run(() => { WEATHER.timer = 0; }); }
  expect(seen.size, [...seen].join()).toBeGreaterThan(1);
  await wp.sim(1);
  const t = await wp.run(() => WEATHER.timer);
  expect(t).toBeGreaterThanOrEqual(900 - 1); expect(t).toBeLessThanOrEqual(2400);
  const kind = await wp.run(() => { PERSIST.save(); return WEATHER.kind; });
  await wp.reload();
  await wp.sim(5);
  expect(await wp.run(() => WEATHER.kind)).toBe(kind);
});
