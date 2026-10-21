// Changing the air wing at runtime: new aircraft join in the hangar, extras retire after landing, nobody is reset
const { test, expect } = require('./support/harness');

test.beforeEach(async ({ wp }) => {
  await wp.boot();
  await wp.sim(90);   // past the start-up rebuild window, a few flights up
});

test('raising a count adds aircraft in the hangar without touching those in the air', async ({ wp }) => {
  const before = await wp.run(() => Object.fromEntries(AIRCRAFT.map(a => [a.callsign + '@' + SHIPS.indexOf(a.host), a.state])));
  await wp.run(() => __t.props({ fa18count: 8, ch53count: 2 }));
  await wp.sim(0.1);
  const r = await wp.run(() => ({
    now: Object.fromEntries(AIRCRAFT.map(a => [a.callsign + '@' + SHIPS.indexOf(a.host), a.state])),
    fa18: AIRCRAFT.filter(a => a.spec.key === 'fa18').map(a => a.callsign).sort(), want: callsignsFor('fa18', 8).sort(),
    ch53: AIRCRAFT.filter(a => a.spec.key === 'ch53').length, rows: document.querySelectorAll('#list .row').length, total: AIRCRAFT.length
  }));
  expect(r.fa18).toEqual(r.want);
  expect(r.ch53).toBe(2);
  expect(r.rows).toBe(r.total);
  for (const [k, s] of Object.entries(before)) {
    const now = r.now[k];
    if (['orbit', 'climb', 'depart', 'mission', 'cbt_wait'].includes(s)) expect(now, `${k} kept flying`).not.toMatch(/^(hangar|parked)$/);
  }
  for (const k of Object.keys(r.now)) if (!(k in before)) expect(r.now[k], `${k} joins in the hangar`).toBe('hangar');
  expect((await wp.sim(300)).violations).toEqual([]);
});

test('lowering a count retires the extras: they land first, then leave (and are disposed)', async ({ wp }) => {
  await wp.run(() => __t.geometries());   // remember the geometries of the aircraft about to retire
  await wp.run(() => __t.props({ fa18count: 1, mh60count: 0 }));
  await wp.sim(0.1);
  const mid = await wp.run(() => ({ retiring: AIRCRAFT.filter(a => a.retiring).map(a => [a.callsign, a.state]), rows: [...document.querySelectorAll('#list .row .st')].map(e => e.textContent) }));
  const r = await wp.until(() => !AIRCRAFT.some(a => a.retiring), 1200);
  expect(r.violations).toEqual([]);
  expect(r.done, JSON.stringify(mid.retiring)).toBe(true);
  const after = await wp.run(() => ({ fa18: AIRCRAFT.filter(a => a.spec.key === 'fa18').map(a => a.callsign), want: callsignsFor('fa18', 1), mh60: AIRCRAFT.filter(a => a.spec.key === 'mh60' && a.host === CARRIER).length, rows: document.querySelectorAll('#list .row').length, total: AIRCRAFT.length }));
  expect(after.fa18).toEqual(after.want);
  expect(after.mh60).toBe(0);
  expect(after.rows).toBe(after.total);
  expect((await wp.sim(120)).violations).toEqual([]);
  const geo = await wp.run(() => __t.geometries());
  expect(geo.leaked, `geometries of retired aircraft not disposed: ${geo.leakedTypes}`).toBe(0);
});

test('the destroyer helicopters can be switched off and on', async ({ wp }) => {
  await wp.run(() => __t.props({ ddhelis: false }));
  const off = await wp.until(() => !AIRCRAFT.some(a => a.host !== CARRIER), 900);
  expect(off.violations).toEqual([]);
  expect(off.done).toBe(true);
  await wp.run(() => __t.props({ ddhelis: true }));
  await wp.sim(0.1);
  expect(await wp.run(() => AIRCRAFT.filter(a => a.host !== CARRIER).map(a => a.callsign))).toEqual(['SEAHORSE', 'PETREL']);
});

test('a rebuild within the start-up window rebuilds the whole air wing', async ({ wp }) => {
  await wp.boot();          // fresh page: T < 3
  await wp.run(() => __t.props({ f35count: 4 }));
  await wp.sim(0.1);
  expect(await wp.run(() => AIRCRAFT.filter(a => a.spec.key === 'f35').length)).toBe(4);
  expect((await wp.sim(60)).violations).toEqual([]);
});
