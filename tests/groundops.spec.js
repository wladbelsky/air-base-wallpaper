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

// an F-15 (a shelter: the tug stays in it) with two runways; one for an open stand with one runway (the tug drives off)
for (const [name, pick, runways] of [['', "a.spec.key === 'f15' && /\\s1$/.test(a.callsign)", 2],
  [', open stand, one runway', "a === AIRCRAFT.find(b => b instanceof FixedWing && !AIRFIELD.sheltered(b.spot))", 1]])
test('emergency landing: smoke, priority approach, stop on the runway, crash tenders, tow home, runway open again' + name, async ({ wp }) => {
  await airborne(wp, pick);
  await wp.run((n) => { CFG.runways = n; window.__a = __f[0]; GROUND_OPS.startEmergency(__a); }, runways);
  const stop = await wp.until(() => __a.state === 'emergency', 400);
  expect(stop.violations).toEqual([]);
  expect(stop.done, (await wp.run(() => __t.log.get(__a.callsign))).join(' > ')).toBe(true);
  // its runway is closed (the south one with two runways: the north one keeps taking departures)
  expect(await wp.run(() => [AIRFIELD.setOf(__a.rwyL).has(__a), AIRFIELD.canLineUp({}) === (__a.rwyL === BASE_LAYOUT.rwy2)])).toEqual([true, true]);
  const trucks = await wp.until(() => GROUND_OPS.scenes.some(s => s.phase === 'foam'), 120);
  expect(trucks.done, 'the crash tenders reach it and foam it').toBe(true);
  // the tug goes home round the wingtip to a depot (or stays in the shelter), never across a runway
  await wp.run(() => { window.__tugOn = null; window.__tugBack = false; });
  const home = await wp.until(() => {
    const sc = GROUND_OPS.scenes.find(x => x instanceof EmergencyScene), q = sc && (sc.phase === 'back' || sc.phase === 'fade') && sc.tug.position;
    if (q) __tugBack = true;
    if (q && [BASE_LAYOUT.rwy, BASE_LAYOUT.rwy2].some(L => Math.abs(q.z - L.z) < L.w / 2 + 1 && q.x > L.x0 - 2 && q.x < L.x1 + 2)) __tugOn = __tugOn || [q.x, q.z];
    return __a.state === 'parked' && !GROUND_OPS.scenes.length;
  }, 600);
  expect(home.violations).toEqual([]);
  expect(home.done, (await wp.run(() => __t.log.get(__a.callsign))).join(' > ')).toBe(true);
  expect(await wp.run(() => __tugOn), 'the tug on a runway on its way back').toBe(null);
  expect(await wp.run(() => [__tugBack, AIRFIELD.sheltered(__a.spot)])).toEqual([runways === 1, runways !== 1]);
  const r = await wp.run(() => ({ log: __t.log.get(__a.callsign), emerg: !!GROUND_OPS.emerg || __a.emerg, rwy: AIRFIELD.rwy.size + AIRFIELD.rwy2.size, home: __a.mesh.position.distanceTo(new THREE.Vector3(__a.spot.x, 0, __a.spot.z)) }));
  expect(r.log.join('>')).toMatch(/approach>final>rollout>emergency>towed>parked/);
  expect(r.emerg).toBe(false);
  expect(r.rwy).toBe(0);
  expect(r.home).toBeLessThan(0.2);
  const p = await pools(wp);
  expect(p.firetruck).toBe(2); expect(p.tug).toBeGreaterThanOrEqual(1);   // the tow's tug (and the pushback's)
  expect(await wp.stuck()).toEqual([]);
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
  const on = await wp.until(() => GROUND_OPS.scenes.some(s => s instanceof ServiceScene && s.a === __a && s.phase === 'work'), 120);
  expect(on.violations).toEqual([]);
  expect(on.done, 'the crew reaches it').toBe(true);
  const r = await wp.run(() => { const s = GROUND_OPS.scenes.find(s => s instanceof ServiceScene && s.a === __a);
    return { kinds: s.crew.map(c => c.kind), busy: __a.groundBusy, near: Math.max(...s.crew.map(c => c.m.position.distanceTo(__a.mesh.position))), hose: s.hose.visible }; });
  expect(r.kinds).toEqual(kinds);
  expect(r.busy).toBe(true); expect(r.hose).toBe(true);
  expect(r.near).toBeLessThan(5);
  const off = await wp.until(() => !GROUND_OPS.scenes.some(s => s instanceof ServiceScene), 200);
  expect(off.violations).toEqual([]);
  expect(off.done, 'the crew is done and gone').toBe(true);
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
        const t = __a.tug.m.position, n = __a.mesh.position.clone().addScaledVector(__a.fwd, __a.spec.len / 2 + 0.75).setY(0); __nose.push(t.distanceTo(n)); return 'pushback'; });
      if (s === 'taxi_out' || s === 'hold_short') break;
    }
    const nose = await wp.run(() => __nose);
    expect(nose.length, 'pushed back').toBeGreaterThan(3);
    expect(Math.max(...nose), 'the tug at the nose').toBeLessThan(1.2);
    const gone = await wp.until(() => !GROUND_OPS.scenes.length && !__a.tug && !__a.tugHold, 120);
    expect(gone.violations).toEqual([]);
    expect(gone.done, 'the tug leaves').toBe(true);
    expect((await pools(wp)).tug).toBe(1);
    expect((await wp.until(() => __a.state === 'orbit', 400)).done).toBe(true);
  });
}
