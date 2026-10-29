// Flight logic: every type launches and recovers through its ground sequence (pushback, taxi, holding point, runway,
// landing roll, taxi home) or its helicopter pad; automatic flight ops run for half an hour without breaking a runway /
// home invariant or leaving anyone stuck.
const { test, expect, SEED } = require('./support/harness');

/* boot with automatic flight ops, missions, fly-bys and tanker passes off, and a fresh air wing (no initial launches) */
async function quietBase(wp, opts) {
  await wp.boot(opts);
  await wp.run(() => { CFG.auto = false; CFG.missions = 0; CFG.flyby = 0; buildAirWing(); TANKER.timer = 1e9; GROUND_OPS.emTimer = 1e9; __t.reset(); });
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
    expect(await wp.run(() => ({ rwy: AIRFIELD.rwy.size + AIRFIELD.rwy2.size, arr: AIRFIELD.arrivals.size }))).toEqual({ rwy: 0, arr: 0 });
  });
}

test('takeoff: the roll uses half the runway or more, it keeps accelerating after lift-off, the turn toward the orbit comes past its end', async ({ wp }) => {
  await quietBase(wp);
  for (const k of ['f16', 'c17']) {
    await wp.run((k) => { window.__a = AIRCRAFT.find(a => a.spec.key === k); __a.requestLaunch(); window.__lift = null; window.__turn = null; window.__vEnd = null; }, k);
    for (let i = 0; i < 1600; i++) {
      await wp.sim(0.25);
      const done = await wp.run(() => {
        if (__a.state === 'climb' && __lift === null) __lift = __a.mesh.position.x;
        if (__lift !== null && __vEnd === null && __a.mesh.position.x > 64) __vEnd = __a.v / __a.spec.vR;
        if (__lift !== null && __turn === null && Math.abs(Math.atan2(__a.fwd.z, __a.fwd.x)) > 0.09) __turn = __a.mesh.position.x;
        return __turn !== null || __a.state === 'orbit';
      });
      if (done) break;
    }
    const r = await wp.run(() => ({ lift: __lift, turn: __turn, vEnd: __vEnd }));
    const frac = (r.lift - (-64 + 4.5)) / (64 - (-64 + 4.5));
    expect(frac, `${k} lift-off point`).toBeGreaterThan(k === 'c17' ? 0.55 : 0.4);
    expect(r.turn, `${k} first turn`).toBeGreaterThan(64);
    expect(r.vEnd, `${k} still speeding up after lift-off: speed over the runway end / vR`).toBeGreaterThan(k === 'c17' ? 1.2 : 1.4);
  }
});

test('nav lights and beacons are off while an aircraft or helicopter is parked and shut down, on with the engines', async ({ wp }) => {
  await quietBase(wp);
  const lit = () => wp.run(() => __f.map(a => { let n = 0, on = 0; a.mesh.traverse(o => { if (o.isPoints) { n++; if (o.visible) on++; } }); return [a.spec.key, n, on]; }));
  await wp.run(() => { window.__f = ['c130', 'c17', 'e3', 'kc46', 'uh60'].map(k => AIRCRAFT.find(a => a.spec.key === k)); });
  await wp.sim(1);
  for (const [k, n, on] of await lit()) { expect(n, `${k} has nav lights`).toBeGreaterThan(0); expect(on, `${k} parked: lights off`).toBe(0); }
  await wp.run(() => __f.forEach(a => a.requestLaunch()));
  const up = await wp.until(() => __f.every(a => a.state !== 'parked'), 60);
  expect(up.done).toBe(true);
  for (const [k, n, on] of await lit()) expect(on, `${k} engines on: lights on`).toBe(n);
});

