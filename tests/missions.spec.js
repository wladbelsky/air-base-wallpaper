// Missions: every type (and every variant of the on-screen scenes) runs to the end and leaves nothing behind
const { test, expect } = require('./support/harness');

/* quiet deck (no automatic ops / missions / fly-bys / tanker), `counts` overrides, then launch `keys` and wait for them */
async function airborne(wp, counts, pick) {
  await wp.boot();
  await wp.run((counts) => { CFG.auto = false; CFG.missions = 0; CFG.flyby = 0; Object.assign(CFG.counts, counts); buildAirWing(); TANKER.timer = 1e9; __t.reset(); }, counts);
  await wp.run((pick) => { window.__f = AIRCRAFT.filter(new Function('a', `return ${pick}`)); __f.forEach(a => a.requestLaunch()); }, pick);
  const up = await wp.until(() => __f.every(a => a.state === 'orbit'), 600);
  expect(up.violations).toEqual([]);
  expect(up.done, JSON.stringify(await wp.states())).toBe(true);
  await wp.sim(15);
}
/* start mission `key` for the launched flight; `setup(m)` (source text) runs before start() to pick a variant */
async function start(wp, key, setup = '') {
  return wp.run(([key, setup]) => {
    const m = window.__m = new MISSION_TYPES[key](__f, __f.length);
    if (setup) new Function('m', setup)(m);
    m.start();
    return { key, lead: m.lead.callsign, states: __f.map(a => a.state) };
  }, [key, setup]);
}
/* run until the flight is home from the mission and the scene objects are gone; check the end state */
async function finish(wp, { landed = false, limit = 900 } = {}) {
  const r = await wp.until(() => __f.every(a => !a.mission) && VESSELS.list.length === 0 && ROPES.items.every(i => !i.on), limit);
  expect(r.violations).toEqual([]);
  const s = await wp.run(() => ({
    states: __f.map(a => a.state), missions: __f.filter(a => a.mission).length, vessels: VESSELS.list.length,
    ropes: ROPES.items.filter(i => i.on).length, cargo: CARGO.items.filter(i => i.mode !== 'off').length,
    lifts: CARRIER.lifts.map(L => [!!L.busy, Math.abs(L.y - L.top) < 1e-3]), stuck: __t.stuck(), log: __f.map(a => __t.log.get(a.callsign + '@' + SHIPS.indexOf(a.host)).join('>'))
  }));
  expect(r.done, JSON.stringify(s)).toBe(true);
  expect(s.missions).toBe(0);
  if (!landed) { const after = await wp.until(() => __f.every(a => a.state === 'orbit'), 120); expect(after.done, JSON.stringify(s)).toBe(true); }
  expect(s.vessels).toBe(0); expect(s.ropes).toBe(0); expect(s.cargo).toBe(0);
  expect(s.stuck).toEqual([]);
  // the lifts are free and up again
  const lifts = await wp.until(() => CARRIER.lifts.every(L => !L.busy && Math.abs(L.y - L.top) < 1e-3), 60);
  expect(lifts.done, JSON.stringify(s.lifts)).toBe(true);
  return s;
}

test('patrol mission: a four-ship flight goes out and returns to its orbit', async ({ wp }) => {
  await airborne(wp, {}, "a.spec.key === 'fa18'");
  const s0 = await start(wp, 'patrol');
  expect(s0.states.every(x => x === 'mission_out')).toBe(true);
  const s = await finish(wp);
  for (const log of s.log) expect(log).toMatch(/mission_out>mission>mission_back/);
});

test('COD mission: the CMV-22B flies its run and lands afterwards', async ({ wp }) => {
  await airborne(wp, {}, "a.spec.key === 'cmv22'");
  await start(wp, 'cod');
  const s = await finish(wp, { landed: true });
  const home = await wp.until(() => __f.every(a => a.state === 'parked' || a.state === 'hangar'), 600);
  expect(home.done, s.log.join(' | ')).toBe(true);
});

for (const dir of ['out', 'in']) {
  test(`sling-load mission (${dir}): the container moves through elevator one`, async ({ wp }) => {
    await airborne(wp, {}, "a.spec.key === 'ch53'");
    await start(wp, 'sling', `m.dir = '${dir}';`);
    // the container is used: out = it comes up on the lift and leaves on the line; in = it is brought back and set down
    const used = await wp.until(() => CARGO.items.some(i => i.mode === 'heli'), 600);
    expect(used.done, 'a container hangs under the helicopter at some point').toBe(true);
    const s = await finish(wp, { limit: 1200 });
    expect(s.log[0]).toMatch(dir === 'out' ? /sling_to>sling_hook>mission_out/ : /mission_back>sling_drop>mission_back/);
  });
}

