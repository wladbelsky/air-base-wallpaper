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
      err, calls: renderer.info.render.drawCalls, tris: renderer.info.render.triangles, programs: renderer.info.memory.programs,
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
      out[b] = { c: __t.sample(0, 0, 640, 360), lit: __t.bright(0, 0, 1280, 720, 50), calls: renderer.info.render.drawCalls, err: gl.getError(), tex: renderer.info.memory.textures, hdr: FX.flash.uK.value };
    }
    return out;
  });
  expect(r.true.err).toBe(0); expect(r.false.err).toBe(0);
  // the glow adds light around the lamps; the passes add only a few draw calls to the scene's (counted per frame)
  expect(r.true.lit, `bright pixels with bloom ${r.true.lit} vs without ${r.false.lit}`).toBeGreaterThan(r.false.lit * 1.03);   // (~+5 % since the night strength was halved)
  expect(r.true.calls).toBeGreaterThan(r.false.calls);
  expect(r.true.calls).toBeLessThan(r.false.calls + 20);
  expect(r.false.hdr, 'no HDR emitters without bloom').toBe(1);
  expect(r.true.tex, 'the bloom targets are kept, not rebuilt').toBe(await wp.run(() => { __t.props({ bloom: false }); __t.props({ bloom: true }); __t.render(); return renderer.info.memory.textures; }));
});

test('the shaders are compiled under the splash: the first frame, a scramble, a fly-by and a fight add no programs and grow no batch', async ({ wp }) => {
  await wp.boot({ warm: true });
  const p0 = await wp.run(() => renderer.info.memory.programs), ev0 = await wp.run(() => ({ ...BATCH.ev }));
  await wp.run(() => __t.render());
  expect(await wp.run(() => renderer.info.memory.programs), 'the first frame').toBe(p0);
  // everyone out of the shelters / hangars (geometry never drawn before), a fly-by, then a fight: waves, armour,
  // helicopters, missiles, tracers, flashes, smoke, craters, fires, wrecks
  await wp.run(() => { AIRCRAFT.forEach(a => a.canLaunch() && a.requestLaunch()); FLYBYS.push(new Flyby()); });
  for (let i = 0; i < 6; i++) { await wp.sim(5); await wp.run(() => __t.render()); }
  await wp.run(() => { __t.forceFight(); STRESS.level = 0.8; });
  for (let i = 0; i < 12; i++) { await wp.sim(5, { audio: true }); await wp.run(() => __t.render()); }
  const r = await wp.run(() => ({ p: renderer.info.memory.programs, kinds: [...new Set(ENEMIES.map(e => e.kind))], ev: { ...BATCH.ev } }));
  expect(r.kinds.length, 'the fight is on').toBeGreaterThan(0);
  expect(r.p, `programs after a scramble and a fight (${r.kinds})`).toBe(p0);
  expect(r.ev, 'no batch grew or was made after the splash').toEqual(ev0);
});

