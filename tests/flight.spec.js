// Flight logic: every type launches and recovers through its ground sequence (pushback, taxi, holding point, runway,
// landing roll, taxi home) or its helicopter pad; automatic flight ops run for half an hour without breaking a runway /
// home invariant or leaving anyone stuck.
const { test, expect, SEED } = require('./support/harness');

/* boot with automatic flight ops, missions, fly-bys and tanker passes off, and a fresh air wing (no initial launches) */
async function quietBase(wp, opts) {
  await wp.boot(opts);
  await wp.run(() => { CFG.auto = false; CFG.missions = 0; CFG.flyby = 0; buildAirWing(); TANKER.timer = 1e9; __t.reset(); });
}
/* does `seq` contain `want` in order (other states may come in between)? */
const inOrder = (seq, want) => { let i = 0; for (const s of seq) if (s === want[i]) i++; return i === want.length; };

const JET_UP = ['parked', 'ready', 'pushback', 'taxi_out', 'hold_short', 'lineup', 'takeoff_roll', 'climb', 'orbit'];
const JET_DOWN = ['orbit', 'approach', 'final', 'rollout', 'taxi_in', 'parked'];
const HELI_UP = ['parked', 'spinup', 'lift', 'depart', 'orbit'];
const HELI_DOWN = ['orbit', 'ret', 'hover', 'descend', 'spindown', 'parked'];

const CASES = [
  { name: 'F-15E (shelter)', pick: "a.spec.key === 'f15' && AIRFIELD.sheltered(a.spot)", home: 'shelter' },
  { name: 'F-16C (front-row stand)', pick: "a.spec.key === 'f16' && PARKING.stands.includes(a.spot)", home: 'stand' },
  { name: 'F-22A', pick: "a.spec.key === 'f22'" },
  { name: 'F-35A', pick: "a.spec.key === 'f35'" },
  { name: 'A-10C', pick: "a.spec.key === 'a10'" },
  { name: 'E-3 (big hangar)', pick: "a.spec.key === 'e3'" },
  { name: 'KC-46', pick: "a.spec.key === 'kc46'" },
  { name: 'C-130J', pick: "a.spec.key === 'c130'" },
  { name: 'KC-130J', pick: "a.spec.key === 'kc130'" },
  { name: 'AC-130J', pick: "a.spec.key === 'ac130'" },
  { name: 'C-17', pick: "a.spec.key === 'c17'" },
  { name: 'MQ-9 (small hangar)', pick: "a.spec.key === 'mq9'" },
  { name: 'UH-60', pick: "a.spec.key === 'uh60'", heli: true },
  { name: 'AH-64D', pick: "a.spec.key === 'ah64'", heli: true },
  { name: 'UH-1Y', pick: "a.spec.key === 'uh1'", heli: true }
];

for (const c of CASES) {
  test(`launch and recovery: ${c.name}`, async ({ wp }) => {
    await quietBase(wp);
    const start = await wp.run((pick) => {
      const a = window.__a = AIRCRAFT.find(new Function('a', `return ${pick}`)); if (!a) return null;
      window.__home = a.spot; __t.track(); a.requestLaunch(); __t.track(); return a.state;
    }, c.pick);
    expect(start, 'aircraft for this case').not.toBeNull();
    const up = await wp.until(() => __a.state === 'orbit', 400);
    expect(up.violations).toEqual([]);
    expect(up.done, `reached orbit (states: ${await wp.run(() => __t.log.get(__a.callsign).join(' > '))})`).toBe(true);
    await wp.sim(20);
    await wp.run(() => __a.requestLand());
    const down = await wp.until(() => __a.state === 'parked', 600);
    const r = await wp.run(() => ({ log: __t.log.get(__a.callsign), landReq: __a.landReq, stuck: __t.stuck(), home: __a.spot === __home && __home.occ === __a,
      at: __a.mesh.position.distanceTo(new THREE.Vector3(__home.x, 0, __home.z)) }));
    expect(down.violations).toEqual([]);
    expect(down.done, `back home (states: ${r.log.join(' > ')})`).toBe(true);
    const upSeq = c.heli ? HELI_UP : JET_UP, downSeq = c.heli ? HELI_DOWN : JET_DOWN;
    expect(inOrder(r.log, upSeq), `launch sequence ${r.log.join(' > ')}`).toBe(true);
    expect(inOrder(r.log.slice(r.log.lastIndexOf('orbit')), downSeq.filter(s => !r.log.includes('go_around') || s !== 'final')), `recovery sequence ${r.log.join(' > ')}`).toBe(true);
    expect(r.landReq).toBe(false);
    expect(r.stuck).toEqual([]);
    expect(r.home, 'parked at its own home again').toBe(true);
    expect(r.at, 'parked on its slot').toBeLessThan(0.2);
    // the runway is free again, no arrival is left in the sequence
    expect(await wp.run(() => ({ rwy: AIRFIELD.rwy.size, arr: AIRFIELD.arrivals.size }))).toEqual({ rwy: 0, arr: 0 });
  });
}

