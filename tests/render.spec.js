// Rendering invariants (WebGL through SwiftShader): GL health, draw-call budget, what is on screen, day / night,
// shadows and their coverage, GPU memory that plateaus. No golden screenshots: checks are relative / structural.
const { test, expect } = require('./support/harness');

test.use({ viewport: { width: 640, height: 360 } });

const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

test('a day frame renders without GL errors, within the draw-call budget, with the fleet on screen', async ({ wp }) => {
  await wp.boot();
  await wp.sim(5);
  const r = await wp.run(() => {
    __t.render();
    const gl = renderer.getContext(), err = gl.getError();
    return {
      err, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, programs: renderer.info.programs.length,
      center: __t.sample(300, 160, 40, 40), sea: __t.sample(10, 10, 40, 40), seaB: __t.sample(590, 310, 40, 40),
      lost: gl.isContextLost(), lightsOn: ENV.lightsOn, spots: SEARCHLIGHTS.filter(s => s.light && s.light.visible).length
    };
  });
  expect(r.lost).toBe(false);
  expect(r.err, 'gl.getError()').toBe(0);
  expect(r.calls, 'draw calls (baseline ~400)').toBeLessThan(700);
  expect(r.calls).toBeGreaterThan(50);
  expect(r.tris).toBeGreaterThan(10000);
  expect(r.programs).toBeLessThan(60);
  // the sea is blue in both corners; the middle (the carrier) is not sea
  for (const c of [r.sea, r.seaB]) expect(c[2], `sea is blue ${c}`).toBeGreaterThan(c[0]);
  const d = Math.max(...r.center.map((v, i) => Math.abs(v - r.sea[i])));
  expect(d, `carrier in the middle ${r.center} vs sea ${r.sea}`).toBeGreaterThan(15);
  expect(r.lightsOn).toBe(0);
  expect(r.spots, 'searchlights hidden by day').toBe(0);
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

test('shadows darken the sea around the ships, and the shadow camera covers the whole screen', async ({ wp }) => {
  await wp.boot();
  await wp.sim(3);
  const r = await wp.run(() => {
    const on = __t.sample(160, 90, 320, 180);
    // the visible sea's corners lie inside the fitted shadow camera (light space)
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
    expect(m.err).toBe(0); expect(m.calls).toBeLessThan(900);
    expect(m.leaked, `geometries dropped without dispose: ${m.leakedTypes}`).toBe(0);
  }
  const early = mem[6], late = mem[mem.length - 1];
  expect(late.t, 'textures').toBeLessThanOrEqual(early.t + 2);
  expect(late.p, 'shader programs').toBeLessThanOrEqual(early.p + 2);
  expect(late.reach, `reachable geometries ${mem.map(m => m.reach).join(' ')}`).toBeLessThan(early.reach * 1.1 + 20);
});
