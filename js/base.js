'use strict';
/* ===== The air base: layout, buildings, runway, lights, air defence =====
   World axes: +X east (the runway heading: every takeoff and landing goes east), +Y up, +Z south; 1 unit ≈ 10 m.
   The camera looks from the south-west, so north (−Z) is the top-left corner of the screen and the runway runs from
   the bottom-left corner to the top-right one. Everything north of the runway is the airfield proper (taxiway, apron,
   shelters, hangars, tower), south of it the helicopter pad, the fire station, air defence and the tank line.
   BASE_LAYOUT is the one source of positions: the models below and the ground traffic (airfield.js) both read it. */
const BASE_LAYOUT = {
  rwy: { x0: -64, x1: 64, z: 8, w: 4.4, td: -54 },          // td: touchdown point (x); 09L/27R with two runways: takeoffs
  rwy2: { x0: -61, x1: 61, z: 22, w: 4.4, td: -51 },        // 09R/27L, south of it: landings (CFG.runways = 2); a little shorter (the perimeter road)
  twy: { z: -2, x0: -66, x1: 68, w: 2.2 },                  // parallel taxiway (westbound)
  links: [-64, -30, 0, 32, 64],                             // runway <-> taxiway links (x); -64 = departure end
  hold: { x: -64, z: 2.6 },                                 // holding point of the departure link
  apron: { x0: -42, x1: 42, z0: -3.1, z1: -26 },
  lane: -16,                                                // apron taxi lane (z), eastbound
  // apron <-> taxiway channels: in (north) west and centre; out (south) by the big hangar and at the east end (east of the
  // last runway link: no head-on meeting there)
  chIn: [-44, -4], chOut: [19.5, 66.5],
  // remote stands at both ends of the apron (slabs joined to it, kept inside the fence): stand xs, rows (z)
  remote: [{ x0: -67.2, x1: -42, z1: -17.6, xs: [-63, -54], rows: [-9] }, { x0: 42, x1: 66, z1: -26, xs: [49, 58], rows: [-9, -20] }],
  // the perimeter fence (clockwise): a rectangle with chamfered corners and, west, an annex around the approach lights
  fence: [[-80, -6], [-80, -56], [-72, -64], [72, -64], [80, -56], [80, 60], [72, 68], [-25, 68], [-61, 68], [-72, 68], [-80, 60], [-80, 32], [-108, 32], [-108, -6]],
  gate: 7,                                                  // fence segment with the main gate (index of its first point)
  towers: [2, 4, 6, 9, 12],                                 // fence corners with a guard tower
  fuel: [[-47, -40], [-40, -44], [-35, -40]], FUEL_R: 1.85,  // fuel farm tanks (the spur road runs in between)
  // vehicle sheds with a roll-up door [x, z, w, d, door face 'n' / 'e' / 's' / 'w', depot point this far in front of the
  // door]: the crew depots west / east (the cargo yard) and the heliport's; ground vehicles set off from inside and drive
  // back in (groundops: garageDepot)
  garages: [[-70.6, -5.8, 3.6, 3.6, 'e', 2.6], [41.2, -9.2, 3.4, 3.6, 's', 1.6], [2.8, 30.4, 3.4, 3.4, 'e', 1.0]],
  // floodlight masts [x, z, aim x, aim z, a real SpotLight]: clear of every taxiing wingtip (units.spec checks it)
  masts: [[-30.1, -12.6, -32, -4, true], [30.9, -12.6, 28, -4, true],   // (behind the front row, in the gaps between stands: on the taxiway's edge a heavy's wing hit them)
    [-48, -12, -54, -14, false], [62.3, -12, 56, -8, false], [34.5, 31, 22, 38, false]],
  fireStation: [-4, 32, 6, 4.5],                            // x, z, w, d: three roll-up doors on its north side
  // with one runway the south strip is a storage yard and scrub: these footprints [x, z, r] (and the fire station's way
  // up to the runway, x −9…1) are kept free of the trees there (TERRAIN.fill)
  fillYard: [[-38, 19, 6.5], [-22, 18, 6.5], [22, 18.5, 3.5], [30, 20, 3.5], [48, 18.5, 3], [59, 15, 3]]   // … and the AA gun
};
const BL = BASE_LAYOUT;
BL.crossZ = BL.rwy.z + BL.rwy.w / 2 + 1.6;   // holding line on the runway connectors in front of the north runway (crossing it)
BL.hold2 = { x: BL.hold.x, z: BL.rwy2.z - BL.rwy2.w / 2 - 1.6 };   // holding point of 09R: departures from the south runway while the north one is closed (AIRFIELD.depR)
BL.channels = [...BL.chIn, ...BL.chOut];
/* a polygon moved `d` inward: each side along its normal, neighbouring sides meet where their offset lines cross */
function insetPoly(P, d) {
  let a2 = 0; for (let i = 0; i < P.length; i++) { const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length]; a2 += x0 * z1 - x1 * z0; }
  const sg = Math.sign(a2), L = P.map((p, i) => {                                          // offset side i: a point and a direction
    const q = P[(i + 1) % P.length], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz), nx = -dz / l * sg, nz = dx / l * sg;
    return [p[0] + nx * d, p[1] + nz * d, dx / l, dz / l];
  });
  return P.map((p, i) => {
    const [ax, az, ux, uz] = L[(i + P.length - 1) % P.length], [bx, bz, vx, vz] = L[i], den = ux * vz - uz * vx;
    if (Math.abs(den) < 1e-9) return [bx, bz];
    const t = ((bx - ax) * vz - (bz - az) * vx) / den;
    return [ax + ux * t, az + uz * t];
  });
}
/* service roads inside the fence ([x, z] polylines): in from the gate past the fire station to the heli pad and the
   barracks, out to the Patriot battery, behind the hangars to the tower, the ops buildings, the fuel farm and the
   radar, and the perimeter road just inside the fence (its points pulled 5 units in toward the centre) */
