// Unit tests of pure helpers, run inside the page (the wallpaper's code is plain global scripts)
const { test, expect } = require('./support/harness');

test.beforeEach(async ({ wp }) => { await wp.boot(); });

test('FlightPath: Dubins curves start and end where asked, never turn tighter than R, and sample continuously', async ({ wp }) => {
  const bad = await wp.run(() => {
    const out = [];
    for (let k = 0; k < 300; k++) {
      const R = rand(4, 30), p0 = new V3(rand(-80, 80), rand(5, 25), rand(-80, 80)), p1 = new V3(rand(-80, 80), rand(5, 25), rand(-80, 80));
      const h0 = rand(0, TAU), h1 = rand(0, TAU);
      const P = new FlightPath().addDubins(p0, h0, p1, h1, R);
      const a = P.sample(0), z = P.sample(P.length);
      const ang = (d, h) => Math.abs(Math.atan2(Math.sin(Math.atan2(d.z, d.x) - h), Math.cos(Math.atan2(d.z, d.x) - h)));
      if (a.pos.distanceTo(p0) > 1e-3 || Math.hypot(z.pos.x - p1.x, z.pos.z - p1.z) > 0.05) out.push(`endpoints off (k=${k})`);
      if (ang(a.dir, h0) > 1e-3 || ang(z.dir, h1) > 0.01) out.push(`headings off (k=${k})`);
      // walk the path: steps of ds move about ds (continuity) and the heading changes by at most ds / R (turn radius)
      const n = 400, ds = P.length / n; let prev = P.sample(0, { pos: new V3(), dir: new V3() });
      prev = { pos: prev.pos.clone(), dir: prev.dir.clone() };
      for (let i = 1; i <= n; i++) {
        const s = P.sample(i * ds);
        const step = Math.hypot(s.pos.x - prev.pos.x, s.pos.z - prev.pos.z);
        if (step > ds * 1.01 + 1e-6) { out.push(`jump of ${step.toFixed(3)} > ${ds.toFixed(3)} (k=${k})`); break; }
        const dh = Math.abs(Math.atan2(prev.dir.x * s.dir.z - prev.dir.z * s.dir.x, prev.dir.x * s.dir.x + prev.dir.z * s.dir.z));
        if (dh > ds / R * 1.05 + 1e-6) { out.push(`turn tighter than R (k=${k})`); break; }
        prev = { pos: s.pos.clone(), dir: s.dir.clone() };
      }
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test('FlightPath: lines and chained pieces add up', async ({ wp }) => {
  const r = await wp.run(() => {
    const P = new FlightPath().addLine(new V3(0, 10, 0), new V3(30, 10, 0)).addDubins(new V3(30, 10, 0), 0, new V3(30, 10, 60), Math.PI, 12).addLine(new V3(30, 10, 60), new V3(0, 10, 60));
    const mid = P.sample(15);
    return { len: P.length, first: P.pieces[0].len, mid: [mid.pos.x, mid.pos.z], end: P.sample(P.length).pos.toArray(), over: P.sample(P.length + 50).pos.toArray() };
  });
  expect(r.first).toBeCloseTo(30, 6);
  expect(r.mid[0]).toBeCloseTo(15, 6); expect(r.mid[1]).toBeCloseTo(0, 6);
  expect(r.end[0]).toBeCloseTo(0, 3); expect(r.end[2]).toBeCloseTo(60, 3);
  expect(r.over.every(Number.isFinite)).toBe(true);
});

test('radio: placeholders, tiers, peace lines and no repeats in a row', async ({ wp }) => {
  const r = await wp.run(() => {
    const out = {};
    out.fill = [fillLine('{C}, bearing {B}', { C: 'JOKER 1', B: 'one-two-zero' }), fillLine('{X} stays', { C: 'a' }), fillLine('no vars')];
    const pool = { peace: ['P1', 'P2'], calm: ['C1', 'C2'], panic: ['X1', 'X2'] };
    AUD.combat = false; STRESS.level = 0.9;
    out.peace = new Set(Array.from({ length: 40 }, () => radioLine(pool)));
    AUD.combat = true; STRESS.level = 0.9;
    out.panic = new Set(Array.from({ length: 200 }, () => radioLine(pool)));
    STRESS.level = 0.5;   // tense: missing → falls back to calm
    out.tense = new Set(Array.from({ length: 40 }, () => radioLine(pool)));
    STRESS.level = 0.1;
    out.calm = new Set(Array.from({ length: 40 }, () => radioLine(pool)));
    AUD.combat = false;
    const list = ['a', 'b', 'c'], seq = Array.from({ length: 200 }, () => radioLine(list));   // no repeats per list object
    out.repeats = seq.filter((x, i) => i && x === seq[i - 1]).length;
    out.single = radioLine(['only']);
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v instanceof Set ? [...v].sort() : v]));
  });
  expect(r.fill).toEqual(['JOKER 1, bearing one-two-zero', '{X} stays', 'no vars']);
  expect(r.peace).toEqual(['P1', 'P2']);
  expect(r.panic).toEqual(['C1', 'C2', 'X1', 'X2']);   // the calmer tier mixed in (MIX_CALMER), never peace
  expect(r.tense).toEqual(['C1', 'C2']);
  expect(r.calm).toEqual(['C1', 'C2']);
  expect(r.repeats).toBe(0);
  expect(r.single).toBe('only');
});

test('threat tiers follow STRESS.level', async ({ wp }) => {
  const r = await wp.run(() => [0, 0.32, 0.34, 0.65, 0.67, 1].map(l => { STRESS.level = l; return [STRESS.tier, STRESS.label]; }));
  expect(r.map(x => x[0])).toEqual(['calm', 'calm', 'tense', 'tense', 'panic', 'panic']);
  expect(r[0][1]).toBe('LOW'); expect(r[5][1]).toBe('CRITICAL');
});

test('bearings and compass words', async ({ wp }) => {
  const r = await wp.run(() => {
    const words = [], comp = [];
    for (let i = 0; i < 360; i += 7) { words.push(bearingWords(i * DEG)); comp.push(compassWord(i * DEG)); }
    return { words, comp, b0: bearingWords(-Math.PI / 2), c0: compassWord(0), c90: compassWord(Math.PI / 2) };
  });
  for (const w of r.words) expect(w).toMatch(/^(zero|one|two|three|four|five|six|seven|eight|niner)(-(zero|one|two|three|four|five|six|seven|eight|niner)){2}$/);
  for (const c of r.comp) expect(['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east']).toContain(c);
  expect(r.b0).toBe('zero-zero-zero');
  expect(r.c0).toBe('east'); expect(r.c90).toBe('south');
});

test('mission texts: every order / done pair fills all its placeholders', async ({ wp }) => {
  const left = await wp.run(() => {
    const keys = [];
    (function walk(o, p) {
      if (Array.isArray(o) && Array.isArray(o[0])) { keys.push(p.join('.')); return; }
      for (const k in o) walk(o[k], [...p, k]);
    })(MISSIONS, []);
    const out = [];
    for (const k of keys) for (let i = 0; i < 30; i++) {
      const { order, done } = makeMission(k, { T: 'Su-35 Flanker' });
      for (const s of [order, done]) if (/\{\w+\}/.test(s)) out.push(`${k}: ${s}`);
    }
    return { keys, out: [...new Set(out)] };
  });
  expect(left.keys.length).toBeGreaterThan(5);
  expect(left.out).toEqual([]);
});

test('callsigns: flights of 4 / 2 / 1, the pool wraps with a suffix, csNum and flightOf', async ({ wp }) => {
  const r = await wp.run(() => ({
    f16: callsignsFor('f16', 5), e3: callsignsFor('e3', 2), uh60: callsignsFor('uh60', 3),
    wrap: callsignsFor('f16', CALLSIGNS.f16.length * 4 + 1).pop(), pool: CALLSIGNS.f16[0],
    num: [csNum({ callsign: 'MAGE 3' }), csNum({ callsign: 'SKYEYE' })], flight: [flightOf({ callsign: 'MAGE 3' }), flightOf({ callsign: 'GHOST EYE 2' })]
  }));
  const J = r.pool;
  expect(r.f16).toEqual([`${J} 1`, `${J} 2`, `${J} 3`, `${J} 4`, expect.stringMatching(/ 1$/)]);
  expect(r.f16[4].startsWith(J)).toBe(false);
  expect(r.e3.every(c => !/\d$/.test(c))).toBe(true);
  expect(r.uh60[0].replace(/ \d$/, '')).toBe(r.uh60[1].replace(/ \d$/, ''));
  expect(r.uh60[2].replace(/ \d$/, '')).not.toBe(r.uh60[0].replace(/ \d$/, ''));
  expect(r.wrap).toBe(`${J}-2 1`);
  expect(r.num).toEqual([3, 0]);
  expect(r.flight).toEqual(['MAGE', 'GHOST EYE']);
});

test('pickMission respects allow-lists and eligibility', async ({ wp }) => {
  const r = await wp.run(() => {
    const picks = {};
    for (const key of Object.keys(AIRCRAFT_TYPES)) {
      const a = AIRCRAFT.find(x => x.spec.key === key); if (!a) continue;
      const s = new Set(); for (let i = 0; i < 300; i++) { const M = pickMission(a); s.add(M ? M.key : null); }
      picks[key] = [...s].sort();
    }
    return { picks, types: Object.keys(MISSION_TYPES).sort() };
  });
  expect(r.types).toEqual(['airlift', 'paradrop', 'patrol']);
  expect(r.picks.c130).toEqual(['airlift', 'paradrop']);
  expect(r.picks.c17).toEqual(['airlift', 'paradrop']);
  expect(r.picks.kc46).toEqual([null]);
  for (const k of ['f15', 'f16', 'f22', 'f35', 'a10', 'e3', 'ac130', 'mq9', 'uh60', 'ah64', 'uh1']) expect(r.picks[k], k).toEqual(['patrol']);
});

test('airfield: every home is reachable — taxi routes start at the home and end at the holding point / back home', async ({ wp }) => {
  const r = await wp.run(() => {
    const out = [], near = (p, x, z) => Math.hypot(p[0] - x, p[1] - z) < 0.01;
    for (const s of [...PARKING.stands, ...PARKING.shelters, ...PARKING.hangars, ...PARKING.remote]) {
      const pb = AIRFIELD.pushback(s), th = AIRFIELD.toHold(s);
      if (!near(pb[0], s.x, s.z)) out.push(`pushback from ${s.x},${s.z} starts elsewhere`);
      if (!near(th[0], ...pb[pb.length - 1])) out.push(`taxi out from ${s.x},${s.z} doesn't continue the pushback`);
      if (!near(th[th.length - 1], HOLD.x, HOLD.z)) out.push(`taxi out from ${s.x},${s.z} doesn't end at the hold`);
      for (const x0 of [-40, -10, 20]) {
        const lk = AIRFIELD.exitFor(s, x0), hr = AIRFIELD.homeRoute(s, x0, lk);
        if (!BASE_LAYOUT.links.includes(lk) || lk < x0) out.push(`exit ${lk} for a stop at ${x0}`);
        if (!near(hr[hr.length - 1], s.x, s.z)) out.push(`route home to ${s.x},${s.z} ends elsewhere`);
      }
    }
    return out;
  });
  expect(r).toEqual([]);
});

test('airfield: the routes home from both runways, every exit, keep to the paving (the last exit off the shorter south runway once crossed the grass)', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    CFG.runways = 2; BASE.setRunways(2); scene.updateMatrixWorld(true);
    const ms = []; BASE.group.traverseVisible(o => { if (o.isMesh && !o.isInstancedMesh) ms.push(o); }); BASE.rwy2.traverseVisible(o => { if (o.isMesh && !o.isInstancedMesh) ms.push(o); });
    const rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), out = [];
    const paved = (x, z) => { rc.set(new THREE.Vector3(x, 0.5, z), down); const h = rc.intersectObjects(ms, false)[0]; return !!h && h.point.y > 0.02; };
    const s = PARKING.stands[0], H = HOLD, H2 = BASE_LAYOUT.hold2;
    const walk = (pts, what) => {
      const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal'), n = Math.ceil(c.getLength() / 0.5);
      for (let i = 0; i <= n; i++) { const p = c.getPointAt(i / n); if (!paved(p.x, p.z)) { out.push(`${what}: grass at ${p.x.toFixed(1)},${p.z.toFixed(1)}`); break; } }
    };
    for (const L of [BASE_LAYOUT.rwy, BASE_LAYOUT.rwy2]) for (const lk of BASE_LAYOUT.links.slice(1)) walk(AIRFIELD.homeRoute(s, lk - 10, lk, L), `${L === BASE_LAYOUT.rwy ? 'north' : 'south'} runway, exit ${lk}`);
    // the departures to 09R while 09L is closed: across 09L's end to hold2, then lining up
    walk([[H.x, H.z], [H.x, H2.z]], 'across to 09R'); walk(AIRFIELD.lineUp(0, 0, BASE_LAYOUT.rwy2), 'lining up on 09R');
    return out;
  });
  expect(r).toEqual([]);
});

