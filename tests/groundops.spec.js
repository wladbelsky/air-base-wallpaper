// Scenes on the ground and over the field: an emergency landing (crash tenders, tug), unloading a transport on its
// stand, a paradrop over the drop zone, the ground crew and the pushback tug — each runs to the end, frees the runway /
// the aircraft and returns its pooled vehicles
const { test, expect } = require('./support/harness');

/* quiet base (no automatic ops / missions / fly-bys / tanker / random emergencies), then launch `pick` and wait */
async function airborne(wp, pick) {
  await wp.boot();
  await wp.run(() => { CFG.auto = false; CFG.missions = 0; CFG.flyby = 0; buildAirWing(); TANKER.timer = 1e9; GROUND_OPS.emTimer = 1e9; __t.reset(); });
  await wp.run((pick) => { window.__f = AIRCRAFT.filter(new Function('a', `return ${pick}`)); __f.forEach(a => a.requestLaunch()); }, pick);
  const up = await wp.until(() => __f.every(a => a.state === 'orbit'), 900);
  expect(up.violations).toEqual([]);
  expect(up.done, JSON.stringify(await wp.states())).toBe(true);
  await wp.sim(35);
}
const pools = wp => wp.run(() => Object.fromEntries(Object.entries(VEH_POOL).map(([k, l]) => [k, l.length])));

// an F-15 (a shelter: the tug stays in it); one on an open stand (the tug drives off)
for (const [name, pick, inside] of [['', "a.spec.key === 'f15' && /\\s1$/.test(a.callsign)", true],
  [', open stand', "a === AIRCRAFT.find(b => b instanceof FixedWing && !AIRFIELD.sheltered(b.spot))", false]])
test('emergency landing: smoke, priority approach, stop on the runway, crash tenders, tow home, runway open again' + name, async ({ wp }) => {
  await airborne(wp, pick);
  await wp.run(() => { window.__a = __f[0]; GROUND_OPS.startEmergency(__a); });
  const stop = await wp.until(() => __a.state === 'emergency', 400);
  expect(stop.violations).toEqual([]);
  expect(stop.done, (await wp.run(() => __t.log.get(__a.callsign))).join(' > ')).toBe(true);
  // its runway is closed (the south one: the north one keeps taking departures)
  expect(await wp.run(() => [AIRFIELD.setOf(__a.rwyL).has(__a), AIRFIELD.canLineUp({}) === (__a.rwyL === BASE_LAYOUT.rwy2)])).toEqual([true, true]);
  const trucks = await wp.until(() => GROUND_OPS.scenes.some(s => s.phase === 'foam'), 120);
  expect(trucks.done, 'the crash tenders reach it and foam it').toBe(true);
  // the tug goes home round the wingtip to a depot (or stays in the shelter), never across a runway
  // under tow the tug leads: always ahead of the nose (it once trailed the hitch like a trailer and jackknifed behind)
  await wp.run(() => { window.__tugOn = null; window.__tugBack = false; window.__lead = 1e9; });
  const home = await wp.until(() => {
    const sc = GROUND_OPS.scenes.find(x => x instanceof EmergencyScene), q = sc && (sc.phase === 'back' || sc.phase === 'fade') && sc.tug.position;
    if (sc && sc.phase === 'tow' && __a.state === 'towed') { const n = new THREE.Vector3(1, 0, 0).applyQuaternion(__a.mesh.quaternion), d = sc.tug.position.clone().sub(__a.mesh.position); __lead = Math.min(__lead, (d.x * n.x + d.z * n.z) / __a.spec.len); }
    if (q) __tugBack = true;
    if (q && [BASE_LAYOUT.rwy, BASE_LAYOUT.rwy2].some(L => Math.abs(q.z - L.z) < L.w / 2 + 1 && q.x > L.x0 - 2 && q.x < L.x1 + 2)) __tugOn = __tugOn || [q.x, q.z];
    return __a.state === 'parked' && !GROUND_OPS.scenes.length;
  }, 600);
  expect(home.violations).toEqual([]);
  expect(home.done, (await wp.run(() => __t.log.get(__a.callsign))).join(' > ')).toBe(true);
  expect(await wp.run(() => __tugOn), 'the tug on a runway on its way back').toBe(null);
  const lead = await wp.run(() => __lead);
  expect(lead, 'the tow was seen').toBeLessThan(1e9); expect(lead, 'the tug ahead of the nose all the way').toBeGreaterThan(0.45);
  expect(await wp.run(() => [__tugBack, AIRFIELD.sheltered(__a.spot)])).toEqual([!inside, inside]);
  const r = await wp.run(() => ({ log: __t.log.get(__a.callsign), emerg: !!GROUND_OPS.emerg || __a.emerg, rwy: AIRFIELD.rwy.size + AIRFIELD.rwy2.size, home: __a.mesh.position.distanceTo(new THREE.Vector3(__a.spot.x, 0, __a.spot.z)) }));
  expect(r.log.join('>')).toMatch(/approach>final>rollout>emergency>towed>parked/);
  expect(r.emerg).toBe(false);
  expect(r.rwy).toBe(0);
  expect(r.home).toBeLessThan(0.2);
  const p = await pools(wp);
  expect(p.firetruck).toBe(2); expect(p.tug).toBeGreaterThanOrEqual(1);   // the tow's tug (and the pushback's)
  expect(await wp.stuck()).toEqual([]);
});

