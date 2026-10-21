// Start-up: the page boots cleanly in Wallpaper Engine mode and in a plain browser, with the default air wing
const { test, expect } = require('./support/harness');

test('boots in Wallpaper Engine mode with WebGL and the default air wing', async ({ wp }) => {
  await wp.boot();
  const info = await wp.run(() => ({
    webgl: !!renderer.getContext(),
    counts: Object.fromEntries(Object.keys(AIRCRAFT_TYPES).map(k => [k, AIRCRAFT.filter(a => a.spec.key === k && a.host === CARRIER).length])),
    cfg: CFG.counts,
    ddHelis: AIRCRAFT.filter(a => a.host !== CARRIER).map(a => a.callsign),
    rows: document.querySelectorAll('#list .row').length,
    total: AIRCRAFT.length,
    names: Object.fromEntries(Object.keys(AIRCRAFT_TYPES).map(k => [k, AIRCRAFT.filter(a => a.spec.key === k && a.host === CARRIER).map(a => a.callsign).sort()])),
    expected: Object.fromEntries(Object.keys(AIRCRAFT_TYPES).map(k => [k, callsignsFor(k, CFG.counts[k]).sort()]))
  }));
  expect(info.webgl).toBe(true);
  expect(info.counts).toEqual(info.cfg);
  expect(info.names).toEqual(info.expected);
  expect(info.ddHelis).toEqual(['SEAHORSE', 'PETREL']);
  expect(info.rows).toBe(info.total);
});

test('every aircraft type has a count property in project.json and CFG', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => ({ types: Object.keys(AIRCRAFT_TYPES), props: Object.keys(WE_PROPERTIES), counts: Object.keys(CFG.counts) }));
  for (const k of r.types) {
    expect(r.props, `${k}count property`).toContain(k + 'count');
    expect(r.counts).toContain(k);
  }
});

test('the splash screen hides after the start-up window', async ({ wp }) => {
  await wp.boot({ splash: true });
  expect(await wp.run(() => document.getElementById('splash').classList.contains('off'))).toBe(false);
  await wp.sim(3.5);
  expect(await wp.run(() => { const s = document.getElementById('splash'); return !s || s.classList.contains('off'); })).toBe(true);
});

test('boots in a normal browser with the settings drawer and stays clean for a minute', async ({ wp }) => {
  await wp.boot({ we: false });
  const r = await wp.run(() => ({ demo: AUD.demo, buttons: document.querySelectorAll('button').length }));
  expect(r.demo).toBe(true);
  expect(r.buttons, 'the settings drawer adds its controls').toBeGreaterThan(5);
  const res = await wp.sim(60);
  expect(res.violations).toEqual([]);
});
