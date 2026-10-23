// Combat: arming through the real audio path, the hold / resume / stand-down cycle, passes and enemies, clean-up
const { test, expect } = require('./support/harness');

/* count beats and remember what the fight produced (sampled every few seconds) */
async function fight(wp, sec, opts = {}) {
  const seen = { passes: 0, kinds: {}, duel: 0, inCombat: 0, maxEnemies: 0 };
  for (let t = 0; t < sec; t += 5) {
    const r = await wp.sim(5, opts);
    expect(r.violations).toEqual([]);
    const s = await wp.run(() => ({
      passes: AIRWAR.passes.length, kinds: ENEMIES.map(e => e.kind), duel: ENEMIES.filter(e => e.duel).length,
      inCombat: AIRCRAFT.filter(a => a.inCombat).length
    }));
    seen.passes = Math.max(seen.passes, s.passes); seen.duel = Math.max(seen.duel, s.duel); seen.inCombat = Math.max(seen.inCombat, s.inCombat);
    seen.maxEnemies = Math.max(seen.maxEnemies, s.kinds.length);
    for (const k of s.kinds) seen.kinds[k] = (seen.kinds[k] || 0) + 1;
  }
  return seen;
}

test.beforeEach(async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { window.__beats = 0; const ob = window.onBeat; window.onBeat = (b, s) => { __beats++; return ob(b, s); }; });
  await wp.sim(40);   // flights up, things settled
});

test('music arms combat after 5 s, the fight runs, silence holds 5 s and stands down; everything is cleaned up', async ({ wp }) => {
  await wp.sim(4, { audio: true });
  expect(await wp.run(() => AUD.combat), 'not armed before ARM_DELAY').toBe(false);
  await wp.sim(1.5, { audio: true });
  expect(await wp.run(() => [AUD.combat, AUD.fighting])).toEqual([true, true]);

  const seen = await fight(wp, 150, { audio: true });
  const beats = await wp.run(() => __beats);
  expect(beats, 'beats detected from the music').toBeGreaterThan(100);
  expect(seen.inCombat, 'armed aircraft engaged').toBeGreaterThan(0);
  expect(seen.passes, 'combat passes flown').toBeGreaterThan(0);
  expect(seen.kinds.bandit, 'enemy waves').toBeGreaterThan(0);
  expect(seen.duel, 'dogfight bandits').toBeGreaterThan(0);
  expect(await wp.run(() => STRESS.level), 'stress builds up').toBeGreaterThan(0.2);
  expect(await wp.run(() => AIRCRAFT.filter(a => a.mission).length), 'no missions in combat').toBe(0);

  // the music stops (the sound counts as gone after 1.6 s): hold — still armed, not fighting — then stand down
  await wp.sim(2, { audio: false });
  expect(await wp.run(() => [AUD.combat, AUD.holding, AUD.fighting])).toEqual([true, true, false]);
  expect(await wp.run(() => ENEMIES.filter(e => (e.kind === 'cruise' || e.kind === 'ballistic') && !e.dead).length), 'inbound missiles intercepted in the hold').toBe(0);
  await wp.sim(5, { audio: false });
  expect(await wp.run(() => [AUD.combat, AUD.holding])).toEqual([false, false]);

  // a few minutes later nothing of the fight is left
  const r = await wp.until(() => !AIRCRAFT.some(a => a.inCombat) && !AIRWAR.passes.length && !ENEMIES.length && !PENDING.length, 300, { audio: false });
  expect(r.violations).toEqual([]);
  expect(r.done, JSON.stringify(await wp.run(() => ({ cbt: AIRCRAFT.filter(a => a.inCombat).map(a => a.callsign + ':' + a.state), passes: AIRWAR.passes.length, enemies: ENEMIES.map(e => e.kind), pending: PENDING.length })))).toBe(true);
  expect(await wp.stuck()).toEqual([]);
});

