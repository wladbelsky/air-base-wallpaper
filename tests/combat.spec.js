// Combat: arming through the real audio path, the hold / resume / stand-down cycle, passes and enemies, clean-up
const { test, expect } = require('./support/harness');

/* count beats and remember what the fight produced (sampled every few seconds) */
async function fight(wp, sec, opts = {}) {
  const seen = { passes: 0, kinds: {}, duel: 0, inCombat: 0, maxEnemies: 0 };
  for (let t = 0; t < sec; t += 5) {
    const r = await wp.sim(5, opts);
    expect(r.violations).toEqual([]);
    const s = await wp.run(() => ({
      passes: AIRWAR.passes.length, kinds: ENEMIES.map(e => e.kind), duel: ENEMIES.filter(e => e.duel).length,
      inCombat: AIRCRAFT.filter(a => a.inCombat).length
    }));
    seen.passes = Math.max(seen.passes, s.passes); seen.duel = Math.max(seen.duel, s.duel); seen.inCombat = Math.max(seen.inCombat, s.inCombat);
    seen.maxEnemies = Math.max(seen.maxEnemies, s.kinds.length);
    for (const k of s.kinds) seen.kinds[k] = (seen.kinds[k] || 0) + 1;
  }
  return seen;
}

test.beforeEach(async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { window.__beats = 0; const ob = window.onBeat; window.onBeat = (b, s) => { __beats++; return ob(b, s); }; });
  await wp.sim(40);   // flights up, things settled
});

test('music arms combat after 5 s, the fight runs, silence holds 5 s and stands down; everything is cleaned up', async ({ wp }) => {
  await wp.sim(4, { audio: true });
  expect(await wp.run(() => AUD.combat), 'not armed before ARM_DELAY').toBe(false);
  await wp.sim(1.5, { audio: true });
  expect(await wp.run(() => [AUD.combat, AUD.fighting])).toEqual([true, true]);

  const seen = await fight(wp, 150, { audio: true });
  const beats = await wp.run(() => __beats);
  expect(beats, 'beats detected from the music').toBeGreaterThan(100);
  expect(seen.inCombat, 'armed aircraft engaged').toBeGreaterThan(0);
  expect(seen.passes, 'combat passes flown').toBeGreaterThan(0);
  expect(seen.kinds.bandit, 'enemy waves').toBeGreaterThan(0);
  expect(seen.duel, 'dogfight bandits').toBeGreaterThan(0);
  expect(await wp.run(() => STRESS.level), 'stress builds up').toBeGreaterThan(0.2);
  expect(await wp.run(() => AIRCRAFT.filter(a => a.mission).length), 'no missions in combat').toBe(0);

  // the music stops (the sound counts as gone after 1.6 s): hold — still armed, not fighting — then stand down
  await wp.sim(2, { audio: false });
  expect(await wp.run(() => [AUD.combat, AUD.holding, AUD.fighting])).toEqual([true, true, false]);
  expect(await wp.run(() => ENEMIES.filter(e => e.kind === 'vampire' && !e.dead).length), 'inbound missiles intercepted in the hold').toBe(0);
  await wp.sim(5, { audio: false });
  expect(await wp.run(() => [AUD.combat, AUD.holding])).toEqual([false, false]);

  // a few minutes later nothing of the fight is left
  const r = await wp.until(() => !AIRCRAFT.some(a => a.inCombat) && !AIRWAR.passes.length && !ENEMIES.length && !PENDING.length, 300, { audio: false });
  expect(r.violations).toEqual([]);
  expect(r.done, JSON.stringify(await wp.run(() => ({ cbt: AIRCRAFT.filter(a => a.inCombat).map(a => a.callsign + ':' + a.state), passes: AIRWAR.passes.length, enemies: ENEMIES.map(e => e.kind), pending: PENDING.length })))).toBe(true);
  expect(await wp.stuck()).toEqual([]);
});

test('sound during the hold resumes the fight; a short ping does not', async ({ wp }) => {
  await wp.sim(8, { audio: true });
  expect(await wp.run(() => AUD.combat)).toBe(true);
  await wp.sim(2, { audio: false });
  expect(await wp.run(() => AUD.holding)).toBe(true);
  await wp.sim(0.3, { audio: true });             // a notification ping: shorter than RESUME_DELAY
  await wp.sim(0.5, { audio: false });
  expect(await wp.run(() => AUD.holding), 'still holding after a ping').toBe(true);
  await wp.sim(1.5, { audio: true });             // the music is back
  expect(await wp.run(() => [AUD.combat, AUD.holding, AUD.fighting])).toEqual([true, false, true]);
  const lines = await wp.run(() => RADIO.q.concat(RADIO.cur ? [RADIO.cur] : []).map(m => m.text));
  expect(lines.length).toBeGreaterThan(0);
});

test('with enemies off the fight has passes but no waves, missiles or boats', async ({ wp }) => {
  await wp.run(() => { CFG.enemies = false; __t.forceFight(); });
  const seen = await fight(wp, 120);
  expect(seen.inCombat).toBeGreaterThan(0);
  expect(seen.kinds).toEqual({});
  await wp.run(() => __t.fightOff());
  const r = await wp.until(() => !AUD.armed && !AIRCRAFT.some(a => a.inCombat), 300);
  expect(r.done).toBe(true);
});

test('fire intensity 0: combat mode without passes or enemies', async ({ wp }) => {
  await wp.run(() => { CFG.fire = 0; __t.forceFight(); });
  const seen = await fight(wp, 60);
  expect(seen.passes).toBe(0);
  expect(seen.kinds).toEqual({});
});

test('a long, heavy fight (high stress) stays within bounds', async ({ wp }) => {
  // the gunship up first: boats only come in gunship passes
  await wp.run(() => AIRCRAFT.filter(a => a.spec.key === 'ah1').forEach(a => a.requestLaunch()));
  const up = await wp.until(() => AIRCRAFT.some(a => a.spec.key === 'ah1' && a.aloft), 300);
  expect(up.done).toBe(true);
  await wp.run(() => { __t.forceFight(); STRESS.level = 0.9; });
  const seen = await fight(wp, 300);
  expect(seen.kinds.vampire || 0, 'anti-ship missiles at high stress').toBeGreaterThan(0);
  expect(seen.kinds.boat || 0, 'boats in gunship passes').toBeGreaterThan(0);
  expect(seen.maxEnemies).toBeLessThan(60);
  expect(await wp.stuck()).toEqual([]);
});