test('climb-out eases into level flight; the landing roll is long, longer for heavies', async ({ wp }) => {
  await quietBase(wp);
  for (const [k, minFrac] of [['f16', 0.25], ['c17', 0.45]]) {
    await wp.run((k) => { window.__a = AIRCRAFT.find(a => a.spec.key === k); __a.requestLaunch(); window.__pp = null; window.__dp = 0; window.__slow = null; }, k);
    // the nose's pitch (from the model, so the rotation on the runway counts) never jumps from one step to the next
    const up = await wp.until(() => {
      if (['takeoff_roll', 'climb', 'orbit'].includes(__a.state)) {
        const p = Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(__a.mesh.quaternion).y);
        if (__pp !== null) __dp = Math.max(__dp, Math.abs(p - __pp)); __pp = p;
      }
      return __a.state === 'orbit' && __a.airT > 8;
    }, 500);
    expect(up.done, `${k} up`).toBe(true);
    expect(await wp.run(() => __dp), `${k} largest pitch change in one step`).toBeLessThan(0.025);
    // braking: down to a fast taxi only well down its runway
    await wp.run(() => __a.requestLand());
    const down = await wp.until(() => {
      if (__a.state === 'rollout' && __slow === null && __a.v <= __a.spec.taxiV * 1.8 + 0.01) __slow = (__a.rx - __a.rwyL.x0) / (__a.rwyL.x1 - __a.rwyL.x0);
      return __a.state === 'parked';
    }, 600);
    expect(down.violations).toEqual([]);
    expect(down.done, `${k} home`).toBe(true);
    expect(await wp.run(() => __slow), `${k}: where on the runway it is down to a fast taxi`).toBeGreaterThan(minFrac);
  }
});

test('helicopters never fly through a roof: one sent home low across the big hangar climbs over it', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.auto = false; CFG.missions = 0; CFG.flyby = 0; TANKER.timer = 1e9; GROUND_OPS.emTimer = 1e9;
    window.__h = AIRCRAFT.find(a => a.spec.key === 'uh60'); __h.requestLaunch(); });
  const up = await wp.until(() => __h.state === 'orbit', 120);
  expect(up.done).toBe(true);
  await wp.run(() => {                                             // a path at 3 high, north of the hangar, across it toward the pads
    const hg = PARKING.hangars.find(s => s.size === 'big'), s = __h.spot;
    const P = new FlightPath().addLine(new THREE.Vector3(hg.x, 3, hg.z - 14), new THREE.Vector3(hg.x, 3, hg.z + 14)).addDubins(new THREE.Vector3(hg.x, 3, hg.z + 14), Math.PI / 2, new THREE.Vector3(s.x, 4, s.z), 0, 5);
    __h.mesh.position.set(hg.x, 3, hg.z - 14); __h.fwd.set(0, 0, 1); __h.fly(P, 6, 0.7); __h.state = 'ret'; window.__over = 0; window.__hg = hg;
  });
  const r = await wp.until(() => { const p = __h.mesh.position; if (Math.abs(p.x - __hg.x) < __hg.w / 2 && Math.abs(p.z - __hg.z) < __hg.d / 2) __over = Math.max(__over, p.y); return __h.state === 'parked'; }, 120);
  expect(r.violations).toEqual([]);                                // (the invariant: never under a roof top + 0.6)
  expect(r.done, 'home on its pad').toBe(true);
  expect(await wp.run(() => __over), 'it went over the roof').toBeGreaterThan(5.5);
});

test('two runways: departures from the north one while arrivals land on the south one and cross back', async ({ wp }) => {
  await quietBase(wp);
  await wp.run(() => { window.__in = AIRCRAFT.filter(a => ['f16', 'f15'].includes(a.spec.key)).slice(0, 3); __in.forEach(a => a.requestLaunch()); });
  expect((await wp.until(() => __in.every(a => a.state === 'orbit'), 600)).done).toBe(true);
  // they come back while others depart
  await wp.run(() => { __in.forEach(a => a.requestLand()); window.__out = AIRCRAFT.filter(a => ['f22', 'f35', 'a10'].includes(a.spec.key) && a.state === 'parked').slice(0, 3); __out.forEach(a => a.requestLaunch()); __t.track(); window.__seen = { r2: 0, cross: 0, both: 0 }; });
  for (let i = 0; i < 240; i++) {
    const r = await wp.sim(2);
    expect(r.violations).toEqual([]);
    const done = await wp.run(() => {
      if (AIRFIELD.rwy2.size) __seen.r2++;
      if (AIRCRAFT.some(a => a.cross && a.cross.ok && AIRFIELD.rwy.has(a))) __seen.cross++;
      if (AIRFIELD.rwy2.size && [...AIRFIELD.rwy].some(b => b.state === 'takeoff_roll')) __seen.both++;
      return __in.every(a => a.state === 'parked') && __out.every(a => a.state === 'orbit');
    });
    if (done) break;
  }
  const r = await wp.run(() => ({ seen: __seen, in: __in.map(a => a.state), out: __out.map(a => a.state), lands: __in.every(a => a.rwyL === BASE_LAYOUT.rwy2), log: __t.log.get(__in[0].callsign) }));
  expect(r.in.every(s => s === 'parked'), JSON.stringify(r)).toBe(true);
  expect(r.out.every(s => s === 'orbit'), JSON.stringify(r)).toBe(true);
  expect(r.lands, 'they landed on the south runway').toBe(true);
  expect(r.seen.r2).toBeGreaterThan(0); expect(r.seen.cross, 'crossed the north runway').toBeGreaterThan(0);
  expect(await wp.stuck()).toEqual([]);
});