test('airfield: taxi routes never loop — no more than a U-turn within 6 units of the path', async ({ wp }) => {
  const r = await wp.run(() => {
    // the heading change over any 6-unit stretch of the smoothed path (as followDeck drives it)
    const loop = pts => {
      const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal'), L = c.getLength(), N = Math.ceil(L / 0.05), cum = [0];
      let prev = null;
      for (let i = 0; i <= N; i++) { const t = c.getTangentAt(i / N), h = Math.atan2(-t.z, t.x); if (prev !== null) cum.push(cum[cum.length - 1] + Math.atan2(Math.sin(h - prev), Math.cos(h - prev))); prev = h; }
      let w = 0; const k = Math.round(6 / (L / N));
      for (let i = 0; i < cum.length; i++) w = Math.max(w, Math.abs(cum[Math.min(cum.length - 1, i + k)] - cum[i]));
      return w / DEG;
    };
    const out = [];
    for (const s of [...PARKING.stands, ...PARKING.shelters, ...PARKING.hangars, ...PARKING.remote]) {
      for (const [name, pts] of [['pushback', AIRFIELD.pushback(s)], ['taxi out', AIRFIELD.toHold(s)]]) if (loop(pts) > 150) out.push(`${name} from ${s.x},${s.z}`);
      for (const L of [RW, BASE_LAYOUT.rwy2]) for (let xStop = L.td; xStop < L.x1; xStop += 3) {
        const lk = AIRFIELD.exitFor(s, xStop);
        for (const x0 of [lk - 4.5, lk - 4.3]) { const w = loop(AIRFIELD.homeRoute(s, x0, lk, L)); if (w > 150) out.push(`home to ${s.x},${s.z} by link ${lk} from z ${L.z}: ${w.toFixed(0)}°`); }
      }
    }
    return [...new Set(out)];
  });
  expect(r).toEqual([]);
});

