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
function wheels(g, xs, z, r) { for (const x of xs) for (const s of [-1, 1]) { const w = cyl(g, r, r, 0.12, 8, 0x1e1e1e, x, r, s * z); w.rotation.x = Math.PI / 2; } }
const VEH_BUILD = {
  kloader() {          // K-loader: a low cab and a long roller deck that rises to the ramp
    const g = new THREE.Group();
    box(g, 1.7, 0.25, 0.85, 0xd8b030, 0, 0.32, 0); box(g, 0.4, 0.38, 0.8, 0xd8b030, 0.75, 0.6, 0); box(g, 0.02, 0.2, 0.6, 0x14202c, 0.96, 0.66, 0);
    const deck = new THREE.Group(); deck.name = 'deck'; deck.position.set(-0.2, 0.5, 0); g.add(deck);
    box(deck, 1.35, 0.08, 0.8, 0x6a6e70, 0, 0, 0); for (const s of [-1, 1]) box(deck, 1.35, 0.1, 0.04, 0xd8b030, 0, 0.06, s * 0.4);
    wheels(g, [-0.55, 0.55], 0.4, 0.13);
    mergeStatic(g, [deck]); return g;
  },
  firetruck() {        // crash tender: big red body, cab, roof turret
    const g = new THREE.Group();
    box(g, 1.9, 0.55, 0.85, 0xc8261c, -0.1, 0.48, 0); box(g, 0.45, 0.45, 0.83, 0xc8261c, 0.95, 0.44, 0); box(g, 0.03, 0.2, 0.7, 0x14202c, 1.18, 0.55, 0);
    box(g, 1.9, 0.06, 0.87, 0xe8e8e0, -0.1, 0.62, 0);                                   // white stripe
    const tur = new THREE.Group(); tur.name = 'turret'; tur.position.set(0.55, 0.8, 0); g.add(tur);
    cyl(tur, 0.07, 0.08, 0.1, 6, 0x9a9a9a, 0, 0.03, 0); tube(tur, 0, 0.35, 0.025, 0.02, 0x9a9a9a, 0.06, 0, 5);
    wheels(g, [-0.65, 0, 0.8], 0.43, 0.15);
    navLights(g, [[0.85, 0.72, -0.25, 0x3060ff], [0.85, 0.72, 0.25, 0xff3020]], { period: 0.5, duty: 0.5 }, 0.9);
    mergeStatic(g, [tur]); return g;
  },
  tug() {              // aircraft tug: low and wide
    const g = new THREE.Group();
    box(g, 1.1, 0.3, 0.7, 0xd8b030, 0, 0.25, 0); box(g, 0.35, 0.3, 0.55, 0x3a3e40, -0.3, 0.55, 0);
    wheels(g, [-0.35, 0.35], 0.35, 0.12);
    mergeStatic(g, []); return g;
  },
  fueler() {           // fuel truck: cab, a tank on the back, a hose (unit length, scaled out to the aircraft)
    const g = new THREE.Group();
    box(g, 1.75, 0.12, 0.6, 0x2a2d2a, 0, 0.2, 0); box(g, 0.5, 0.45, 0.62, 0x5a6448, 0.62, 0.45, 0); box(g, 0.02, 0.18, 0.5, 0x14202c, 0.875, 0.55, 0);
    const t = cyl(g, 0.3, 0.3, 1.15, 10, 0x6b7458, -0.25, 0.56, 0); t.rotation.z = Math.PI / 2;
    const hose = new THREE.Group(); hose.name = 'hose'; hose.position.set(-0.85, 0.3, 0.2); hose.visible = false; g.add(hose);
    box(hose, 1, 0.05, 0.05, 0x1a1a1a, 0.5, 0, 0);
    wheels(g, [-0.55, 0.6], 0.32, 0.13);
    mergeStatic(g, [hose]); return g;
  },
  ammo() {             // munitions loader (MJ-1 style): low yellow tractor, a lift table with two bombs on it
    const g = new THREE.Group();
    box(g, 0.45, 0.3, 0.55, 0xd8b030, 0.55, 0.3, 0); box(g, 0.2, 0.25, 0.45, 0x3a3e40, 0.42, 0.57, 0); box(g, 0.9, 0.08, 0.55, 0x5a5e60, -0.25, 0.3, 0);
    for (const z of [-0.14, 0.14]) { const b = cyl(g, 0.08, 0.08, 0.7, 8, 0x4a5236, -0.25, 0.43, z); b.rotation.z = Math.PI / 2; }
    wheels(g, [-0.45, 0.5], 0.3, 0.1);
    mergeStatic(g, []); return g;
  },
  pallet() { const g = new THREE.Group(); box(g, 0.42, 0.04, 0.42, 0x8a8a84, 0, 0.02, 0); box(g, 0.38, 0.3, 0.38, 0x5a6448, 0, 0.19, 0); box(g, 0.39, 0.03, 0.39, 0x2a2d2a, 0, 0.25, 0); mergeStatic(g, []); return g; },
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
/* a vehicle driving a smooth path ([x, z] points) at speed, nose along the path (rev: backing up, tail first);
   step(dt, true) waits where it is (giving way, see vehHold) */
class Drive {
  constructor(m, pts, speed, rev) {
    const q = [pts[0]]; for (const p of pts) if (Math.hypot(p[0] - q[q.length - 1][0], p[1] - q[q.length - 1][1]) > 0.3) q.push(p);   // no doubled points (the curve would loop)
    if (q.length < 2) q.push([q[0][0] + 0.01, q[0][1]]);
    this.m = m; this.c = new THREE.CatmullRomCurve3(densify(q).map(p => new V3(p[0], 0, p[1])), false, 'centripetal'); this.len = this.c.getLength(); this.s = 0; this.v = speed; this.rev = !!rev;
  }
  step(dt, hold) {
    if (!hold) this.s = Math.min(this.len, this.s + this.v * dt * smoothstep(0, 1.5, this.s + 0.2) * (0.4 + 0.6 * smoothstep(0, 2, this.len - this.s)));
    const u = this.s / this.len, p = this.c.getPointAt(u), t = this.c.getTangentAt(u);
    this.m.position.set(p.x, groundH(p.x, p.z), p.z); this.m.rotation.set(0, this.rev ? Math.atan2(t.z, -t.x) : Math.atan2(-t.z, t.x), 0);
    return this.s >= this.len - 1e-3;
  }
  // the way it is heading, `k` ahead
  ahead(out, k = 1.5) { const t = this.c.getTangentAt(Math.min(1, this.s / this.len)); k *= this.rev ? -1 : 1; return out.set(this.m.position.x + t.x * k, 0, this.m.position.z + t.z * k); }
}
/* vehicles give way to aircraft: stop short of the way one on the move (or pushing back toward here) is about to take,
   or of one standing in the way; one already in that way drives on and clears it. Aircraft never wait for vehicles
   (but a pushback waits for one near its path) */
function vehHold(d, own) {
  const p = d.ahead(_vh), m = d.m.position; d.ahead(_vh2, 3.5);
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
const _vh = new V3(), _vh2 = new V3(), _vr = new V3();
const nearAhead = (x, z, r) => Math.hypot(x - _vh.x, z - _vh.z) < r || Math.hypot(x - _vh2.x, z - _vh2.z) < r;   // the two points ahead of the vehicle (vehHold)
/* distance from (px, pz) to the segment a-b */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, u = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(px - ax - dx * u, pz - az - dz * u);
}
/* vehicles pop in / out at their depots: a quick grow / shrink */
const vehScale = (m, k) => m.scale.setScalar(Math.max(0.01, Math.min(1, k)));

const FIRE_STATION = { x: -4, z: 28.6 }, SERVICE_Z = -5.8, CARGO_YARD = { x: 41, z: SERVICE_Z };   // the service strip: between the taxiway's wingtips and the tails on the front row
// ground crew depots: the cargo yard (east) and a west one, on the service strip between the taxiway and the front row;
// HELI_DEPOT: on the road by the helicopter pad
const CREW_DEPOTS = [CARGO_YARD, { x: -66.2, z: SERVICE_Z }], HELI_DEPOT = { x: 5.5, z: 27.2 };
const nearestDepot = x => CREW_DEPOTS.reduce((b, d) => Math.abs(d.x - x) < Math.abs(b.x - x) ? d : b);
const GROUND_OPS = registerMissionWorld({
  scenes: [], chutes: [], emerg: null, emTimer: rand(420, 720),
  reset() {
    for (const s of this.scenes) this.endScene(s);
    for (const c of this.chutes) dropVehicle(c.kind, c.m);
    this.scenes = []; this.chutes = []; this.emerg = null; this.emTimer = rand(420, 720);
  },
  update(dt) {
    for (const s of this.scenes) s.update(dt);
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
    this.loader.position.set(CARGO_YARD.x, 0, CARGO_YARD.z);
    this.pallets = []; this.veh = [this.loader];
  }
  update(dt) {
    const a = this.a; this.t += dt;
    if ((a.state !== 'parked' && a.state !== 'ready') || !AIRCRAFT.includes(a)) { this.done = true; return; }   // gone meanwhile (retired, rebuilt): drop it
    switch (this.phase) {
      case 'ramp': if (this.t > 2.5) { this.phase = 'in'; this.drive = new Drive(this.loader, [[CARGO_YARD.x, CARGO_YARD.z], [this.at[0] + 4, SERVICE_Z], [this.at[0] + 0.6, this.at[1] + 0.6], this.at], 2.2); } break;
      case 'in': if (this.drive.step(dt, vehHold(this.drive, a))) { this.phase = 'load'; this.t = 0; this.loader.rotation.y = -Math.PI / 2; } break;   // nose to the ramp (north)
      case 'load': {
        this.deck.position.y = 0.5 + 0.25 * smoothstep(0, 1, this.t);
        const n = Math.min(3, Math.floor((this.t - 1) / 2.2) + 1);   // three pallets, one every 2.2 s
        while (this.pallets.length < n && this.t > 1) { const p = takeVehicle('pallet'); this.pallets.push({ m: p, t: 0 }); }
        for (const [i, p] of this.pallets.entries()) {
          p.t += dt; const k = smoothstep(0, 1.8, p.t);
          // from inside the hold, down the ramp, to its place on the deck (local deck x along the loader, which faces north)
          const from = new V3(a.spot.x, 0.35, a.spot.z + a.spec.len * 0.2), to = this.loader.localToWorld(new V3(-0.2 + 0.45 - i * 0.45, this.deck.position.y + 0.05, 0));
          p.m.position.lerpVectors(from, to, k); p.m.rotation.y = this.loader.rotation.y;
        }
        if (this.t > 1 + 3 * 2.2 + 1) { this.phase = 'out'; a.rampT = 0; this.drive = new Drive(this.loader, [this.at, [this.at[0] + 0.6, this.at[1] + 0.8], [this.at[0] + 4, SERVICE_Z], [CARGO_YARD.x, CARGO_YARD.z], [CARGO_YARD.x + 4, CARGO_YARD.z - 6]], 2.0); }
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
    dropVehicle('kloader', this.loader); for (const p of this.pallets) dropVehicle('pallet', p.m);
  }
}

/* emergency on the runway: two crash tenders race out, park either side and foam the aircraft, then a tug tows it home */
class EmergencyScene {
  constructor(a) {
    this.a = a; this.t = 0; this.phase = 'roll';
    const x = a.mesh.position.x, R = a.rwyL || BASE_LAYOUT.rwy;
    this.trucks = [-1, 1].map(i => {
      const m = takeVehicle('firetruck'), to = [x + i * 2.4, R.z + R.w / 2 + 1.3];
      return { m, tur: m.getObjectByName('turret'), d: new Drive(m, [[FIRE_STATION.x + i * 1.2, FIRE_STATION.z], [FIRE_STATION.x + i * 1.2, R.z + R.w / 2 + 2.6], [to[0] - Math.sign(to[0] - FIRE_STATION.x) * 3, to[1] + 0.2], to], 4.5), home: [[to[0], to[1]], [to[0] - Math.sign(to[0] - FIRE_STATION.x || 1) * 3, to[1] + 0.6], [FIRE_STATION.x + i * 1.2, R.z + R.w / 2 + 2.6], [FIRE_STATION.x + i * 1.2, FIRE_STATION.z]] };
    });
    RADIO.say(RADIO_NAMES.tower, radioLine(LINES.emergency.rolling, { R: rwyName(a.rwyL) }), { role: 'tower', prio: 2 });
  }
  update(dt) {
    const a = this.a; this.t += dt;
    if (!AIRCRAFT.includes(a)) { this.done = true; return; }
    switch (this.phase) {
      case 'roll':                                         // trucks to the aircraft
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
          this.tug = takeVehicle('tug'); const nose = a.mesh.position.clone().addScaledVector(a.fwd, a.spec.len * 0.5 + 0.8);
          this.tugD = new Drive(this.tug, [[FIRE_STATION.x + 3, FIRE_STATION.z], [FIRE_STATION.x + 3, (a.rwyL || BASE_LAYOUT.rwy).z + 4.4], [nose.x + 3, nose.z + 1], [nose.x + 0.9, nose.z]], 3);
          for (const k of this.trucks) k.d = new Drive(k.m, k.home, 2.5);
        }
        break;
      }
      case 'tug': {
        for (const k of this.trucks) k.d.step(dt);
        if (this.tugD.step(dt)) { this.phase = 'tow'; this.t = 0; a.startTow(); RADIO.say(RADIO_NAMES.tower, radioLine(LINES.emergency.tow, { C: a.callsign }), { role: 'tower', prio: 1 }); }
        break;
      }
      case 'tow':                                          // the tug leads the aircraft home (Aircraft.towed state)
        if (GROUND_OPS.emerg === a && !AIRFIELD.setOf(a.rwyL).has(a)) GROUND_OPS.emerg = null;   // off its runway: it reopens (the tow may queue behind departures)
        for (const k of this.trucks) if (k.d.step(dt)) { k.m.visible = false; }
        if (a.state === 'towed') { const ahead = a.mesh.position.clone().addScaledVector(a.fwd, a.spec.len * 0.5 + 0.7); this.tug.position.copy(ahead).setY(0); this.tug.rotation.set(0, Math.atan2(-a.fwd.z, a.fwd.x), 0); }
        else { this.phase = 'back'; this.tugD = new Drive(this.tug, [[this.tug.position.x, this.tug.position.z], [this.tug.position.x, this.tug.position.z + 2], [FIRE_STATION.x + 3, FIRE_STATION.z - 1]], 2.5); GROUND_OPS.done(a); }
        break;
      case 'back': if (this.tugD.step(dt)) this.done = true; break;
    }
  }
  end() {
    for (const k of this.trucks) dropVehicle('firetruck', k.m);
    if (this.tug) dropVehicle('tug', this.tug);
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
    this.d = new Drive(this.m, inPts, 2.6); this.d.step(0, true); vehScale(this.m, 0.01);
  }
  update(dt, own, leaving) {
    const m = this.m;
    switch (this.stage) {
      case 'in': {
        if ((this.delay -= dt) > 0) break;
        const h = vehHold(this.d, own); if (!h || this.d.s > 0) vehScale(m, this.k += dt * 2.5);   // doesn't pop in under a passing aircraft
        if (this.d.step(dt, h)) { this.stage = 'park'; this.delay = 0; }
        break;
      }
      case 'park': if (leaving && (this.delay -= dt) <= 0) { this.stage = 'back'; this.d = new Drive(m, [[m.position.x, m.position.z], ...this.back], 1.2, true); } break;
      case 'back': if (this.d.step(dt, vehHold(this.d, own))) { this.stage = 'go'; this.d = new Drive(m, [[m.position.x, m.position.z], ...this.out], 2.6); } break;
      case 'go': if (this.d.step(dt, vehHold(this.d, own))) this.stage = 'fade'; break;
      case 'fade': vehScale(m, this.k -= dt * 2.5); if (this.k <= 0) { this.drop(); this.stage = 'gone'; } break;
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
      const inPts = z => [[D.x, D.z], [D.x, zc + sg * 1.2], [D.x + 1.4, zc], [x - 1.4, zc], [x, zc - 1.2], [x, z]];
      const out = [[D.x + 1.4, zc], [D.x, zc + sg * 1.2], [D.x, D.z]];
      this.crew = kinds.map(k => new CrewCar(k, inPts(k === 'ammo' ? s.z - 1.2 : s.z + 1.1), [[x, zc - 0.5], [x + 1.4, zc]], out, k === 'fueler' && kinds.length > 1 ? 1.4 : 0));
      for (const c of this.crew) c.outDelay = c.kind === 'ammo' ? 5 : 0;   // the one behind backs out first, the loader once it has cleared the corridor
    } else {
      // from the nearest depot along the service strip, up beside the wings: fuel truck on the east side, loader on the west
      const D = nearestDepot(s.x), o = a.spec.span / 2 + 0.55, tz = s.z + a.spec.len * 0.12;
      this.crew = kinds.map((k, i) => {
        const sx = s.x + (k === 'fueler' ? o : -o), dir = Math.sign(D.x - sx) || 1;
        const c = new CrewCar(k, [[D.x, D.z], [sx + dir * 1.6, SERVICE_Z], [sx, SERVICE_Z - 1.2], [sx, tz]], [[sx, SERVICE_Z - 1.0], [sx - dir * 1.4, SERVICE_Z]], [[D.x, SERVICE_Z]], i * 0.8);
        c.outDelay = i * 1.2; return c;
      });
    }
    this.veh = this.crew;
    this.hose = this.crew[0].m.getObjectByName('hose');
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
      this.hoseTo(true);
      if (this.t > (hurry ? Math.min(this.work, 2) : this.work)) {
        this.phase = 'out'; this.hoseTo(false);
        for (const c of this.crew) c.delay = c.outDelay;
        if (Math.random() < 0.3) RADIO.say(a instanceof Helicopter ? 'PAD CREW' : 'CREW CHIEF', radioLine(LINES.service, { C: a.callsign }), { role: 'ground', prio: 0, cat: AUD.armed ? 'combat' : 'ops' });
      }
    }
    for (const c of this.crew) c.update(dt, a, this.phase === 'out');
    // the aircraft is free once its crew has pulled away
    if (this.phase === 'out' && a.groundBusy && this.crew.every(c => (c.stage === 'go' && c.d.s > 2) || c.stage === 'fade' || c.stage === 'gone')) a.groundBusy = false;
    if (this.crew.every(c => c.stage === 'gone')) this.done = true;
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
    this.m = takeVehicle('tug'); this.veh = [this];
    if (AIRFIELD.sheltered(s)) {
      this.inside = true; this.phase = 'hooked'; a.tugReady = true;
      this.m.position.set(s.x, 0, this.nz); this.m.rotation.set(0, -Math.PI / 2, 0);   // nose south, to the aircraft
    } else {
      const D = this.D = s.row === 'c' ? CARGO_YARD : nearestDepot(s.x), sx = s.x + (Math.sign(D.x - s.x) || 1) * (a.spec.span / 2 + 0.6);
      const pts = s.row === 'c' ? [[D.x, D.z], [44.6, SERVICE_Z - 1.2], [44.6, this.nz - 1.6], [s.x - 1, this.nz - 1.6], [s.x, this.nz]]
        : [[D.x, D.z], [sx + (Math.sign(D.x - sx) || 1) * 1.6, SERVICE_Z], [sx, SERVICE_Z - 1.2], [sx, s.z], [sx, this.nz + 0.2], [s.x + (sx - s.x) * 0.45, this.nz - 0.45], [s.x, this.nz]];   // round the wingtip, in from the side (not out over the lane)
      this.d = new Drive(this.m, pts, 3); this.d.step(0, true); this.k = 0; vehScale(this.m, 0.01);
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
        if (this.d.step(dt, h)) { this.phase = 'hooked'; a.tugReady = true; this.m.rotation.set(0, -Math.PI / 2, 0); }
        break;
      }
      case 'hooked':
        if (a.state === 'pushback') {                           // pushing: ride at the nose, facing the aircraft
          const f = a.fwd; this.m.position.set(a.mesh.position.x + f.x * this.L, 0, a.mesh.position.z + f.z * this.L);
          this.m.rotation.set(0, Math.atan2(-f.z, f.x) + Math.PI, 0);
        } else if (a.state === 'taxi_out') {                    // unhook and back off to the side (north: toward the homes)
          const p = this.m.position, f = a.fwd;
          this.phase = 'unhook'; this.d = new Drive(this.m, [[p.x, p.z], [p.x + f.x * 0.6, p.z + f.z * 0.6 - 0.9], [p.x + f.x * 1.2, p.z + f.z * 1.2 - 2.0]], 1.2, true);
        } else if (a.state === 'parked') this.leave();
        break;
      case 'unhook':
        if (this.d.step(dt)) { a.tugHold = false; this.leave(); }
        break;
      case 'away': if (this.d.step(dt, vehHold(this.d, gone ? null : a))) { this.phase = this.inside ? 'inside' : 'fade'; this.k = 1; this.t = 0; } break;
      case 'inside': if (s.door < 0.05 || this.t > 40 || gone) { this.drop(); this.done = true; } break;   // the door has shut on it
      case 'fade': vehScale(this.m, this.k -= dt * 2.5); if (this.k <= 0) { this.drop(); this.done = true; } break;
    }
  }
  /* back into the shelter / hangar, or away along the service strip to the depot */
  leave() {
    const a = this.a, s = a.spot, p = this.m.position;
    if (a.tug === this) { a.tug = null; a.tugReady = false; a.tugHold = false; }
    this.phase = 'away'; this.t = 0;
    const D = this.D || nearestDepot(s.x);
    const pts = this.inside ? [[p.x, p.z], [s.x, s.z + (s.d || 6) / 2 + 1.2], [s.x, this.nz]]
      : s.row === 'c' ? [[p.x, p.z], [44.6, BASE_LAYOUT.lane - 2.4], [44.6, SERVICE_Z - 1.2], [D.x, D.z]]
      : [[p.x, p.z], [p.x + (Math.sign(D.x - p.x) || 1) * 1.2, SERVICE_Z], [D.x, D.z]];
    this.d = new Drive(this.m, pts, 3);
  }
  drop() { if (this.m) { vehScale(this.m, 1); dropVehicle('tug', this.m); this.m = null; } }
  end() {
    this.drop();
    const a = this.a; if (a.tug === this) { a.tug = null; a.tugReady = false; a.tugHold = false; }
  }
}
