// Rendering invariants (WebGL through SwiftShader): GL health, draw-call budget, what is on screen, day / night,
// shadows and their coverage, GPU memory that plateaus. No golden screenshots: checks are relative / structural.
const { test, expect } = require('./support/harness');

test.use({ viewport: { width: 640, height: 360 } });

const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

test('a day frame renders without GL errors, within the draw-call budget, with the base on screen', async ({ wp }) => {
  await wp.boot({ query: '?season=spring' });
  await wp.sim(5);
  const r = await wp.run(() => {
    __t.render();
    const gl = renderer.getContext(), err = gl.getError();
    return {
      err, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, programs: renderer.info.programs.length,
      center: __t.sample(300, 160, 40, 40), ground: __t.sample(600, 330, 30, 25), lost: gl.isContextLost(), lightsOn: ENV.lightsOn,
      spots: SEARCHLIGHTS.filter(s => s.light && s.light.visible).length
    };
  });
  expect(r.lost).toBe(false);
  expect(r.err, 'gl.getError()').toBe(0);
  expect(r.calls, 'draw calls').toBeLessThan(800);
  expect(r.calls).toBeGreaterThan(50);
  expect(r.tris).toBeGreaterThan(10000);
  expect(r.programs).toBeLessThan(70);
  // spring ground is green-ish in the corner; the middle (runway, apron) is not ground-coloured
  expect(r.ground[1], `green ground ${r.ground}`).toBeGreaterThan(r.ground[2]);
  const d = Math.max(...r.center.map((v, i) => Math.abs(v - r.ground[i])));
  expect(d, `the airfield in the middle ${r.center} vs ground ${r.ground}`).toBeGreaterThan(15);
  expect(r.lightsOn).toBe(0);
  expect(r.spots, 'searchlights hidden by day').toBe(0);
});

test('the seasons change the ground: snow is bright, the desert sandy, spring green', async ({ wp }) => {
  const col = {};
  for (const s of ['winter', 'summer', 'spring', 'autumn']) {
    await wp.boot({ query: `?season=${s}` });
    await wp.sim(1);
    col[s] = await wp.run(() => ({ c: __t.sample(600, 330, 30, 25), season: TERRAIN.season, veg: TERRAIN.veg.reduce((n, v) => n + v.count, 0) }));
    expect(col[s].season).toBe(s);
    expect(col[s].veg, `${s} vegetation`).toBeGreaterThan(300);
  }
  expect(lum(col.winter.c)).toBeGreaterThan(lum(col.spring.c) + 30);
  expect(col.summer.c[0], 'desert: more red than blue').toBeGreaterThan(col.summer.c[2] + 20);
  expect(col.spring.c[1]).toBeGreaterThan(col.spring.c[0]);
});

test('a season change at runtime rebuilds the vegetation without leaking', async ({ wp }) => {
  await wp.boot({ query: '?season=spring' });
  await wp.sim(1);
  const a = await wp.run(() => __t.geometries());
  for (const s of ['winter', 'summer', 'autumn', 'spring']) await wp.run((s) => { CFG.season = s; updateEnvironment(); }, s);
  await wp.sim(1);
  const b = await wp.run(() => __t.geometries());
  expect(b.leaked, b.leakedTypes.join()).toBe(0);
  expect(b.reach).toBeLessThan(a.reach + 5);
});

test('night is darker than day, with nav lights and searchlights on', async ({ wp }) => {
  await wp.boot();
  await wp.sim(3);
  const day = await wp.run(() => __t.sample(0, 0, 640, 360));
  await wp.boot({ query: '?hour=0' });
  await wp.sim(3);
  const night = await wp.run(() => ({ c: __t.sample(0, 0, 640, 360), on: ENV.lightsOn, nav: NAV_MATS.some(m => m.opacity > 0.5), spots: SEARCHLIGHTS.filter(s => s.light && s.light.visible).length }));
  expect(lum(night.c)).toBeLessThan(lum(day) * 0.6);
  expect(night.on).toBeGreaterThan(0.9);
  expect(night.nav).toBe(true);
  expect(night.spots).toBeGreaterThan(0);
});

