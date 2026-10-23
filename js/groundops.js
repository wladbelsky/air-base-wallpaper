'use strict';
/* ===== Scenes on the ground and over the field (peace only) =====
   - unloading: a C-17 / C-130 back from an airlift run with cargo, parked on a stand: its ramp opens, a K-loader comes
     from the cargo yard, the pallets slide onto it, it drives them away;
   - paradrop: a C-130 / C-17 flies low across the screen over a drop zone and paratroopers (or cargo) come down under
     canopies, drift with the wind and land (missions.js: ParadropMission);
   - emergency landing: now and then a jet comes back with an engine fire, trailing smoke; the runway is cleared for it,
     it stops on the runway, the crash tenders race out of the fire station and foam it, a tug tows it home;
   - ground crew: an aircraft back on an open stand or a helicopter on its pad gets a fuel truck (and an ammo loader
     if it is armed) for a while; a departing aircraft is pushed back by a tug (ServiceScene, PushbackScene).
   Vehicles, pallets and parachutes are clones of one template each, kept in pools (never disposed, never rebuilt).
   GROUND_OPS is a mission-world object: updated every step, reset when the air wing is rebuilt.                    */
Object.assign(STATUS, { emergency: ['EMERGENCY', 'wait'], towed: ['UNDER TOW', 'busy'] });
const VEH_TEMPLATES = {}, VEH_POOL = { kloader: [], firetruck: [], tug: [], fueler: [], ammo: [], pallet: [], chute: [], cargochute: [] };
/* ---- vehicle templates: +X forward, wheels on y = 0 ---- */
function wheels(g, xs, z, r) { for (const x of xs) for (const s of [-1, 1]) { const w = cyl(g, r, r, 0.12, 8, 0x1e1e1e, x, r, s * z); w.rotation.x = Math.PI / 2; cyl(g, r * 0.45, r * 0.45, 0.13, 6, 0x9a9e9a, x, r, s * z).rotation.x = Math.PI / 2; } }
/* cab glass: a windscreen on the cab's front face (x = fx) and a side window each side; w = cab width, len = side window */
function cabGlass(g, fx, y, w, len, h) {
  const G = CANOPY(); box(g, 0.02, h, w * 0.84, G, fx + 0.006, y, 0);
  for (const s of [-1, 1]) box(g, len, h * 0.9, 0.02, G, fx - len / 2 - 0.05, y, s * (w / 2 + 0.006));
}
/* headlights (white, front) and tail lights (red, back) at night; an amber beacon (on a small housing) flashing day and night */
function vehLights(g, fx, bx, y, z, beacon) {
  navLights(g, [[fx, y, -z, 0xfff2d0], [fx, y, z, 0xfff2d0], [bx, y, -z, 0xff2010], [bx, y, z, 0xff2010]], null, 0.5);
  for (const s of [-1, 1]) box(g, 0.02, 0.05, 0.07, 0xe8e4d0, fx - 0.005, y, s * z);
  if (!beacon) return;
  box(g, 0.07, 0.05, 0.07, 0xc87818, beacon[0], beacon[1] - 0.025, beacon[2]);
  navLights(g, [[beacon[0], beacon[1] + 0.02, beacon[2], 0xffa020]], { period: 0.8, duty: 0.22 }, 0.85).material.userData.day = true;
}
const bumper = (g, x, y, w) => box(g, 0.05, 0.07, w, 0x2a2d2a, x, y, 0);
/* the munitions loader's loads: one kind shown per job, its items (separate nodes) vanish one by one as they go onto the
   aircraft (ServiceScene); a kind per aircraft type, a mix among them (LOADS) */
const LOAD_BUILD = {
  bombs: t => [-0.14, 0.14].map(z => { const i = new THREE.Group(); i.position.set(0, 0.1, z); t.add(i);
    cyl(i, 0.075, 0.075, 0.5, 8, 0x4a5236, 0, 0, 0).rotation.z = Math.PI / 2; const n = cyl(i, 0.001, 0.075, 0.14, 8, 0x4a5236, 0.32, 0, 0); n.rotation.z = -Math.PI / 2;
    box(i, 0.08, 0.16, 0.012, 0x3a4028, -0.28, 0, 0); box(i, 0.08, 0.012, 0.16, 0x3a4028, -0.28, 0, 0); return i; }),
  missiles: t => [-0.12, 0.12].map(z => { const i = new THREE.Group(); i.position.set(0, 0.07, z); t.add(i);
    cyl(i, 0.035, 0.035, 0.62, 8, 0xd8d8d0, 0, 0, 0).rotation.z = Math.PI / 2; const n = cyl(i, 0.001, 0.035, 0.1, 8, 0xd8d8d0, 0.36, 0, 0); n.rotation.z = -Math.PI / 2;
    for (const x of [-0.26, 0.1]) { box(i, 0.07, 0.12, 0.008, 0x9a9a92, x, 0, 0); box(i, 0.07, 0.008, 0.12, 0x9a9a92, x, 0, 0); } return i; }),
  gun: t => { const d = new THREE.Group(); d.position.set(0.12, 0.17, 0); t.add(d); cyl(d, 0.15, 0.15, 0.42, 10, 0x3f4a34, 0, 0, 0).rotation.x = Math.PI / 2; cyl(d, 0.05, 0.05, 0.44, 6, 0x8a8a84, 0, 0, 0).rotation.x = Math.PI / 2;
    const c = new THREE.Group(); c.position.set(-0.27, 0.07, 0); t.add(c); for (const z of [-0.12, 0.12]) box(c, 0.22, 0.13, 0.18, 0x55603e, 0, 0, z); box(c, 0.22, 0.13, 0.18, 0x55603e, 0, 0.13, 0); return [d, c]; },
  rockets: t => { const r = new THREE.Group(); r.position.set(-0.18, 0.08, 0); t.add(r); box(r, 0.5, 0.03, 0.22, 0x3a3e40, 0, -0.03, 0);
    for (const y of [0.02, 0.08]) for (const z of [-0.06, 0.06]) cyl(r, 0.025, 0.025, 0.46, 6, 0x6a7058, 0, y, z).rotation.z = Math.PI / 2;
    const p = new THREE.Group(); p.position.set(0.24, 0.1, 0); t.add(p); cyl(p, 0.09, 0.09, 0.36, 10, 0x55603e, 0, 0, 0).rotation.z = Math.PI / 2; cyl(p, 0.07, 0.07, 0.01, 10, 0x1a1a1a, 0.18, 0, 0).rotation.z = Math.PI / 2; return [r, p]; },
  crates: t => [[-0.25, 0], [0.02, 0], [0.29, 0]].map(([x, z]) => { const i = new THREE.Group(); i.position.set(x, 0.08, z); t.add(i);
    box(i, 0.24, 0.14, 0.4, 0x55603e, 0, 0, 0); box(i, 0.245, 0.03, 0.405, 0x3a4028, 0, 0.03, 0); return i; })
};
const LOADS = { a10: ['gun', 'bombs'], f15: ['bombs', 'missiles'], f16: ['bombs', 'missiles'], f22: ['missiles'], f35: ['missiles', 'bombs'], mq9: ['rockets'],
  ac130: ['crates', 'gun'], ah64: ['rockets'], uh1: ['rockets', 'crates'], uh60: ['crates'] };