test('takeoff: fighters lift off around mid-runway, heavies further down; lines and the fuel farm where they belong', async ({ wp }) => {
  const r = await wp.run(() => {
    const out = [], run = RW.x1 - (HOLD.x + 4.5);
    for (const [k, C] of Object.entries(AIRCRAFT_TYPES)) {
      const S = C.spec; if (!(C.prototype instanceof FixedWing)) continue;
      const f = S.toRoll / run, want = S.park === 'h' ? [0.55, 0.75] : S.drone ? [0.3, 0.5] : [0.4, 0.6];
      if (!(f >= want[0] && f <= want[1])) out.push(`${k} lifts off ${(f * 100).toFixed(0)}% down the runway`);
    }
    // the yellow lines (channels, the lane) lie on concrete: the apron, the remote stands, the channel strips, the taxiway
    const A = BASE_LAYOUT.apron, TW = BASE_LAYOUT.twy, L = BASE_LAYOUT.lane;
    const rects = [[A.x0, A.z1, A.x1, A.z0], ...BASE_LAYOUT.remote.map(q => [q.x0, q.z1, q.x1, A.z0]), ...BASE_LAYOUT.channels.map(c => [c - 1.6, L - 1.6, c + 1.6, A.z0]), [TW.x0, TW.z - TW.w / 2, TW.x1, TW.z + TW.w / 2]];
    const onConc = (x, z) => rects.some(([x0, z0, x1, z1]) => x >= x0 - 1e-6 && x <= x1 + 1e-6 && z >= z0 - 1e-6 && z <= z1 + 1e-6);
    for (const c of BASE_LAYOUT.channels) for (let z = L; z <= TW.z; z += 0.25) if (!onConc(c, z)) out.push(`channel ${c} line off the concrete at z ${z}`);
    for (let x = BASE_LAYOUT.chIn[0]; x <= BASE_LAYOUT.chOut[BASE_LAYOUT.chOut.length - 1]; x += 0.25) if (!onConc(x, L)) out.push(`lane line off the concrete at x ${x}`);
    for (const [x, z] of BASE_LAYOUT.fuel) if (roadDist(x, z) - BASE_LAYOUT.FUEL_R - BASE_LAYOUT.ROAD_W / 2 < 0.3) out.push(`fuel tank at ${x},${z} on a road`);
    // every lane home leaves by an out channel east of where its pushback ends
    for (const s of [...PARKING.shelters, ...PARKING.hangars, ...PARKING.remote].filter(AIRFIELD.onLane)) if (!(AIRFIELD.outFor(s) > s.x - 3.4)) out.push(`home ${s.x} leaves by ${AIRFIELD.outFor(s)}`);
    return [...new Set(out)];
  });
  expect(r).toEqual([]);
});

