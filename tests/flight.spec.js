// Flight logic: every type launches and recovers through its deck / elevator sequence; automatic flight ops run
// for half an hour without breaking a deck-resource invariant or leaving anyone stuck.
const { test, expect, SEED } = require('./support/harness');

/* boot with automatic flight ops, missions, fly-bys and tanker passes off, and a fresh air wing (no initial launches) */
async function quietDeck(wp, opts) {
  await wp.boot(opts);
  await wp.run(() => { CFG.auto = false; CFG.missions = 0; CFG.flyby = 0; buildAirWing(); TANKER.timer = 1e9; __t.reset(); });
}
/* does `seq` contain `want` in order (other states may come in between)? */
const inOrder = (seq, want) => { let i = 0; for (const s of seq) if (s === want[i]) i++; return i === want.length; };

const JET_UP = ['queued', 'taxi_out', 'hold', 'launch', 'climb', 'orbit'];
const JET_FROM_HANGAR = ['hangar', 'lift_wait', 'lift_prep', 'roll_out', 'lift_up', ...JET_UP];
const JET_DOWN = ['orbit', 'approach', 'final', 'trap'];
const HELI_UP = ['unfold', 'spinup', 'lift', 'depart', 'orbit'];
const HELI_FROM_HANGAR = ['hangar', 'lift_wait', 'lift_prep', 'roll_out', 'lift_up', 'tow_pad', ...HELI_UP];
const HELI_DOWN = ['orbit', 'ret', 'hover', 'descend', 'spindown'];

const CASES = [
  { name: 'F/A-18 from the deck', pick: "a.spec.key === 'fa18' && a.state === 'parked'", up: JET_UP, down: JET_DOWN },
  { name: 'F/A-18 from the hangar', pick: "a.spec.key === 'fa18' && a.state === 'hangar'", up: JET_FROM_HANGAR, down: JET_DOWN },
  { name: 'F-14', pick: "a.spec.key === 'f14'", up: JET_UP, down: JET_DOWN },
  { name: 'F-35C', pick: "a.spec.key === 'f35'", up: JET_UP, down: JET_DOWN },
  { name: 'E-2D', pick: "a.spec.key === 'e2d'", up: JET_UP, down: JET_DOWN },
  { name: 'MQ-25', pick: "a.spec.key === 'mq25'", up: JET_UP, down: JET_DOWN },
  { name: 'MH-60 (deck)', pick: "a.spec.key === 'mh60' && a.host === CARRIER", up: HELI_UP, down: HELI_DOWN },
  { name: 'CH-53 (hangar)', pick: "a.spec.key === 'ch53'", up: HELI_FROM_HANGAR, down: HELI_DOWN },
  { name: 'AH-1Z', pick: "a.spec.key === 'ah1'", up: HELI_FROM_HANGAR, down: HELI_DOWN },
  { name: 'CMV-22B', pick: "a.spec.key === 'cmv22'", up: ['lift_up', 'unfold', 'spinup', 'lift', 'depart', 'orbit'], down: HELI_DOWN },
  { name: 'destroyer MH-60', pick: 'a.host !== CARRIER', up: HELI_UP, down: HELI_DOWN }
];

for (const c of CASES) {
  test(`launch and recovery: ${c.name}`, async ({ wp }) => {
    await quietDeck(wp);
    const start = await wp.run((pick) => {
      const a = window.__a = AIRCRAFT.find(new Function('a', `return ${pick}`)); if (!a) return null;
      const s = a.state; __t.track(); a.requestLaunch(); __t.track(); return s;   // log the start and the first state
    }, c.pick);
    expect(start, 'aircraft for this case').not.toBeNull();
    // up: from the deck / hangar to its orbit
    const up = await wp.until(() => __a.state === 'orbit', 400);
    expect(up.violations).toEqual([]);
    expect(up.done, `reached orbit (states: ${await wp.run(() => __t.log.get(__a.callsign + '@' + SHIPS.indexOf(__a.host)).join(' > '))})`).toBe(true);
    await wp.sim(20);
    // down: back to the deck / hangar
    await wp.run(() => __a.requestLand());
    const down = await wp.until(() => __a.state === 'parked' || __a.state === 'hangar', 600);
    const r = await wp.run(() => ({ log: __t.log.get(__a.callsign + '@' + SHIPS.indexOf(__a.host)), state: __a.state, landReq: __a.landReq, stuck: __t.stuck() }));
    expect(down.violations).toEqual([]);
    expect(down.done, `back on the ship (states: ${r.log.join(' > ')})`).toBe(true);
    expect(inOrder(r.log, c.up[0] === start ? c.up : [start, ...c.up]), `launch sequence ${r.log.join(' > ')}`).toBe(true);
    expect(inOrder(r.log.slice(r.log.lastIndexOf('orbit')), c.down), `recovery sequence ${r.log.join(' > ')}`).toBe(true);
    expect(r.landReq).toBe(false);
    expect(r.stuck).toEqual([]);
    // the deck is free again
    const free = await wp.run(() => ({ cats: FD.cats.every(c => !c.busy), runway: !FD.runway, pad: !DECK.heliPad.busy, lifts: CARRIER.lifts.every(L => !L.busy) }));
    expect(free).toEqual({ cats: true, runway: true, pad: true, lifts: true });
  });
}

test('LAUNCH ALL / RECOVER ALL buttons cycle the whole air wing', async ({ wp }) => {
  await quietDeck(wp);
  await wp.page.click('#allUp');
  const up = await wp.until(() => AIRCRAFT.every(a => a.airborne), 1500);
  expect(up.violations).toEqual([]);
  expect(up.done, JSON.stringify(await wp.states())).toBe(true);
  await wp.page.click('#allDown');
  const down = await wp.until(() => AIRCRAFT.every(a => a.state === 'parked' || a.state === 'hangar'), 2400);
  expect(down.violations).toEqual([]);
  expect(down.done, JSON.stringify(await wp.states())).toBe(true);
  expect(await wp.stuck()).toEqual([]);
  // every deck spot holder is parked there; nothing holds a catapult, the runway or a lift
  const deck = await wp.run(() => ({
    spots: DECK.fixedSpots.filter(s => s.occ).every(s => s.occ.state === 'parked'),
    parkedHaveSpots: AIRCRAFT.filter(a => a.state === 'parked' && a instanceof FixedWing).every(a => a.spot && a.spot.occ === a),
    free: FD.cats.every(c => !c.busy) && !FD.runway && CARRIER.lifts.every(L => !L.busy)
  }));
  expect(deck).toEqual({ spots: true, parkedHaveSpots: true, free: true });
});

for (const seed of [SEED, SEED + 100, SEED + 200]) {
  test(`automatic flight ops for 30 min stay consistent (seed ${seed})`, async ({ wp }) => {
    await wp.boot({ seed });
    const shares = [];
    for (let i = 0; i < 30; i++) {
      const r = await wp.sim(60);
      expect(r.violations, `minute ${i}`).toEqual([]);
      shares.push(await wp.run(() => AIRCRAFT.filter(a => a.aloft).length / AIRCRAFT.length));
    }
    expect(await wp.stuck()).toEqual([]);
    const mean = shares.slice(5).reduce((s, x) => s + x, 0) / (shares.length - 5);
    expect(mean, `share of the air wing up (per minute: ${shares.map(x => x.toFixed(2)).join(' ')})`).toBeGreaterThan(0.2);
    expect(mean).toBeLessThan(0.9);
    // missions went out and came back during the half hour
    const seen = await wp.run(() => [...__t.log.values()].flat());
    expect(seen).toContain('mission');
    expect(seen).toContain('trap');
  });
}