const loadFor = a => pick(LOADS[a.spec.key] || (a instanceof Helicopter ? ['crates'] : ['bombs', 'missiles']));
/* show one kind of load on a loader (all its items back on the table), the table down; returns the items */
function setLoad(m, kind) {
  const t = m.getObjectByName('table'); t.position.y = 0.3; let items = [];
  for (const k of t.children) if (k.name.startsWith('load:')) { k.visible = k.name === 'load:' + kind; for (const i of k.children) i.visible = true; if (k.visible) items = k.children.slice(); }
  return items;
}
/* cargo on a K-loader pallet: one kind per pallet */
const PALLET_KINDS = ['crates', 'drums', 'covered', 'long'];
function setPallet(m, kind) { for (const k of m.children) if (k.name.startsWith('kind:')) k.visible = k.name === 'kind:' + kind; }
const VEH_BUILD = {
  kloader() {          // K-loader: a low cab and a long roller deck that rises to the ramp
    const g = new THREE.Group(), Y = 0xd8b030;
    box(g, 1.7, 0.25, 0.85, Y, 0, 0.32, 0); box(g, 0.4, 0.38, 0.8, Y, 0.75, 0.6, 0); box(g, 0.44, 0.04, 0.84, 0x3a3e40, 0.75, 0.81, 0);
    cabGlass(g, 0.95, 0.66, 0.8, 0.2, 0.2); bumper(g, 0.88, 0.24, 0.86);
    const deck = new THREE.Group(); deck.name = 'deck'; deck.position.set(-0.2, 0.5, 0); g.add(deck);
    box(deck, 1.35, 0.08, 0.8, 0x6a6e70, 0, 0, 0); for (const s of [-1, 1]) box(deck, 1.35, 0.1, 0.04, Y, 0, 0.06, s * 0.4);
    for (let i = 0; i < 6; i++) box(deck, 0.03, 0.012, 0.74, 0x8a8e90, -0.6 + i * 0.24, 0.045, 0);   // rollers
    wheels(g, [-0.55, 0.55], 0.4, 0.13);
    vehLights(g, 0.86, -0.86, 0.34, 0.33, [0.75, 0.86, 0]);
    mergeStatic(g, [deck]); return g;
  },
  firetruck() {        // crash tender: big red body with roller doors, cab, roof turret, light bar
    const g = new THREE.Group(), R = 0xc8261c;
    box(g, 1.9, 0.55, 0.85, R, -0.1, 0.48, 0); box(g, 0.45, 0.45, 0.83, R, 0.95, 0.44, 0); box(g, 0.47, 0.04, 0.85, 0xe8e8e0, 0.95, 0.685, 0);
    cabGlass(g, 1.175, 0.53, 0.83, 0.26, 0.2); bumper(g, 1.2, 0.22, 0.86);
    box(g, 1.9, 0.06, 0.87, 0xe8e8e0, -0.1, 0.62, 0);                                   // white stripe
    for (const x of [-0.75, -0.3, 0.15]) for (const s of [-1, 1]) box(g, 0.38, 0.28, 0.01, 0xb4b4ac, x, 0.42, s * 0.428);   // roller doors
    box(g, 1.1, 0.03, 0.22, 0x9a9a9a, -0.45, 0.77, 0.22);                              // ladder on the roof
    const tur = new THREE.Group(); tur.name = 'turret'; tur.position.set(0.55, 0.8, 0); g.add(tur);
    cyl(tur, 0.07, 0.08, 0.1, 6, 0x9a9a9a, 0, 0.03, 0); tube(tur, 0, 0.35, 0.025, 0.02, 0x9a9a9a, 0.06, 0, 5);
    wheels(g, [-0.65, 0, 0.8], 0.43, 0.15);
    navLights(g, [[0.85, 0.72, -0.25, 0x3060ff], [0.85, 0.72, 0.25, 0xff3020]], { period: 0.5, duty: 0.5 }, 0.9);
    vehLights(g, 1.18, -1.06, 0.32, 0.3);
    mergeStatic(g, [tur]); return g;
  },
  tug() {              // aircraft tug: low and wide, an open seat under a roll bar, the tow hitch in front
    const g = new THREE.Group(), Y = 0xd8b030, S = 0x9a9e9a, D = 0x3a3e40;
    box(g, 1.1, 0.3, 0.7, Y, 0, 0.25, 0); box(g, 1.12, 0.04, 0.72, 0x2a2d2a, 0, 0.12, 0);
    box(g, 0.28, 0.06, 0.42, D, -0.3, 0.43, 0); box(g, 0.06, 0.24, 0.42, D, -0.44, 0.56, 0);   // seat
    for (const s of [-1, 1]) box(g, 0.03, 0.46, 0.03, S, -0.5, 0.63, s * 0.27); box(g, 0.03, 0.03, 0.57, S, -0.5, 0.86, 0);   // roll bar
    box(g, 0.02, 0.17, 0.46, CANOPY(), -0.08, 0.5, 0); box(g, 0.04, 0.05, 0.04, D, -0.16, 0.5, 0);   // windscreen, wheel
    box(g, 0.14, 0.06, 0.1, D, 0.6, 0.2, 0); bumper(g, -0.57, 0.22, 0.72);             // hitch, rear bumper
    const bar = new THREE.Group(); bar.name = 'bar'; bar.position.set(0.6, 0.2, 0); bar.visible = false; g.add(bar);   // towbar (unit length, towTug)
    box(bar, 1, 0.035, 0.035, 0x2a2d2a, 0.5, 0, 0);
    wheels(g, [-0.35, 0.35], 0.35, 0.12);
    vehLights(g, 0.56, -0.56, 0.3, 0.26, [-0.5, 0.9, 0]);
    mergeStatic(g, [bar]); return g;
  },
  fueler() {           // fuel truck: cab, a tank on the back, a hose (unit length, scaled out to the aircraft)
    const g = new THREE.Group();
    box(g, 1.75, 0.12, 0.6, 0x2a2d2a, 0, 0.2, 0); box(g, 0.5, 0.45, 0.62, 0x5a6448, 0.62, 0.45, 0); box(g, 0.52, 0.03, 0.64, 0x4a5236, 0.62, 0.685, 0);
    cabGlass(g, 0.87, 0.55, 0.62, 0.24, 0.17); bumper(g, 0.9, 0.24, 0.62);
    const t = cyl(g, 0.3, 0.3, 1.15, 10, 0x6b7458, -0.25, 0.56, 0); t.rotation.z = Math.PI / 2;
    for (const x of [-0.7, 0.2]) { const b = cyl(g, 0.31, 0.31, 0.04, 10, 0x4a5236, x, 0.56, 0); b.rotation.z = Math.PI / 2; }   // tank bands
    cyl(g, 0.025, 0.025, 0.42, 6, 0x2a2d2a, 0.34, 0.62, 0.26);                           // exhaust stack
    const reel = cyl(g, 0.1, 0.1, 0.16, 8, 0x2a2d2a, -0.82, 0.33, 0); reel.rotation.x = Math.PI / 2;   // hose reel
    const hose = new THREE.Group(); hose.name = 'hose'; hose.position.set(-0.85, 0.3, 0.2); hose.visible = false; g.add(hose);
    box(hose, 1, 0.05, 0.05, 0x1a1a1a, 0.5, 0, 0);
    wheels(g, [-0.55, 0.6], 0.32, 0.13);
    vehLights(g, 0.88, -0.88, 0.3, 0.24, [0.62, 0.72, 0]);
    mergeStatic(g, [hose]); return g;
  },
  ammo() {             // munitions loader (MJ-1 style): low yellow tractor with a roll cage, a lift table with the load
    const g = new THREE.Group(), Y = 0xd8b030, S = 0x9a9e9a;
    box(g, 0.45, 0.3, 0.55, Y, 0.55, 0.3, 0); box(g, 0.18, 0.06, 0.4, 0x3a3e40, 0.42, 0.48, 0); box(g, 0.05, 0.2, 0.4, 0x3a3e40, 0.34, 0.58, 0);
    for (const x of [0.34, 0.74]) for (const s of [-1, 1]) box(g, 0.025, 0.42, 0.025, S, x, 0.66, s * 0.25); box(g, 0.42, 0.025, 0.52, S, 0.54, 0.87, 0);   // roll cage
    bumper(g, 0.79, 0.22, 0.56);
    for (const s of [-1, 1]) box(g, 0.95, 0.06, 0.06, 0x5a5e60, -0.25, 0.22, s * 0.2);    // the lift's frame
    const table = new THREE.Group(); table.name = 'table'; table.position.set(-0.25, 0.3, 0); g.add(table);
    box(table, 0.9, 0.05, 0.55, 0x5a5e60, 0, 0, 0); for (const s of [-1, 1]) box(table, 0.9, 0.05, 0.03, Y, 0, 0.03, s * 0.28);
    const items = [];
    for (const [k, f] of Object.entries(LOAD_BUILD)) { const kg = new THREE.Group(); kg.name = 'load:' + k; kg.position.y = 0.025; table.add(kg); items.push(kg, ...[].concat(f(kg))); }
    wheels(g, [-0.45, 0.5], 0.3, 0.1);
    vehLights(g, 0.78, -0.72, 0.3, 0.22, [0.54, 0.91, 0]);
    mergeStatic(g, [table, ...items]); return g;
  },
  pallet() {           // an air-cargo pallet with one of a few loads (setPallet)
    const g = new THREE.Group(); box(g, 0.42, 0.04, 0.42, 0x8a8a84, 0, 0.02, 0);
    const K = {}; for (const k of PALLET_KINDS) { K[k] = new THREE.Group(); K[k].name = 'kind:' + k; g.add(K[k]); }
    box(K.crates, 0.38, 0.3, 0.38, 0x5a6448, 0, 0.19, 0); box(K.crates, 0.39, 0.03, 0.39, 0x2a2d2a, 0, 0.25, 0); box(K.crates, 0.39, 0.3, 0.02, 0x2a2d2a, 0, 0.19, 0);   // netted crates
    for (const x of [-0.1, 0.1]) for (const z of [-0.1, 0.1]) cyl(K.drums, 0.085, 0.085, 0.28, 8, 0x3a4a5a, x, 0.18, z);                    // fuel drums
    const tp = taper(K.covered, 0.4, 0.3, 0.4, 0x6a6a52, 0, 0.19, 0, 0.8, 0.8); tp.castShadow = true;                                     // tarp-covered load
    box(K.long, 0.4, 0.14, 0.3, 0x7a6a4a, 0, 0.11, 0); box(K.long, 0.3, 0.12, 0.24, 0x6a5a3a, 0, 0.24, 0);                                // crates of spares
    mergeStatic(g, Object.values(K)); return g;
  },
  chute: () => buildChute(false), cargochute: () => buildChute(true)
};
/* a parachute: canopy (scaled by the opening), lines, a paratrooper (or a cargo pallet) under it */
function buildChute(cargo) {
  const g = new THREE.Group(), can = new THREE.Group(); can.name = 'canopy'; can.position.y = 1.0; g.add(can);
  const c = shade(new THREE.Mesh(new THREE.SphereGeometry(cargo ? 0.75 : 0.5, 10, 4, 0, TAU, 0, Math.PI / 2.4), M(cargo ? 0xd8d0c0 : 0x56603e)), false);
  c.scale.y = 0.55; can.add(c);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.785; strut(can, new V3(Math.cos(a) * 0.38, 0.05, Math.sin(a) * 0.38), new V3(0, -0.95, 0), 0.006, 0x333333); }
  if (cargo) box(g, 0.42, 0.32, 0.42, 0x5a6448, 0, 0, 0);
  else { box(g, 0.08, 0.2, 0.1, 0x4a5236, 0, 0, 0); box(g, 0.06, 0.06, 0.06, 0xc8a080, 0, 0.13, 0); }
  mergeStatic(g, [can]); return g;
}
function takeVehicle(kind) {
  const m = VEH_POOL[kind].pop() || (VEH_TEMPLATES[kind] || (VEH_TEMPLATES[kind] = VEH_BUILD[kind]())).clone();
  m.visible = true; scene.add(m); return m;
}
function dropVehicle(kind, m) { scene.remove(m); m.visible = false; m.position.set(0, -50, 0); VEH_POOL[kind].push(m); }
/* a vehicle driving a smooth path ([x, z] points) at speed, nose along the path (rev: backing up, tail first), keeping
   `lane` to the right of it between its ends (two meeting head-on pass each other); step(dt, true) waits where it is
   (giving way, see vehHold) */
