// Refuelling passes: KC-46 (boom) with a fighter flight, KC-130 (two hoses) with a helicopter pair — who joins, the
// slots, how the pass ends (peace, combat, abort), the timer
const { test, expect } = require('./support/harness');

/* the boom tanker and the first F-16 flight up (kind 'boom'), or the KC-130 and the first UH-60 pair (kind 'drogue') */
async function ready(wp, kind = 'boom') {
  await wp.boot();
  await wp.run((kind) => {
    CFG.auto = false; CFG.missions = 0; CFG.flyby = 0; buildAirWing(); TANKER.timer = 1e9; __t.reset();
    window.__said = []; const say = RADIO.say.bind(RADIO); RADIO.say = (who, text, o) => { __said.push(who + ': ' + text); return say(who, text, o); };
    window.__f = AIRCRAFT.filter(a => kind === 'boom' ? a.spec.key === 'kc46' || (a.spec.key === 'f16' && flightOf(a) === CALLSIGNS.f16[0])
      : a.spec.key === 'kc130' || (a.spec.key === 'uh60' && flightOf(a) === CALLSIGNS.uh60[0]));
    __f.forEach(a => a.requestLaunch());
  }, kind);
  const up = await wp.until(() => __f.every(a => a.state === 'orbit'), 1200);
  expect(up.done, JSON.stringify(await wp.states())).toBe(true);
  await wp.sim(35);   // the tanker needs airT > 20 (and receivers > 10)
}
/* step through the pass, checking the slot geometry; returns what was seen */
async function runPass(wp, limit) {
  const seen = { boarded: false, hose: false, basket: new Set(), badSlots: [], kind: null };
  for (let t = 0; t < limit; t += 1) {
    const r = await wp.sim(1);
    expect(r.violations).toEqual([]);
    const s = await wp.run(() => {
      const ev = TANKER.ev; if (!ev) return { done: true };
      const tk = ev.tanker, S = TANK_SLOTS[ev.kind], out = { done: false, kind: ev.kind, boarded: !!ev.P, hose: tk.hoseOut === 1, basket: [], bad: [] };
      if (ev.P) ev.recv.forEach((a, i) => {
        const inB = S.cur.includes(a.slot);
        if (inB) out.basket.push(a.callsign);
        if (ev.kind === 'drogue' && !inB) out.bad.push(`${a.callsign} should be on a hose`);
        if (ev.kind === 'boom') {
          if (i === ev.cur && !inB) out.bad.push(`${a.callsign} should be on the boom`);
          if (i < ev.cur && !(a.slot[1] < 0)) out.bad.push(`${a.callsign} (done) should be on the left wing`);
          if (i > ev.cur && !(a.slot[1] > 0)) out.bad.push(`${a.callsign} (to go) should be on the right wing`);
        }
        // receivers hold their slot behind the tanker along the path
        if (tk.state === 'tank_pass' && !a.passDone && Math.abs(tk.ps - a.ps - a.slot[0]) > 2) out.bad.push(`${a.callsign} ${(tk.ps - a.ps).toFixed(1)} behind instead of ${a.slot[0]}`);
      });
      return out;
    });
    if (s.done) return Object.assign(seen, { done: true });
    seen.kind = s.kind || seen.kind; seen.boarded = seen.boarded || s.boarded; seen.hose = seen.hose || s.hose;
    if (s.basket.length) seen.basket.add(s.basket.length);
    seen.badSlots.push(...s.bad);
  }
  return Object.assign(seen, { done: false });
}

for (const kind of ['boom', 'drogue']) {
  test(`peacetime ${kind} pass: the receivers join the tanker, everyone back in orbit`, async ({ wp }) => {
    await ready(wp, kind);
    const st = await wp.run((kind) => { TANKER.next = kind; return { ok: TANKER.start(), kind: TANKER.ev && TANKER.ev.kind, recv: TANKER.ev && TANKER.ev.recv.map(a => a.callsign), states: __f.map(a => a.state) }; }, kind);
    expect(st.ok).toBe(true);
    expect(st.kind).toBe(kind);
    expect(st.recv.length).toBeGreaterThanOrEqual(1); expect(st.recv.length).toBeLessThanOrEqual(kind === 'boom' ? 4 : 2);
    expect(st.states.every(s => s === 'tank_out')).toBe(true);
    const seen = await runPass(wp, 500);
    expect(seen.done, 'the event ends').toBe(true);
    expect(seen.boarded, 'the pass was flown').toBe(true);
    expect(seen.hose, 'boom / hoses out during the pass').toBe(true);
    expect([...seen.basket]).toEqual([kind === 'boom' ? 1 : st.recv.length]);
    expect(seen.badSlots.slice(0, 5)).toEqual([]);
    const back = await wp.until(() => __f.every(a => a.state === 'orbit' && !a.tank), 300);
    expect(back.done, JSON.stringify(await wp.states())).toBe(true);
    const said = await wp.run(() => __said.join('\n'));
    expect(said.length, 'refuelling radio').toBeGreaterThan(0);
    expect(await wp.stuck()).toEqual([]);
  });
}

