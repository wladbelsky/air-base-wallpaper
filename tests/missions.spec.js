// Missions: every type runs to the end and leaves nothing behind
const { test, expect } = require('./support/harness');

/* quiet base (no automatic ops / missions / fly-bys / tanker), `counts` overrides, then launch `keys` and wait for them */
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
/* run until the flight is home from the mission; check the end state */
async function finish(wp, { landed = false, limit = 900 } = {}) {
  const r = await wp.until(() => __f.every(a => !a.mission), limit);
  expect(r.violations).toEqual([]);
  const s = await wp.run(() => ({ states: __f.map(a => a.state), missions: __f.filter(a => a.mission).length, stuck: __t.stuck(), log: __f.map(a => __t.log.get(a.callsign).join('>')) }));
  expect(r.done, JSON.stringify(s)).toBe(true);
  expect(s.missions).toBe(0);
  if (!landed) { const after = await wp.until(() => __f.every(a => a.state === 'orbit'), 120); expect(after.done, JSON.stringify(s)).toBe(true); }
  expect(s.stuck).toEqual([]);
  return s;
}

test('patrol mission: a four-ship flight goes out and returns to its orbit', async ({ wp }) => {
  await airborne(wp, {}, "a.spec.key === 'f16'");
  const s0 = await start(wp, 'patrol');
  expect(s0.states.every(x => x === 'mission_out')).toBe(true);
  const s = await finish(wp);
  for (const log of s.log) expect(log).toMatch(/mission_out>mission>mission_back/);
});

for (const key of ['c130', 'c17']) {
  test(`airlift mission: the ${key} flies its run and lands afterwards`, async ({ wp }) => {
    await airborne(wp, {}, `a.spec.key === '${key}'`);
    await start(wp, 'airlift');
    const s = await finish(wp, { landed: true });
    const home = await wp.until(() => __f.every(a => a.state === 'parked'), 900);
    expect(home.done, s.log.join(' | ')).toBe(true);
  });
}

test('pickMission: transports only airlift, tankers nothing, the rest patrol', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => Object.fromEntries(['f15', 'c130', 'c17', 'kc46', 'kc130', 'ac130', 'mq9', 'uh60', 'ah64', 'e3'].map(k => {
    const a = AIRCRAFT.find(x => x.spec.key === k), got = new Set(); for (let i = 0; i < 40; i++) { const M = pickMission(a); got.add(M ? M.key : null); }
    return [k, [...got].sort()];
  })));
  expect(r).toEqual({ f15: ['patrol'], c130: ['airlift'], c17: ['airlift'], kc46: [null], kc130: [null], ac130: ['patrol'], mq9: ['patrol'], uh60: ['patrol'], ah64: ['patrol'], e3: ['patrol'] });
});

test('dispatchFlight never sends out the last flight on station, and only in peace', async ({ wp }) => {
  await airborne(wp, {}, "a.spec.key === 'f16' && /MAGE/.test(a.callsign)");
  await wp.run(() => { for (let i = 0; i < 20; i++) dispatchFlight(); });
  expect(await wp.run(() => AIRCRAFT.filter(a => a.mission).length), 'only one flight up: it stays').toBe(0);
  // a second flight up: one of them may go, never both
  await wp.run(() => { const f = AIRCRAFT.filter(a => a.spec.key === 'f22'); f.forEach(a => a.requestLaunch()); window.__f2 = f; });
  const up = await wp.until(() => __f2.every(a => a.state === 'orbit'), 600);
  expect(up.done).toBe(true);
  await wp.sim(15);
  // in combat the mission timer sends nobody, however often missions are set to happen
  await wp.run(() => { CFG.missions = 10; __t.forceFight(); });
  const fight = await wp.sim(120);
  expect(fight.violations).toEqual([]);
  expect(await wp.run(() => AIRCRAFT.filter(a => a.mission).length), 'no missions in combat').toBe(0);
  await wp.run(() => { CFG.missions = 0; __t.fightOff(); });
  const calm = await wp.until(() => !AUD.armed && AIRCRAFT.filter(a => a.spec.armed && a.state !== 'parked').every(a => a.state === 'orbit'), 600);
  expect(calm.done).toBe(true);
  await wp.sim(20);   // back on station long enough (airT > 15) to be sent
  await wp.run(() => { for (let i = 0; i < 20; i++) dispatchFlight(); });
  const r = await wp.run(() => ({ away: [...new Set(AIRCRAFT.filter(a => a.mission).map(flightOf))], up: [...new Set(AIRCRAFT.filter(a => a.airborne).map(flightOf))] }));
  // something went, and something (a whole flight, or the pair of a four-ship left behind) is still on station
  expect(r.away.length).toBeGreaterThanOrEqual(1);
  expect(r.up.length, JSON.stringify(r)).toBeGreaterThanOrEqual(1);
});