class Drive {
  constructor(m, pts, speed, rev, lane) {
    const q = [pts[0]]; for (const p of pts) if (Math.hypot(p[0] - q[q.length - 1][0], p[1] - q[q.length - 1][1]) > 0.3) q.push(p);   // no doubled points (the curve would loop)
    if (q.length < 2) q.push([q[0][0] + 0.01, q[0][1]]);
    this.m = m; this.c = new THREE.CatmullRomCurve3(densify(q).map(p => new V3(p[0], 0, p[1])), false, 'centripetal'); this.len = this.c.getLength(); this.s = 0; this.v = speed; this.rev = !!rev; this.lane = lane || 0;
    // the heading carries on from where the vehicle points (it turns, never snaps) unless it is just being placed
    const fresh = !m.visible || m.scale.x < 0.5 || Math.hypot(m.position.x - q[0][0], m.position.z - q[0][1]) > 0.5;
    this.yaw = fresh ? null : m.rotation.y; m.userData.drive = this; this.x0 = q[0][0]; this.z0 = q[0][1]; this.x1 = q[q.length - 1][0]; this.z1 = q[q.length - 1][1]; this.key = q[0][0].toFixed(1) + ',' + q[0][1].toFixed(1);
  }
  /* hold: true waits; 'back' backs up along the way it came, 'go' drives on whatever is ahead (giving way to an aircraft, vehHold) */
  step(dt, hold) {
    if (hold === 'back') this.s = Math.max(0, this.s - this.v * 0.45 * dt);
    else if (!hold || hold === 'go') this.s = Math.min(this.len, this.s + this.v * dt * smoothstep(0, 1.5, this.s + 0.2) * (0.4 + 0.6 * smoothstep(0, 2, this.len - this.s)));
    const u = this.s / this.len, p = this.c.getPointAt(u), t = this.c.getTangentAt(u), ty = this.rev ? Math.atan2(t.z, -t.x) : Math.atan2(-t.z, t.x);
    this.yaw = this.yaw == null || !dt ? ty : this.yaw + clamp(Math.atan2(Math.sin(ty - this.yaw), Math.cos(ty - this.yaw)), -3 * dt, 3 * dt);
    if (this.lane) { const w = this.lane * smoothstep(0, 1.5, this.s) * smoothstep(0, 1.5, this.len - this.s); p.x -= t.z * w; p.z += t.x * w; }
    this.m.position.set(p.x, groundH(p.x, p.z), p.z); this.m.rotation.set(0, this.yaw, 0);
    return this.s >= this.len - 1e-3;
  }
  // `k` ahead the way it is moving (along the path: a vehicle backing up looks behind it)
  ahead(out, k = 1.5) { const t = this.c.getTangentAt(Math.min(1, this.s / this.len)); return out.set(this.m.position.x + t.x * k, 0, this.m.position.z + t.z * k); }
}
/* vehicles give way to aircraft: stop short of the way one on the move (or pushing back toward here) is about to take,
   or of one standing in the way; one already in that way drives on and clears it. Aircraft never wait for vehicles
   (but a pushback waits for one near its path) */