test('one runway: everything on the north one; switching to one mid-approach to the south one still lands there', async ({ wp }) => {
  await quietBase(wp);
  await wp.run(() => { CFG.runways = 1; window.__a = AIRCRAFT.find(a => a.spec.key === 'f16'); __a.requestLaunch(); });
  expect((await wp.until(() => __a.state === 'orbit', 400)).done).toBe(true);
  await wp.run(() => __a.requestLand());
  expect((await wp.until(() => __a.state === 'parked', 600)).done).toBe(true);
  expect(await wp.run(() => [__a.rwyL === BASE_LAYOUT.rwy, BASE.rwy2.visible, BASE.fill.visible])).toEqual([true, false, true]);
  // two runways, an approach to the south one, then back to one: it lands there all the same, the runway is drawn till it is home
  await wp.run(() => { CFG.runways = 2; __a.requestLaunch(); });
  expect((await wp.until(() => __a.state === 'orbit', 400)).done).toBe(true);
  await wp.run(() => __a.requestLand());
  expect((await wp.until(() => __a.state === 'approach', 200)).done).toBe(true);
  await wp.run(() => { CFG.runways = 1; });
  await wp.sim(2);
  expect(await wp.run(() => [__a.rwyL === BASE_LAYOUT.rwy2, BASE.rwy2.visible])).toEqual([true, true]);
  const home = await wp.until(() => __a.state === 'parked', 600);
  expect(home.violations).toEqual([]);
  expect(home.done).toBe(true);
  await wp.sim(1);
  expect(await wp.run(() => [BASE.rwy2.visible, BASE.fill.visible])).toEqual([false, true]);
});

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

test('09L closed: the departures cross its end to 09R and take off there, sharing it with the arrivals', async ({ wp }) => {
  await quietBase(wp);
  // one up to land meanwhile, one to depart; 09L closed (a crater far east) once the departure holds short of it
  await wp.run(() => { CFG.runways = 2; window.__b = AIRCRAFT.find(a => a.spec.key === 'f22'); __b.requestLaunch(); });
  expect((await wp.until(() => __b.state === 'orbit', 400)).done).toBe(true);
  await wp.run(() => { window.__a = AIRCRAFT.find(a => a.spec.key === 'f16'); __a.requestLaunch(); });
  expect((await wp.until(() => __a.state === 'hold_short', 400)).done).toBe(true);
  await wp.run(() => { DAMAGE.close(BASE_LAYOUT.rwy, new THREE.Vector3(30, 0, BASE_LAYOUT.rwy.z)); __b.requestLand(); window.__s = { seq: [], roll: null, both: 0 }; });
  expect(await wp.run(() => AIRFIELD.depR() === BASE_LAYOUT.rwy2)).toBe(true);
  const r = await wp.until(() => {
    if (__s.seq[__s.seq.length - 1] !== __a.state) __s.seq.push(__a.state);
    if (__a.state === 'takeoff_roll' && __a.rolling && !__s.roll) __s.roll = [__a.mesh.position.x, __a.mesh.position.z];
    if (AIRFIELD.rwy2.has(__a) && AIRFIELD.rwy2.has(__b) && __b.state === 'rollout' && __a.state !== 'takeoff_roll') __s.both++;   // (one rolling fast may share it, as on 09L)
    return (__a.state === 'climb' || __a.state === 'orbit') && __b.state === 'parked';
  }, 600);
  expect(r.violations).toEqual([]);
  expect(r.done, JSON.stringify(await wp.run(() => [__s.seq, __a.state, __b.state]))).toBe(true);
  const s = await wp.run(() => __s);
  expect(inOrder(s.seq, ['hold_short', 'cross_out', 'hold_short', 'lineup', 'takeoff_roll', 'climb'])).toBe(true);
  expect(s.roll[1], 'rolled on 09R').toBeCloseTo(await wp.run(() => BASE_LAYOUT.rwy2.z), 0);
  expect(s.both, 'never on 09R with a landing roll').toBe(0);
  expect(await wp.run(() => [__a.rwyL, __b.rwyL === BASE_LAYOUT.rwy2])).toEqual([null, true]);
});