BL.roads = [
  [[-43, 67.5], [-43, 53], [-36, 47], [-24, 40], [-14, 27.2], [36, 27.2], [44, 35]],   // in at the gate, between the south runway and the heliport
  [[-36, 47], [-41, 41], [-41, 34.5]], [[5.5, 27.2], [5.5, 48.5]],
  [[-44, -26], [-44, -28.7], [36, -28.7], [40, -26]],
  [[-43, -28.7], [-43, -41.5]], [[-18, -28.7], [-18, -38]], [[4, -28.7], [4, -32.2]], [[16, -28.7], [16, -33.5]], [[30, -28.7], [30, -30.6]],
  [[36, -28.7], [41, -36]], [[-2, -28.7], [-2, -47.5]],
  (() => { const f = insetPoly(BL.fence, 5); return [...f, f[0]]; })()
];
BL.ROAD_W = 1.6;
/* how far (x, z) is from the nearest road's centreline */
function roadDist(x, z) {
  let best = Infinity;
  for (const r of BL.roads) for (let i = 0; i < r.length - 1; i++) {
    const [ax, az] = r[i], [bx, bz] = r[i + 1], dx = bx - ax, dz = bz - az, u = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, Math.hypot(x - ax - dx * u, z - az - dz * u));
  }
  return best;
}
/* the runway (in use) at (x, z), within margin m — null off it; and paved ground (a runway, the taxiway, the apron) */
function runwayAt(x, z, m = 0) {
  for (const R of CFG.runways > 1 ? [BL.rwy, BL.rwy2] : [BL.rwy]) if (x > R.x0 - m && x < R.x1 + m && Math.abs(z - R.z) < R.w / 2 + m) return R;
  return null;
}
function pavedAt(x, z) { const T = BL.twy, A = BL.apron; return !!runwayAt(x, z) || (x > T.x0 && x < T.x1 && Math.abs(z - T.z) < T.w / 2) || (x > A.x0 && x < A.x1 && z < A.z0 && z > A.z1); }
/* parking: fighter / heavy stands in the front row, shelters (HAS) and hangars behind the lane, remote stands at the
   ends; everything is entered nose first (yaw: nose north) and left by pushback. kind: 'f' fighter, 'h' heavy, 'd' drone */
function layoutParking() {
  const P = { shelters: [], hangars: [], stands: [], remote: [], heli: [] }, N = 90 * DEG;   // N: yaw of a nose pointing north (−Z)
  for (let k = 0; k < 7; k++) P.stands.push({ x: -37 + 4.6 * k, z: -9, kind: 'f', row: 'a' });
  for (const x of [4, 13, 26, 35]) P.stands.push({ x, z: -9.5, kind: 'h', row: 'a' });   // the gap: out channel 19.5; the noses (and their tugs) clear of the lane
  for (const x of [-37.5, -32, -26.5, -21, -15.5]) P.shelters.push({ x, z: -22, kind: 'f', row: 'b', door: 0, w: 4.4, d: 5.6 });
  P.hangars.push({ x: 4.5, z: -23.8, kind: 'h', row: 'b', door: 0, w: 11, d: 9, size: 'big' });
  P.hangars.push({ x: 17.5, z: -23, kind: 'h', row: 'b', door: 0, w: 8.6, d: 7.4, size: 'medium' });
  for (const x of [27, 32.5]) P.hangars.push({ x, z: -21.6, kind: 'd', row: 'b', door: 0, w: 4.6, d: 4.4, size: 'small' });
  for (const r of BL.remote) for (const z of r.rows) for (const x of r.xs) P.remote.push({ x, z, kind: 'r', row: z > -15 ? 'a' : 'c' });   // the east channel runs past the east end
  for (const z of [32, 38, 44]) for (const x of [11, 17, 23, 29]) P.heli.push({ x, z, yaw: 0, kind: 'heli', occ: null });   // south of the south runway
  for (const l of [P.stands, P.shelters, P.hangars, P.remote]) for (const s of l) { s.yaw = N; s.occ = null; }
  return P;
}
const PARKING = layoutParking();
const GARAGE_DOORS = [];   // roll-up doors of the fire station (the first three) and the vehicle sheds (rollDoors; opened in GROUND_OPS.update)

/* ===== models ===== */
const CONC = 0x8d8c86, ASPH = 0x3c3e40, ASPH2 = 0x4a4c4e, WALL = 0x8f8a7c, WALL2 = 0x7d796e;
/* a flat slab (runway, taxiway, apron…): its top sits at y */
function slab(p, x0, z0, x1, z1, y, c) { const m = box(p, x1 - x0, 0.06, z1 - z0, c, (x0 + x1) / 2, y - 0.03, (z0 + z1) / 2); m.castShadow = false; return m; }
/* runway designator / building lettering painted from a canvas (static, built once) */
function textDecal(p, text, w, h, x, y, z, rotY) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d'); g.font = 'bold 100px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#e6e6de'; g.fillText(text, 128, 70);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshPhongMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
  m.rotation.set(-Math.PI / 2, 0, rotY || 0); m.position.set(x, y, z); m.receiveShadow = true; p.add(m); return m;
}
/* what an aircraft in flight keeps clear of (Aircraft.clearRoofs): the buildings' boxes [x0, x1, z0, z1, top, group] —
   collected by the builders below; one in a hidden group (the storage yard with two runways) doesn't count */