function vehHold(d, own) {
  const p = d.ahead(_vh), m = d.m.position; d.ahead(_vh2, 3.5);
  if (T < (d.giveWay || 0)) return d.giveDir;                                              // still getting out of an aircraft's way
  for (const a of AIRCRAFT) {
    if (a === own || !a.onGround || !a.mesh.visible) continue;
    // in the way of one that has to come through here (a pushback about to start for us, or one taxiing at us whose route
    // runs over this spot): back up along the way we came or drive on, whichever is clearer of its way, rather than both
    // standing there
    const q = a.mesh.position, rr = 1.0 + a.spec.len * 0.5, way = [];
    if (a.state === 'ready' && AIRFIELD.wantsOut(a) && a.pb) { for (const [x, z] of a.pb) way.push(x, z); }
    else if (a.dcurve && a.ds < a.dlen && Math.abs(a.v || 0) > 0.05 && Math.hypot(q.x - m.x, q.z - m.z) < 9) for (let k = 0; k <= 10; k += 2) { const c = a.dcurve.getPointAt(Math.min(1, (a.ds + k) / a.dlen), _vr); way.push(c.x, c.z); }
    if (!way.length) continue;
    const clear = (x, z) => { let b = 1e9; for (let i = 0; i < way.length; i += 2) b = Math.min(b, Math.hypot(way[i] - x, way[i + 1] - z)); return b; };
    const inPath = clear(m.x, m.z) < (a.state === 'ready' ? rr : 0.6 + a.spec.span * 0.35);
    if (inPath && d.s > 0.3 && d.holdSince != null && T - d.holdSince > 1.5) {
      const pb = d.c.getPointAt(Math.max(0, d.s - 2) / d.len, _vr), back = clear(pb.x, pb.z), pf = d.c.getPointAt(Math.min(d.len, d.s + 2.5) / d.len, _vr), fwd = clear(pf.x, pf.z);
      d.giveWay = T + 2.5; d.holdSince = null; return d.giveDir = fwd > back ? 'go' : 'back';
    }
  }
  // setting off from a start point (a depot) only once the last one to leave it is clear of it: one at a time
  if (d.s < 0.05 && T - (d.startSince = d.startSince ?? T) < 10) {                                     // (after 10 s it goes anyway)
    const sl = GROUND_OPS.starts[d.key];
    if (sl && sl.m !== d.m && sl.m.visible && Math.hypot(sl.m.position.x - d.x0, sl.m.position.z - d.z0) < 1.8) return true;
    for (const o of GROUND_OPS.vehicles()) {                                                // nor while one is arriving there
      const od = o.userData.drive; if (o === d.m || !o.visible || !od || od === d) continue;
      if (Math.hypot(od.x1 - d.x0, od.z1 - d.z0) < 0.6 && od.len - od.s < 3 && Math.hypot(o.position.x - d.x0, o.position.z - d.z0) < 3) return true;
    }
    if (!sl || sl.m !== d.m) GROUND_OPS.starts[d.key] = { m: d.m, x: d.x0, z: d.z0 };
  }
  const h = vehHoldAir(d, own, p, m);
  // behind another vehicle (two holding for each other: the lower id goes); a vehicle that has stood 8 s gives up on it
  let byVeh = null, clearing = false;
  for (const a of AIRCRAFT) if (a !== own && a.onGround && a.mesh.visible && Math.abs(a.v || 0) > 0.05 && Math.hypot(a.mesh.position.x - m.x, a.mesh.position.z - m.z) < 0.6 + a.spec.span * 0.5) clearing = true;   // under one on the move: clear out, whoever is ahead
  if (!h && !clearing) for (const o of GROUND_OPS.vehicles()) {
    if (o === d.m || !o.visible) continue;
    const op = o.position; if (Math.hypot(op.x - m.x, op.z - m.z) > 4) continue;
    if (o.scale.x < 0.5 && o.userData.drive && o.userData.drive.s < 0.05) continue;         // still waiting in its depot (the start rule queues those)
    d.ahead(_vh3, 0.8);
    if (Math.hypot(op.x - _vh.x, op.z - _vh.z) < 0.9 || Math.hypot(op.x - _vh3.x, op.z - _vh3.z) < 0.9 || Math.hypot(op.x - m.x, op.z - m.z) < 0.75) {
      const od = o.userData.drive;
      if (od && d.s < 0.3 && od.s < 0.3 && Math.hypot(op.x - m.x, op.z - m.z) < 0.7) { if (d.m.id < o.id) continue; byVeh = o; break; }   // both setting off from one spot: in id order (no cycle)
      if (od && od.heldBy === d.m && T - od.heldAt < 0.2 && d.m.id < o.id) continue;
      byVeh = o; break;
    }
  }
  // 8 s behind the same one gives up on it (in a queue the one ahead keeps changing)
  if (byVeh) { if (byVeh !== d.vehBy) { d.vehBy = byVeh; d.vehSince = T; } if (T - d.vehSince < 8) { d.heldBy = byVeh; d.heldAt = T; d.holdSince = d.holdSince ?? T; return true; } }
  else d.vehBy = null;
  d.holdSince = h ? d.holdSince ?? T : null;                                              // how long it has been held (giving way above)
  return h;
}
/* the aircraft rule of vehHold (p: the point ahead, m: the vehicle) */
function vehHoldAir(d, own, p, m) {
  for (const a of AIRCRAFT) {
    if (a === own || !a.onGround || !a.mesh.visible || a.state === 'parked' || a.state === 'ready' || a.state === 'emergency') continue;
    const q = a.mesh.position, moving = Math.abs(a.v || 0) > 0.05 || a.state === 'pushback';
    if (!moving) { if (Math.hypot(q.x - p.x, q.z - p.z) < 0.5 + a.spec.len * 0.35) return true; continue; }
    const r = 1.0 + a.spec.len * 0.5, rIn = 0.5 + a.spec.span * 0.35;                  // stop well short of its way; "in it" = under it
    if (Math.hypot(q.x - m.x, q.z - m.z) < rIn) continue;                                // in its way already: get out of it
    // its taxi route over the next stretch (it may be about to turn toward us), else straight on along its nose
    if (a.dcurve && a.ds < a.dlen) {
      let inWay = false, hold = false;
      for (let k = 0; k <= 8; k += 2) { const c = a.dcurve.getPointAt(Math.min(1, (a.ds + k) / a.dlen), _vr); if (Math.hypot(c.x - m.x, c.z - m.z) < rIn) inWay = true; else if (nearAhead(c.x, c.z, r)) hold = true; }
      if (hold && !inWay) return true;
    } else { const k = a.state === 'pushback' ? -3 : 3; if (segDist(p.x, p.z, q.x, q.z, q.x + a.fwd.x * k, q.z + a.fwd.z * k) < r) return true; }
    if (a.state === 'pushback') { const [ex, ez] = a.pb[a.pb.length - 1]; if (Math.hypot(ex - p.x, ez - p.z) < r) return true; }
  }
  return false;
}
const _vh = new V3(), _vh2 = new V3(), _vh3 = new V3(), _vr = new V3(), _tn = new V3(), _tb = new V3();
/* the tug on its towbar at the aircraft's nose gear: it trails the hitch like a trailer (bending in turns, never glued
   to the nose); pushing it faces the aircraft (bar from its front), towing it faces away (bar from its back) */
function towTug(m, a, push) {
  const nose = _tn.set(1, 0, 0).applyQuaternion(a.mesh.quaternion).setY(0).normalize(), q = a.mesh.position;
  const hx = q.x + nose.x * a.spec.len * 0.3, hz = q.z + nose.z * a.spec.len * 0.3, D = a.spec.len * 0.2 + 0.75;
  let dx = m.position.x - hx, dz = m.position.z - hz, l = Math.hypot(dx, dz);
  if (l < 0.05) { dx = nose.x; dz = nose.z; l = 1; }
  dx /= l; dz /= l;
  m.position.set(hx + dx * D, 0, hz + dz * D); m.rotation.set(0, push ? Math.atan2(dz, -dx) : Math.atan2(-dz, dx), 0);
  const bar = barOf(m); if (!bar) return;
  bar.visible = true; bar.position.x = push ? 0.6 : -0.57; m.updateMatrixWorld();
  const lp = m.worldToLocal(_tb.set(hx, 0.2, hz)), bx = lp.x - bar.position.x;
  bar.rotation.set(0, Math.atan2(-lp.z, bx), 0); bar.scale.set(Math.max(0.05, Math.hypot(bx, lp.z)), 1, 1);
}
const barOf = m => m.userData.bar ?? (m.userData.bar = m.getObjectByName('bar') || null);
const hideBar = m => { const b = barOf(m); if (b) b.visible = false; };
const nearAhead = (x, z, r) => Math.hypot(x - _vh.x, z - _vh.z) < r || Math.hypot(x - _vh2.x, z - _vh2.z) < r;   // the two points ahead of the vehicle (vehHold)
/* distance from (px, pz) to the segment a-b */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, u = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(px - ax - dx * u, pz - az - dz * u);
}
/* vehicles pop in / out at their depots: a quick grow / shrink */
const vehScale = (m, k) => m.scale.setScalar(Math.max(0.01, Math.min(1, k)));

const FIRE_STATION = { x: -4, z: 28.6 }, SERVICE_Z = -5.8;   // the service strip: between the taxiway's wingtips and the tails on the front row
// a depot: the point in front of a vehicle shed's door (x, z) and inside it (`in`: vehicles set off from there and end
// there, out of sight; GROUND_OPS.update rolls the door up for them) — BASE_LAYOUT.garages
const garageDepot = ([x, z, w, d, face, out]) => { const q = doorAt(x, z, w, d, face, 0, out); return { x: q.x, z: q.z, in: [q.ix, q.iz] }; };
// ground crew depots: the cargo yard (east) and a west one, on the service strip between the taxiway and the front row;
// HELI_DEPOT: on the road by the helicopter pads; FIRE_DOORS: the fire station's (west to east)
const CARGO_YARD = garageDepot(BASE_LAYOUT.garages[1]), CREW_DEPOTS = [CARGO_YARD, garageDepot(BASE_LAYOUT.garages[0])], HELI_DEPOT = garageDepot(BASE_LAYOUT.garages[2]);
const FIRE_DOORS = [-1, 0, 1].map(i => { const [x, z, w, d] = BASE_LAYOUT.fireStation; return doorAt(x, z, w, d, 'n', i * 2, 1); });
const nearestDepot = x => CREW_DEPOTS.reduce((b, d) => Math.abs(d.x - x) < Math.abs(b.x - x) ? d : b);
const tugDepot = s => s.row === 'c' ? CARGO_YARD : nearestDepot(s.x);
/* a tug's way from the depot D to the nose (z nz) of an aircraft on the open home s: round its wingtip, in from the side
   (not out over the lane); the east remote rows from the cargo yard; from inside its shed. Reversed: the way back. */