test('bloom: the night lights glow; toggling it renders without GL errors, counts the whole frame and leaks nothing', async ({ wp }) => {
  await wp.boot({ query: '?hour=0' });
  await wp.sim(3);
  const r = await wp.run(() => {
    const gl = renderer.getContext(), out = {};
    for (const b of [true, false, true]) {
      __t.props({ bloom: b });
      out[b] = { c: __t.sample(0, 0, 640, 360), lit: __t.bright(0, 0, 1280, 720, 110), calls: renderer.info.render.calls, err: gl.getError(), tex: renderer.info.memory.textures, hdr: FX.flash.mesh.material.uniforms.uK.value };
    }
    return out;
  });
  expect(r.true.err).toBe(0); expect(r.false.err).toBe(0);
  // the glow adds light around the lamps; the passes add only a few draw calls to the scene's (counted per frame)
  expect(r.true.lit, `bright pixels with bloom ${r.true.lit} vs without ${r.false.lit}`).toBeGreaterThan(r.false.lit * 1.15);
  expect(r.true.calls).toBeGreaterThan(r.false.calls);
  expect(r.true.calls).toBeLessThan(r.false.calls + 20);
  expect(r.false.hdr, 'no HDR emitters without bloom').toBe(1);
  expect(r.true.tex, 'the bloom targets are kept, not rebuilt').toBe(await wp.run(() => { __t.props({ bloom: false }); __t.props({ bloom: true }); __t.render(); return renderer.info.memory.textures; }));
});

test('the shaders are compiled under the splash: the first frame and a fight add no programs', async ({ wp }) => {
  await wp.boot({ warm: true });
  const p0 = await wp.run(() => renderer.info.programs.length);
  await wp.run(() => __t.render());
  expect(await wp.run(() => renderer.info.programs.length), 'the first frame').toBe(p0);
  // a fight: waves, armour, helicopters, missiles, tracers, flashes, smoke, craters, fires (as at night, the lamps on)
  await wp.run(() => { __t.forceFight(); STRESS.level = 0.8; });
  for (let i = 0; i < 12; i++) { await wp.sim(5, { audio: true }); await wp.run(() => __t.render()); }
  const r = await wp.run(() => ({ p: renderer.info.programs.length, kinds: [...new Set(ENEMIES.map(e => e.kind))] }));
  expect(r.kinds.length, 'the fight is on').toBeGreaterThan(0);
  expect(r.p, `programs after a fight (${r.kinds})`).toBeLessThanOrEqual(p0 + 2);
});

test('batching: the merged meshes draw through a few BatchedMeshes that follow them; a rebuild frees what it drops', async ({ wp }) => {
  await wp.boot();
  await wp.sim(20);
  const r = await wp.run(() => {
    __t.props({ bloom: false, shadows: false }); __t.render();
    const main = renderer.info.render.calls, s0 = BATCH.stats();
    // an aircraft's merged meshes: their instances carry its world matrices; hidden with it
    const a = AIRCRAFT.find(x => x.mesh.visible), ms = []; a.mesh.traverse(o => { if (o.userData.batched) ms.push(o); });
    const m4 = new THREE.Matrix4(), rec = BATCH.recs.get(ms[0]);
    rec.G.bm.getMatrixAt(rec.inst, m4);
    const same = m4.elements.every((v, i) => Math.abs(v - ms[0].matrixWorld.elements[i]) < 1e-5);
    a.mesh.visible = false; __t.render(); const hidden = !rec.G.bm.getVisibleAt(rec.inst); a.mesh.visible = true; __t.render();
    const onLayer = ms.every(o => !o.layers.test(camera.layers));
    buildAirWing(); for (let i = 0; i < 6; i++) { step(0.5); __t.render(); }
    // (the count varies: aircraft behind a shut door were never drawn, so never batched) — what the batches hold is alive
    const out = BATCH.live.filter(r => { let p = r.m; while (p.parent) p = p.parent; return p !== scene; }).length;
    const disposed = [...BATCH.groups.values()].reduce((n, G) => n + [...G.geos.keys()].filter(g => g.__disposed).length, 0);
    return { main, s0, s1: BATCH.stats(), n: ms.length, same, hidden, onLayer, out, disposed, empty: [...BATCH.groups.values()].filter(G => !G.geos.size).length };
  });
  expect(r.n).toBeGreaterThan(0);
  expect(r.onLayer, 'not drawn on their own').toBe(true);
  expect(r.same, 'instance matrix = the mesh\'s world matrix').toBe(true);
  expect(r.hidden, 'hidden with its aircraft').toBe(true);
  expect(r.main, 'main-pass draw calls').toBeLessThan(220);
  expect(r.s1.batches).toBeLessThanOrEqual(r.s0.batches);
  expect(r.s1.instances, 'one instance per live record').toBe(r.s1.live);
  expect(r.out, 'instances of meshes gone from the scene').toBe(0);
  expect(r.disposed, 'geometries of the disposed aircraft still in a batch').toBe(0);
  expect(r.empty).toBe(0);
  const g = await wp.run(() => __t.geometries());
  expect(g.leaked, g.leakedTypes.join()).toBe(0);
});