const OBSTACLES = [];
function obstacle(p, x, z, w, d, top, rotY = 0) {
  const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY)), hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
  OBSTACLES.push([x - hw, x + hw, z - hd, z + hd, top, p]); OBSTACLES.top = Math.max(OBSTACLES.top, top);
}
function obstacleTop(x, z, m = 0) { let t = 0; for (const o of OBSTACLES) if (x > o[0] - m && x < o[1] + m && z > o[2] - m && z < o[3] + m && o[4] > t && o[5].visible) t = o[4]; return t; }   // (m: that much around each)
/* hardened aircraft shelter: concrete arch (seasonal material), back wall, front headwall with two sliding door leaves */
function buildShelter(p, s, win) {
  const g = new THREE.Group(); g.position.set(s.x, 0, s.z); p.add(g);
  const r = s.w / 2 + 0.3, arch = new THREE.CylinderGeometry(r, r, s.d, 14, 1, true, Math.PI / 2, Math.PI);
  arch.rotateX(Math.PI / 2); arch.scale(1, 0.62, 1);
  const a = shade(new THREE.Mesh(arch, ARCH_MAT)); a.position.set(0, 0, -0.3); g.add(a);
  const back = new THREE.CircleGeometry(r, 14, 0, Math.PI); back.scale(1, 0.62, 1);
  const bw = shade(new THREE.Mesh(back, M(WALL2))); bw.position.set(0, 0, -s.d / 2 - 0.29); g.add(bw);
  const H = r * 0.62, fz = s.d / 2 - 0.1;
  for (const sx of [-1, 1]) box(g, 0.7, H + 0.3, 0.7, WALL, sx * (r - 0.1), (H + 0.3) / 2, fz);    // headwall pillars
  box(g, s.w + 1.6, 0.5, 0.7, WALL, 0, H + 0.05, fz);                                          // lintel
  box(g, s.w + 1.6, 0.12, 0.8, ROOF_MAT, 0, H + 0.36, fz);
  const leaves = [];
  for (const sx of [-1, 1]) {
    const lg = new THREE.Group(); lg.position.set(sx * s.w / 4, 0, fz + 0.5); g.add(lg);
    box(lg, s.w / 2, H - 0.25, 0.3, 0x6f7068, 0, (H - 0.25) / 2, 0);
    box(lg, s.w / 2, 0.1, 0.32, 0x5e5f58, 0, H * 0.45, 0);
    leaves.push({ g: lg, sx });
  }
  box(g, s.w * 1.6, 0.08, 0.15, DARK, 0, 0.04, fz + 0.5);                                       // door rail
  s.leaves = leaves; s.group = g; s.H = H;
  obstacle(p, s.x, s.z + 0.25, s.w + 1.6, s.d + 1.1, H + 0.42);
  return [...leaves.map(l => l.g)];
}
/* hangar: walls, a shallow curved roof (seasonal), front door made of sliding panels, lit office windows */
function buildHangar(p, s, win) {
  const g = new THREE.Group(); g.position.set(s.x, 0, s.z); p.add(g);
  const H = s.size === 'big' ? 3.4 : s.size === 'medium' ? 2.7 : 1.7, w = s.w, d = s.d;
  box(g, w, H, 0.3, WALL, 0, H / 2, -d / 2);                                                  // back
  for (const sx of [-1, 1]) box(g, 0.3, H, d, WALL, sx * w / 2, H / 2, 0);
  // shallow barrel roof: a cylinder segment along z (top of the arc up), the gables are its outline closed at the eaves
  const R = w * 0.75, th = Math.asin((w / 2) / R), cy = H - R * Math.cos(th), roof = new THREE.CylinderGeometry(R, R, d + 0.4, 12, 1, true, Math.PI - th, th * 2);
  roof.rotateX(Math.PI / 2);
  const rm = shade(new THREE.Mesh(roof, ROOF_MAT)); rm.position.set(0, cy, 0); g.add(rm);
  const gs = new THREE.Shape(); gs.moveTo(-w / 2, H);
  for (let i = 0; i <= 12; i++) { const a = -th + 2 * th * i / 12; gs.lineTo(R * Math.sin(a), cy + R * Math.cos(a)); }
  const gable = new THREE.ShapeGeometry(gs);
  for (const sz of [-1, 1]) { const gm = shade(new THREE.Mesh(gable, M(WALL2))); gm.position.z = sz * (d / 2 - 0.05); if (sz < 0) gm.rotation.y = Math.PI; g.add(gm); }
  box(g, w, 0.5, 0.35, WALL2, 0, H - 0.2, d / 2);                                            // door header
  const nP = s.size === 'small' ? 2 : 4, pw = (w - 0.4) / nP, panels = [];
  for (let i = 0; i < nP; i++) {
    const pg = new THREE.Group(); const x = -w / 2 + 0.2 + pw * (i + 0.5); pg.position.set(x, 0, d / 2 + 0.05 + (i % 2) * 0.12); g.add(pg);
    box(pg, pw, H - 0.45, 0.1, 0x7e8a86, 0, (H - 0.45) / 2, 0);
    box(pg, pw * 0.9, 0.3, 0.12, 0x9fb0b6, 0, H * 0.7, 0);                                    // window band
    panels.push({ g: pg, x0: x, x1: Math.sign(x) * (w / 2 + pw / 2 + 0.1) });                 // open: slid out past the side walls
  }
  if (s.size !== 'small') { box(g, w * 0.3, 1.2, 1.2, WALL2, -w / 2 + w * 0.15, 0.6, -d / 2 - 0.6); box(g, w * 0.3 + 0.02, 0.22, 0.02, win, -w / 2 + w * 0.15, 0.8, -d / 2 - 1.21); }   // office lean-to
  s.panels = panels; s.group = g; s.H = H;
  obstacle(p, s.x, s.z, w + 0.3, d + 0.4, cy + R);                                              // (up to the roof's crown)
  return panels.map(q => q.g);
}
/* control tower: shaft, glazed cab (window material, lit at night), roof, beacon and antennas */
function buildTower(p, x, z, win) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(0.75); p.add(g);
  obstacle(p, x - 0.9 * 0.75, z, 4.4 * 0.75, 3.3 * 0.75, 1.8 * 0.75); obstacle(p, x + 0.6 * 0.75, z, 3.2 * 0.75, 3.2 * 0.75, 7.45 * 0.75);   // base, shaft and cab (up to its roof: the antennas are wires)
  box(g, 4.2, 1.6, 3.2, WALL, -1.2, 0.8, 0); box(g, 4.3, 0.12, 3.3, ROOF_MAT, -1.2, 1.66, 0);  // base building
  box(g, 4.25, 0.25, 0.02, win, -1.2, 1.0, 1.61);
  taper(g, 1.6, 6.2, 1.6, WALL, 0.6, 3.1, 0, 0.82, 0.82);                                    // shaft
  for (let i = 0; i < 4; i++) box(g, 1.34, 0.12, 0.02, win, 0.6, 1.5 + i * 1.3, 0.69);       // stairwell windows
  const cab = shade(new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.2, 0.9, 8), win)); cab.position.set(0.6, 6.7, 0); cab.rotation.y = Math.PI / 8; g.add(cab);
  cyl(g, 1.25, 1.2, 0.2, 8, WALL2, 0.6, 6.15, 0).rotation.y = Math.PI / 8;
  cyl(g, 1.6, 1.5, 0.18, 8, ROOF_MAT, 0.6, 7.24, 0).rotation.y = Math.PI / 8;
  cyl(g, 0.04, 0.05, 1.6, 4, DARK, 0.2, 8.1, 0.3); cyl(g, 0.03, 0.04, 1.1, 4, DARK, 1.1, 7.9, -0.4);
  const lights = [navLights(g, [[0.6, 7.45, 0, 0x30ff70]], { period: 2.0, duty: 0.45 }, 1.6), navLights(g, [[0.6, 7.45, 0, 0xffffff]], { period: 2.0, duty: 0.45, phase: 0.5 }, 1.6),
    navLights(g, [[0.2, 8.9, 0.3, 0xff2020]], { period: 1.4, duty: 0.3 }, 1.2)];
  return { g, lights };
}
/* airport surveillance radar: lattice mast and the rotating antenna (dynamic) */
function buildRadar(p, x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); p.add(g);
  obstacle(p, x, z, 2.8, 2.8, 5.3);
  box(g, 1.6, 0.8, 1.6, WALL2, 0, 0.4, 0);
  for (const [a, b] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) strut(g, new V3(a, 0.8, b), new V3(a * 0.3, 4.2, b * 0.3), 0.05, 0x9a9a92);
  box(g, 0.8, 0.1, 0.8, 0x9a9a92, 0, 4.25, 0);
  const ant = new THREE.Group(); ant.position.set(x, 4.35, z); p.add(ant);
  cyl(ant, 0.12, 0.15, 0.3, 6, DARK, 0, 0.15, 0);
  const refl = box(ant, 0.2, 0.7, 2.6, 0xcfd2d4, 0.25, 0.55, 0); refl.rotation.z = 0.35;
  box(ant, 0.5, 0.15, 0.15, DARK, 0.05, 0.3, 0);
  navLights(g, [[0, 4.3, 0.45, 0xff2020]], { period: 1.6, duty: 0.3 }, 1.0);
  return ant;
}
/* a door on the `face` side of a building centred (cx, cz), w × d, `o` along the side: its centre on the wall (fx, fz),
   the point `out` in front of it (x, z) and one inside, 2.3 behind the wall (ix, iz: a vehicle there is hidden) */