function tugWay(a, s, D, nz) {
  const sx = s.x + (Math.sign(D.x - s.x) || 1) * (a.spec.span / 2 + 0.6);
  return s.row === 'c' ? [D.in, [D.x, D.z], [44.6, SERVICE_Z - 1.2], [44.6, nz - 1.6], [s.x - 1, nz - 1.6], [s.x, nz]]
    : [D.in, [D.x, D.z], [sx + (Math.sign(D.x - sx) || 1) * 1.6, SERVICE_Z], [sx, SERVICE_Z - 1.2], [sx, s.z], [sx, nz + 0.2], [s.x + (sx - s.x) * 0.45, nz - 0.45], [s.x, nz]];
}
const GROUND_OPS = registerMissionWorld({
  scenes: [], chutes: [], emerg: null, emTimer: rand(420, 720), starts: {},   // starts: the last vehicle to set off from each start point ({ m, x, z }, vehHold)
  reset() {
    for (const s of this.scenes) this.endScene(s);
    for (const c of this.chutes) dropVehicle(c.kind, c.m);
    this.scenes = []; this.chutes = []; this.emerg = null; this.emTimer = rand(420, 720); this.starts = {};
  },
  update(dt) {
    if ((this.pruneT = (this.pruneT || 0) - dt) <= 0) {                                     // start slots whose vehicle has left them
      this.pruneT = 5;
      for (const k in this.starts) { const e = this.starts[k]; if (!e.m.visible || Math.hypot(e.m.position.x - e.x, e.m.position.z - e.z) > 1.8) delete this.starts[k]; }
    }
    for (const s of this.scenes) s.update(dt);
    // shed / fire station doors roll up for a vehicle setting off from inside or driving in, and down behind it
    for (const o of GARAGE_DOORS) {
      let want = false;
      for (const v of this.vehicles()) {
        const d = v.userData.drive; if (!v.visible || !d || Math.hypot(v.position.x - o.fx, v.position.z - o.fz) > 3.6) continue;
        if (Math.hypot(d.x0 - o.ix, d.z0 - o.iz) < 0.4 || Math.hypot(d.x1 - o.ix, d.z1 - o.iz) < 0.4) { want = true; break; }
      }
      const k = clamp(o.k + (want ? dt : -dt) * 2.2, 0, 1); if (k !== o.k) { o.k = k; o.g.scale.y = 1 - 0.94 * k; }
    }
    for (let i = this.scenes.length - 1; i >= 0; i--) if (this.scenes[i].done) { this.endScene(this.scenes[i]); this.scenes.splice(i, 1); }
    this.updateChutes(dt);
    // unloading: a transport home with cargo, on a stand where it can be seen
    for (const a of AIRCRAFT) if (a.cargo && a.state === 'parked' && a.t > 2 && !a.groundBusy) {
      if (AIRFIELD.sheltered(a.spot)) a.cargo = false; else this.scenes.push(new UnloadScene(a));
    }
    // tugs for the departures; the ground crew for those back on an open stand or pad (a few at a time)
    let crews = 0; for (const s of this.scenes) if (s instanceof ServiceScene) crews++;
    for (const a of AIRCRAFT) {
      if (a.state === 'ready' && !a.tug && !a.groundBusy && a instanceof FixedWing) this.scenes.push(new PushbackScene(a));   // once the crew / loader has pulled away
      else if (a.needsService && a.state === 'parked' && a.t > 1.5 && crews < 3 && !a.groundBusy && !a.cargo) {
        a.needsService = false; if (crewSpot(a)) { this.scenes.push(new ServiceScene(a)); crews++; }
      }
    }
    // emergencies: peace only, now and then one jet in orbit
    if (this.emerg || combatOn()) return;
    if ((this.emTimer -= dt) > 0) return;
    const c = AIRCRAFT.filter(a => a instanceof FixedWing && a.spec.armed && a.state === 'orbit' && !a.landReq && !a.retiring && !a.tank && a.airT > 30);
    this.emTimer = c.length ? rand(480, 900) : 20;                  // nobody suitable up: look again soon
    if (c.length) this.startEmergency(pick(c));
  },
  endScene(s) { if (s.end) s.end(); },
  /* the ground vehicles out on the field (models) */
  vehicles() {
    if (this.vT === T && this.vList) return this.vList;                                     // once per step (vehHold asks per vehicle)
    const out = this.vList = []; this.vT = T;
    for (const sc of this.scenes) {
      if (sc.veh) for (const v of sc.veh) { const m = v.isObject3D ? v : v.m; if (m) out.push(m); }
      if (sc.trucks) for (const k of sc.trucks) out.push(k.m);
      if (sc.tug && sc.tug.isObject3D) out.push(sc.tug);
    }
    return out;
  },
  /* is a ground vehicle (other than those working on `a`) within r of (x, z)? */
  vehicleNear(x, z, r, a) {
    for (const sc of this.scenes) if (sc.a !== a && sc.veh) for (const v of sc.veh) { const p = v.position; if (p && Math.hypot(p.x - x, p.z - z) < r) return true; }
    return false;
  },

  /* ---- emergency landing ---- */
  startEmergency(a) {
    this.emerg = a; a.emerg = true; a.requestLand();
    a.say(radioLine(LINES.emergency.mayday), { prio: 3 });
    RADIO.say(RADIO_NAMES.tower, radioLine(LINES.emergency.tower, { C: a.callsign, R: rwyName(AIRFIELD.landR()) }), { role: 'tower', prio: 3, delay: 2.5 });
  },
  /* the aircraft has stopped on the runway: crash tenders out, then the tug */
  onStopped(a) { this.scenes.push(new EmergencyScene(a)); },
  done(a) { a.emerg = false; if (this.emerg === a) this.emerg = null; },

  /* ---- parachutes ---- */
  dropChute(p, v, cargo) {
    const kind = cargo ? 'cargochute' : 'chute', m = takeVehicle(kind); m.position.copy(p);
    const can = m.getObjectByName('canopy'); can.scale.set(0.05, 0.05, 0.05);
    this.chutes.push({ kind, m, can, v: v.clone(), t: 0, landed: -1, ph: rand(0, 6) });
  },
  updateChutes(dt) {
    for (let i = this.chutes.length - 1; i >= 0; i--) {
      const c = this.chutes[i], p = c.m.position; c.t += dt;
      if (c.landed < 0) {
        const open = smoothstep(0.6, 1.6, c.t);
        c.v.lerp(_gw.set(WIND.x * 0.7, -2.2, WIND.z * 0.7), Math.min(1, dt * (0.4 + open * 2)));
        if (open < 0.05) c.v.y -= 9 * dt;
        p.addScaledVector(c.v, dt); c.can.scale.setScalar(Math.max(0.05, open));
        c.m.rotation.set(Math.sin(c.t * 1.3 + c.ph) * 0.15, c.t * 0.3, Math.cos(c.t * 1.1 + c.ph) * 0.12);
        if (p.y <= groundH(p.x, p.z) + 0.12) { c.landed = 0; p.y = groundH(p.x, p.z) + 0.1; c.m.rotation.set(0, c.m.rotation.y, 0); }
      } else {
        c.landed += dt;
        c.can.scale.set(1 + c.landed * 0.3, Math.max(0.05, 1 - c.landed * 1.2), 1 + c.landed * 0.3);   // the canopy collapses
        c.can.position.x = Math.min(0.7, c.landed * 0.6); c.can.position.y = Math.max(0.15, 1 - c.landed * 0.9);
        if (c.landed > 14) { const k = 1 - smoothstep(14, 16, c.landed); c.m.scale.setScalar(Math.max(0.01, k)); }
        if (c.landed > 16) { c.m.scale.setScalar(1); c.can.position.set(0, 1, 0); dropVehicle(c.kind, c.m); this.chutes.splice(i, 1); }
      }
    }
  }
});
const _gw = new V3();

/* unloading at a stand: the ramp opens, the K-loader comes from the cargo yard along the service road, three pallets
   slide onto it, it drives back; the aircraft can't leave meanwhile (groundBusy) */