test('shadows darken the ground, and the shadow camera covers the whole screen', async ({ wp }) => {
  await wp.boot();
  await wp.sim(3);
  const r = await wp.run(() => {
    const on = __t.sample(160, 90, 320, 180);
    // the visible ground's corners lie inside the fitted shadow camera (light space)
    const sc = sunLight.shadow.camera, inside = [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([x, y]) => {
      const p = AIRWAR.groundAt(x, y, 0).applyMatrix4(sc.matrixWorldInverse);
      return p.x >= sc.left && p.x <= sc.right && p.y >= sc.bottom && p.y <= sc.top;
    });
    __t.props({ shadows: false }); renderer.shadowMap.needsUpdate = true;
    const off = __t.sample(160, 90, 320, 180);
    return { on, off, inside };
  });
  expect(r.inside).toBe(true);
  expect(lum(r.on), `with shadows ${r.on} vs without ${r.off}`).toBeLessThan(lum(r.off) - 0.3);
});

test('zoom and camera rotation keep the shadow camera fitted', async ({ wp }) => {
  await wp.boot({ query: '?zoom=50' });
  await wp.run(() => { CFG.camRotate = true; CFG.camSpeed = 15; });
  for (let i = 0; i < 6; i++) {
    await wp.sim(4);
    const inside = await wp.run(() => {
      __t.render();
      const sc = sunLight.shadow.camera;
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([x, y]) => {
        const p = AIRWAR.groundAt(x, y, 0).applyMatrix4(sc.matrixWorldInverse);
        return p.x >= sc.left - 1e-3 && p.x <= sc.right + 1e-3 && p.y >= sc.bottom - 1e-3 && p.y <= sc.top + 1e-3;
      });
    });
    expect(inside).toBe(true);
  }
});

test('GPU memory plateaus over a long fight with fly-bys, missiles and smoke', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.flyby = 10; __t.forceFight(); STRESS.level = 0.8; });
  const mem = [];
  for (let i = 0; i < 20; i++) {
    const r = await wp.sim(30);
    expect(r.violations).toEqual([]);
    mem.push(await wp.run(() => Object.assign(__t.geometries(), { t: renderer.info.memory.textures, p: renderer.info.programs.length, calls: renderer.info.render.calls, err: renderer.getContext().getError() })));
  }
  for (const m of mem) {
    expect(m.err).toBe(0); expect(m.calls).toBeLessThan(1000);
    expect(m.leaked, `geometries dropped without dispose: ${m.leakedTypes}`).toBe(0);
  }
  const early = mem[6], late = mem[mem.length - 1];
  expect(late.t, 'textures').toBeLessThanOrEqual(early.t + 2);
  expect(late.p, 'shader programs').toBeLessThanOrEqual(early.p + 2);
  expect(late.reach, `reachable geometries ${mem.map(m => m.reach).join(' ')}`).toBeLessThan(early.reach * 1.1 + 20);
});
