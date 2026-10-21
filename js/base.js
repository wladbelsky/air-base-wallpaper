'use strict';
/* ===== The air base: layout, buildings, runway, lights, air defence =====
   World axes: +X east (the runway heading: every takeoff and landing goes east), +Y up, +Z south; 1 unit ≈ 10 m.
   The camera looks from the south-west, so north (−Z) is the top-left corner of the screen and the runway runs from
   the bottom-left corner to the top-right one. Everything north of the runway is the airfield proper (taxiway, apron,
   shelters, hangars, tower), south of it the helicopter pad, the fire station, air defence and the tank line.
   BASE_LAYOUT is the one source of positions: the models below and the ground traffic (airfield.js) both read it. */
const BASE_LAYOUT = {
  rwy: { x0: -64, x1: 64, z: 8, w: 4.4, td: -54 },          // td: touchdown point (x)
  twy: { z: -2, x0: -66, x1: 66, w: 2.2 },                  // parallel taxiway (westbound)
  links: [-64, -30, 0, 32, 64],                             // runway <-> taxiway links (x); -64 = departure end
  hold: { x: -64, z: 2.6 },                                 // holding point of the departure link
  apron: { x0: -42, x1: 42, z0: -3.1, z1: -26 },
  lane: -16,                                                // apron taxi lane (z), eastbound
  channels: [-44, -4, 64],                                  // apron <-> taxiway: west and centre channels in (north), the east one out (south)
  remote: [{ x0: -70, x1: -44 }, { x0: 44, x1: 68 }],       // remote stands, both ends of the apron
  fence: [[-74, -2], [-58, -40], [-24, -66], [12, -70], [50, -50], [76, -14], [74, 22], [44, 54], [8, 72], [-28, 64], [-58, 42], [-76, 18]],
  gate: 9                                                   // fence segment with the main gate (index of its first point)
};
const BL = BASE_LAYOUT;
/* service roads inside the fence ([x, z] polylines): in from the gate past the fire station to the heli pad and the
   barracks, out to the Patriot battery, behind the hangars to the tower, the ops buildings, the fuel farm and the
   radar, and the perimeter road just inside the fence (its points pulled 5 units in toward the centre) */