class UnloadScene {
  constructor(a) {
    this.a = a; a.groundBusy = true; a.rampT = 1; this.t = 0; this.phase = 'ramp';
    const s = a.spot, tail = s.z + a.spec.len * 0.5 + 0.9;
    this.at = [s.x, tail + 0.75];
    this.loader = takeVehicle('kloader'); this.deck = this.loader.getObjectByName('deck');
    this.loader.position.set(CARGO_YARD.in[0], 0, CARGO_YARD.in[1]); vehScale(this.loader, 0.01); this.lk = 0;   // grows in inside the yard's shed as it sets off
    this.pallets = []; this.veh = [this.loader];
  }
  update(dt) {
    const a = this.a; this.t += dt;
    if ((a.state !== 'parked' && a.state !== 'ready') || !AIRCRAFT.includes(a)) { this.done = true; return; }   // gone meanwhile (retired, rebuilt): drop it
    switch (this.phase) {
      case 'ramp': if (this.t > 2.5) { this.phase = 'in'; this.drive = new Drive(this.loader, [CARGO_YARD.in, [CARGO_YARD.x, CARGO_YARD.z], [this.at[0] + 4, SERVICE_Z], [this.at[0] + 1.6, this.at[1] + 1.3]], 2.2, false, 0.5); } break;
      case 'in': {
        if (this.lk < 1) vehScale(this.loader, this.lk = Math.min(1, this.lk + dt * 2.5));
        if (this.drive.step(dt, vehHold(this.drive, a))) { const p = this.loader.position; this.phase = 'dock'; this.drive = new Drive(this.loader, [[p.x, p.z], [this.at[0] + 0.3, this.at[1] + 0.6], this.at], 1.0, true); }
        break;
      }
      case 'dock': if (this.drive.step(dt, vehHold(this.drive, a))) { this.phase = 'load'; this.t = 0; } break;   // backs up to the ramp, deck first
      case 'load': {
        this.deck.position.y = 0.5 + 0.25 * smoothstep(0, 1, this.t);
        const n = Math.min(3, Math.floor((this.t - 1) / 2.2) + 1);   // three pallets, one every 2.2 s
        while (this.pallets.length < n && this.t > 1) { const p = takeVehicle('pallet'); setPallet(p, pick(PALLET_KINDS)); this.pallets.push({ m: p, t: 0 }); }
        for (const [i, p] of this.pallets.entries()) {
          p.t += dt; const k = smoothstep(0, 1.8, p.t);
          // from inside the hold, down the ramp, to its place on the deck (local deck x along the loader, which faces north)
          const from = new V3(a.spot.x, 0.35, a.spot.z + a.spec.len * 0.2), to = this.loader.localToWorld(new V3(-0.2 + 0.45 - i * 0.45, this.deck.position.y + 0.05, 0));
          p.m.position.lerpVectors(from, to, k); p.m.rotation.y = this.loader.rotation.y;
        }
        if (this.t > 1 + 3 * 2.2 + 1) { this.phase = 'out'; a.rampT = 0; this.drive = new Drive(this.loader, [this.at, [this.at[0] + 0.6, this.at[1] + 0.8], [this.at[0] + 4, SERVICE_Z], [CARGO_YARD.x, CARGO_YARD.z], CARGO_YARD.in], 2.0, false, 0.5); }   // back into the shed (dropped there)
        break;
      }
      case 'out': {
        const end = this.drive.step(dt, vehHold(this.drive, a));
        this.pallets.forEach((p, i) => p.m.position.copy(this.loader.localToWorld(new V3(-0.2 + 0.45 - i * 0.45, this.deck.position.y + 0.05, 0))));
        this.pallets.forEach(p => p.m.rotation.y = this.loader.rotation.y);
        if (end) { this.done = true; a.cargo = false; if (Math.random() < 0.5) a.say(radioLine(LINES.unload), { prio: 0 }); }
        break;
      }
    }
  }
  end() {
    this.a.groundBusy = false; this.a.rampT = 0; this.deck.position.y = 0.5;
    vehScale(this.loader, 1); dropVehicle('kloader', this.loader); for (const p of this.pallets) dropVehicle('pallet', p.m);
  }
}

/* emergency on the runway: two crash tenders race out, park either side and foam the aircraft, then a tug tows it home */
class EmergencyScene {
  constructor(a) {
    this.a = a; this.t = 0; this.phase = 'roll';
    const x = a.mesh.position.x, R = a.rwyL || BASE_LAYOUT.rwy;
    this.trucks = [-1, 1].map(i => {
      const m = takeVehicle('firetruck'), to = [x + i * 2.4, R.z + R.w / 2 + 1.3]; vehScale(m, 0.01);   // inside the station: they grow in there, no pop
      const dr = FIRE_DOORS[1 + i], lx = dr.fx, mx = lerp(to[0], lx, Math.min(1, 3 / (Math.abs(to[0] - lx) || 1)));   // out of its own door, turning in from its own lane: the two never cross
      return { m, k: 0, tur: m.getObjectByName('turret'), d: new Drive(m, [[lx, dr.iz], [lx, dr.z], [lx, R.z + R.w / 2 + 2.6], [mx, to[1] + 0.2], to], 4.5), home: [[to[0], to[1]], [mx, to[1] + 0.6], [lx, R.z + R.w / 2 + 2.6], [lx, dr.z], [lx, dr.iz]] };
    });
    RADIO.say(RADIO_NAMES.tower, radioLine(LINES.emergency.rolling, { R: rwyName(a.rwyL) }), { role: 'tower', prio: 2 });
  }
  update(dt) {
    const a = this.a; this.t += dt;
    if (!AIRCRAFT.includes(a)) { this.done = true; return; }
    switch (this.phase) {
      case 'roll':                                         // trucks to the aircraft
        for (const k of this.trucks) if (k.k < 1) vehScale(k.m, k.k = Math.min(1, k.k + dt * 2.5));
        if (this.trucks.map(k => k.d.step(dt)).every(Boolean)) { this.phase = 'foam'; this.t = 0; RADIO.say('CRASH 1', radioLine(LINES.emergency.foam), { role: 'ground', prio: 1 }); }
        break;
      case 'foam': {                                       // the roof turrets spray foam over it
        for (const k of this.trucks) {
          const tp = k.tur.getWorldPosition(new V3()), to = a.mesh.position.clone().setY(0.6).sub(tp);
          k.tur.rotation.y = Math.atan2(-to.z, to.x) - k.m.rotation.y;
          if (Math.random() < dt * 30) FX.smoke.spawn(tp, { s0: 0.25, s1: 1.4, life: 0.9, a0: 0.75, color: 0xf4f6f8, v: to.normalize().multiplyScalar(rand(5, 6.5)).add(new V3(0, 2.5, 0)), drag: 0.6, rise: -6 });
        }
        if (Math.random() < dt * 4) FX.smoke.spawn(a.mesh.position.clone().setY(0.3), { s0: 0.8, s1: 2.2, life: 2.5, a0: 0.35, color: 0xf0f0ee, v: new V3(rand(-0.3, 0.3), 0.15, rand(-0.3, 0.3)) });
        a.smokeOut = Math.max(0, 1 - this.t / 4);
        if (this.t > 7) {
          this.phase = 'tug'; this.t = 0;
          this.tug = takeVehicle('tug'); hideBar(this.tug); vehScale(this.tug, 0.01); this.tk = 0;
          const f = a.fwd, nose = a.mesh.position.clone().addScaledVector(f, a.spec.len * 0.5 + 0.75), sd = Math.sign(FIRE_STATION.z - nose.z) || 1;   // its towing spot (towTug), arriving the way it will lead
          const dr = FIRE_DOORS[1];                                                         // out of the middle door
          this.tugD = new Drive(this.tug, [[dr.fx, dr.iz], [dr.fx, dr.z], [dr.fx, (a.rwyL || BASE_LAYOUT.rwy).z + 4.4], [nose.x - f.x * 2.2, nose.z - f.z * 2.2 + sd * 1.8], [nose.x - f.x * 0.6, nose.z - f.z * 0.6 + sd * 0.3], [nose.x, nose.z]], 3);
          for (const k of this.trucks) k.d = new Drive(k.m, k.home, 2.5);
        }
        break;
      }
      case 'tug': {
        for (const k of this.trucks) k.d.step(dt, vehHold(k.d, a));
        if (this.tk < 1) vehScale(this.tug, this.tk = Math.min(1, this.tk + dt * 2.5));
        if (this.tugD.step(dt, vehHold(this.tugD, a))) { this.phase = 'tow'; this.t = 0; a.startTow(); RADIO.say(RADIO_NAMES.tower, radioLine(LINES.emergency.tow, { C: a.callsign }), { role: 'tower', prio: 1 }); }
        break;
      }
      case 'tow':                                          // the tug leads the aircraft home (Aircraft.towed state)
        if (GROUND_OPS.emerg === a && !AIRFIELD.setOf(a.rwyL).has(a)) GROUND_OPS.emerg = null;   // off its runway: it reopens (the tow may queue behind departures)
        for (const k of this.trucks) if (k.m.visible && k.d.step(dt, vehHold(k.d, a))) k.m.visible = false;   // home: in the station
        if (a.state === 'towed') towTug(this.tug, a, false);   // on the towbar, leading it
        else {
          hideBar(this.tug);                                               // home: it stays in a shelter / hangar (the door shuts on it), else round the wingtip to a depot
          const s = a.spot, p = this.tug.position; this.t = 0; GROUND_OPS.done(a);
          if (AIRFIELD.sheltered(s)) { this.phase = 'inside'; break; }
          const pts = tugWay(a, s, tugDepot(s), s.z - a.spec.len / 2 - 0.75).reverse(); pts[0] = [p.x, p.z];
          this.phase = 'back'; this.tugD = new Drive(this.tug, pts, 2.5, false, 0.5);
        }
        break;
      case 'back': if (this.tugD.step(dt, vehHold(this.tugD, a)) || this.tugD.len - this.tugD.s < 1.1) { this.phase = 'fade'; this.k = 1; } break;
      case 'fade': this.tugD.step(dt); vehScale(this.tug, this.k -= dt * 2.5); if (this.k <= 0) this.done = true; break;
      case 'inside': if (this.a.spot.door < 0.05 || this.t > 40) this.done = true; break;
    }
  }
  end() {
    for (const k of this.trucks) dropVehicle('firetruck', k.m);
    for (const k of this.trucks) vehScale(k.m, 1);
    if (this.tug) { vehScale(this.tug, 1); hideBar(this.tug); dropVehicle('tug', this.tug); }
    if (this.a.emerg) GROUND_OPS.done(this.a);
  }
}

