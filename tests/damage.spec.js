// Damage on the base (combat.js DAMAGE): what an enemy bomb lands on is out for a while — an air-defence unit, an
// aircraft at its home, a runway (the repair truck) — within caps that keep the base working; bombers miss more often;
// craters never stack
const { test, expect } = require('./support/harness');

test('a bomb on an air-defence unit knocks it out: no tracking, no fire, smoke; it comes back with its crater filled', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { __t.forceFight(); STRESS.level = 0.6; CFG.enemies = true;
    window.__u = ALL_AA[0]; window.__fired = 0;
    const f = window.fireAA; window.fireAA = (m, k) => { if (m === __u && m.downT > 0) __fired++; return f(m, k); };
    enemyBomb(DAMAGE.at(__u).clone()); });
  const r0 = await wp.run(() => ({ down: __u.downT, crater: FX.scorch.items.some(i => i.on && Math.hypot(i.p.x - DAMAGE.at(__u).x, i.p.z - DAMAGE.at(__u).z) < 1.5) }));
  expect(r0.down, 'down for a while').toBeGreaterThan(59);
  expect(r0.crater, 'a crater at it').toBe(true);
  const s = await wp.sim(30, { audio: true });
  expect(s.violations).toEqual([]);
  expect(await wp.run(() => [__u.track, __u.sv, __fired])).toEqual([null, 0, 0]);
  const up = await wp.until(() => !(__u.downT > 0), 100, { audio: true });
  expect(up.done, 'back on line').toBe(true);
  await wp.sim(4, { audio: true });
  expect(await wp.run(() => FX.scorch.items.some(i => i.on && Math.hypot(i.p.x - DAMAGE.at(__u).x, i.p.z - DAMAGE.at(__u).z) < 1.5)), 'its crater filled in').toBe(false);
});

test('bombs on every air-defence unit: at most 40 % go down, never the Patriot and the NASAMS together', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.forceFight();
    for (const u of DAMAGE.units().slice().sort(() => Math.random() - 0.5)) DAMAGE.hit(DAMAGE.at(u), 2.6);
    const all = DAMAGE.units();
    return { n: all.length, down: all.filter(u => u.downT > 0).length, both: DAMAGE.patriotDown() && DAMAGE.nasamsDown() };
  });
  expect(r.down).toBeGreaterThan(0);
  expect(r.down).toBeLessThanOrEqual(Math.floor(r.n * 0.4));
  expect(r.both).toBe(false);
  expect((await wp.sim(5, { audio: true })).violations).toEqual([]);
});

test('an aircraft hit on its stand: DAMAGED, no launch, the crash tender foams it, the maintenance truck repairs it, then serviced', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.auto = false; CFG.missions = 0; CFG.flyby = 0; TANKER.timer = 1e9; GROUND_OPS.emTimer = 1e9;
    window.__a = AIRCRAFT.find(a => a instanceof FixedWing && a.state === 'parked' && crewSpot(a));
    __t.forceFight(); enemyBomb(__a.mesh.position.clone().setY(0)); });
  expect(await wp.run(() => [__a.dmgT > 100, __a.status[0], __a.canLaunch()])).toEqual([true, 'DAMAGED', false]);
  await wp.run(() => __a.requestLaunch());
  expect(await wp.run(() => __a.state)).toBe('parked');
  const foam = await wp.until(() => GROUND_OPS.scenes.some(s => s instanceof FireScene && s.a === __a && s.phase === 'foam'), 90, { audio: true });
  expect(foam.violations).toEqual([]);
  expect(foam.done, 'the crash tender reaches it').toBe(true);
  const out = await wp.until(() => !(__a.burnT > 0) && !GROUND_OPS.scenes.some(s => s instanceof FireScene && s.a === __a), 90, { audio: true });   // (bombs may hit others meanwhile)
  expect(out.violations).toEqual([]);
  expect(out.done, 'the fire is out, the tender gone').toBe(true);
  // the maintenance truck: its crane sets the spare engine down beside it (on the ground, near the aircraft), the crew
  // works, the engine goes back; then it is repaired and the fuel truck comes
  await wp.run(() => { window.__mt = { down: null }; });
  const fixed = await wp.until(() => {
    const sc = GROUND_OPS.scenes.find(s => s instanceof MaintScene && s.a === __a);
    if (sc && sc.phase === 'work' && sc.crane.steps[0] === sc.holdStep && sc.crane.there && !__mt.down) {
      const b = sc.crane.blk.getWorldPosition(new THREE.Vector3()); __mt.down = [b.y, Math.hypot(b.x - __a.mesh.position.x, b.z - __a.mesh.position.z), sc.crane.carry.visible, __a.groundBusy];
    }
    return !(__a.dmgT > 0) && GROUND_OPS.scenes.some(s => s instanceof ServiceScene && s.a === __a);
  }, 150, { audio: true });
  expect(fixed.violations).toEqual([]);
  expect(fixed.done, 'repaired, then serviced').toBe(true);
  const d = await wp.run(() => __mt.down);
  expect(d, 'the engine was set down by the aircraft').not.toBeNull();
  expect(d[0]).toBeLessThan(0.5); expect(d[1]).toBeLessThan(3.5); expect(d[2]).toBe(true); expect(d[3], 'held by the repair crew').toBe(true);
  expect(await wp.run(() => __a.status[0])).not.toBe('DAMAGED');
});