test('unloading at a hangar: a C-130 back with cargo stops nose in its open door, the K-loader unloads it over the lane, then it rolls in', async ({ wp }) => {
  await airborne(wp, "a.spec.key === 'c130'");
  await wp.run(() => { window.__a = __f[0]; __a.cargo = true; __a.requestLand(); window.__u = { seq: [], at: null }; });
  expect(await wp.run(() => AIRFIELD.sheltered(__a.spot))).toBe(true);
  const r = await wp.until(() => {
    if (__u.seq[__u.seq.length - 1] !== __a.state) __u.seq.push(__a.state);
    const sc = GROUND_OPS.scenes.find(s => s instanceof UnloadScene && s.a === __a);
    if (sc && sc.phase === 'load' && !__u.at) {
      const s = __a.spot, q = __a.mesh.position, l = sc.loader.position;
      __u.at = { door: s.z + s.d / 2, nose: q.z - __a.spec.len / 2, tail: q.z + __a.spec.len / 2, loader: Math.hypot(l.x - sc.at[0], l.z - sc.at[1]), ramp: __a.rampT, open: s.door };
    }
    return __a.state === 'parked' && !GROUND_OPS.scenes.some(s => s instanceof UnloadScene);
  }, 900);
  expect(r.violations).toEqual([]);
  expect(r.done, JSON.stringify(await wp.run(() => __u.seq))).toBe(true);
  const u = await wp.run(() => __u);
  expect(u.seq.join('>')).toMatch(/taxi_in>unload>taxi_in>parked/);
  expect(u.at, 'the loader at its tail').not.toBeNull();
  expect(u.at.nose, 'nose in the door').toBeLessThan(u.at.door); expect(u.at.tail, 'tail out over the lane').toBeGreaterThan(u.at.door + 1);
  expect(u.at.loader).toBeLessThan(0.3); expect(u.at.ramp).toBe(1); expect(u.at.open).toBeGreaterThan(0.9);
  expect(await wp.run(() => [__a.cargo, __a.groundBusy, __a.mesh.position.distanceTo(new THREE.Vector3(__a.spot.x, 0, __a.spot.z)) < 0.2])).toEqual([false, false, true]);
  await wp.sim(15);
  expect(await wp.run(() => [__a.spot.door < 0.05, GROUND_OPS.scenes.length])).toEqual([true, 0]);
  const p = await pools(wp);
  expect(p.kloader).toBe(1); expect(p.pallet).toBe(3);
});

