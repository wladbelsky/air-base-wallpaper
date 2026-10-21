// Soak: two hours of simulated wallpaper life — music and silence taking turns, missions, refuelling, count changes —
// with every invariant checked each step, no stuck aircraft and no growth in memory or pools.
const { test, expect, SEED } = require('./support/harness');

test.use({ viewport: { width: 960, height: 540 } });
test.setTimeout(15 * 60 * 1000);

test(`two hours of wallpaper life (seed ${SEED})`, async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.flyby = 8; CFG.missions = 8; });
  const snap = () => wp.run(() => {
    const geo = __t.geometries();
    return { gpu: geo.gpu, reach: geo.reach, leaked: geo.leaked, leakedTypes: geo.leakedTypes, t: renderer.info.memory.textures, p: renderer.info.programs.length,
      scene: scene.children.length, enemies: ENEMIES.length, flybys: FLYBYS.length, missiles: MISSILES.length,
      // nav-light materials must belong to something alive: an object in the scene or a mission-ship template
      navOrphans: (() => { const used = new Set(); const add = r => r.traverse(o => { if (o.isPoints) used.add(o.material); }); add(scene); Object.values(VESSEL_MODELS).forEach(add); return NAV_MATS.filter(m => !used.has(m)).length; })(),
      spots: SEARCHLIGHTS.length, vessels: VESSELS.list.length, cargo: CARGO.items.length, ropes: ROPES.items.length, aircraft: AIRCRAFT.length };
  });
  const snaps = [];
  for (let min = 0; min < 120; min++) {
    const music = Math.floor(min / 10) % 2 === 1;              // 10 min silence, 10 min music, …
    if (min === 45) await wp.run(() => __t.props({ fa18count: 8, mh60count: 3, ah1count: 2 }));
    if (min === 75) await wp.run(() => __t.props({ fa18count: 4, mh60count: 1, ah1count: 1, ddhelis: false }));
    if (min === 95) await wp.run(() => __t.props({ ddhelis: true }));
    const r = await wp.sim(60, { audio: music });
    expect(r.violations, `minute ${min}`).toEqual([]);
    if (min % 5 === 4) snaps.push(await snap());
  }
  expect(await wp.stuck()).toEqual([]);
  // compare like with like: the same air wing at minute 40 (before the changes) and at the end
  const a = snaps[7], z = snaps[snaps.length - 1];
  expect(z.aircraft).toBe(a.aircraft);
  expect(z.t, 'textures').toBeLessThanOrEqual(a.t + 2);
  expect(z.p, 'shader programs').toBeLessThanOrEqual(a.p + 2);
  for (const s of snaps) expect(s.leaked, `geometries dropped without dispose: ${s.leakedTypes}`).toBe(0);
  expect(z.reach, `reachable geometries over time ${snaps.map(s => s.reach).join(' ')}`).toBeLessThan(a.reach * 1.1 + 30);
  expect(z.scene, `scene children ${snaps.map(s => s.scene).join(' ')}`).toBeLessThan(a.scene + 40);
  for (const s of snaps) expect(s.navOrphans, 'nav-light materials of disposed aircraft are released').toBe(0);
  expect(z.spots, 'searchlights of disposed aircraft are released').toBeLessThanOrEqual(a.spots);
  for (const s of snaps) { expect(s.cargo).toBeLessThan(10); expect(s.ropes).toBeLessThan(10); expect(s.vessels).toBeLessThan(6); }
  // all of it happened
  const seen = await wp.run(() => { const all = new Set([...__t.log.values()].flat()); return ['mission', 'cbt_pass', 'tank_pass', 'trap', 'hangar'].filter(s => all.has(s)); });
  expect(seen).toEqual(['mission', 'cbt_pass', 'tank_pass', 'trap', 'hangar']);
});