test('roads stay off the runway, the taxiway and the apron, and nothing grows on them', async ({ wp }) => {
  const r = await wp.run(() => {
    const out = [], R = BASE_LAYOUT.rwy;
    for (const road of BASE_LAYOUT.roads) for (let i = 0; i < road.length - 1; i++) for (let u = 0; u <= 1; u += 0.05) {
      const x = road[i][0] + (road[i + 1][0] - road[i][0]) * u, z = road[i][1] + (road[i + 1][1] - road[i][1]) * u;
      for (const L of [R, BASE_LAYOUT.rwy2]) if (x > L.x0 - 2 && x < L.x1 + 2 && Math.abs(z - L.z) < L.w / 2 + 1.6) out.push(`road on a runway at ${x.toFixed(0)},${z.toFixed(0)}`);
      if (x > 7.5 && x < 32.5 && z > 28.5 && z < 47.5) out.push(`road across the heliport at ${x.toFixed(0)},${z.toFixed(0)}`);
    }
    // the south runway inside the fence, clear of the perimeter road; the heliport pads off both runways
    const R2 = BASE_LAYOUT.rwy2;
    for (let x = R2.x0 - 2; x <= R2.x1 + 2; x += 0.5) for (const z of [R2.z - R2.w / 2 - 0.8, R2.z + R2.w / 2 + 0.8]) {
      if (!insideFence(x, z)) out.push(`south runway outside the fence at ${x.toFixed(0)}`);
      if (roadDist(x, z) < BASE_LAYOUT.ROAD_W / 2 + 0.2) out.push(`road across the south runway at ${x.toFixed(0)},${z.toFixed(1)}`);
    }
    for (const s of PARKING.heli) if (Math.abs(s.z - R2.z) < R2.w / 2 + 0.8 + 2) out.push(`heli pad ${s.x},${s.z} on the south runway`);
    // the remote stand slabs and the taxiway: inside the fence, clear of the perimeter road
    const A = BASE_LAYOUT.apron, TW = BASE_LAYOUT.twy;
    for (const [x0, z0, x1, z1] of [...BASE_LAYOUT.remote.map(r => [r.x0, r.z1, r.x1, A.z0]), [TW.x0, TW.z - TW.w / 2, TW.x1, TW.z + TW.w / 2]])
      for (let x = x0; x <= x1; x += 0.5) for (let z = z0; z <= z1; z += 0.5) {
        if (!insideFence(x, z)) out.push(`concrete outside the fence at ${x.toFixed(0)},${z.toFixed(0)}`);
        if (roadDist(x, z) < BASE_LAYOUT.ROAD_W / 2 + 0.2) out.push(`road across the concrete at ${x.toFixed(0)},${z.toFixed(0)}`);
      }
    let trees = 0; const m = new THREE.Matrix4(), p = new THREE.Vector3();
    for (const v of TERRAIN.veg) for (let i = 0; i < v.count; i++) { v.getMatrixAt(i, m); p.setFromMatrixPosition(m); if (roadDist(p.x, p.z) < BASE_LAYOUT.ROAD_W / 2) trees++; }
    return { out: [...new Set(out)], trees };
  });
  expect(r.out).toEqual([]);
  expect(r.trees).toBe(0);
});

