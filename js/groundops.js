'use strict';
/* ===== Scenes on the ground and over the field (peace only) =====
   - unloading: a C-17 / C-130 back from an airlift run with cargo, parked on a stand: its ramp opens, a K-loader comes
     from the cargo yard, the pallets slide onto it, it drives them away;
   - paradrop: a C-130 / C-17 flies low across the screen over a drop zone and paratroopers (or cargo) come down under
     canopies, drift with the wind and land (missions.js: ParadropMission);
   - emergency landing: now and then a jet comes back with an engine fire, trailing smoke; the runway is cleared for it,
     it stops on the runway, the crash tenders race out of the fire station and foam it, a tug tows it home.
   Vehicles, pallets and parachutes are clones of one template each, kept in pools (never disposed, never rebuilt).
   GROUND_OPS is a mission-world object: updated every step, reset when the air wing is rebuilt.                    */
Object.assign(STATUS, { emergency: ['EMERGENCY', 'wait'], towed: ['UNDER TOW', 'busy'] });
const VEH_TEMPLATES = {}, VEH_POOL = { kloader: [], firetruck: [], tug: [], pallet: [], chute: [], cargochute: [] };
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
/* a vehicle driving a smooth path ([x, z] points) at speed, nose along the path */
class Drive {
  constructor(m, pts, speed) { this.m = m; this.c = new THREE.CatmullRomCurve3(pts.map(p => new V3(p[0], 0, p[1])), false, 'centripetal'); this.len = this.c.getLength(); this.s = 0; this.v = speed; }
  step(dt) {
    this.s = Math.min(this.len, this.s + this.v * dt * smoothstep(0, 1.5, this.s + 0.2) * (0.4 + 0.6 * smoothstep(0, 2, this.len - this.s)));
    const u = this.s / this.len, p = this.c.getPointAt(u), t = this.c.getTangentAt(u);
    this.m.position.set(p.x, groundH(p.x, p.z), p.z); this.m.rotation.set(0, Math.atan2(-t.z, t.x), 0);
    return this.s >= this.len - 1e-3;
  }
}

const FIRE_STATION = { x: -4, z: 14.6 }, CARGO_YARD = { x: 41, z: -5.2 }, SERVICE_Z = -5.2;
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
    // emergencies: peace only, now and then one jet in orbit
    if (this.emerg || combatOn()) return;
    if ((this.emTimer -= dt) > 0) return;
    const c = AIRCRAFT.filter(a => a instanceof FixedWing && a.spec.armed && a.state === 'orbit' && !a.landReq && !a.retiring && !a.tank && a.airT > 30);
    this.emTimer = c.length ? rand(480, 900) : 20;                  // nobody suitable up: look again soon
    if (c.length) this.startEmergency(pick(c));
  },
  endScene(s) { if (s.end) s.end(); },

  /* ---- emergency landing ---- */
  startEmergency(a) {
    this.emerg = a; a.emerg = true; a.requestLand();
    a.say(radioLine(LINES.emergency.mayday), { prio: 3 });
    RADIO.say(RADIO_NAMES.tower, radioLine(LINES.emergency.tower, { C: a.callsign }), { role: 'tower', prio: 3, delay: 2.5 });
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
    this.pallets = [];
  }
  update(dt) {
    const a = this.a; this.t += dt;
    if ((a.state !== 'parked' && a.state !== 'ready') || !AIRCRAFT.includes(a)) { this.done = true; return; }   // gone meanwhile (retired, rebuilt): drop it
    switch (this.phase) {
      case 'ramp': if (this.t > 2.5) { this.phase = 'in'; this.drive = new Drive(this.loader, [[CARGO_YARD.x, CARGO_YARD.z], [this.at[0] + 4, SERVICE_Z], [this.at[0] + 0.6, this.at[1] + 0.6], this.at], 2.2); } break;
      case 'in': if (this.drive.step(dt)) { this.phase = 'load'; this.t = 0; this.loader.rotation.y = -Math.PI / 2; } break;   // nose to the ramp (north)
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
        const end = this.drive.step(dt);
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
    const x = a.mesh.position.x, R = BASE_LAYOUT.rwy;
    this.trucks = [-1, 1].map(i => {
      const m = takeVehicle('firetruck'), to = [x + i * 2.4, R.z + R.w / 2 + 1.3];
      return { m, tur: m.getObjectByName('turret'), d: new Drive(m, [[FIRE_STATION.x + i * 1.2, FIRE_STATION.z], [FIRE_STATION.x + i * 1.2, R.z + R.w / 2 + 2.6], [to[0] - Math.sign(to[0] - FIRE_STATION.x) * 3, to[1] + 0.2], to], 4.5), home: [[to[0], to[1]], [to[0] - Math.sign(to[0] - FIRE_STATION.x || 1) * 3, to[1] + 0.6], [FIRE_STATION.x + i * 1.2, R.z + R.w / 2 + 2.6], [FIRE_STATION.x + i * 1.2, FIRE_STATION.z]] };
    });
    RADIO.say(RADIO_NAMES.tower, radioLine(LINES.emergency.rolling), { role: 'tower', prio: 2 });
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
          this.tugD = new Drive(this.tug, [[FIRE_STATION.x + 3, FIRE_STATION.z], [FIRE_STATION.x + 3, BASE_LAYOUT.rwy.z + 4.4], [nose.x + 3, nose.z + 1], [nose.x + 0.9, nose.z]], 3);
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
        if (GROUND_OPS.emerg === a && !AIRFIELD.rwy.has(a)) GROUND_OPS.emerg = null;   // off the runway: it reopens (the tow may queue behind departures)
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
