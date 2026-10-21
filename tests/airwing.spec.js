// Changing the air wing at runtime: new aircraft join at a free home, extras retire after landing, nobody is reset;
// the stand markings follow (the helicopter pads are all drawn, always)
const { test, expect } = require('./support/harness');

test.beforeEach(async ({ wp }) => {
  await wp.boot();
  await wp.sim(90);   // past the start-up rebuild window, a few flights up
});

test('raising a count adds parked aircraft at free homes without touching those in the air', async ({ wp }) => {
  const before = await wp.run(() => Object.fromEntries(AIRCRAFT.map(a => [a.callsign, a.state])));
  await wp.run(() => __t.props({ f15count: 6, uh60count: 4 }));
  await wp.sim(0.1);
  const r = await wp.run(() => ({
    now: Object.fromEntries(AIRCRAFT.map(a => [a.callsign, a.state])),
    f15: AIRCRAFT.filter(a => a.spec.key === 'f15').map(a => a.callsign).sort(), want: callsignsFor('f15', 6).sort(),
    uh60: AIRCRAFT.filter(a => a.spec.key === 'uh60').length, rows: document.querySelectorAll('#list .row').length, total: AIRCRAFT.length,
    pads: AIRFIELD.marks.pad.count, helis: AIRCRAFT.filter(a => a instanceof Helicopter).length, homes: new Set(AIRCRAFT.map(a => a.spot)).size
  }));
  expect(r.f15).toEqual(r.want);
  expect(r.uh60).toBe(4);
  expect(r.pads, 'all the helicopter pads, always').toBe(12);
  expect(r.homes, 'every aircraft has a home of its own').toBe(r.total);
  expect(r.rows).toBe(r.total);
  for (const [k, s] of Object.entries(before)) {
    const now = r.now[k];
    if (['orbit', 'climb', 'depart', 'mission', 'cbt_wait'].includes(s)) expect(now, `${k} kept flying`).not.toBe('parked');
  }
  for (const k of Object.keys(r.now)) if (!(k in before)) expect(r.now[k], `${k} joins parked`).toBe('parked');
  expect((await wp.sim(300)).violations).toEqual([]);
});

test('lowering a count retires the extras: they land first, then leave (and are disposed)', async ({ wp }) => {
  await wp.run(() => __t.geometries());   // remember the geometries of the aircraft about to retire
  await wp.run(() => __t.props({ f15count: 1, uh60count: 0 }));
  await wp.sim(0.1);
  const mid = await wp.run(() => ({ retiring: AIRCRAFT.filter(a => a.retiring).map(a => [a.callsign, a.state]), rows: [...document.querySelectorAll('#list .row .st')].map(e => e.textContent) }));
  const r = await wp.until(() => !AIRCRAFT.some(a => a.retiring), 1200);
  expect(r.violations).toEqual([]);
  expect(r.done, JSON.stringify(mid.retiring)).toBe(true);
  const after = await wp.run(() => ({ f15: AIRCRAFT.filter(a => a.spec.key === 'f15').map(a => a.callsign), want: callsignsFor('f15', 1), uh60: AIRCRAFT.filter(a => a.spec.key === 'uh60').length, rows: document.querySelectorAll('#list .row').length, total: AIRCRAFT.length,
    pads: AIRFIELD.marks.pad.count, helis: AIRCRAFT.filter(a => a instanceof Helicopter).length }));
  expect(after.f15).toEqual(after.want);
  expect(after.uh60).toBe(0);
  expect(after.pads).toBe(12);
  expect(after.rows).toBe(after.total);
  expect((await wp.sim(120)).violations).toEqual([]);
  const geo = await wp.run(() => __t.geometries());
  expect(geo.leaked, `geometries of retired aircraft not disposed: ${geo.leakedTypes}`).toBe(0);
});

test('stand markings appear for every aircraft parked outside a shelter / hangar, and go with it', async ({ wp }) => {
  const count = () => wp.run(() => ({ marks: AIRFIELD.marks.stand.count, used: [...PARKING.stands, ...PARKING.remote].filter(s => s.occ).length,
    open: AIRCRAFT.filter(a => !AIRFIELD.sheltered(a.spot) && !(a instanceof Helicopter)).length }));
  const a = await count();
  expect(a.marks).toBe(a.used);
  expect(a.marks).toBe(a.open);
  await wp.run(() => __t.props({ f16count: 6, f22count: 4 }));
  await wp.sim(0.1);
  const b = await count();
  expect(b.marks).toBe(b.open);
  expect(b.marks).toBeGreaterThan(a.marks);
  await wp.run(() => __t.props({ f16count: 0, f22count: 0, a10count: 0 }));
  const r = await wp.until(() => !AIRCRAFT.some(a => a.retiring), 1500);
  expect(r.violations).toEqual([]);
  expect(r.done).toBe(true);
  const c = await count();
  expect(c.marks).toBe(c.open);
  expect(c.marks).toBeLessThan(a.marks);
});

test('a rebuild within the start-up window rebuilds the whole air wing', async ({ wp }) => {
  await wp.boot();          // fresh page: T < 3
  await wp.run(() => __t.props({ f35count: 4 }));
  await wp.sim(0.1);
  expect(await wp.run(() => AIRCRAFT.filter(a => a.spec.key === 'f35').length)).toBe(4);
  expect((await wp.sim(60)).violations).toEqual([]);
});