test('a pair from one flight takes off side by side', async ({ wp }) => {
  await quietBase(wp);
  await wp.run(() => { const f = AIRCRAFT.filter(a => a.spec.key === 'f16').slice(0, 2); window.__f = f; f.forEach(a => a.requestLaunch()); __t.track(); });
  const r = await wp.until(() => __f.every(a => a.state === 'climb' || a.state === 'orbit'), 400);
  expect(r.violations).toEqual([]);
  expect(r.done).toBe(true);
  // logged by the stuck detector: both rolled; in a pair the second one lines up beside the first (rdz ±1)
  const pairs = await wp.run(() => __f.map(a => a._rdz));
  expect(pairs.every(z => z === 0) || (pairs.includes(1) && pairs.includes(-1)), JSON.stringify(pairs)).toBe(true);
});

test('an arrival finding the runway occupied goes around and lands afterwards', async ({ wp }) => {
  await quietBase(wp);
  await wp.run(() => { window.__a = AIRCRAFT.find(a => a.spec.key === 'f22'); __a.requestLaunch(); });
  expect((await wp.until(() => __a.state === 'orbit', 400)).done).toBe(true);
  // something sits on the runway when it reaches its final
  await wp.run(() => { __a.requestLand(); window.__blk = AIRCRAFT.find(a => a.spec.key === 'c130'); });
  await wp.until(() => __a.state === 'approach', 120);
  await wp.run(() => { AIRFIELD.rwy.add(__blk); __blk.state = 'lineup'; __blk.startDeckPath(AIRFIELD.lineUp(0, 0), 0.0001); });
  const ga = await wp.until(() => __a.state === 'go_around', 200, { check: false });
  expect(ga.done).toBe(true);
  await wp.run(() => { AIRFIELD.rwy.delete(__blk); __blk.state = 'parked'; });
  const down = await wp.until(() => __a.state === 'parked', 600);
  expect(down.violations).toEqual([]);
  expect(down.done).toBe(true);
});

test('LAUNCH ALL / RECOVER ALL buttons cycle the whole air wing', async ({ wp }) => {
  await quietBase(wp);
  await wp.page.click('#allUp');
  const up = await wp.until(() => AIRCRAFT.every(a => a.airborne), 2400);
  expect(up.violations).toEqual([]);
  expect(up.done, JSON.stringify(await wp.states())).toBe(true);
  await wp.page.click('#allDown');
  const down = await wp.until(() => AIRCRAFT.every(a => a.state === 'parked'), 3600);
  expect(down.violations).toEqual([]);
  expect(down.done, JSON.stringify(await wp.states())).toBe(true);
  expect(await wp.stuck()).toEqual([]);
  const home = await wp.run(() => ({
    all: AIRCRAFT.every(a => a.spot.occ === a && a.mesh.position.distanceTo(new THREE.Vector3(a.spot.x, 0, a.spot.z)) < 0.2),
    free: AIRFIELD.rwy.size === 0 && AIRFIELD.arrivals.size === 0
  }));
  expect(home).toEqual({ all: true, free: true });
});

for (const seed of [SEED, SEED + 100, SEED + 200]) {
  test(`automatic flight ops for 30 min stay consistent (seed ${seed})`, async ({ wp }) => {
    await wp.boot({ seed });
    const shares = [];
    for (let i = 0; i < 30; i++) {
      const r = await wp.sim(60);
      expect(r.violations, `minute ${i}`).toEqual([]);
      shares.push(await wp.run(() => AIRCRAFT.filter(a => a.aloft).length / AIRCRAFT.length));
    }
    expect(await wp.stuck()).toEqual([]);
    const mean = shares.slice(5).reduce((s, x) => s + x, 0) / (shares.length - 5);
    expect(mean, `share of the air wing up (per minute: ${shares.map(x => x.toFixed(2)).join(' ')})`).toBeGreaterThan(0.2);
    expect(mean).toBeLessThan(0.9);
    // missions went out and came back, aircraft landed during the half hour
    const seen = await wp.run(() => [...__t.log.values()].flat());
    expect(seen).toContain('mission');
    expect(seen).toContain('rollout');
  });
}