test('only a few aircraft are damaged at once (a quarter of the air wing)', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.forceFight();
    for (const a of AIRCRAFT.filter(a => a.state === 'parked')) DAMAGE.hit(a.mesh.position.clone().setY(0), 2.6);
    return [AIRCRAFT.filter(a => a.dmgT > 0).length, Math.max(1, Math.floor(AIRCRAFT.length * 0.25))];
  });
  expect(r[0]).toBeGreaterThan(0);
  expect(r[0]).toBeLessThanOrEqual(r[1]);
});

for (const runways of [1, 2])
test(`a bomb on the runway closes it: the repair truck mats the crater, the runway opens within 75 s (${runways} runway${runways > 1 ? 's' : ''})`, async ({ wp }) => {
  await wp.boot();
  await wp.run((n) => { CFG.runways = n; __t.reset(); }, runways);
  await wp.sim(30);
  await wp.run(() => { window.__L = CFG.runways > 1 ? BASE_LAYOUT.rwy2 : BASE_LAYOUT.rwy; window.__ph = new Set(); window.__drops = []; enemyBomb(new THREE.Vector3(14, 0, __L.z)); });
  expect(await wp.run(() => [!!DAMAGE.rwy, DAMAGE.closed(__L), AIRFIELD.landR() === BASE_LAYOUT.rwy])).toEqual([true, true, true]);
  // every mat is let go with the hook right over the crater, down at the bottom (the boom swung all the way round)
  const r = await wp.until(() => {
    const sc = GROUND_OPS.scenes.find(s => s instanceof RepairScene); if (!sc) return !DAMAGE.rwy;
    __ph.add(sc.phase);
    if ((sc.placed || 0) > __drops.length) { const b = sc.crane.blk.getWorldPosition(new THREE.Vector3()); __drops.push([Math.hypot(b.x - sc.c.x, b.z - sc.c.z), b.y]); }
    return !DAMAGE.rwy;
  }, 80);
  expect(r.violations).toEqual([]);
  expect(r.done, 'open again').toBe(true);
  expect(await wp.run(() => [...__ph])).toEqual(expect.arrayContaining(['in', 'work', 'stow', 'out']));
  const drops = await wp.run(() => __drops);
  expect(drops.length, 'mats laid').toBeGreaterThan(0);
  for (const [d, y] of drops) { expect(d, 'over the crater').toBeLessThan(0.15); expect(y, 'hook down').toBeLessThan(0.3); }
  expect(await wp.run(() => FX.scorch.items.some(i => i.on && !i.fade && runwayAt(i.p.x, i.p.z) === __L)), 'the crater is filled').toBe(false);
  const gone = await wp.until(() => !GROUND_OPS.scenes.some(s => s instanceof RepairScene), 60);
  expect(gone.violations).toEqual([]);
  expect(gone.done, 'the truck is back in its shed').toBe(true);
  expect(await wp.run(() => VEH_POOL.repair.length)).toBe(1);
  // traffic goes on: something takes off or lands
  await wp.run(() => __t.reset());
  const tr = await wp.until(() => AIRCRAFT.some(a => a.state === 'takeoff_roll' || a.state === 'rollout'), 400);
  expect(tr.done, JSON.stringify(await wp.states())).toBe(true);
  expect(await wp.stuck()).toEqual([]);
});