const FACE = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
function doorAt(cx, cz, w, d, face, o, out) {
  const [nx, nz] = FACE[face], half = nx ? w / 2 : d / 2, fx = cx + nx * half + (nx ? 0 : o), fz = cz + nz * half + (nz ? 0 : o);
  return { fx, fz, nx, nz, x: fx + nx * out, z: fz + nz * out, ix: fx - nx * 2.3, iz: fz - nz * 2.3 };
}
/* roll-up doors (n, dw wide, dh high, spaced `gap`) on a building, a dark opening behind each (a vehicle driving through
   is hidden by the solid building inside). Returns GARAGE_DOORS entries: doorAt's points plus g (dynamic: scaled up to
   roll it open) and k (open 0..1) */
function rollDoors(p, cx, cz, w, d, face, n, dw, dh, gap, c, out) {
  const res = [];
  for (let i = 0; i < n; i++) {
    const q = doorAt(cx, cz, w, d, face, (i - (n - 1) / 2) * gap, out), { fx, fz, nx, nz } = q, ry = Math.atan2(nx, nz);
    const op = box(p, dw, dh, 0.02, 0x1c1d1e, fx + nx * 0.02, dh / 2, fz + nz * 0.02); op.rotation.y = ry; op.castShadow = false;   // the opening
    const hd = box(p, dw + 0.2, 0.22, 0.16, 0x6a6c6e, fx + nx * 0.08, dh + 0.11, fz + nz * 0.08); hd.rotation.y = ry;          // the roll drum
    const g = new THREE.Group(); g.position.set(fx + nx * 0.05, dh, fz + nz * 0.05); g.rotation.y = ry; p.add(g);
    box(g, dw, dh, 0.04, c, 0, -dh / 2, 0);                                                    // one mesh (it stays dynamic: a draw call each)
    for (let k = 1; k < 5; k++) { const sl = box(p, dw, 0.025, 0.02, 0x4a4c4e, fx + nx * 0.005, dh * k / 5, fz + nz * 0.005); sl.rotation.y = ry; sl.castShadow = false; }   // the frame's rails, seen when it is up
    res.push(Object.assign(q, { g, k: 0 }));
  }
  return res;
}
/* a vehicle shed: walls, flat roof, a concrete pad in front, one roll-up door (rollDoors) */
function buildGarage(p, [x, z, w, d, face, out], win) {
  const h = 1.8, [nx, nz] = FACE[face];
  obstacle(p, x, z, w + 0.15, d + 0.15, h + 0.1);
  box(p, w, h, d, WALL2, x, h / 2, z); box(p, w + 0.15, 0.1, d + 0.15, ROOF_MAT, x, h + 0.05, z);
  const pl = nx ? w / 2 : d / 2, ax = x + nx * pl, bx = x + nx * (pl + 1.4), az = z + nz * pl, bz = z + nz * (pl + 1.4), sx = Math.abs(nz) * 1.2, sz = Math.abs(nx) * 1.2;
  slab(p, Math.min(ax, bx) - sx, Math.min(az, bz) - sz, Math.max(ax, bx) + sx, Math.max(az, bz) + sz, 0.035, CONC);   // the pad in front of the door
  const sw = box(p, nx ? 0.02 : w * 0.3, 0.2, nz ? 0.02 : d * 0.3, win, x - nx * (w / 2 + 0.01) + (nz ? w * 0.25 : 0), 1.2, z - nz * (d / 2 + 0.01) + (nx ? d * 0.25 : 0)); sw.castShadow = false;   // a window at the back
  return rollDoors(p, x, z, w, d, face, 1, 1.9, 1.3, 0, 0x8a8f86, out);
}
function buildBuilding(p, x, z, w, d, h, win, rotY, c) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY || 0; p.add(g);
  obstacle(p, x, z, w + 0.15, d + 0.15, h + 0.42, rotY);
  box(g, w, h, d, c || WALL, 0, h / 2, 0); box(g, w + 0.15, 0.12, d + 0.15, ROOF_MAT, 0, h + 0.06, 0);
  for (const sz of [-1, 1]) for (let fy = 0; fy < Math.round(h / 1.1); fy++) box(g, w * 0.86, 0.22, 0.02, win, 0, 0.6 + fy * 1.1, sz * (d / 2 + 0.01));
  box(g, 0.5, 0.3, 0.4, 0x7a7d80, w * 0.25, h + 0.27, 0);                                    // AC unit
  return g;
}
/* light mast with floodlights (one real SpotLight on the first `real` masts, cones only on the rest) */
function buildLightMast(p, x, z, aimX, aimZ, real) {
  cyl(p, 0.08, 0.12, 5.2, 5, 0x8a8c8e, x, 2.6, z); box(p, 0.9, 0.12, 0.2, 0x55585b, x, 5.25, z); obstacle(p, x, z, 1.2, 1.2, 5.4);
  const sl = makeSearchlight(p, x, 5.15, z, { angle: 0.55, len: 14, intensity: 1.4, coneOpacity: 0.07, color: 0xffe2b8, noLight: !real });
  sl.holder.lookAt(aimX, 0, aimZ); sl.mast = true;
  return sl;
}
/* roads: asphalt strips along the polylines, a disc at every bend (merged with the rest of the base) */
function buildRoads(p) {
  const W = BL.ROAD_W, C = 0x56585a;
  for (const r of BL.roads) {
    for (let i = 0; i < r.length - 1; i++) {
      const [ax, az] = r[i], [bx, bz] = r[i + 1], m = box(p, Math.hypot(bx - ax, bz - az), 0.04, W, C, (ax + bx) / 2, 0.002, (az + bz) / 2);
      m.rotation.y = Math.atan2(-(bz - az), bx - ax); m.castShadow = false;
    }
    for (const [x, z] of r) cyl(p, W / 2, W / 2, 0.04, 10, C, x, 0.001, z).castShadow = false;
  }
}
/* fence: posts (one instanced mesh), three wires and concertina on top (merged), a gap with a barrier at the gate */
function buildFence(p) {
  const pts = BL.fence, posts = [], wireMat = M(0x6c7074);
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length], L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 3.2);
    const gate = i === BL.gate, g0 = 0.45, g1 = 0.55;
    for (let k = 0; k <= n; k++) { const u = k / n; if (gate && u > g0 && u < g1) continue; posts.push([ax + (bx - ax) * u, az + (bz - az) * u]); }
    const seg = (u0, u1) => {
      const x0 = ax + (bx - ax) * u0, z0 = az + (bz - az) * u0, x1 = ax + (bx - ax) * u1, z1 = az + (bz - az) * u1, l = Math.hypot(x1 - x0, z1 - z0), r = Math.atan2(-(z1 - z0), x1 - x0);
      for (const y of [0.35, 0.8, 1.25]) { const m = box(p, l, 0.025, 0.025, wireMat, (x0 + x1) / 2, y, (z0 + z1) / 2); m.rotation.y = r; m.castShadow = false; }
      const c = box(p, l, 0.2, 0.2, M(0x5a5e62), (x0 + x1) / 2, 1.5, (z0 + z1) / 2); c.rotation.y = r; c.castShadow = false;
    };
    if (gate) {
      seg(0, g0); seg(g1, 1);
      const gx = ax + (bx - ax) * 0.5, gz = az + (bz - az) * 0.5, r = Math.atan2(-(bz - az), bx - ax);
      const bar = box(p, L * 0.1, 0.08, 0.08, 0xd03a2a, gx, 0.9, gz); bar.rotation.y = r;           // barrier
      const hx = gx + Math.sin(r) * 2.2 + Math.cos(r) * 3, hz = gz + Math.cos(r) * 2.2 - Math.sin(r) * 3;   // guard hut, inside, beside the road
      box(p, 1.3, 1.3, 1.3, WALL, hx, 0.65, hz).rotation.y = r; box(p, 1.45, 0.12, 1.45, ROOF_MAT, hx, 1.36, hz).rotation.y = r;
      BL.gatePos = new V3(gx, 0, gz); BL.gateOut = new V3(-Math.sin(r), 0, -Math.cos(r));          // outward normal of the gate (the fence runs clockwise)
    } else seg(0, 1);
  }
  const geo = new THREE.CylinderGeometry(0.05, 0.05, 1.7, 4); geo.translate(0, 0.85, 0);
  const inst = new THREE.InstancedMesh(geo, M(0x6c7074), posts.length), m4 = new THREE.Matrix4();
  posts.forEach(([x, z], i) => inst.setMatrixAt(i, m4.makeTranslation(x, 0, z)));
  inst.castShadow = true; inst.receiveShadow = true; p.add(inst);
  return inst;
}
/* guard tower at a fence corner, with a searchlight sweeping the ground outside (cone only) */
function buildGuardTower(p, x, z, outAng) {
  for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) strut(p, new V3(x + a, 0, z + b), new V3(x + a * 0.7, 3.2, z + b * 0.7), 0.06, 0x6a5e4c);
  box(p, 1.4, 0.9, 1.4, 0x7a6e5a, x, 3.6, z); box(p, 1.7, 0.12, 1.7, ROOF_MAT, x, 4.4, z);
  const sl = makeSearchlight(p, x, 4.2, z, { angle: 0.12, len: 34, intensity: 2, coneOpacity: 0.35, noLight: true });
  sl.sweep = { base: outAng, amp: 55 * DEG, speed: rand(0.1, 0.18), ph: rand(0, 6), dist: 24, y: -4 };
  return sl;
}
/* sky searchlight (air raid style): a big lamp on a stand whose beam sweeps the sky; in combat it tracks bandits */
function buildSkyLight(p, x, z) {
  cyl(p, 0.45, 0.55, 0.35, 8, OLIVE2, x, 0.18, z); box(p, 0.3, 0.6, 0.9, OLIVE2, x, 0.6, z);
  const sl = makeSearchlight(p, x, 1.05, z, { angle: 0.05, len: 90, intensity: 2, coneOpacity: 0.28, color: 0xdfe8ff, noLight: true });
  const h = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.5, 8), M(0x4a4e50)); h.rotation.x = Math.PI / 2; sl.holder.add(h);
  sl.sky = { ph: rand(0, 6), speed: rand(0.08, 0.14), elev: rand(0.75, 1.05) };
  return sl;
}