test('the fence: square-cut, everything inside it, the approach lights too; mounts clear of the PAPI, lights and roads', async ({ wp }) => {
  const r = await wp.run(() => {
    const out = [], F = BASE_LAYOUT.fence, RW = BASE_LAYOUT.ROAD_W / 2;
    for (let i = 0; i < F.length; i++) {                                   // sides: along x / z, or a 45° chamfer
      const [x0, z0] = F[i], [x1, z1] = F[(i + 1) % F.length], dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
      if (dx > 1e-6 && dz > 1e-6 && Math.abs(dx - dz) > 1e-6) out.push(`fence side ${i} is slanted`);
    }
    // approach lights, red bars, flashers and PAPI of both runways (as buildRunway places them)
    const lights = [], papi = [];
    for (const [L, side] of [[BASE_LAYOUT.rwy, -1], [BASE_LAYOUT.rwy2, 1]]) {
      for (let x = L.x0 - 4; x > L.x0 - 34; x -= 3) for (let k = -2; k <= 2; k++) lights.push([x, L.z + k * 0.45]);
      for (const sx of [-1, 1]) for (let x = L.x0 - 8; x > L.x0 - 18; x -= 3) lights.push([x, L.z + sx * 1.6]);
      for (let i = 0; i < 10; i++) lights.push([L.x0 - 34 + i * 3, L.z]);
      for (let i = 0; i < 4; i++) papi.push([L.td + 2, L.z + side * (L.w / 2 + 1.2 + i * 0.5)]);
    }
    const inside = (x, z, m) => [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]].every(([a, b]) => insideFence(x + a, z + b));
    for (const [x, z] of lights) {
      if (!inside(x, z, 2)) out.push(`approach light at ${x.toFixed(0)},${z.toFixed(1)} outside the fence`);
      if (roadDist(x, z) < RW + 1.5) out.push(`road by the approach light at ${x.toFixed(0)},${z.toFixed(1)}`);
    }
    // mounts, the Patriot radar, sky lights: inside, off the roads, clear of the lights and the PAPI
    const things = [...Object.values(BASE.mounts).flat().map(m => [m.yawG.position.x, m.yawG.position.z, 'mount']),
      [BASE.patriotRadar.position ? BASE.patriotRadar.position.x : -40, BASE.patriotRadar.position ? BASE.patriotRadar.position.z : 32, 'patriot radar'],
      ...BASE.skyLights.map(sl => [sl.holder.position.x, sl.holder.position.z, 'sky light'])];
    for (const [x, z, what] of things) {
      const at = `${what} at ${x.toFixed(0)},${z.toFixed(0)}`;
      if (!inside(x, z, 2)) out.push(`${at} outside the fence`);
      if (roadDist(x, z) < RW + 1.2) out.push(`${at} on a road`);
      for (const [px, pz] of [...lights, ...papi]) if (Math.hypot(px - x, pz - z) < 3) { out.push(`${at} on the runway lights at ${px.toFixed(0)},${pz.toFixed(1)}`); break; }
    }
    // the perimeter road keeps 5 from the fence all round (an inward offset, not a pull toward the centre)
    const per = BASE_LAYOUT.roads[BASE_LAYOUT.roads.length - 1];
    for (let i = 0; i < per.length - 1; i++) for (let u = 0; u <= 1; u += 0.1) {
      const x = per[i][0] + (per[i + 1][0] - per[i][0]) * u, z = per[i][1] + (per[i + 1][1] - per[i][1]) * u;
      if (!inside(x, z, 4.5)) out.push(`perimeter road too close to the fence at ${x.toFixed(0)},${z.toFixed(0)}`);
    }
    return [...new Set(out)];
  });
  expect(r).toEqual([]);
});