for (const kind of ['feeder', 'trawler', 'corvette', 'destroyer']) for (const damaged of [true, false]) {
  test(`ship mission: ${damaged ? 'rescue from a damaged' : 'inspection of an intact'} ${kind}`, async ({ wp }) => {
    await airborne(wp, { mh60: 2 }, "a.spec.key === 'mh60' && a.host === CARRIER");
    await start(wp, 'ship', `
      const i = VESSELS.list.indexOf(m.vessel); scene.remove(m.vessel.g); VESSELS.list.splice(i, 1);
      m.dir = ${damaged} ? 'rescue' : 'inspect'; m.vessel = VESSELS.spawn(VESSEL_KINDS['${kind}'], ${damaged}, FIG_RESCUE);`);
    // the lead reaches the scene and works the rope; the wingman flies overwatch
    const on = await wp.until(() => __f[0].state === 'ship_hover' && ROPES.items.some(i => i.on), 400);
    expect(on.done, 'rope out over the scene').toBe(true);
    const s = await finish(wp, { limit: 1200 });
    expect(s.log[0]).toMatch(/ship_out>ship_hover>mission_back/);
    expect(s.log[1]).toMatch(/ship_out>ship_watch>mission_back/);
  });
}

for (const [side, known] of [['friendly', true], ['enemy', true], ['enemy', false], ['friendly', false]]) {
  test(`pilot rescue: ${known ? '' : 'unidentified, then '}${side} pilot`, async ({ wp }) => {
    await airborne(wp, { mh60: 2 }, "a.spec.key === 'mh60' && a.host === CARRIER");
    await start(wp, 'pilot', `
      const i = VESSELS.list.indexOf(m.vessel); scene.remove(m.vessel.g); VESSELS.list.splice(i, 1);
      m.side = '${side}'; m.known = ${known};
      m.vessel = VESSELS.spawn(Object.values(WRECK_KINDS).find(k => k.side === '${side}'), true, PILOT_SUIT['${side}']);`);
    const on = await wp.until(() => __f[0].state === 'ship_hover', 400);
    expect(on.done).toBe(true);
    const s = await finish(wp, { limit: 1200 });
    const done = await wp.run(() => __m.done);
    expect(done, 'the done text is set (revealed on arrival when unknown)').toBeTruthy();
    expect(s.log[0]).toMatch(/ship_out>ship_hover>mission_back/);
  });
}

test('dispatchFlight never sends out the last flight on station, and only in peace', async ({ wp }) => {
  await airborne(wp, {}, "a.spec.key === 'fa18' && /JOKER/.test(a.callsign)");
  await wp.run(() => { for (let i = 0; i < 20; i++) dispatchFlight(); });
  expect(await wp.run(() => AIRCRAFT.filter(a => a.mission).length), 'only one flight up: it stays').toBe(0);
  // a second flight up: one of them may go, never both
  await wp.run(() => { const f = AIRCRAFT.filter(a => a.spec.key === 'f14'); f.forEach(a => a.requestLaunch()); window.__f2 = f; });
  const up = await wp.until(() => __f2.every(a => a.state === 'orbit'), 600);
  expect(up.done).toBe(true);
  await wp.sim(15);
  // in combat the mission timer sends nobody, however often missions are set to happen
  await wp.run(() => { CFG.missions = 10; __t.forceFight(); });
  const fight = await wp.sim(120);
  expect(fight.violations).toEqual([]);
  expect(await wp.run(() => AIRCRAFT.filter(a => a.mission).length), 'no missions in combat').toBe(0);
  await wp.run(() => { CFG.missions = 0; __t.fightOff(); });
  const calm = await wp.until(() => !AUD.armed && AIRCRAFT.filter(a => a.spec.armed && a.host === CARRIER && !/hangar|parked/.test(a.state)).every(a => a.state === 'orbit'), 600);
  expect(calm.done).toBe(true);
  await wp.sim(20);   // back on station long enough (airT > 15) to be sent
  await wp.run(() => { for (let i = 0; i < 20; i++) dispatchFlight(); });
  const r = await wp.run(() => ({ away: [...new Set(AIRCRAFT.filter(a => a.mission).map(flightOf))], up: [...new Set(AIRCRAFT.filter(a => a.airborne).map(flightOf))] }));
  // something went, and something (a whole flight, or the pair of a four-ship left behind) is still on station
  expect(r.away.length).toBeGreaterThanOrEqual(1);
  expect(r.up.length, JSON.stringify(r)).toBeGreaterThanOrEqual(1);
});