test('no refuelling passes start in combat', async ({ wp }) => {
  await ready(wp);
  await wp.run(() => __t.forceFight());
  await wp.sim(40);
  expect(await wp.run(() => TANKER.start())).toBe(false);
  await wp.run(() => { TANKER.timer = 0; });
  const r = await wp.sim(180);
  expect(r.violations).toEqual([]);
  expect(await wp.run(() => ({ ev: TANKER.ev, tank: AIRCRAFT.filter(a => a.tank).length }))).toEqual({ ev: null, tank: 0 });
});

test('a fight starting while the flight gathers off-screen calls the pass off', async ({ wp }) => {
  await ready(wp);
  expect(await wp.run(() => { TANKER.next = 'boom'; return TANKER.start(); })).toBe(true);
  await wp.sim(2);
  expect(await wp.run(() => !!TANKER.ev && !TANKER.ev.P)).toBe(true);   // still gathering
  await wp.run(() => { window.__h0 = new Map(__f.filter(a => a.state === 'tank_out').map(a => [a, Math.atan2(a.fwd.z, a.fwd.x)])); __t.forceFight(); });
  await wp.sim(0.1);
  expect(await wp.run(() => TANKER.ev)).toBeNull();
  // those still flying out turn back smoothly: no heading snap in the step the pass is called off
  const snap = await wp.run(() => Math.max(0, ...[...__h0].map(([a, h]) => { const d = Math.atan2(a.fwd.z, a.fwd.x) - h; return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); })));
  expect(snap, 'heading change in one step (rad)').toBeLessThan(0.3);
  const back = await wp.until(() => !AIRCRAFT.some(a => a.tank || __t.TANK_STATES.has(a.state)), 400);
  expect(back.violations).toEqual([]);
  expect(back.done, JSON.stringify(await wp.states())).toBe(true);
  // the fighters join the fight; the tanker stays up on its orbit
  const r = await wp.until(() => __f.filter(a => a.spec.armed).some(a => a.inCombat), 120);
  expect(r.done).toBe(true);
  expect(await wp.run(() => AIRCRAFT.find(a => a.spec.key === 'kc46').state)).toBe('orbit');
});

test('a pass already on screen when a fight starts is flown to the end', async ({ wp }) => {
  await ready(wp);
  await wp.run(() => { TANKER.next = 'boom'; TANKER.start(); });
  const on = await wp.until(() => !!TANKER.ev && !!TANKER.ev.P, 400);
  expect(on.done).toBe(true);
  await wp.run(() => __t.forceFight());
  const seen = await runPass(wp, 400);
  expect(seen.done).toBe(true);
  expect(seen.badSlots.slice(0, 5)).toEqual([]);
  const back = await wp.until(() => !AIRCRAFT.some(a => a.tank || __t.TANK_STATES.has(a.state)), 400);
  expect(back.done, JSON.stringify(await wp.states())).toBe(true);
});

test('in combat the AWACS is scrambled, the tankers are not; a tanker already up stays up, passes resume after', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.auto = false; CFG.missions = 0; CFG.flyby = 0; buildAirWing(); TANKER.timer = 1e9; CFG.auto = true; __t.forceFight(); });
  const r = await wp.sim(180);
  expect(r.violations).toEqual([]);
  const st = await wp.run(() => ({ awacs: AIRCRAFT.find(a => a.isAwacs).state, tankers: AIRCRAFT.filter(a => a.spec.tanker).map(a => a.state) }));
  expect(st.awacs).not.toBe('parked');
  for (const s of st.tankers) expect(s).toBe('parked');
  // a tanker launched in peace stays on station through a fight, then passes resume
  await ready(wp);
  await wp.run(() => { CFG.auto = true; __t.forceFight(); });
  const fight = await wp.sim(240);
  expect(fight.violations).toEqual([]);
  expect(await wp.run(() => { const t = AIRCRAFT.find(a => a.spec.key === 'kc46'); return [t.state, t.landReq]; })).toEqual(['orbit', false]);
  await wp.run(() => __t.fightOff());
  const calm = await wp.until(() => !AUD.armed, 30);
  expect(calm.done).toBe(true);
  await wp.run(() => { TANKER.timer = 5; });
  const pass = await wp.until(() => !!TANKER.ev, 300);
  expect(pass.done, 'a refuelling pass after the fight').toBe(true);
});

test('a pass that cannot assemble in 45 s is aborted and everyone goes back', async ({ wp }) => {
  await ready(wp);
  await wp.run(() => { TANKER.next = 'boom'; TANKER.start(); });
  await wp.sim(1);
  await wp.run(() => { TANKER.ev.t = 50; });   // as if a receiver never got there
  await wp.sim(1);
  expect(await wp.run(() => TANKER.ev)).toBeNull();
  const back = await wp.until(() => __f.every(a => a.state === 'orbit' && !a.tank), 400);
  expect(back.violations).toEqual([]);
  expect(back.done, JSON.stringify(await wp.states())).toBe(true);
});

test('the peacetime timer launches a tanker and starts passes by itself', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { TANKER.timer = 120; });
  const r = await wp.until(() => [...__t.log.values()].some(l => l.includes('tank_pass')), 900);
  expect(r.violations).toEqual([]);
  expect(r.done, 'a refuelling pass within 15 min').toBe(true);
  const fin = await wp.until(() => !TANKER.ev && !AIRCRAFT.some(a => a.tank), 600);
  expect(fin.done).toBe(true);
  expect(await wp.stuck()).toEqual([]);
});