test('seasons: the PC date picks the season unless one is set', async ({ wp }) => {
  const r = await wp.run(() => {
    const out = {}, real = getNow;
    for (const [m, want] of [[0, 'winter'], [3, 'spring'], [6, 'summer'], [9, 'autumn'], [11, 'winter']]) { window.getNow = () => new Date(Date.UTC(2026, m, 15, 12)); CFG.season = 'auto'; out[m] = seasonNow(); }
    window.getNow = real; CFG.season = 'summer'; out.fixed = seasonNow(); CFG.season = 'auto';
    return out;
  });
  expect(r).toEqual({ 0: 'winter', 3: 'spring', 6: 'summer', 9: 'autumn', 11: 'winter', fixed: 'summer' });
});

test('sun position and sky palette: day above the horizon, night below', async ({ wp }) => {
  const r = await wp.run(() => {
    const d = h => new Date(Date.UTC(2026, 5, 21, h));
    const noon = sunPosition(d(12), CFG.lat, 0), night = sunPosition(d(0), CFG.lat, 0), winter = sunPosition(new Date(Date.UTC(2026, 11, 21, 12)), CFG.lat, 0);
    const day = skyAt(noon.elev), dark = skyAt(night.elev), lum = c => c.r + c.g + c.b;
    return { noon: noon.elev, night: night.elev, winter: winter.elev, dayLum: lum(day.fog), nightLum: lum(dark.fog), si: [day.si, dark.si] };
  });
  expect(r.noon).toBeGreaterThan(60); expect(r.noon).toBeLessThan(75);
  expect(r.night).toBeLessThan(-10);
  expect(r.winter).toBeLessThan(r.noon - 30);
  expect(r.dayLum).toBeGreaterThan(r.nightLum);
  expect(r.si[0]).toBeGreaterThan(r.si[1]);
});

