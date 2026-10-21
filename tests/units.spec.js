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

test('roads stay off the runway, the taxiway and the apron, and nothing grows on them', async ({ wp }) => {
  const r = await wp.run(() => {
    const out = [], R = BASE_LAYOUT.rwy;
    for (const road of BASE_LAYOUT.roads) for (let i = 0; i < road.length - 1; i++) for (let u = 0; u <= 1; u += 0.05) {
      const x = road[i][0] + (road[i + 1][0] - road[i][0]) * u, z = road[i][1] + (road[i + 1][1] - road[i][1]) * u;
      if (x > R.x0 - 2 && x < R.x1 + 2 && Math.abs(z - R.z) < R.w / 2 + 1.6) out.push(`road on the runway at ${x.toFixed(0)},${z.toFixed(0)}`);
    }
    let trees = 0; const m = new THREE.Matrix4(), p = new THREE.Vector3();
    for (const v of TERRAIN.veg) for (let i = 0; i < v.count; i++) { v.getMatrixAt(i, m); p.setFromMatrixPosition(m); if (roadDist(p.x, p.z) < BASE_LAYOUT.ROAD_W / 2) trees++; }
    return { out: [...new Set(out)], trees };
  });
  expect(r.out).toEqual([]);
  expect(r.trees).toBe(0);
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