/* ---- ground crew ---- */
// where the crew can be seen working: an open front-row / remote stand, or a helicopter pad (not in a shelter / hangar)
const crewSpot = a => a instanceof Helicopter || (!AIRFIELD.sheltered(a.spot) && a.spot.row === 'a');
/* one crew vehicle: drives in (in), waits (park), backs off (back, tail first), drives away (go) and shrinks out at the
   depot; delay staggers two vehicles sharing a way in / out */
class CrewCar {
  constructor(kind, inPts, back, out, delay) {
    this.kind = kind; this.m = takeVehicle(kind); this.back = back; this.out = out; this.delay = delay || 0; this.k = 0; this.stage = 'in';
    this.d = new Drive(this.m, inPts, 2.6, false, 0.5); this.d.step(0, true); vehScale(this.m, 0.01); this.m.visible = this.delay <= 0;   // hidden while it waits its turn
  }
  update(dt, own, leaving) {
    const m = this.m;
    switch (this.stage) {
      case 'in': {
        if ((this.delay -= dt) > 0) break;
        m.visible = true;
        const h = vehHold(this.d, own); if (!h || this.d.s > 0) vehScale(m, this.k += dt * 2.5);   // doesn't pop in under a passing aircraft
        if (this.d.step(dt, h)) { this.stage = 'park'; this.delay = 0; }
        break;
      }
      case 'park': if (leaving && (this.delay -= dt) <= 0 && (!this.after || ['fade', 'gone'].includes(this.after.stage) || (this.after.stage === 'go' && this.after.d.s > 2))) { this.stage = 'back'; this.d = new Drive(m, [[m.position.x, m.position.z], ...this.back], 1.2, true); } break;
      case 'back': if (this.d.step(dt, vehHold(this.d, own))) { this.stage = 'go'; this.d = new Drive(m, [[m.position.x, m.position.z], ...this.out], 2.6, false, 0.5); } break;
      case 'go': if (this.d.step(dt, vehHold(this.d, own)) || this.d.len - this.d.s < 1.1) { this.stage = 'fade'; this.k = Math.min(this.k, 1); } break;
      case 'fade': this.d.step(dt); vehScale(m, this.k -= dt * 2.5); if (this.k <= 0) { this.drop(); this.stage = 'gone'; } break;
    }
  }
  get position() { return this.m && this.m.position; }
  drop() { if (this.m) { vehScale(this.m, 1); dropVehicle(this.kind, this.m); this.m = null; } }
}
/* refuel / rearm on the stand or pad: a fuel truck (hose out to the aircraft) and, for an armed one, an ammo loader;
   the aircraft can't leave meanwhile (groundBusy; a launch request cuts the work short) */
class ServiceScene {
  constructor(a) {
    this.a = a; a.groundBusy = true; this.t = 0; this.phase = 'in'; this.work = combatOn() ? rand(8, 12) : rand(15, 20);
    const s = a.spot, kinds = a.spec.armed ? ['fueler', 'ammo'] : ['fueler'];
    if (a instanceof Helicopter) {
      // up the corridor east of the pad to beside it: the ammo loader further in, the fuel truck behind it
      const D = HELI_DEPOT, x = s.x + 3, zc = s.z + 3, sg = Math.sign(D.z - zc) || 1;
      const inPts = z => [D.in, [D.x, D.z], [D.x, zc + sg * 1.2], [D.x + 1.4, zc], [x - 1.4, zc], [x, zc - 1.2], [x, z]];
      const out = [[D.x + 1.4, zc], [D.x, zc + sg * 1.2], [D.x, D.z], D.in];
      this.crew = kinds.map(k => new CrewCar(k, inPts(k === 'ammo' ? s.z - 1.2 : s.z + 1.1), [[x, zc - 0.5], [x + 1.4, zc]], out, k === 'fueler' && kinds.length > 1 ? 1.4 : 0));
      for (const c of this.crew) c.outDelay = c.kind === 'ammo' ? 5 : 0;   // the one behind backs out first, the loader once it has cleared the corridor
      const fu = this.crew.find(c => c.kind === 'fueler'), am = this.crew.find(c => c.kind === 'ammo'); if (fu && am) am.after = fu;
    } else {
      // from the nearest depot along the service strip, up beside the wings: fuel truck on the east side, loader on the west
      const D = nearestDepot(s.x), o = a.spec.span / 2 + 0.55, tz = s.z + a.spec.len * 0.12;
      this.crew = kinds.map((k, i) => {
        const sx = s.x + (k === 'fueler' ? o : -o), dir = Math.sign(D.x - sx) || 1;
        const c = new CrewCar(k, [D.in, [D.x, D.z], [sx + dir * 1.6, SERVICE_Z], [sx, SERVICE_Z - 1.2], [sx, tz]], [[sx, SERVICE_Z - 1.0], [sx - dir * 1.4, SERVICE_Z]], [[D.x, D.z], D.in], i * 0.8);
        c.sx = sx; return c;
      });
      // out in order: the one nearer the depot first, the other once it is under way (they share the strip back)
      const order = this.crew.slice().sort((p, q) => Math.abs(p.sx - D.x) - Math.abs(q.sx - D.x));
      order.forEach((c, i) => { c.outDelay = i * 1.2; c.after = order[i - 1] || null; });
    }
    this.veh = this.crew;
    this.hose = this.crew[0].m.getObjectByName('hose');
    const am = this.crew.find(c => c.kind === 'ammo');                // the loader brings this aircraft's kind of load
    if (am) { this.items = setLoad(am.m, loadFor(a)); this.table = am.m.getObjectByName('table'); }
  }
  update(dt) {
    const a = this.a; this.t += dt;
    if (!AIRCRAFT.includes(a)) { this.done = true; return; }
    const hurry = a.state !== 'parked';                       // a launch is waiting: wrap up
    if (this.phase === 'in' && hurry) {                         // not there yet: no work; those still at the depot stay there,
      this.phase = 'out';                                       // the others back off as soon as they are in
      for (const c of this.crew) { c.delay = c.outDelay; if (c.stage === 'in' && c.d.s < 1) c.stage = 'fade'; }
    }
    if (this.phase === 'in' && this.crew.every(c => c.stage === 'park')) { this.phase = 'work'; this.t = 0; }
    if (this.phase === 'work') {
      if (hurry && this.cut == null) this.cut = Math.min(this.work, Math.max(2, this.t + 1.2));              // wrap up: the table comes down in time
      const W = hurry ? this.cut : this.work;
      this.hoseTo(true); this.loadTo(W);
      if (this.t > W) {
        this.phase = 'out'; this.hoseTo(false); if (this.table) this.table.position.y = 0.3;
        for (const c of this.crew) c.delay = c.outDelay;
        if (Math.random() < 0.3) RADIO.say(a instanceof Helicopter ? 'PAD CREW' : 'CREW CHIEF', radioLine(LINES.service, { C: a.callsign }), { role: 'ground', prio: 0, cat: AUD.armed ? 'combat' : 'ops' });
      }
    }
    for (const c of this.crew) c.update(dt, a, this.phase === 'out');
    // the aircraft is free once its crew has pulled away
    if (this.phase === 'out' && a.groundBusy && this.crew.every(c => (c.stage === 'go' && c.d.s > 2) || c.stage === 'fade' || c.stage === 'gone')) a.groundBusy = false;
    if (this.crew.every(c => c.stage === 'gone')) this.done = true;
  }
  /* the loader's table rises to the wing, the items go onto the aircraft one by one, the table comes down again */
  loadTo(W) {
    if (!this.table) return;
    const t = this.t, w = this.work;
    this.table.position.y = 0.3 + 0.16 * smoothstep(0, 1.2, t) * (1 - smoothstep(W - 1.2, W, t));
    if (W < w) return;                                                                      // cut short: what is still on the table stays on it
    const n = this.items.length, gone = Math.min(n, Math.floor(clamp((t - 1.2) / Math.max(1, w - 2.6), 0, 1) * (n + 0.999)));
    this.items.forEach((it, i) => { it.visible = i >= gone; });
  }
  /* the fuel hose from the truck's reel to the aircraft (a unit box scaled out in the truck's frame) */
  hoseTo(on) {
    const h = this.hose; if (!h) return;
    h.visible = on; if (!on) return;
    const m = this.crew[0].m; m.updateMatrixWorld();
    const p = m.worldToLocal(_hs.copy(this.a.mesh.position).setY(0.3)).sub(h.position);
    h.rotation.set(0, Math.atan2(-p.z, p.x), 0); h.scale.set(Math.max(0.2, Math.hypot(p.x, p.z) - this.a.spec.span * 0.2), 1, 1);
  }
  end() {
    if (this.hose) { this.hose.visible = false; this.hose.scale.set(1, 1, 1); this.hose.rotation.set(0, 0, 0); }
    for (const c of this.crew) c.drop();
    this.a.groundBusy = false;
  }
}
const _hs = new V3();