test('models: every builder runs, mergeStatic keeps dynamic nodes, disposeTree spares shared materials', async ({ wp }) => {
  const r = await wp.run(() => {
    const out = { built: [], fail: [] };
    const air = { buildF15, buildF16, buildF22, buildF35, buildA10, buildE3, buildKC46, c130: () => buildC130('c130'), kc130: () => buildC130('kc130'), ac130: () => buildC130('ac130'), buildC17, buildMQ9,
      buildUH60, buildAH64, buildUH1, buildSu25, buildSu35, buildSu47, buildSu57, buildSu34, buildTu22, buildKa52, buildMi24, buildT90, buildBMP, buildBTR, buildCruise, buildBallistic };
    for (const [n, f] of Object.entries(air)) {
      try {
        const m = f(), grp = m.group || m; if (!grp.isObject3D) throw new Error('no group');   // enemy builders return the group itself
        if (m.setFold) { m.setFold(1); m.setFold(0); }
        if (m.tick) m.tick(0.05, { rotor: 1, fold: 0, gear: 1, glow: 0, v: 10, hoseOut: 1, engineOn: true, airborne: true });
        let meshes = 0; grp.traverse(o => { if (o.isMesh) meshes++; });
        out.built.push([n, meshes]); disposeTree(grp);
      } catch (e) { out.fail.push(n + ': ' + e.message); }
    }
    // the live base: the radar, the mounts and the doors are still separate, movable nodes inside its group
    const inTree = o => { let p = o; while (p && p !== BASE.group) p = p.parent; return !!p; };
    out.dyn = [...BASE.radars, ...ALL_CIWS.map(c => c.yawG), ...ALL_TANKS.map(m => m.barrelG), ...PARKING.shelters.flatMap(s => s.leaves.map(l => l.g)), ...PARKING.hangars.flatMap(s => s.panels.map(q => q.g))].every(inTree);
    let baseMeshes = 0; BASE.group.traverse(o => { if (o.isMesh) baseMeshes++; }); out.baseMeshes = baseMeshes;
    // mergeStatic on a hand-made group
    const root = new THREE.Group(), dyn = new THREE.Group(); root.add(dyn);
    for (let i = 0; i < 3; i++) box(root, 1, 1, 1, 0x123456, i * 2, 0, 0);
    box(dyn, 1, 1, 1, 0x123456, 0, 2, 0); box(dyn, 1, 1, 1, 0x123456, 0, 4, 0);
    mergeStatic(root, [dyn]);
    out.merge = { rootMeshes: root.children.filter(c => c.isMesh).length, dynKept: dyn.parent === root, dynMeshes: dyn.children.filter(c => c.isMesh).length };
    // disposeTree: shared (cached) materials survive, own materials and geometries are disposed
    const g2 = new THREE.Group(), shared = M(0x654321), own = new THREE.MeshBasicMaterial(), geo = new THREE.BoxGeometry();
    g2.add(new THREE.Mesh(geo, shared), new THREE.Mesh(new THREE.BoxGeometry(), own));
    const disposed = []; shared.addEventListener('dispose', () => disposed.push('shared')); own.addEventListener('dispose', () => disposed.push('own')); geo.addEventListener('dispose', () => disposed.push('geo'));
    disposeTree(g2); out.disposed = disposed.sort();
    return out;
  });
  expect(r.fail).toEqual([]);
  expect(r.built.length).toBe(28);
  expect(r.dyn).toBe(true);
  expect(r.baseMeshes).toBeLessThan(400);
  expect(r.merge).toEqual({ rootMeshes: 1, dynKept: true, dynMeshes: 1 });
  expect(r.disposed).toEqual(['geo', 'own']);
});

test('no tree grows through a gun, tank, launcher or light tower', async ({ wp }) => {
  const r = await wp.run(() => {
    const out = [], m = new THREE.Matrix4(), p = new THREE.Vector3(), w = new THREE.Vector3();
    const keep = [...Object.values(BASE.mounts).flat().map(o => o.yawG), BASE.patriotRadar, ...BASE.skyLights.map(s => s.holder)].map(o => o.getWorldPosition(w.clone()));
    for (const v of [...TERRAIN.veg, ...TERRAIN.fill]) for (let i = 0; i < v.count; i++) {
      v.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      for (const k of keep) if (Math.hypot(p.x - k.x, p.z - k.z) < 2) out.push(`tree at ${p.x.toFixed(0)},${p.z.toFixed(0)}`);
    }
    return out;
  });
  expect(r).toEqual([]);
});

test('landing gear: every airframe stands on its wheels, the gear folds away in about a second', async ({ wp }) => {
  const r = await wp.run(() => {
    const out = [];
    for (const [n, f] of Object.entries({ buildF15, buildF16, buildF22, buildF35, buildA10, buildE3, buildKC46, c130: () => buildC130('c130'), buildC17, buildMQ9 })) {
      const m = f(), g = m.group; g.updateMatrixWorld(true);
      const gr = g.getObjectByName('gear');
      if (!gr) { out.push(`${n}: no gear`); disposeTree(g); continue; }
      const bb = new THREE.Box3().setFromObject(gr);
      if (Math.abs(bb.min.y) > 0.01) out.push(`${n}: wheels at y ${bb.min.y.toFixed(3)}`);
      for (let i = 0; i < 25; i++) m.tick(0.05, { gearDown: false });
      if (gr.visible) out.push(`${n}: gear still down after 1.25 s`);
      for (let i = 0; i < 25; i++) m.tick(0.05, { gearDown: true });
      if (!gr.visible || gr.scale.y < 0.99) out.push(`${n}: gear not back down`);
      disposeTree(g);
    }
    return out;
  });
  expect(r).toEqual([]);
});