/* a runway: asphalt with shoulders, threshold bars, centreline, touchdown zones, edge lines; its edge / threshold /
   approach lights and PAPI into `lines` (papi: -1 north side, 1 south), the sequenced flashers into `rabbit`.
   Returns the designator decals ([09…, 27…] per set of names) so the caller can switch them. */
function buildRunway(g, R, names, lines, rabbit, papi) {
  slab(g, R.x0 - 2, R.z - R.w / 2 - 0.8, R.x1 + 2, R.z + R.w / 2 + 0.8, 0.02, ASPH2);
  slab(g, R.x0, R.z - R.w / 2, R.x1, R.z + R.w / 2, 0.04, ASPH);
  const my = 0.046, W = 0xe6e6de;
  for (const sx of [-1, 1]) deckLine(g, R.x0, R.z + sx * (R.w / 2 - 0.12), R.x1, R.z + sx * (R.w / 2 - 0.12), 0.1, W, my);
  dashed(g, R.x0 + 9, R.z, R.x1 - 9, R.z, 0.12, W, my, 2.4, 1.6);
  for (const [x0, dir] of [[R.x0, 1], [R.x1, -1]]) {
    for (let i = 0; i < 6; i++) { const z = R.z - R.w / 2 + 0.45 + i * (R.w - 0.9) / 5; deckLine(g, x0 + dir * 0.6, z, x0 + dir * 3.4, z, 0.26, W, my); }
    deckLine(g, x0 + dir * 0.25, R.z - R.w / 2 + 0.2, x0 + dir * 0.25, R.z + R.w / 2 - 0.2, 0.14, W, my);
    for (const k of [12, 18]) for (const sz of [-1, 1]) deckLine(g, x0 + dir * k, R.z + sz * 1.2, x0 + dir * (k + 2), R.z + sz * 1.2, 0.36, W, my);   // touchdown zone / aiming point
  }
  const decals = names.map(([a, b]) => [textDecal(g, a, 3.2, 1.6, R.x0 + 6.5, my + 0.002, R.z, -Math.PI / 2), textDecal(g, b, 3.2, 1.6, R.x1 - 6.5, my + 0.002, R.z, Math.PI / 2)]);
  for (let x = R.x0; x <= R.x1 + 0.01; x += 6) for (const sz of [-1, 1]) lines.push([x, 0.1, R.z + sz * (R.w / 2 + 0.25), 0xfff2c8]);
  for (let z = R.z - R.w / 2; z <= R.z + R.w / 2 + 0.01; z += 0.55) { lines.push([R.x0 - 0.3, 0.1, z, 0x30ff60]); lines.push([R.x1 + 0.3, 0.1, z, 0xff3020]); }
  for (let x = R.x0 - 4; x > R.x0 - 34; x -= 3) for (let k = -2; k <= 2; k++) lines.push([x, 0.15, R.z + k * 0.45, 0xffffff]);
  for (const sx of [-1, 1]) for (let x = R.x0 - 8; x > R.x0 - 18; x -= 3) lines.push([x, 0.15, R.z + sx * 1.6, 0xff4030]);
  for (let i = 0; i < 4; i++) lines.push([R.td + 2, 0.18, R.z + papi * (R.w / 2 + 1.2 + i * 0.5), i < 2 ? 0xffffff : 0xff3020]);   // PAPI: two white, two red = on the glide path
  for (let i = 0; i < 10; i++) rabbit.push(navLights(g, [[R.x0 - 34 + i * 3, 0.2, R.z, 0xffffff]], { period: 0.5, duty: 0.07, phase: -i * 0.05 }, 1.3));   // sequenced flashers run toward the runway
  return decals;
}
/* the whole base; returns its parts (mounts, lights, doors, structures to hit) for main.js / airfield.js */
function buildBase() {
  OBSTACLES.length = 0; OBSTACLES.top = 0;
  const g = new THREE.Group(), dyn = [], win = windowMat(), R = BL.rwy, TW = BL.twy, A = BL.apron;
  const lines = [];   // light lists for navLights
  const rabbit = [], my = 0.046;
  // --- runways: the north one (designators 09/27, or 09L/27R with two); the south one in its own group (shown with two
  // runways, see setRunways), with the connectors on from the links and a holding line in front of the north runway; the
  // one at the departure link (x −64, past 09L's end) takes the departures down to 09R while 09L is closed
  const desig1 = buildRunway(g, R, [['09', '27'], ['09L', '27R']], lines, rabbit, -1);
  dyn.push(...desig1.flat());
  const g2 = new THREE.Group(), R2 = BL.rwy2, lines2 = [];
  buildRunway(g2, R2, [['09R', '27L']], lines2, rabbit, 1);
  for (const lx of BL.links) {
    slab(g2, lx - TW.w / 2, R.z + R.w / 2, lx + TW.w / 2, R2.z - R2.w / 2, 0.035, ASPH2);
    if (lx - TW.w / 2 < R.x0) slab(g2, lx - TW.w / 2, R.z - R.w / 2, R.x0, R.z + R.w / 2, 0.035, ASPH2);   // across the north runway's end
    deckLine(g2, lx, R.z + R.w / 2, lx, R2.z - R2.w / 2, 0.08, 0xd8b030, my - 0.006);
    for (const dz of [0, 0.3]) deckLine(g2, lx - TW.w / 2 + 0.15, BL.crossZ + dz, lx + TW.w / 2 - 0.15, BL.crossZ + dz, 0.07, 0xd8b030, my);   // hold short of the north runway
    for (const sx of [-1, 1]) for (let z = R.z + R.w / 2 + 1.6; z < R2.z - R2.w / 2 - 1; z += 3) lines2.push([lx + sx * (TW.w / 2 + 0.2), 0.1, z, 0x4a7cff]);
    // a connector past the south runway's end (it is shorter): a stub on from its end, the exit line curving onto it —
    // without it the last exit (AIRFIELD.homeRoute) once ran over the grass
    if (lx + TW.w / 2 > R2.x1) {
      slab(g2, R2.x1, R2.z - R2.w / 2, lx + TW.w / 2, R2.z + R2.w / 2, 0.035, ASPH2);
      deckLine(g2, R2.x1, R2.z, lx - 1, R2.z - 0.6, 0.08, 0xd8b030, my - 0.006); deckLine(g2, lx - 1, R2.z - 0.6, lx, R2.z - R2.w / 2, 0.08, 0xd8b030, my - 0.006);
    }
    if (lx - TW.w / 2 < R2.x0) {                                     // and before its west end: onto it for a takeoff
      slab(g2, lx - TW.w / 2, R2.z - R2.w / 2, R2.x0, R2.z + R2.w / 2, 0.035, ASPH2);
      deckLine(g2, lx, R2.z - R2.w / 2, lx + 1, R2.z - 0.6, 0.08, 0xd8b030, my - 0.006); deckLine(g2, lx + 1, R2.z - 0.6, R2.x0, R2.z, 0.08, 0xd8b030, my - 0.006);
      for (const sz of [-0.15, 0.15]) deckLine(g2, lx - TW.w / 2 + 0.15, BL.hold2.z + sz, lx + TW.w / 2 - 0.15, BL.hold2.z + sz, 0.07, 0xd8b030, my);   // hold short of 09R
    }
  }
  slab(g2, -7.5, R2.z + R2.w / 2 + 0.9, -0.5, 29.7, 0.03, CONC);   // the fire station's apron out onto it
  navLights(g2, lines2, null, 0.8);
  mergeStatic(g2, []);
  // --- taxiway, links, apron, remote stands, holding point
  slab(g, TW.x0, TW.z - TW.w / 2, TW.x1, TW.z + TW.w / 2, 0.035, ASPH2);
  deckLine(g, TW.x0, TW.z, TW.x1, TW.z, 0.08, 0xd8b030, my - 0.006);
  for (const lx of BL.links) { slab(g, lx - TW.w / 2, TW.z, lx + TW.w / 2, R.z - R.w / 2, 0.035, ASPH2); deckLine(g, lx, TW.z, lx, R.z - R.w / 2, 0.08, 0xd8b030, my - 0.006); }
  for (const sz of [-0.15, 0.15]) deckLine(g, BL.hold.x - 1.1, BL.hold.z + sz, BL.hold.x + 1.1, BL.hold.z + sz, 0.07, 0xd8b030, my);
  slab(g, A.x0, A.z1, A.x1, A.z0, 0.03, CONC);
  for (const r of BL.remote) slab(g, r.x0, r.z1, r.x1, A.z0, 0.03, CONC);
  for (const cx of BL.channels) slab(g, cx - 1.6, BL.lane - 1.6, cx + 1.6, A.z0, 0.03, CONC);   // channels and the lane's ends on concrete
  for (const cx of BL.channels) deckLine(g, cx, TW.z, cx, BL.lane, 0.08, 0xd8b030, my - 0.012);
  deckLine(g, BL.chIn[0], BL.lane, BL.chOut[BL.chOut.length - 1], BL.lane, 0.08, 0xd8b030, my - 0.012);
  // --- heliport and the fire station south of the south runway (its apron with the south runway, above), the roads
  slab(g, 7.5, 28.5, 32.5, 47.5, 0.03, CONC);
  buildRoads(g);
  // --- shelters, hangars, tower, radar, buildings
  const P = PARKING;
  for (const s of P.shelters) dyn.push(...buildShelter(g, s, win));
  for (const s of P.hangars) dyn.push(...buildHangar(g, s, win));
  const tower = buildTower(g, -7, -31, win);
  const radar = buildRadar(g, 16, -36); dyn.push(radar);
  buildBuilding(g, -24, -32, 8, 3.6, 1.8, win); buildBuilding(g, -24, -38, 8, 3.6, 1.8, win);   // ops, squadron buildings
  buildBuilding(g, 4, -34, 6, 3.4, 2.6, win); buildBuilding(g, 30, -32.5, 5, 4, 1.8, win);
  buildBuilding(g, 52, 32, 10, 3.6, 2.2, win, 0.5, 0x8a8370); buildBuilding(g, 40, 42, 10, 3.6, 2.2, win, 0.5, 0x8a8370);   // barracks
  buildBuilding(g, BL.fireStation[0], BL.fireStation[1], BL.fireStation[2], BL.fireStation[3], 2.0, win, 0, 0x9a6a5a);   // fire station
  GARAGE_DOORS.length = 0;
  GARAGE_DOORS.push(...rollDoors(g, ...BL.fireStation, 'n', 3, 1.7, 1.5, 2, 0x8a2a20, 1));    // its doors, onto the south runway (FIRE_DOORS)
  for (const G of BL.garages) GARAGE_DOORS.push(...buildGarage(g, G, win));
  for (const [x, z] of BL.fuel) { cyl(g, BL.FUEL_R - 0.05, BL.FUEL_R - 0.05, 2.0, 12, 0xd8d8d0, x, 1.0, z); cyl(g, BL.FUEL_R, BL.FUEL_R, 0.12, 12, ROOF_MAT, x, 2.06, z); }   // fuel farm
  // --- fence, guard towers, gate road
  dyn.push(buildFence(g));
  const guards = [];
  for (const i of BL.towers) { const [x, z] = BL.fence[i]; guards.push(buildGuardTower(g, x * 0.97, z * 0.97, Math.atan2(-z, x))); }
  const gp = BL.gatePos, go = BL.gateOut;
  const road = box(g, 170, 0.04, 3.0, ASPH2, gp.x + go.x * 75, 0.01, gp.z + go.z * 75); road.rotation.y = Math.atan2(-go.z, go.x); road.castShadow = false;   // the road in (enemy columns come along it)
  // --- air defence, tanks (mounts are dynamic)
  const mounts = { ciws: [], aa: [], tanks: [], sams: [], shorad: [] };
  const add = (list, m) => { list.push(m); dyn.push(m.yawG, m.pitchG); if (m.barrelG) dyn.push(m.barrelG); if (m.search) dyn.push(m.search); return m; };
  add(mounts.ciws, buildCRAM(g, -12, 35, 225, 120)); add(mounts.ciws, buildCRAM(g, -2, -50, 135, 120)); add(mounts.ciws, buildCRAM(g, 44, -4, 45, 120));
  add(mounts.aa, buildAAGun(g, -56, -16, 200, 140)); add(mounts.aa, buildAAGun(g, 59, 15, 20, 140)); add(mounts.aa, buildAAGun(g, -20, 57, 235, 140)); add(mounts.aa, buildAAGun(g, 30, -52, 90, 140));
  for (const [x, z, f] of [[-22, 49, 230], [-6, 56, 255], [18, 58, 290], [-56, 28.5, 200]]) add(mounts.tanks, buildTank(g, x, z, f, 70, true));
  const pr = buildPatriotRadar(g, -40, 32, 215); dyn.push(pr.head);
  for (const [x, z, f] of [[-49, 38, 215], [-30, 33, 230], [-33, 40, 245], [-54, 34, 200]]) add(mounts.sams, buildSamLauncher(g, x, z, f, 70, 'patriot'));
  for (const [x, z, f] of [[38, -40, 60], [44, -34, 40]]) add(mounts.sams, buildSamLauncher(g, x, z, f, 80, 'nasams'));
  add(mounts.shorad, buildAvenger(g, -60, 4, 180, 150)); add(mounts.shorad, buildAvenger(g, 60, -20, 20, 150)); add(mounts.shorad, buildAvenger(g, -14, 50, 300, 150));
  // --- lights: runway edge, thresholds, approach lights + sequenced flashers, PAPI, taxiway edges, apron masts
  for (let x = TW.x0; x <= TW.x1; x += 4) for (const sz of [-1, 1]) lines.push([x, 0.1, TW.z + sz * (TW.w / 2 + 0.2), 0x4a7cff]);
  const navs = [navLights(g, lines, null, 0.8), ...tower.lights];
  const floods = [];
  for (const [x, z, ax, az, real] of BL.masts) floods.push(buildLightMast(g, x, z, ax, az, real));
  const skyLights = [[-30, 52], [60, -36], [-62, 30], [40, 52]].map(([x, z]) => buildSkyLight(g, x, z));
  dyn.push(...floods.map(f => f.holder), ...guards.map(s => s.holder), ...skyLights.map(s => s.holder), ...GARAGE_DOORS.map(o => o.g));
  mergeStatic(g, dyn);
  g.add(g2);                                                 // after the merge: the south runway keeps its own meshes
  // structures the enemy aims at: a world point on each (cruise missiles, bombs) and the panel's site rows
  const targets = [
    ...P.shelters.map(s => ({ p: new V3(s.x, 1.6, s.z), name: 'HAS' })), ...P.hangars.slice(0, 2).map(s => ({ p: new V3(s.x, s.H * 0.8, s.z), name: 'HANGAR' })),
    { p: new V3(-7, 4.5, -31), name: 'TOWER' }, { p: new V3(-24, 1.4, -35), name: 'OPS' }, { p: new V3(-41, 1.5, -41.5), name: 'FUEL' },
    { p: new V3(-40, 1.2, 32), name: 'PATRIOT' }, { p: new V3(-4, 1.2, 32), name: 'FIRE STN' }, { p: new V3(20, 0.5, R.z), name: 'RUNWAY' }, { p: new V3(-20, 0.5, R.z), name: 'RUNWAY' }
  ];
  // --- with one runway: a storage yard on the south strip (containers, a warehouse, sheds, a sandbag position) and the
  // fire station's apron all the way up to the runway; trees around them come from TERRAIN.fill
  const gF = new THREE.Group();
  slab(gF, -7.5, R.z + R.w / 2 + 0.9, -0.5, 29.7, 0.03, CONC);
  buildBuilding(gF, -38, 19, 9, 4, 2.2, win, 0, 0x8a8370);                                   // warehouse
  const CONT = [0x7a4a32, 0x3f5a6a, 0x5a6a3a, 0x8a7a4a, 0x6a3a3a];
  for (let i = 0; i < 4; i++) for (const [dz, k] of [[-0.7, 0], [0.7, 1]]) for (let j = 0; j < (i + k) % 3 + 1 && j < 2; j++) {   // container stacks
    box(gF, 2.4, 0.95, 1.1, CONT[(i * 2 + k + j) % CONT.length], -25.5 + i * 2.6, 0.48 + j * 0.97, 18 + dz);
  }
  buildBuilding(gF, 22, 18.5, 4, 3, 1.6, win, 0.2, WALL2); buildBuilding(gF, 30, 20, 4, 3, 1.6, win, -0.3, WALL2);   // sheds
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; taper(gF, 1.1, 0.5, 0.6, 0x9a8a62, 48 + Math.cos(a) * 1.8, 0.25, 18.5 + Math.sin(a) * 1.8, 0.8, 0.8).rotation.y = -a; }   // sandbag ring
  mergeStatic(gF, []);
  g.add(gF);
  const setRunways = n => {
    g2.visible = n > 1; gF.visible = n < 2; desig1[0].forEach(m => m.visible = n < 2); desig1[1].forEach(m => m.visible = n > 1);
    if (typeof TERRAIN !== 'undefined') TERRAIN.setFill(n < 2);
  };
  setRunways(CFG.runways);
  return { group: g, rwy2: g2, fill: gF, setRunways, winMat: win, deckY: 0, mounts, radars: [radar], navs, rabbit, floods, guards, skyLights, targets, patriotRadar: pr, name: 'base' };
}
