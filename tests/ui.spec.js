// Control panel and radio subtitles
const { test, expect } = require('./support/harness');

test.describe('aircraft list that does not fit (1280x720)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('is paged: the pager appears, ◀ ▶ and type chips switch pages, the panel keeps its height', async ({ wp, page }) => {
    await wp.boot();
    await wp.sim(1);
    const st = () => wp.run(() => ({ hidden: document.getElementById('pager').hidden, info: document.getElementById('pgInfo').textContent,
      shown: PAGER.rows.filter(r => r.style.display !== 'none').length, rows: PAGER.rows.length, size: PAGER.size,
      h: document.getElementById('panel').offsetHeight, on: [...document.querySelectorAll('#pgTypes .chip.on')].map(c => c.textContent) }));
    const a = await st();
    expect(a.hidden).toBe(false);
    const pages = Math.ceil(a.rows / a.size);
    expect(a.info).toBe(`1/${pages}`);
    expect(a.shown).toBe(a.size);
    const heights = [a.h];
    for (let i = 1; i <= pages; i++) {
      await page.click('#pgNext');
      const s = await st(); heights.push(s.h);
      expect(s.info).toBe(`${(i % pages) + 1}/${pages}`);
    }
    expect(new Set(heights).size, `panel height per page ${heights}`).toBe(1);
    await page.click('#pgPrev');
    expect((await st()).info).toBe(`${pages}/${pages}`);
    // a chip jumps to the page of its type and is highlighted
    const chips = await page.locator('#pgTypes .chip').allTextContents();
    expect(chips).toEqual(expect.arrayContaining(['F/A-18', 'MH-60', 'CMV-22B']));
    await page.locator('#pgTypes .chip', { hasText: 'CMV-22B' }).click();
    const c = await st();
    expect(c.on).toContain('CMV-22B');
    expect(await wp.run(() => PAGER.rows.some(r => r.style.display !== 'none' && r.querySelector('.tp').textContent === 'CMV-22B'))).toBe(true);
  });
});

test.describe('aircraft list that fits (1280x1080)', () => {
  test.use({ viewport: { width: 1280, height: 1080 } });
  test('shows every row and no pager', async ({ wp }) => {
    await wp.boot();
    await wp.sim(1);
    const r = await wp.run(() => ({ hidden: document.getElementById('pager').hidden, shown: PAGER.rows.filter(r => r.style.display !== 'none').length, rows: PAGER.rows.length, minH: document.getElementById('list').style.minHeight }));
    expect(r).toEqual({ hidden: true, shown: r.rows, rows: r.rows, minH: '' });
  });
});

test('collapse, per-row LAUNCH / RECOVER buttons and the counters', async ({ wp, page }) => {
  await wp.boot();
  await wp.run(() => { CFG.auto = false; buildAirWing(); });
  await wp.sim(1);
  await page.click('#collapse');
  expect(await wp.run(() => document.getElementById('panel').classList.contains('collapsed'))).toBe(true);
  await page.click('#collapse');
  expect(await wp.run(() => document.getElementById('panel').classList.contains('collapsed'))).toBe(false);
  // the first visible row's button launches that aircraft; once it is up the button recovers it
  const cs = await wp.run(() => { const r = PAGER.rows.find(r => r.style.display !== 'none'); return r.querySelector('.nm').textContent; });
  const btn = page.locator('#list .row', { hasText: cs }).locator('button.act');
  expect(await btn.textContent()).toBe('LAUNCH');
  await btn.click();
  const up = await wp.until(new Function(`return AIRCRAFT.find(a => a.callsign === ${JSON.stringify(cs)}).state === 'orbit'`), 600);
  expect(up.done).toBe(true);
  await wp.sim(0.5);
  expect(await btn.textContent()).toBe('RECOVER');
  expect(await page.textContent('#count')).toMatch(/^1\/\d+$/);
  await btn.click();
  const down = await wp.until(new Function(`return /parked|hangar/.test(AIRCRAFT.find(a => a.callsign === ${JSON.stringify(cs)}).state)`), 600);
  expect(down.done).toBe(true);
});

test('radio subtitles show up, and the setting turns them off', async ({ wp }) => {
  await wp.boot();
  let shown = 0;
  for (let i = 0; i < 20; i++) { await wp.sim(2); if (await wp.run(() => document.getElementById('subs').classList.contains('on') && !!document.querySelector('#subs .txt').textContent)) shown++; }
  expect(shown).toBeGreaterThan(0);
  await wp.run(() => __t.props({ subtitles: false }));
  for (let i = 0; i < 20; i++) {
    await wp.sim(2);
    expect(await wp.run(() => document.getElementById('subs').classList.contains('on') || RADIO.q.length > 0)).toBe(false);
  }
});

test('panel position, size and visibility follow the properties', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    const p = document.getElementById('panel'), out = {};
    __t.props({ panelposition: 'tl' }); out.tl = p.className;
    __t.props({ panelscale: 150 }); out.scale = p.style.getPropertyValue('--scale');
    __t.props({ showpanel: false }); out.hidden = getComputedStyle(p).display === 'none' || p.hidden || p.style.display === 'none';
    return out;
  });
  expect(r.tl).toContain('pos-tl');
  expect(parseFloat(r.scale)).toBeCloseTo(1.5, 5);
  expect(r.hidden).toBe(true);
});
