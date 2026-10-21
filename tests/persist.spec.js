// Session state: who is up / away and the threat level survive a reload; the setting turns it off
const { test, expect } = require('./support/harness');

async function setUp(wp) {
  await wp.boot();
  await wp.run(() => {
    CFG.auto = false; CFG.missions = 0; CFG.flyby = 0; buildAirWing(); TANKER.timer = 1e9;
    window.__up = AIRCRAFT.filter(a => a.spec.key === 'fa18' && flightOf(a) === CALLSIGNS.fa18[0]);
    window.__away = AIRCRAFT.filter(a => a.spec.key === 'f14');
    [...__up, ...__away].forEach(a => a.requestLaunch());
  });
  const up = await wp.until(() => [...__up, ...__away].every(a => a.state === 'orbit'), 900);
  expect(up.done).toBe(true);
  await wp.sim(20);
  await wp.run(() => { new MISSION_TYPES.patrol(__away, __away.length).start(); });
  await wp.sim(10);
  await wp.run(() => { STRESS.level = 0.61; });   // set last: it eases off in silence
  return wp.run(() => ({ up: __up.map(a => a.callsign).sort(), away: __away.map(a => a.callsign).sort() }));
}

test('aircraft in the air and on missions, and the threat level, come back after a reload', async ({ wp }) => {
  const want = await setUp(wp);
  const saved = await wp.run(() => { PERSIST.last = null; PERSIST.save(); return JSON.parse(localStorage.getItem(PERSIST.KEY)); });
  expect(saved.v).toBe(1);
  expect(saved.stress).toBeCloseTo(0.6, 5);
  expect(saved.air.filter(e => e.mission).map(e => e.cs).sort()).toEqual(want.away);

  await wp.reload();
  const r = await wp.run(() => ({
    orbit: AIRCRAFT.filter(a => a.state === 'orbit').map(a => a.callsign).sort(),
    away: AIRCRAFT.filter(a => a.mission).map(a => a.callsign).sort(),
    stress: STRESS.level,
    radio: RADIO.q.map(m => m.text)
  }));
  for (const cs of want.up) expect(r.orbit).toContain(cs);
  expect(r.away).toEqual(want.away);
  expect(r.stress).toBeCloseTo(0.6, 5);
  const restoreLines = await wp.run(() => LINES.restore);
  expect(r.radio.some(t => restoreLines.includes(t)), 'comms-restored radio line').toBe(true);
  // the restored mission flight comes home as usual
  const home = await wp.until(() => !AIRCRAFT.some(a => a.mission), 600);
  expect(home.violations).toEqual([]);
  expect(home.done).toBe(true);
});

test('unknown aircraft in a saved session are ignored', async ({ wp }) => {
  await wp.boot();
  // saveState off for this page only, or the save on pagehide would overwrite the planted session
  await wp.run(() => { CFG.saveState = false; localStorage.setItem(PERSIST.KEY, JSON.stringify({ v: 1, stress: 0.2, air: [
    { key: 'fa18', cs: 'NOBODY 9', host: 0, mission: false }, { key: 'zz', cs: 'X', host: 0, mission: true }, { key: 'fa18', cs: CALLSIGNS.fa18[0] + ' 1', host: 0, mission: false }] })); });
  await wp.reload();
  const r = await wp.run(() => ({ lead: AIRCRAFT.find(a => a.callsign === CALLSIGNS.fa18[0] + ' 1').state, missions: AIRCRAFT.filter(a => a.mission).length }));
  expect(r.lead).toBe('orbit');
  expect(r.missions).toBe(0);
  expect((await wp.sim(30)).violations).toEqual([]);
});

test('a corrupt saved session is ignored', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.saveState = false; localStorage.setItem(PERSIST.KEY, '{not json'); });
  await wp.reload();
  expect((await wp.sim(10)).violations).toEqual([]);
});

test('turning the setting off forgets the saved session', async ({ wp }) => {
  await setUp(wp);
  await wp.run(() => { PERSIST.last = null; PERSIST.save(); });
  expect(await wp.run(() => !!localStorage.getItem(PERSIST.KEY))).toBe(true);
  await wp.run(() => __t.props({ savestate: false }));
  expect(await wp.run(() => localStorage.getItem(PERSIST.KEY))).toBeNull();
  await wp.run(() => { PERSIST.last = null; PERSIST.save(); });
  expect(await wp.run(() => localStorage.getItem(PERSIST.KEY)), 'nothing saved while off').toBeNull();
});