test('batching: the merged meshes draw through a few BatchedMeshes that follow them; a rebuild frees what it drops', async ({ wp }) => {
  await wp.boot();
  await wp.sim(20);
  const r = await wp.run(() => {
    __t.props({ bloom: false, shadows: false }); __t.render();
    const main = renderer.info.render.drawCalls, s0 = BATCH.stats();
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

test('volumetric light (forced on the WebGL 2 backend): the searchlights light the night haze, the meshed beams of real lights hide', async ({ wp }) => {
  await wp.boot({ query: '?hour=23&season=winter&vol=1&weather=fog' });
  await wp.run(() => __t.render());   // (the pipeline and the volume are built by the first frame)
  await wp.sim(200);
  const r = await wp.run(() => {
    const on = __t.bright(0, 0, 1280, 720, 40), err = renderer.getContext().getError();
    const d = VOLUME.density.value; VOLUME.density.value = 0; const off = __t.bright(0, 0, 1280, 720, 40); VOLUME.density.value = d;
    return { on, off, err, active: VOLUME.active, d, hidden: SEARCHLIGHTS.filter(s => s.light && s.cone).every(s => !s.cone.visible) };
  });
  expect(r.active).toBe(true);
  expect(r.err).toBe(0);
  expect(r.d).toBeGreaterThan(0);
  expect(r.on, `lit haze ${r.on} vs none ${r.off}`).toBeGreaterThan(r.off);
  expect(r.hidden).toBe(true);
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
    mem.push(await wp.run(() => Object.assign(__t.geometries(), { t: renderer.info.memory.textures, p: renderer.info.memory.programs, calls: renderer.info.render.drawCalls, err: renderer.getContext().getError() })));
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

test('perfReport: averages frames, CPU, draw calls and lights; perfFlags keeps its switches in localStorage', async ({ wp }) => {
  await wp.boot();
  // two reports at once (the second one starts later): each keeps its own frames (the node frame advanced as the
  // renderer's own rAF loop would: the harness has none)
  const [r, r2] = await wp.run(async () => {
    const f = ms => { renderer._nodes.nodeFrame.update(); frame(ms); };
    const p = perfReport(0.3); for (let i = 1; i <= 5; i++) f(i * 16.7);
    const p2 = perfReport(0.2); for (let i = 6; i <= 10; i++) f(i * 16.7);
    return Promise.all([p, p2]);
  });
  expect(r.frames).toBe(10);
  expect(r2.frames).toBe(5);
  expect(r.frameMs).toBeCloseTo(16.7, 1);
  expect(r.drawCalls).toBeGreaterThan(50);
  expect(r.backend).toBe('WebGL 2');
  expect(r.batches).toBeGreaterThan(0);
  expect(r.simMs + r.renderMs).toBeCloseTo(r.cpuMs, 1);
  // a WE pause isn't one long frame
  const q = await wp.run(async () => {
    const f = ms => { renderer._nodes.nodeFrame.update(); frame(ms); };
    const p = perfReport(0.1); f(16.7); f(33.4); paused = true; f(3000); f(3016.7); paused = false; f(3033.4); f(3050.1);
    return p;
  });
  expect([q.frames, q.pauses, q.frameMsMax]).toEqual([4, 1, 16.7]);
  // a long frame goes into the hitch log, with what it and the frame before it made
  const h = await wp.run(async () => {
    const f = ms => { renderer._nodes.nodeFrame.update(); frame(ms); };
    const p = perfReport(0.1); f(5000); f(5016.7); f(5216.7); f(5233.4);
    return p;
  });
  expect(h.hitches).toBe(1);
  expect(h.hitchLog.length).toBe(1);
  expect(h.hitchLog[0].ms).toBe(200);
  expect(Object.keys(h.hitchLog[0].made).sort()).toEqual(['batchGrow', 'newBatch', 'pipes', 'programs']);
  expect(h.made.batchGrow).toBe(0);
  const f = await wp.run(() => { perfFlags({ gl: 'webgl2' }); const a = localStorage.getItem('fab-perf'); perfFlags({}); return [a, localStorage.getItem('fab-perf')]; });
  expect(f).toEqual(['{"gl":"webgl2"}', '{}']);
});


// fire (FlameFX): tongues of procedural flame over a burning roof, warm and bright; the fire lights are a fixed pair in
// the scene (the light set never changes) lit only while something burns; HDR only with bloom
test('fire: a burning roof draws flames and lights the roof; fixed fire lights, dark without a fire; uK 1 without bloom', async ({ wp }) => {
  await wp.boot({ query: '?hour=23&season=summer' });
  await wp.sim(2);
  const r = await wp.run(() => {
    const lights = () => { let n = 0; scene.traverse(o => { if (o.isLight) n++; }); return n; };
    const n0 = lights(), dark = FX.fireLights.items.every(l => l.intensity === 0);
    const t = BASE.targets.find(t => /HANGAR/i.test(t.name)); baseImpact(t.p.clone(), 1.6, t.name);
    CFG.zoom = 420; CAM_TGT.set(t.p.x, t.p.y, t.p.z); updateCamera();
    for (let i = 0; i < 60; i++) step(0.05);
    __t.render();
    const v = t.p.clone().add(new THREE.Vector3(0, 1.5, 0)).project(camera), x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
    const c = __t.sample(x - 30, y - 30, 60, 60);
    const lit = FX.fireLights.items.filter(l => l.intensity > 0).length, flames = FX.fire.live.length, n1 = lights();
    __t.props({ bloom: false }); const k0 = FX.fire.uK.value; __t.props({ bloom: true });
    return { n0, n1, dark, lit, flames, c, k0, err: renderer.getContext().getError() };
  });
  expect(r.err).toBe(0);
  expect(r.dark, 'no fire: the fire lights are dark').toBe(true);
  expect(r.n1, 'the light set never changes').toBe(r.n0);
  expect(r.lit, 'the fire lights the roof').toBeGreaterThan(0);
  expect(r.flames, 'tongues of flame').toBeGreaterThan(5);
  expect(r.c[0], `warm and bright over the roof ${r.c}`).toBeGreaterThan(r.c[2] + 40);
  expect(r.k0, 'no HDR without bloom').toBe(1);
  // a long fire never outgrows its pool; the flames die with it
  const s = await wp.run(() => { let mx = 0; for (let i = 0; i < 900; i++) { step(0.05); mx = Math.max(mx, FX.fire.live.length); } return { mx, left: BASE_FIRES.length, live: FX.fire.live.length, lit: FX.fireLights.items.filter(l => l.intensity > 0).length }; });
  expect(s.mx).toBeLessThanOrEqual(240);
  expect([s.left, s.live, s.lit], 'out: no flames, the lights dark').toEqual([0, 0, 0]);
});

test('the grade: day and night values follow ENV.night (night: the pre-r187 / r187 midpoint)', async ({ wp }) => {
  await wp.boot({ query: '?hour=23' });
  const n = await wp.run(() => { __t.render(); updateBloom(); return { night: ENV.night, sat: GRADE.u.sat.value, con: GRADE.u.con.value, mid: GRADE.u.mid.value }; });
  expect(n.night).toBe(1);
  expect([n.sat, n.con, n.mid]).toEqual([GRADE_N.sat, GRADE_N.con, GRADE_N.mid]);
});
const GRADE_N = { sat: 0.8, con: 0.87, mid: 0.33 };