test('unloading: a C-17 back with cargo opens its ramp on its stand, the K-loader takes the pallets away', async ({ wp }) => {
  await airborne(wp, "a.spec.key === 'c17'");
  await wp.run(() => { window.__a = __f[0]; __a.cargo = true; __a.requestLand(); });
  const parked = await wp.until(() => __a.state === 'parked', 900);
  expect(parked.done).toBe(true);
  const on = await wp.until(() => GROUND_OPS.scenes.some(s => s.phase === 'load'), 120);
  expect(on.done, 'the loader at the ramp').toBe(true);
  expect(await wp.run(() => __a.groundBusy && __a.rampT === 1)).toBe(true);
  // it can't leave while the cargo comes off: a launch request waits
  await wp.run(() => __a.requestLaunch());
  const done = await wp.until(() => !__a.cargo && !GROUND_OPS.scenes.length, 200);
  expect(done.violations).toEqual([]);
  expect(done.done).toBe(true);
  const p = await pools(wp);
  expect(p.kloader).toBe(1); expect(p.pallet).toBe(3);
  const gone = await wp.until(() => __a.state === 'orbit', 600);
  expect(gone.done, 'then it launches as asked').toBe(true);
});

for (const cargo of [false, true]) {
  test(`paradrop (${cargo ? 'cargo' : 'troops'}): the transport crosses the screen over the drop zone, canopies come down and land`, async ({ wp }) => {
    await airborne(wp, "a.spec.key === 'c130'");
    await wp.run((cargo) => { const m = window.__m = new MISSION_TYPES.paradrop(__f, __f.length); m.cargo = cargo; m.start(); }, cargo);
    const drop = await wp.until(() => GROUND_OPS.chutes.length > 0, 300);
    expect(drop.violations).toEqual([]);
    expect(drop.done, 'parachutes out').toBe(true);
    const r = await wp.run(() => ({ dz: __m.dz && AIRWAR.onScreen(__m.dz, 0), clear: !vegBlocked(__m.dz.x, __m.dz.z) }));
    expect(r).toEqual({ dz: true, clear: true });
    const landed = await wp.until(() => GROUND_OPS.chutes.some(c => c.landed >= 0), 120);
    expect(landed.done).toBe(true);
    // a collapsed canopy lies flat on the ground about its own size (it once kept widening into a big white disc)
    await wp.run(() => { window.__can = [1e9, 0, 0]; });
    await wp.until(() => {
      for (const c of GROUND_OPS.chutes) if (c.landed > 2 && c.landed < 14) {
        const b = new THREE.Box3().setFromObject(c.can), g = groundH(c.m.position.x, c.m.position.z);
        __can[0] = Math.min(__can[0], b.min.y - g); __can[1] = Math.max(__can[1], b.max.y - g); __can[2] = Math.max(__can[2], Math.max(b.max.x - b.min.x, b.max.z - b.min.z));
      }
      return false;
    }, 15);
    const can = await wp.run(() => __can);
    expect(can[2], 'landed canopies seen').toBeGreaterThan(0.5); expect(can[0], 'on the ground, not under it').toBeGreaterThan(-0.05);
    expect(can[1], 'lying flat').toBeLessThan(0.45);
    expect(can[2], 'about its own size').toBeLessThan(cargo ? 2.6 : 1.8);
    const end = await wp.until(() => !GROUND_OPS.chutes.length && __f.every(a => !a.mission), 400);
    expect(end.violations).toEqual([]);
    expect(end.done).toBe(true);
    const p = await pools(wp);
    expect(p[cargo ? 'cargochute' : 'chute']).toBeGreaterThanOrEqual(cargo ? 3 : 8);
    expect(await wp.stuck()).toEqual([]);
  });
}

test('random emergencies come by themselves in peace and never in a fight', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { GROUND_OPS.emTimer = 60; });
  const r = await wp.until(() => [...__t.log.values()].some(l => l.includes('emergency')), 900);
  expect(r.violations).toEqual([]);
  expect(r.done, 'an emergency within 15 min').toBe(true);
  await wp.run(() => { __t.forceFight(); GROUND_OPS.emTimer = 0; window.__e0 = GROUND_OPS.emerg; });
  const f = await wp.sim(60);
  expect(f.violations).toEqual([]);
  expect(await wp.run(() => !GROUND_OPS.emerg || GROUND_OPS.emerg === __e0)).toBe(true);
});