test('09L closed near its end: the departure waits at the hold (not across the repair), then goes from 09L', async ({ wp }) => {
  await quietBase(wp);
  await wp.run(() => { CFG.runways = 2; window.__a = AIRCRAFT.find(a => a.spec.key === 'f16'); __a.requestLaunch(); });
  expect((await wp.until(() => __a.state === 'hold_short', 400)).done).toBe(true);
  await wp.run(() => { DAMAGE.close(BASE_LAYOUT.rwy, new THREE.Vector3(-52, 0, BASE_LAYOUT.rwy.z)); window.__x = 0; });
  const r = await wp.until(() => { if (__a.state === 'cross_out') __x++; return __a.state === 'climb'; }, 300);
  expect(r.violations).toEqual([]);
  expect(r.done).toBe(true);
  expect(await wp.run(() => __x), 'never crossed by the repair').toBe(0);
  expect(await wp.run(() => !DAMAGE.rwy)).toBe(true);
});

test('an arrival finding the runway occupied goes around and lands afterwards', async ({ wp }) => {
  await quietBase(wp);
  await wp.run(() => { window.__a = AIRCRAFT.find(a => a.spec.key === 'f22'); __a.requestLaunch(); });
  expect((await wp.until(() => __a.state === 'orbit', 400)).done).toBe(true);
  // something sits on the runway when it reaches its final
  await wp.run(() => { __a.requestLand(); window.__blk = AIRCRAFT.find(a => a.spec.key === 'c130'); });
  await wp.until(() => __a.state === 'approach', 120);
  await wp.run(() => { AIRFIELD.setOf(__a.rwyL).add(__blk); __blk.state = 'lineup'; __blk.startDeckPath(AIRFIELD.lineUp(0, 0), 0.0001); });
  const ga = await wp.until(() => __a.state === 'go_around', 200, { check: false });
  expect(ga.done).toBe(true);
  await wp.run(() => { AIRFIELD.setOf(__a.rwyL).delete(__blk); __blk.state = 'parked'; });
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
    free: AIRFIELD.rwy.size === 0 && AIRFIELD.rwy2.size === 0 && AIRFIELD.arrivals.size === 0
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

test('a count lowered: one still getting ready (not pushed back / not off its pad) calls the launch off and leaves at once; one up lands first', async ({ wp }) => {
  await quietBase(wp);
  await wp.run(() => {
    window.__j = AIRCRAFT.filter(a => a.spec.key === 'f35'); window.__h = AIRCRAFT.filter(a => a.spec.key === 'uh60');
    __j[0].requestLaunch(); __h[0].requestLaunch();
  });
  await wp.sim(1);
  expect(await wp.run(() => [__j[0].state, __h[0].state])).toEqual(['ready', 'spinup']);
  await wp.run(() => __t.props({ f35count: 0, uh60count: 0 }));
  const r = await wp.until(() => !AIRCRAFT.some(a => a.spec.key === 'f35' || a.spec.key === 'uh60'), 10);
  expect(r.violations).toEqual([]);
  expect(r.done, 'all gone within 10 s').toBe(true);
});