BL.roads = [
  [[-43, 53], [-37, 46], [-24, 33], [-12, 23], [5.5, 23], [5.5, 35.5], [34, 35.5], [46, 37]],
  [[-24, 33], [-30, 25], [-37, 25]],
  [[-44, -26], [-44, -28.7], [36, -28.7], [40, -26]],
  [[-43, -28.7], [-43, -41.5]], [[-18, -28.7], [-18, -38]], [[4, -28.7], [4, -32.2]], [[16, -28.7], [16, -33.5]], [[30, -28.7], [30, -30.6]],
  [[36, -28.7], [41, -36]], [[-2, -28.7], [-2, -47.5]],
  (() => { const f = BL.fence.map(([x, z]) => { const l = Math.hypot(x, z); return [x - x / l * 5, z - z / l * 5]; }); return [...f, f[0]]; })()
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
/* parking: fighter / heavy stands in the front row, shelters (HAS) and hangars behind the lane, remote stands at the
   ends; everything is entered nose first (yaw: nose north) and left by pushback. kind: 'f' fighter, 'h' heavy, 'd' drone */
function layoutParking() {
  const P = { shelters: [], hangars: [], stands: [], remote: [], heli: [] }, N = 90 * DEG;   // N: yaw of a nose pointing north (−Z)
  for (let k = 0; k < 7; k++) P.stands.push({ x: -37 + 4.6 * k, z: -9, kind: 'f', row: 'a' });
  for (const x of [5, 14, 23, 32]) P.stands.push({ x, z: -10, kind: 'h', row: 'a' });
  for (const x of [-37.5, -32, -26.5, -21, -15.5]) P.shelters.push({ x, z: -22, kind: 'f', row: 'b', door: 0, w: 4.4, d: 5.6 });
  P.hangars.push({ x: 4.5, z: -23.8, kind: 'h', row: 'b', door: 0, w: 11, d: 9, size: 'big' });
  P.hangars.push({ x: 17.5, z: -23, kind: 'h', row: 'b', door: 0, w: 8.6, d: 7.4, size: 'medium' });
  for (const x of [27, 32.5]) P.hangars.push({ x, z: -21.6, kind: 'd', row: 'b', door: 0, w: 4.6, d: 4.4, size: 'small' });
  for (const r of BL.remote) for (const z of r.x0 > 0 ? [-9, -20] : [-9]) for (let x = r.x0 + 5; x < r.x1 - 8; x += 9) P.remote.push({ x, z, kind: 'r', row: z > -15 ? 'a' : 'c' });   // the east channel runs past the east end
  for (const z of [18, 24, 30]) for (const x of [11, 17, 23, 29]) P.heli.push({ x, z, yaw: 0, kind: 'heli', occ: null });
  for (const l of [P.stands, P.shelters, P.hangars, P.remote]) for (const s of l) { s.yaw = N; s.occ = null; }
  return P;
}
const PARKING = layoutParking();

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
  return panels.map(q => q.g);
}
/* control tower: shaft, glazed cab (window material, lit at night), roof, beacon and antennas */
function buildTower(p, x, z, win) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(0.75); p.add(g);
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
function buildBuilding(p, x, z, w, d, h, win, rotY, c) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY || 0; p.add(g);
  box(g, w, h, d, c || WALL, 0, h / 2, 0); box(g, w + 0.15, 0.12, d + 0.15, ROOF_MAT, 0, h + 0.06, 0);
  for (const sz of [-1, 1]) for (let fy = 0; fy < Math.round(h / 1.1); fy++) box(g, w * 0.86, 0.22, 0.02, win, 0, 0.6 + fy * 1.1, sz * (d / 2 + 0.01));
  box(g, 0.5, 0.3, 0.4, 0x7a7d80, w * 0.25, h + 0.27, 0);                                    // AC unit
  return g;
}
/* light mast with floodlights (one real SpotLight on the first `real` masts, cones only on the rest) */
function buildLightMast(p, x, z, aimX, aimZ, real) {
  cyl(p, 0.08, 0.12, 5.2, 5, 0x8a8c8e, x, 2.6, z); box(p, 0.9, 0.12, 0.2, 0x55585b, x, 5.25, z);
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
      const hx = gx + Math.sin(r) * 2.4, hz = gz + Math.cos(r) * 2.4;                            // guard hut, inside
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

/* the whole base; returns its parts (mounts, lights, doors, structures to hit) for main.js / airfield.js */
function buildBase() {
  const g = new THREE.Group(), dyn = [], win = windowMat(), R = BL.rwy, TW = BL.twy, A = BL.apron;
  const lines = [];   // light lists for navLights
  // --- runway: asphalt with shoulders, threshold bars, designators, centreline, touchdown zones, edge lines
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
  textDecal(g, '09', 3.2, 1.6, R.x0 + 6.5, my + 0.002, R.z, -Math.PI / 2); textDecal(g, '27', 3.2, 1.6, R.x1 - 6.5, my + 0.002, R.z, Math.PI / 2);
  // --- taxiway, links, apron, remote stands, holding point
  slab(g, TW.x0, TW.z - TW.w / 2, TW.x1, TW.z + TW.w / 2, 0.035, ASPH2);
  deckLine(g, TW.x0, TW.z, TW.x1, TW.z, 0.08, 0xd8b030, my - 0.006);
  for (const lx of BL.links) { slab(g, lx - TW.w / 2, TW.z, lx + TW.w / 2, R.z - R.w / 2, 0.035, ASPH2); deckLine(g, lx, TW.z, lx, R.z - R.w / 2, 0.08, 0xd8b030, my - 0.006); }
  for (const sz of [-0.15, 0.15]) deckLine(g, BL.hold.x - 1.1, BL.hold.z + sz, BL.hold.x + 1.1, BL.hold.z + sz, 0.07, 0xd8b030, my);
  slab(g, A.x0, A.z1, A.x1, A.z0, 0.03, CONC);
  for (const r of BL.remote) slab(g, r.x0, -25, r.x1, A.z0, 0.03, CONC);
  for (const cx of BL.channels) deckLine(g, cx, TW.z, cx, BL.lane, 0.08, 0xd8b030, my - 0.012);
  deckLine(g, -70, BL.lane, 70, BL.lane, 0.08, 0xd8b030, my - 0.012);
  // --- heli pad (south of the runway), the fire station with its apron onto the runway, the roads
  slab(g, 7.5, 14.5, 32.5, 33.5, 0.03, CONC);
  slab(g, -7.5, R.z + R.w / 2 + 0.9, -0.5, 15.7, 0.03, CONC);
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
  buildBuilding(g, -4, 18, 6, 4.5, 2.0, win, 0, 0x9a6a5a);                                    // fire station
  for (let i = 0; i < 3; i++) box(g, 1.6, 1.5, 0.05, 0x8a2a20, -6 + i * 2, 0.8, 15.73);       // its doors, onto the runway
  for (const [x, z] of [[-48, -44], [-43, -48], [-38, -44]]) { cyl(g, 1.8, 1.8, 2.0, 12, 0xd8d8d0, x, 1.0, z); cyl(g, 1.85, 1.85, 0.12, 12, ROOF_MAT, x, 2.06, z); }   // fuel farm
  // --- fence, guard towers, gate road
  dyn.push(buildFence(g));
  const guards = [];
  for (const i of [1, 3, 5, 7, 10]) { const [x, z] = BL.fence[i]; guards.push(buildGuardTower(g, x * 0.97, z * 0.97, Math.atan2(-z, x))); }
  const gp = BL.gatePos, go = BL.gateOut;
  const road = box(g, 170, 0.04, 3.0, ASPH2, gp.x + go.x * 75, 0.01, gp.z + go.z * 75); road.rotation.y = Math.atan2(-go.z, go.x); road.castShadow = false;   // the road in (enemy columns come along it)
  // --- air defence, tanks (mounts are dynamic)
  const mounts = { ciws: [], aa: [], tanks: [], sams: [], shorad: [] };
  const add = (list, m) => { list.push(m); dyn.push(m.yawG, m.pitchG); if (m.barrelG) dyn.push(m.barrelG); return m; };
  add(mounts.ciws, buildCRAM(g, -14, 21, 225, 120)); add(mounts.ciws, buildCRAM(g, -2, -50, 135, 120)); add(mounts.ciws, buildCRAM(g, 44, -4, 45, 120));
  add(mounts.aa, buildAAGun(g, -56, -16, 200, 140)); add(mounts.aa, buildAAGun(g, 52, 18, 20, 140)); add(mounts.aa, buildAAGun(g, -40, 38, 235, 140)); add(mounts.aa, buildAAGun(g, 30, -52, 90, 140));
  for (const [x, z, f] of [[-26, 44, 230], [-6, 56, 255], [18, 58, 290], [-56, 24, 200]]) add(mounts.tanks, buildTank(g, x, z, f, 70, true));
  const pr = buildPatriotRadar(g, -40, 22, 215);
  for (const [x, z, f] of [[-48, 28, 215], [-44, 32, 230], [-34, 30, 245], [-50, 18, 200]]) add(mounts.sams, buildSamLauncher(g, x, z, f, 70, 'patriot'));
  for (const [x, z, f] of [[38, -40, 60], [44, -34, 40]]) add(mounts.sams, buildSamLauncher(g, x, z, f, 80, 'nasams'));
  add(mounts.shorad, buildAvenger(g, -60, 4, 180, 150)); add(mounts.shorad, buildAvenger(g, 60, -20, 20, 150)); add(mounts.shorad, buildAvenger(g, 30, 40, 300, 150));
  // --- lights: runway edge, thresholds, approach lights + sequenced flashers, PAPI, taxiway edges, apron masts
  for (let x = R.x0; x <= R.x1 + 0.01; x += 6) for (const sz of [-1, 1]) lines.push([x, 0.1, R.z + sz * (R.w / 2 + 0.25), 0xfff2c8]);
  for (let z = R.z - R.w / 2; z <= R.z + R.w / 2 + 0.01; z += 0.55) { lines.push([R.x0 - 0.3, 0.1, z, 0x30ff60]); lines.push([R.x1 + 0.3, 0.1, z, 0xff3020]); }
  for (let x = R.x0 - 4; x > R.x0 - 34; x -= 3) for (let k = -2; k <= 2; k++) lines.push([x, 0.15, R.z + k * 0.45, 0xffffff]);
  for (const sx of [-1, 1]) for (let x = R.x0 - 8; x > R.x0 - 18; x -= 3) lines.push([x, 0.15, R.z + sx * 1.6, 0xff4030]);
  for (let i = 0; i < 4; i++) lines.push([R.td + 2, 0.18, R.z - R.w / 2 - 1.2 - i * 0.5, i < 2 ? 0xffffff : 0xff3020]);   // PAPI: two white, two red = on the glide path
  for (let x = TW.x0; x <= TW.x1; x += 4) for (const sz of [-1, 1]) lines.push([x, 0.1, TW.z + sz * (TW.w / 2 + 0.2), 0x4a7cff]);
  const navs = [navLights(g, lines, null, 0.8), ...tower.lights];
  const rabbit = [];
  for (let i = 0; i < 10; i++) rabbit.push(navLights(g, [[R.x0 - 34 + i * 3, 0.2, R.z, 0xffffff]], { period: 0.5, duty: 0.07, phase: -i * 0.05 }, 1.3));   // sequenced flashers run toward the runway
  const floods = [];
  for (const [x, z, ax, az, real] of [[-30, -4.2, -30, -16, true], [16, -4.2, 18, -16, true], [-48, -12, -54, -14, false], [56, -12, 56, -14, false], [20, 13.8, 20, 24, false]]) floods.push(buildLightMast(g, x, z, ax, az, real));
  const skyLights = [[-30, 52], [60, -36], [-62, 30], [40, 52]].map(([x, z]) => buildSkyLight(g, x, z));
  dyn.push(...floods.map(f => f.holder), ...guards.map(s => s.holder), ...skyLights.map(s => s.holder));
  mergeStatic(g, dyn);
  // structures the enemy aims at: a world point on each (cruise missiles, bombs) and the panel's site rows
  const targets = [
    ...P.shelters.map(s => ({ p: new V3(s.x, 1.6, s.z), name: 'HAS' })), ...P.hangars.slice(0, 2).map(s => ({ p: new V3(s.x, s.H * 0.8, s.z), name: 'HANGAR' })),
    { p: new V3(-7, 4.5, -31), name: 'TOWER' }, { p: new V3(-24, 1.4, -35), name: 'OPS' }, { p: new V3(-43, 1.5, -46), name: 'FUEL' },
    { p: new V3(-40, 1.2, 22), name: 'PATRIOT' }, { p: new V3(-4, 1.2, 18), name: 'FIRE STN' }, { p: new V3(20, 0.5, R.z), name: 'RUNWAY' }, { p: new V3(-20, 0.5, R.z), name: 'RUNWAY' }
  ];
  return { group: g, winMat: win, deckY: 0, mounts, radars: [radar], navs, rabbit, floods, guards, skyLights, targets, patriotRadar: pr, name: 'base' };
}