/* the crew on its stand / pad: vehicles drive up, the aircraft is held (groundBusy), then they leave and are pooled */
async function crewVisit(wp, kinds) {
  // the vehicles come out of a shed and go back into one: small (growing / shrinking) only inside one, its door rolls up
  await wp.run(() => { window.__shed = { open: 0, out: [] }; window.__trackShed = () => {
    for (const o of GARAGE_DOORS) __shed.open = Math.max(__shed.open, o.k);
    for (const s of GROUND_OPS.scenes) if (s instanceof ServiceScene && s.a === __a) for (const c of s.crew) if (c.m && c.m.visible && c.m.scale.x < 0.95) {
      const d = Math.min(...GARAGE_DOORS.map(o => Math.hypot(c.m.position.x - o.ix, c.m.position.z - o.iz)));
      if (d > 1.3) __shed.out.push(`${c.kind} ${c.stage} scale ${c.m.scale.x.toFixed(2)} ${d.toFixed(2)} from a shed`);
    }
    return false; }; });
  const on = await wp.until(() => __trackShed() || GROUND_OPS.scenes.some(s => s instanceof ServiceScene && s.a === __a && s.phase === 'work'), 120);
  expect(on.violations).toEqual([]);
  expect(on.done, 'the crew reaches it').toBe(true);
  const r = await wp.run(() => { const s = GROUND_OPS.scenes.find(s => s instanceof ServiceScene && s.a === __a);
    return { kinds: s.crew.map(c => c.kind), busy: __a.groundBusy, near: Math.max(...s.crew.map(c => c.m.position.distanceTo(__a.mesh.position))), hose: s.hose.visible }; });
  expect(r.kinds).toEqual(kinds);
  expect(r.busy).toBe(true); expect(r.hose).toBe(true);
  expect(r.near).toBeLessThan(5);
  // the loader's load goes onto the aircraft: it drives off empty
  if (kinds.includes('ammo')) {
    const out = await wp.until(() => GROUND_OPS.scenes.some(s => s instanceof ServiceScene && s.a === __a && s.phase === 'out'), 60);
    expect(out.done).toBe(true);
    expect(await wp.run(() => GROUND_OPS.scenes.find(s => s instanceof ServiceScene && s.a === __a).items.filter(i => i.visible).length), 'items left on the loader').toBe(0);
  }
  const off = await wp.until(() => __trackShed() || !GROUND_OPS.scenes.some(s => s instanceof ServiceScene), 200);
  expect(off.violations).toEqual([]);
  expect(off.done, 'the crew is done and gone').toBe(true);
  const sh = await wp.run(() => __shed);
  expect(sh.out.slice(0, 5), 'grown in / shrunk out only inside a shed').toEqual([]);
  expect(sh.open, 'a shed door rolled up for them').toBeGreaterThan(0.9);
  expect((await wp.until(() => GARAGE_DOORS.every(o => o.k === 0), 10)).done, 'and down again').toBe(true);
  expect(await wp.run(() => __a.groundBusy)).toBe(false);
  const p = await pools(wp);
  for (const k of kinds) expect(p[k], k).toBeGreaterThanOrEqual(1);
}

test('ground crew: a fighter back on an open stand gets a fuel truck and an ammo loader, a helicopter on its pad fuel', async ({ wp }) => {
  await airborne(wp, "(a.spec.key === 'f16' && PARKING.stands.includes(a.spot)) || a.spec.key === 'uh60'");
  await wp.run(() => { window.__a = __f.find(a => a.spec.key === 'f16'); __a.requestLand(); });
  expect((await wp.until(() => __a.state === 'parked', 600)).done).toBe(true);
  await crewVisit(wp, ['fueler', 'ammo']);
  await wp.run(() => { window.__a = __f.find(a => a.spec.key === 'uh60'); __a.requestLand(); });
  expect((await wp.until(() => __a.state === 'parked', 600)).done).toBe(true);
  await crewVisit(wp, ['fueler']);
  expect(await wp.stuck()).toEqual([]);
});

test('ground crew: a hot turnaround is cut short by a launch request', async ({ wp }) => {
  await airborne(wp, "a.spec.key === 'ah64'");
  await wp.run(() => { window.__a = __f[0]; __a.requestLand(); });
  expect((await wp.until(() => __a.state === 'parked', 600)).done).toBe(true);
  expect((await wp.until(() => GROUND_OPS.scenes.some(s => s instanceof ServiceScene && s.phase === 'work'), 120)).done).toBe(true);
  await wp.run(() => __a.requestLaunch());
  const r = await wp.until(() => __a.state === 'lift', 60);
  expect(r.violations).toEqual([]);
  expect(r.done, 'off within a minute: spun up while the crew wrapped up').toBe(true);
});