/* the tug: hooked to the nose in a shelter / hangar (it waits inside), or driven up to the nose of one on an open stand;
   it pushes the aircraft back (riding at its nose), unhooks and backs off to the side (the aircraft holds: tugHold),
   then drives back into the shelter / away to the depot */
class PushbackScene {
  constructor(a) {
    this.a = a; a.tug = this; a.tugReady = false; a.tugHold = false; this.t = 0;
    const s = a.spot; this.L = a.spec.len / 2 + 0.75; this.nz = s.z - this.L;   // homes face north: the tug stands north of the nose
    this.m = takeVehicle('tug'); this.veh = [this]; hideBar(this.m); this.k = 1;
    if (AIRFIELD.sheltered(s)) {
      this.inside = true; this.phase = 'hooked'; a.tugReady = true;
      this.m.position.set(s.x, 0, this.nz); this.m.rotation.set(0, -Math.PI / 2, 0);   // nose south, to the aircraft
      if (s.door > 0.05) { this.k = 0; vehScale(this.m, 0.01); }                         // the door is open: it fades in rather than pop up
    } else {
      const D = this.D = tugDepot(s);
      this.d = new Drive(this.m, tugWay(a, s, D, this.nz), 3, false, 0.5); this.d.step(0, true); this.k = 0; vehScale(this.m, 0.01);
      this.phase = 'in';
    }
  }
  get position() { return this.m && this.m.position; }
  update(dt) {
    const a = this.a, s = a.spot; this.t += dt;
    if (!this.m) { this.done = true; return; }
    const gone = !AIRCRAFT.includes(a);
    if (gone && this.phase !== 'away' && this.phase !== 'fade') { this.done = true; return; }
    switch (this.phase) {
      case 'in': {
        const h = vehHold(this.d, a); if (!h || this.d.s > 0) vehScale(this.m, this.k += dt * 2.5);   // doesn't pop in under a passing aircraft
        if (a.state !== 'ready') { this.leave(); break; }      // it went without the tug (it waited too long), or stays: turn away
        if (this.d.step(dt, h)) { this.phase = 'hooked'; a.tugReady = true; }
        break;
      }
      case 'hooked':
        if (this.k < 1) vehScale(this.m, this.k = Math.min(1, this.k + dt * 2.5));
        if (a.state === 'pushback') towTug(this.m, a, true);   // pushing: on the towbar at the nose gear, facing the aircraft
        else if (a.state === 'taxi_out') {                    // unhook and back off to the side (north: toward the homes)
          const p = this.m.position, f = a.fwd; hideBar(this.m); if (this.inside) s.tugIn = this;
          this.phase = 'unhook'; this.d = new Drive(this.m, [[p.x, p.z], [p.x + f.x * 0.6, p.z + f.z * 0.6 - 0.9], [p.x + f.x * 1.2, p.z + f.z * 1.2 - 2.0]], 1.2, true);
        } else if (a.state === 'parked') { hideBar(this.m); this.leave(); }
        else { const r = this.m.rotation; r.y += clamp(Math.atan2(Math.sin(-Math.PI / 2 - r.y), Math.cos(-Math.PI / 2 - r.y)), -3 * dt, 3 * dt); }   // turning to face the nose
        break;
      case 'unhook':
        if (this.d.step(dt, vehHold(this.d, a))) { a.tugHold = false; this.leave(); }
        break;
      case 'away': if (this.d.step(dt, vehHold(this.d, gone ? null : a)) || (!this.inside && this.d.len - this.d.s < 1.1)) { this.phase = this.inside ? 'door' : 'fade'; this.k = 1; this.t = 0; } break;
      // back in: it waits at the threshold for the door (held open for it: s.tugIn), drives in, then the door shuts on it
      case 'door': if (s.door > 0.9 || gone) { this.phase = 'enter'; this.d = new Drive(this.m, [[this.m.position.x, this.m.position.z], [s.x, this.nz]], 1.8); } break;
      case 'enter': if (this.d.step(dt, vehHold(this.d, gone ? null : a))) { this.phase = 'inside'; this.t = 0; if (s.tugIn === this) s.tugIn = null; } break;
      case 'inside': if (s.door < 0.05 || this.t > 40 || gone) { this.drop(); this.done = true; } break;
      case 'fade': this.d.step(dt); vehScale(this.m, this.k -= dt * 2.5); if (this.k <= 0) { this.drop(); this.done = true; } break;
    }
  }
  /* back into the shelter / hangar, or away along the service strip to the depot */
  leave() {
    const a = this.a, s = a.spot, p = this.m.position;
    if (a.tug === this) { a.tug = null; a.tugReady = false; a.tugHold = false; }
    this.phase = 'away'; this.t = 0;
    const D = this.D || nearestDepot(s.x);
    if (this.inside) s.tugIn = this;                                                       // the door stays open until it is in
    const pts = this.inside ? [[p.x, p.z], [s.x, s.z + (s.d || 6) / 2 + 1.2]]
      : s.row === 'c' ? [[p.x, p.z], [44.6, BASE_LAYOUT.lane - 2.4], [44.6, SERVICE_Z - 1.2], [D.x, D.z], D.in]
      : [[p.x, p.z], [p.x + (Math.sign(D.x - p.x) || 1) * 1.2, SERVICE_Z], [D.x, D.z], D.in];
    this.d = new Drive(this.m, pts, 3, false, this.inside ? 0 : 0.5);
  }
  drop() { if (this.m) { vehScale(this.m, 1); hideBar(this.m); dropVehicle('tug', this.m); this.m = null; } }
  end() {
    this.drop();
    const a = this.a; if (a.tug === this) { a.tug = null; a.tugReady = false; a.tugHold = false; }
    if (a.spot && a.spot.tugIn === this) a.spot.tugIn = null;
  }
}