test("airfield: floodlight masts stand clear of every taxiing aircraft (fuselage and wings, the biggest that uses each route) and of the ground vehicles' ways", async ({ wp }) => {
  const r = await wp.run(() => {
    const fw = Object.values(AIRCRAFT_TYPES).filter(C => C.prototype instanceof FixedWing).map(C => C.spec);
    const biggest = l => l.reduce((b, S) => S.span > b.span ? S : b, l[0]);
    const FIGHTER = biggest(fw.filter(S => S.park === 'f')), ANY = biggest(fw), DRONE = biggest(fw.filter(S => S.park === 'd'));
    const who = s => PARKING.shelters.includes(s) || s.kind === 'f' ? FIGHTER : s.size === 'small' ? DRONE : ANY;
    const routes = [];
    for (const s of [...PARKING.stands, ...PARKING.shelters, ...PARKING.hangars, ...PARKING.remote]) {
      const S = who(s);
      routes.push([AIRFIELD.pushback(s), S], [AIRFIELD.toHold(s), S]);
      for (const R of [RW, BASE_LAYOUT.rwy2]) for (const x0 of [-40, -10, 20, 50]) routes.push([AIRFIELD.homeRoute(s, x0, AIRFIELD.exitFor(s, x0), R), S]);
    }
    // the ground vehicles' ways to the open homes (tug, fuel truck / loader) with the biggest that parks there
    const ways = [];
    for (const s of [...PARKING.stands, ...PARKING.remote]) {
      const S = who(s), D = tugDepot(s), o = S.span / 2 + 0.55, tz = s.z + S.len * 0.12;
      ways.push(tugWay({ spec: S }, s, D, s.z - S.len / 2 - 0.75));
      if (s.row === 'a') for (const sg of [-1, 1]) { const C = nearestDepot(s.x), sx = s.x + sg * o, dir = Math.sign(C.x - sx) || 1; ways.push([C.in, [C.x, C.z], [sx + dir * 1.6, SERVICE_Z], [sx, SERVICE_Z - 1.2], [sx, tz]]); }
    }
    // the pad crews up the corridors (ServiceScene), the crash tenders and the emergency tug out of the fire station
    for (const s of PARKING.heli) { const D = HELI_DEPOT, x = s.x + 3, zc = s.z + 3, sg = Math.sign(D.z - zc) || 1; for (const z of [s.z - 1.2, s.z + 1.1]) ways.push([D.in, [D.x, D.z], [D.x, zc + sg * 1.2], [D.x + 1.4, zc], [x - 1.4, zc], [x, zc - 1.2], [x, z]]); }
    for (const R of [RW, BASE_LAYOUT.rwy2]) for (let x = R.x0 + 6; x < R.x1 - 6; x += 8) for (const dr of FIRE_DOORS) { const to = [x + Math.sign(dr.fx - FIRE_DOORS[1].fx) * 2.4, R.z + R.w / 2 + 1.3]; ways.push([[dr.fx, dr.iz], [dr.fx, dr.z], [dr.fx, R.z + R.w / 2 + 2.6], [lerp(to[0], dr.fx, Math.min(1, 3 / (Math.abs(to[0] - dr.fx) || 1))), to[1] + 0.2], to]); }
    const out = [];
    for (const [mx, mz] of BASE_LAYOUT.masts) {
      for (const pts of ways) {
        const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal'), L = c.getLength();
        for (let u = 0; u <= L; u += 0.25) { const p = c.getPointAt(u / L), d = Math.hypot(mx - p.x, mz - p.z); if (d < 1.0) { out.push(`mast ${mx},${mz}: a vehicle's way passes ${d.toFixed(2)} from it at ${p.x.toFixed(1)},${p.z.toFixed(1)}`); break; } }   // (half a vehicle, 0.45, + its lane offset, 0.5)
      }
      let worst = null;
      for (const [pts, S] of routes) {
        const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal'), L = c.getLength();
        for (let u = 0; u <= L; u += 0.25) {
          const p = c.getPointAt(u / L), t = c.getTangentAt(u / L), dx = mx - p.x, dz = mz - p.z;
          const al = dx * t.x + dz * t.z, sd = Math.abs(dx * t.z - dz * t.x);
          // the aircraft as a cross: fuselage along the heading, wings across it (half a length / span each way)
          const gap = Math.min(Math.hypot(Math.max(0, Math.abs(al) - S.len / 2), sd), Math.hypot(al, Math.max(0, sd - S.span / 2)));
          if (gap < 0.5 && (!worst || gap < worst.gap)) worst = { gap, S: S.key, at: `${p.x.toFixed(1)},${p.z.toFixed(1)}` };
        }
      }
      if (worst) out.push(`mast ${mx},${mz}: a ${worst.S} passes ${worst.gap.toFixed(2)} from it at ${worst.at}`);
    }
    return out;
  });
  expect(r).toEqual([]);
});