test('sound during the hold resumes the fight; a short ping does not', async ({ wp }) => {
  await wp.sim(8, { audio: true });
  expect(await wp.run(() => AUD.combat)).toBe(true);
  await wp.sim(2, { audio: false });
  expect(await wp.run(() => AUD.holding)).toBe(true);
  await wp.sim(0.3, { audio: true });             // a notification ping: shorter than RESUME_DELAY
  await wp.sim(0.5, { audio: false });
  expect(await wp.run(() => AUD.holding), 'still holding after a ping').toBe(true);
  await wp.sim(1.5, { audio: true });             // the music is back
  expect(await wp.run(() => [AUD.combat, AUD.holding, AUD.fighting])).toEqual([true, false, true]);
  const lines = await wp.run(() => RADIO.q.concat(RADIO.cur ? [RADIO.cur] : []).map(m => m.text));
  expect(lines.length).toBeGreaterThan(0);
});

test('with enemies off the fight has passes but no waves, missiles or armour', async ({ wp }) => {
  await wp.run(() => { CFG.enemies = false; __t.forceFight(); });
  const seen = await fight(wp, 120);
  expect(seen.inCombat).toBeGreaterThan(0);
  expect(seen.kinds).toEqual({});
  await wp.run(() => __t.fightOff());
  const r = await wp.until(() => !AUD.armed && !AIRCRAFT.some(a => a.inCombat), 300);
  expect(r.done).toBe(true);
});

test('fire intensity 0: combat mode without passes or enemies', async ({ wp }) => {
  await wp.run(() => { CFG.fire = 0; __t.forceFight(); });
  const seen = await fight(wp, 60);
  expect(seen.passes).toBe(0);
  expect(seen.kinds).toEqual({});
});

test('a long, heavy fight (high stress) stays within bounds', async ({ wp }) => {
  // the gunships up first: armour comes in on its own and in their passes, the AC-130 circles over it
  // (automatic flight ops off meanwhile: they would bring the helicopters back while the AC-130 queues for the runway)
  await wp.run(() => { CFG.auto = false; AIRCRAFT.filter(a => ['ah64', 'ac130', 'a10'].includes(a.spec.key)).forEach(a => a.requestLaunch()); });
  const up = await wp.until(() => AIRCRAFT.some(a => a.spec.key === 'ah64' && a.aloft) && AIRCRAFT.some(a => a.spec.key === 'ac130' && a.aloft), 600);
  expect(up.done, JSON.stringify(await wp.states())).toBe(true);
  await wp.run(() => { CFG.auto = true; __t.forceFight(); STRESS.level = 0.9; });
  const seen = await fight(wp, 300);
  for (const k of ['cruise', 'ballistic', 'armor', 'bandit']) expect(seen.kinds[k] || 0, `${k} at high stress`).toBeGreaterThan(0);
  expect(seen.maxEnemies).toBeLessThan(70);
  expect(await wp.run(() => [...__t.log.values()].flat().includes('cbt_orbit')), 'the gunship circled over the fight').toBe(true);
  expect(await wp.stuck()).toEqual([]);
});

test('the base fires back: tanks at the armour, SAMs and guns into the air; hits leave fires and scorch marks', async ({ wp }) => {
  await wp.run(() => { __t.forceFight(); STRESS.level = 0.7; window.__shots = { tank: 0, sam: 0, aa: 0 };
    const t = window.fireTank, s = window.launchSAM, a = window.fireAA;
    window.fireTank = (m, k) => { __shots.tank++; return t(m, k); }; window.launchSAM = (k) => { __shots.sam++; return s(k); }; window.fireAA = (m, k) => { __shots.aa++; return a(m, k); }; });
  await fight(wp, 120, { audio: true });
  const r = await wp.run(() => ({ shots: __shots, scorch: FX.scorch.items.filter(i => i.on).length }));
  expect(r.shots.tank).toBeGreaterThan(0);
  expect(r.shots.sam + r.shots.aa).toBeGreaterThan(0);
  expect(r.scorch, 'scorch marks on the ground').toBeGreaterThan(0);
});

test('sky searchlights slew: with bandits coming and going, and the fight ending, no beam ever jumps', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { __t.forceFight(); STRESS.level = 0.8; window.__sk = { prev: null, max: 0, tracked: 0 }; });
  // the beam's direction every step, in the step's own predicate (wp.until): the largest change between two steps
  const watch = () => {
    const d = BASE.skyLights.map(sl => new THREE.Vector3(0, 0, 1).applyQuaternion(sl.holder.getWorldQuaternion(new THREE.Quaternion())));
    if (__sk.prev) d.forEach((v, i) => { __sk.max = Math.max(__sk.max, v.angleTo(__sk.prev[i])); });
    __sk.prev = d; if (BASE.skyLights.some(sl => sl.tgt)) __sk.tracked++;
    return false;
  };
  await wp.until(watch, 120, { audio: true });
  await wp.run(() => __t.fightOff());
  await wp.until(watch, 60);
  const r = await wp.run(() => __sk);
  expect(r.tracked, 'the lights tracked bandits').toBeGreaterThan(0);
  expect(r.max, 'largest beam turn in one 0.05 s step').toBeLessThan(0.05);
});