for (const [name, pick] of [['an open stand', "a.spec.key === 'f16' && PARKING.stands.includes(a.spot)"], ['a shelter', "a.spec.key === 'f15' && AIRFIELD.sheltered(a.spot)"]]) {
  test(`pushback from ${name}: a tug hooks up at the nose, pushes it back, unhooks and leaves`, async ({ wp }) => {
    await wp.boot();
    await wp.run(() => { CFG.auto = false; CFG.missions = 0; CFG.flyby = 0; buildAirWing(); TANKER.timer = 1e9; GROUND_OPS.emTimer = 1e9; __t.reset(); });
    await wp.run((pick) => { window.__a = AIRCRAFT.find(new Function('a', `return ${pick}`)); __a.requestLaunch(); window.__nose = []; }, pick);
    await wp.sim(0.1);
    expect(await wp.run(() => !!__a.tug)).toBe(true);
    // pushing: the tug rides at the nose
    for (let i = 0; i < 200; i++) {
      await wp.sim(0.5);
      const s = await wp.run(() => { if (__a.state !== 'pushback') return __a.state;
        const t = __a.tug.m.position, n = __a.mesh.position.clone().addScaledVector(__a.fwd, __a.spec.len / 2 + 0.75).setY(0); __nose.push(t.distanceTo(n));
        // the bend at the towbar: the tug's heading against the aircraft's (it faces the nose: pi apart when straight)
        const ya = Math.atan2(-__a.fwd.z, __a.fwd.x) + Math.PI, yt = __a.tug.m.rotation.y; window.__bend = Math.max(window.__bend || 0, Math.abs(Math.atan2(Math.sin(yt - ya), Math.cos(yt - ya))));
        window.__bar = window.__bar || __a.tug.m.getObjectByName('bar').visible; return 'pushback'; });
      if (s === 'taxi_out' || s === 'hold_short') break;
    }
    const nose = await wp.run(() => __nose);
    expect(nose.length, 'pushed back').toBeGreaterThan(3);
    expect(Math.max(...nose), 'the tug at the nose').toBeLessThan(1.2);
    expect(await wp.run(() => [__bar, __bend > 0.08]), 'towbar out; the tug bends at it in the turn').toEqual([true, true]);
    const gone = await wp.until(() => !GROUND_OPS.scenes.length && !__a.tug && !__a.tugHold, 120);
    expect(gone.violations).toEqual([]);
    expect(gone.done, 'the tug leaves').toBe(true);
    expect((await pools(wp)).tug).toBe(1);
    expect((await wp.until(() => __a.state === 'orbit', 400)).done).toBe(true);
  });
}

test('an emergency closing the south one sends the other arrivals to the north one (no holding for minutes)', async ({ wp }) => {
  await airborne(wp, "a.spec.key === 'f15' && /\\s[12]$/.test(a.callsign)");
  await wp.run(() => { window.__a = __f[0]; window.__b = __f[1]; GROUND_OPS.startEmergency(__a); });
  expect((await wp.until(() => __a.state === 'emergency', 400)).done).toBe(true);
  expect(await wp.run(() => __a.rwyL === BASE_LAYOUT.rwy2)).toBe(true);
  await wp.run(() => __b.requestLand());
  const r = await wp.until(() => __b.state === 'rollout' || __b.state === 'taxi_in', 300);
  expect(r.violations).toEqual([]);
  expect(r.done, 'it lands while the emergency is still on').toBe(true);
  expect(await wp.run(() => [__b.rwyL === RW, !!GROUND_OPS.emerg])).toEqual([true, true]);
  const home = await wp.until(() => __a.state === 'parked' && __b.state === 'parked' && !GROUND_OPS.scenes.some(s => s instanceof EmergencyScene), 600);
  expect(home.violations).toEqual([]);
  expect(home.done).toBe(true);
});