test('a second runway hit while one is closed only craters (patched soon): never both closed', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.runways = 2; enemyBomb(new THREE.Vector3(14, 0, BASE_LAYOUT.rwy2.z)); enemyBomb(new THREE.Vector3(-20, 0, BASE_LAYOUT.rwy.z)); });
  expect(await wp.run(() => [DAMAGE.closed(BASE_LAYOUT.rwy2), DAMAGE.closed(BASE_LAYOUT.rwy)])).toEqual([true, false]);
  await wp.sim(12);
  expect(await wp.run(() => FX.scorch.items.some(i => i.on && runwayAt(i.p.x, i.p.z) === BASE_LAYOUT.rwy && i.t > 3))).toBe(false);
});

test('craters always shrink away, even when the pool overflows under heavy bombing', async ({ wp }) => {
  await wp.boot();
  // 200 craters in 10 s (more than the pool holds): a crater only ever goes off at the end of its shrink (scale ~0) — never
  // switched off or taken over while it still shows
  const r = await wp.run(() => {
    const S = FX.scorch, sh = new Map(); let popped = 0, made = 0;
    const look = () => { for (const o of S.items) { if (sh.has(o) && sh.get(o).on && (!o.on || o.p.x !== sh.get(o).x) && sh.get(o).k > 0.05) popped++; sh.set(o, { on: o.on, k: o.k, x: o.p.x }); } };
    for (let i = 0; i < 400; i++) { if (i % 2 === 0 && S.spawn(new THREE.Vector3(-70 + (i % 40) * 3.5, 0, 40 + Math.floor(i / 40) * 4), 2)) made++; look(); S.update(0.05); look(); }
    return { popped, made };
  });
  expect(r.popped, 'none cut short while showing').toBe(0);
  expect(r.made).toBeGreaterThan(100);
  expect((await wp.sim(10)).violations).toEqual([]);
});

test('craters never stack: hits on a live crater widen it', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    const p = new THREE.Vector3(-30, 0, 45), live = () => FX.scorch.items.filter(i => i.on);
    const n0 = live().length; FX.scorch.spawn(p, 2); const r0 = live().find(i => i.p.distanceTo(p) < 0.5).r;
    FX.scorch.spawn(p.clone().setX(-29), 2); FX.scorch.spawn(p.clone().setX(-31), 2);
    const near = live().filter(i => Math.hypot(i.p.x + 30, i.p.z - 45) < 3);
    FX.scorch.spawn(p.clone().setX(-22), 2);                       // far enough: a second one
    return { added: live().length - n0, near: near.length, grown: near[0].r / r0 };
  });
  expect(r.near).toBe(1);
  expect(r.grown).toBeGreaterThan(1.1); expect(r.grown).toBeLessThanOrEqual(1.4 + 1e-9);
  expect(r.added).toBe(2);
});

test('bombers miss more often than not: less than half the bombs fall within 3 of a structure', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { __t.forceFight(); STRESS.level = 0.95; window.__bombs = [];
    const f = window.enemyBomb; window.enemyBomb = p => { __bombs.push([p.x, p.z]); return f(p); }; });
  const r = await wp.until(() => __bombs.length >= 40, 900, { audio: true });
  expect(r.violations).toEqual([]);
  const b = await wp.run(() => ({ n: __bombs.length, on: __bombs.filter(([x, z]) => BASE.targets.some(t => t.name !== 'RUNWAY' && Math.hypot(t.p.x - x, t.p.z - z) < 3)).length }));
  expect(b.n).toBeGreaterThanOrEqual(40);
  expect(b.on / b.n).toBeLessThan(0.5);
});