test('a knocked-out vehicle burns black in its crater, smoulders, then sinks into the ground and is gone; craters fade', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => {
    window.__e = spawnArmor(new THREE.Vector3(-110, 0, 45), new THREE.Vector3(1, 0, 0), 't90', new THREE.Vector3(-110, 0, 45), 'X', 0); __e.speed = 0;
    damageEnemy(__e, 99, null);
    window.__c = FX.scorch.items.filter(i => i.on).length;
  });
  const r0 = await wp.run(() => {
    const mats = new Set(); __e.mesh.traverse(o => { if (o.isMesh) mats.add(o.material.color.getHex()); });
    return { mats: [...mats], falling: __e.falling, alive: enemyAlive(__e), craters: __c };
  });
  expect(r0.falling).toBe(true); expect(r0.alive).toBe(false);
  expect(r0.mats, 'burnt black').toEqual([0x2c2a26]);
  expect(r0.craters, 'a crater under it').toBeGreaterThan(0);
  // burning: still on the ground at 20 s; sinking from 30 s; gone by 40 s
  await wp.sim(20);
  expect(await wp.run(() => [ENEMIES.includes(__e), __e.mesh.position.y - __e.p.y])).toEqual([true, 0]);
  await wp.sim(13);
  const y = await wp.run(() => __e.mesh.position.y - __e.p.y);
  expect(y, 'sinking').toBeLessThan(-0.2); expect(y).toBeGreaterThan(-1.4);
  const g = await wp.sim(8);
  expect(g.violations).toEqual([]);
  expect(await wp.run(() => [ENEMIES.includes(__e), !!__e.mesh.parent])).toEqual([false, false]);
  // the crater shrinks away at the end of its life
  await wp.sim(40);
  expect(await wp.run(() => FX.scorch.items.filter(i => i.on).length)).toBe(0);
});

test('air-defence radars: AA search antennas spin in a fight, the Patriot radar turns (slowly) toward its target, all settle in peace', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { window.__rd = { spin: 0, max: 0, prev: null, aimed: 0 }; });
  const watch = () => {
    const pr = BASE.patriotRadar, h = pr.head.rotation.y;
    if (__rd.prev != null) __rd.max = Math.max(__rd.max, Math.abs(angleWrap(h - __rd.prev))); __rd.prev = h;
    __rd.spin = Math.max(__rd.spin, ...BASE.mounts.aa.map(m => m.sv || 0));
    if (pr.tgt) { const want = Math.atan2(-(pr.tgt.p.z - pr.position.z), pr.tgt.p.x - pr.position.x) - pr.rotation.y; if (Math.abs(angleWrap(want - h)) < 0.2) __rd.aimed++; }
    return false;
  };
  expect(await wp.run(() => BASE.mounts.aa.every(m => m.search) && !!BASE.patriotRadar.head)).toBe(true);
  await wp.run(() => { __t.forceFight(); STRESS.level = 0.8; });
  await wp.until(watch, 120, { audio: true });
  const r = await wp.run(() => __rd);
  expect(r.spin, 'search antennas up to speed').toBeGreaterThan(3.9);
  expect(r.aimed, 'the Patriot radar faced its target').toBeGreaterThan(20);
  expect(r.max, 'its head turns at ≤ 0.35 rad/s').toBeLessThan(0.35 * 0.05 + 1e-6);
  await wp.run(() => __t.fightOff());
  const calm = await wp.until(() => !AUD.armed && BASE.mounts.aa.every(m => m.sv === 0) && Math.abs(BASE.patriotRadar.head.rotation.y) < 0.01, 90);
  expect(calm.done, 'after the fight: antennas stopped, the radar back to its sector').toBe(true);
});
