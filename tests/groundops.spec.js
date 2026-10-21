// Scenes on the ground and over the field: an emergency landing (crash tenders, tug), unloading a transport on its
// stand, a paradrop over the drop zone — each runs to the end, frees the runway and returns its pooled vehicles
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

test('emergency landing: smoke, priority approach, stop on the runway, crash tenders, tow home, runway open again', async ({ wp }) => {
  await airborne(wp, "a.spec.key === 'f15' && /\\s1$/.test(a.callsign)");
  await wp.run(() => { window.__a = __f[0]; GROUND_OPS.startEmergency(__a); });
  const stop = await wp.until(() => __a.state === 'emergency', 400);
  expect(stop.violations).toEqual([]);
  expect(stop.done, (await wp.run(() => __t.log.get(__a.callsign))).join(' > ')).toBe(true);
  // the runway is closed: nobody lines up while it is there
  expect(await wp.run(() => AIRFIELD.rwy.has(__a) && !AIRFIELD.canLineUp({}))).toBe(true);
  const trucks = await wp.until(() => GROUND_OPS.scenes.some(s => s.phase === 'foam'), 120);
  expect(trucks.done, 'the crash tenders reach it and foam it').toBe(true);
  const home = await wp.until(() => __a.state === 'parked' && !GROUND_OPS.scenes.length, 600);
  expect(home.violations).toEqual([]);
  expect(home.done, (await wp.run(() => __t.log.get(__a.callsign))).join(' > ')).toBe(true);
  const r = await wp.run(() => ({ log: __t.log.get(__a.callsign), emerg: !!GROUND_OPS.emerg || __a.emerg, rwy: AIRFIELD.rwy.size, home: __a.mesh.position.distanceTo(new THREE.Vector3(__a.spot.x, 0, __a.spot.z)) }));
  expect(r.log.join('>')).toMatch(/approach>final>rollout>emergency>towed>parked/);
  expect(r.emerg).toBe(false);
  expect(r.rwy).toBe(0);
  expect(r.home).toBeLessThan(0.2);
  const p = await pools(wp);
  expect(p.firetruck).toBe(2); expect(p.tug).toBe(1);
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
