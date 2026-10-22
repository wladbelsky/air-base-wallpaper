'use strict';
/* ===== Missions beyond the screen edge (only while there is no music) =====
   A Mission is one dispatched flight. legs(role) lists the steps (Leg subclasses) each aircraft flies; the lead and
   the wingmen may fly different legs. dispatchFlight (main.js) only picks the flight, pickMission() picks the type.
   New mission type: subclass Mission (or one of the types below), override what differs — legs(role), eligible(),
   weight, optIn, textKey(), dist / away — and registerMission() it; its texts go into MISSIONS (radio.js).
   New step: subclass Leg with a static `state`, implement enter() / update(), and registerLeg() it (panel status).
   Objects living in the world for a mission (the refuelling passes, ground scenes) registerMissionWorld() an { update, reset }. */

/* ---- mission-world objects (refuelling passes, ground scenes …): updated every step, reset when the air wing is rebuilt ---- */
const MISSION_WORLD = [];
function registerMissionWorld(o) { MISSION_WORLD.push(o); return o; }
function missionWorldUpdate(dt) { for (const o of MISSION_WORLD) if (o.update) o.update(dt); }
function missionWorldReset() { for (const o of MISSION_WORLD) if (o.reset) o.reset(); }

/* ---- legs: one step of a mission for one aircraft ----
   c = the aircraft's mission context { m: Mission, slot, role: 'lead' | 'wing', far, legs, i }.
   update() returns true when the step is finished; the next leg's enter() follows on the same frame. */
class Leg {
  static state = '';
  enter(a, c) { a.state = this.constructor.state; a.t = 0; }
  update(a, c, dt) { return true; }
}
function registerLeg(L, label, cls) { STATUS[L.state] = [label, cls]; return L; }

/* fly from the orbit (or a hover) to this aircraft's point beyond the screen edge; wingmen follow the lead in trail */
class Depart extends Leg {
  static state = 'mission_out';
  enter(a, c) { super.enter(a, c); this.wait = c.slot * 1.6; this.flying = false; }
  update(a, c, dt) {
    if (!this.flying) {
      if ((c.role === 'wing' && !c.m.leadOut) || (this.wait -= dt) > 0) { a.orbitStep(dt); return false; }
      const v0 = Math.min(a.v || a.orbit.v, a.orbit.v);                 // from a hover it speeds up from slow flight
      a.fly(new FlightPath().addDubins(a.mesh.position, headingOf(a.fwd), c.far, c.m.heading, a.spec.turnR), v0, a.orbit.v * 1.15);
      this.flying = true; if (c.role === 'lead') c.m.leadOut = true;
    }
    if (!a.followPath(dt)) return false;
    a.mesh.visible = false; return true;
  }
}
/* off-screen. The lead reports the job done when it turns back. */
class Away extends Leg {
  static state = 'mission';
  enter(a, c) { super.enter(a, c); a.mesh.visible = false; }
  update(a, c, dt) {
    if (a.t <= c.m.away + c.slot * 1.6) return false;
    if (c.role === 'lead' && c.m.done) a.say(c.m.done, { prio: 1 });
    return true;
  }
}
/* back to a (new) orbit: from the far point, or from wherever the aircraft is */
class Return extends Leg {
  static state = 'mission_back';
  enter(a, c) {
    super.enter(a, c);
    const hidden = !a.mesh.visible, from = a.mesh.position.clone(), h = hidden ? c.m.heading + Math.PI : headingOf(a.fwd), P = new FlightPath();
    a.pickOrbit(true); a.pathToOrbit(P, from, h, 0.5);
    a.fly(P, hidden ? a.orbit.v * 1.15 : clamp(a.v || 0, 1.5, a.orbit.v), a.orbit.v);   // from a hover / drift: carry on from its speed
    a.fwd.set(Math.cos(h), 0, Math.sin(h)); a.mesh.visible = true;
  }
  update(a, c, dt) { return a.followPath(dt); }
}
registerLeg(Depart, 'MISSION ▶', 'air'); registerLeg(Away, 'ON MISSION', 'air'); registerLeg(Return, 'RTB', 'air');

/* ---- mission types ---- */
const MISSION_TYPES = {};
function registerMission(M) {
  if (!M.key || (MISSION_TYPES[M.key] && MISSION_TYPES[M.key] !== M)) throw new Error(`mission type needs its own static key (got '${M.key}')`);
  MISSION_TYPES[M.key] = M; return M;
}
/* spec.missions (optional) is an allow-list of mission keys; otherwise every eligible type that isn't optIn */
function pickMission(lead) {
  const allow = lead.spec.missions;
  const cands = Object.values(MISSION_TYPES).filter(M => (allow ? allow.includes(M.key) : !M.optIn) && M.eligible(lead)).map(M => ({ M, w: M.weight }));
  return cands.length ? wpick(cands).M : null;
}

/* generic off-screen job (CAP, strikes, escorts, CSAR, medevac, overwatch…): out, away, back to the orbit */
class Mission {
  static key = 'patrol'; static weight = 1;
  static optIn = false;                       // only for aircraft that list it in spec.missions
  static eligible(lead) { return true; }
  constructor(flight, size) {
    this.flight = flight; this.size = size; this.lead = flight[0]; this.heli = this.lead instanceof Helicopter;
    this.heading = rand(0, TAU); this.dist = this.heli ? 120 : 175; this.away = rand(50, 110); this.leadOut = false;
  }
  textKey() { const a = this.lead; return a.isAwacs ? 'awacs' : a.spec.gunship ? 'gunship' : this.heli ? (a.spec.armed ? 'heli_attack' : 'heli_transport') : 'fighter'; }
  copyKey() { return this.textKey(); }        // acknowledgement pool (LINES.missionCopy)
  textVars() { return null; }                 // extra placeholders for the order / done texts ({V} …)
  legs(role) { return [Depart, Away, Return]; }
  /* this aircraft's point beyond the screen edge: the flight spread abreast across the mission heading */
  farPoint(a, slot) {
    const h = this.heading, n = this.flight.length;
    return new V3(Math.cos(h) * this.dist, a.orbit.alt, Math.sin(h) * this.dist).addScaledVector(new V3(-Math.sin(h), 0, Math.cos(h)), (slot - (n - 1) / 2) * 6);
  }
  board(a, slot, legs) {
    const role = slot ? 'wing' : 'lead', c = a.mission = { m: this, slot, role, far: this.farPoint(a, slot), legs: legs(role).map(L => new L()), i: 0 };
    c.legs[0].enter(a, c);
  }
  start() {
    const { order, done } = makeMission(this.textKey(), this.textVars()); this.done = done;
    const n = this.flight.length;
    this.flight.forEach((a, slot) => this.board(a, slot, r => this.legs(r)));
    // the whole flight is addressed through its lead; part of a flight by each aircraft (WARDOG 3, WARDOG 4)
    const lead = this.lead, awacs = AIRCRAFT.find(a => a.isAwacs && a.airborne && a !== lead);
    const who = n === this.size ? lead.callsign : this.flight.map(a => a.callsign).join(', ');
    RADIO.say(awacs ? awacs.callsign : RADIO_NAMES.tower, `${who}, ${order}`, { role: awacs ? 'awacs' : 'tower', prio: 1 });
    lead.say(missionCopy(this.copyKey()), { prio: 1, delay: 0.3 });
  }
  /* a flight restored from a saved session (js/persist.js): already out there — away a little longer, then back */
  resume() {
    this.done = makeMission(this.textKey(), this.textVars()).done; this.away = rand(10, 40); this.leadOut = true;
    const h = this.heading;
    this.flight.forEach((a, slot) => {
      a.pickOrbit(true); a.fwd.set(Math.cos(h), 0, Math.sin(h)); a.v = a.orbit.v;
      this.board(a, slot, () => [Away, Return]); a.mesh.position.copy(a.mission.far);
    });
  }
  update(a, dt) {
    const c = a.mission;
    if (!c.legs[c.i].update(a, c, dt)) return;
    if (++c.i < c.legs.length) c.legs[c.i].enter(a, c); else this.finish(a);
  }
  finish(a) { a.mission = null; a.state = 'orbit'; a.airT = 0; }
}
registerMission(Mission);

/* C-130 / C-17 airlift run: farther, longer, and it lands at the base when it comes back */
class AirliftMission extends Mission {
  static key = 'airlift'; static optIn = true;
  constructor(flight, size) { super(flight, size); this.dist = 180; this.away = rand(100, 170); }
  textKey() { return 'airlift'; }
  finish(a) { super.finish(a); a.landReq = true; a.cargo = true; }   // unloaded on its stand when it is back (groundops.js)
}
registerMission(AirliftMission);


/* ---- paradrop (C-130 / C-17): low across the screen over a drop zone at the edge of the base, the jumpers or the
   cargo under canopies (GROUND_OPS.dropChute), then back to the orbit ---- */
/* a drop zone: open ground on screen, nothing in the way — outside the fence if any of that is on screen, else a
   field inside it (away from the runway, the apron and the buildings) */
function dropZone() {
  let inside = null;
  const ok = p => !vegBlocked(p.x, p.z) && !BASE.targets.some(t => Math.hypot(t.p.x - p.x, t.p.z - p.z) < 10);
  for (let i = 0; i < 150; i++) {
    const p = AIRWAR.groundAt(rand(-0.7, 0.7), rand(-0.7, 0.5), 0);
    if (!ok(p)) continue;
    if (!insideFence(p.x, p.z)) return p;
    inside = inside || p;
  }
  if (inside) return inside;
  for (let y = -0.7; y <= 0.5; y += 0.1) for (let x = -0.8; x <= 0.8; x += 0.1) { const p = AIRWAR.groundAt(x, y, 0); if (ok(p)) return p; }   // open ground somewhere on screen
  return AIRWAR.groundAt(rand(-0.5, 0.5), -0.5, 0);
}
class DropPass extends Leg {
  static state = 'drop_pass';
  enter(a, c) {
    super.enter(a, c);
    const m = c.m; if (!m.dz) { m.dz = dropZone(); m.dh = rand(0, TAU); }
    // in a line abreast behind the lead: the run-in starts off-screen, crosses the drop zone, leaves off-screen
    const d = new V3(Math.cos(m.dh), 0, Math.sin(m.dh)), side = new V3(-d.z, 0, d.x), alt = rand(8.5, 10);
    const lag = c.slot * 7, A = m.dz.clone().addScaledVector(d, -95 - lag).addScaledVector(side, c.slot * 2.5), B = m.dz.clone().addScaledVector(d, 95 - lag).addScaledVector(side, c.slot * 2.5);
    A.y = B.y = alt;
    a.fly(new FlightPath().addLine(A, B), a.spec.speed * 0.8, a.spec.speed * 0.8); a.mesh.visible = true; a.fwd.copy(d);
    this.dropAt = 95 + lag - 7; this.n = m.cargo ? 3 : randi(8, 12); this.acc = 0; this.said = false;
  }
  update(a, c, dt) {
    const done = a.followPath(dt);
    if (a.ps > this.dropAt && this.n > 0 && (this.acc -= dt) <= 0) {
      this.acc = c.m.cargo ? 0.6 : 0.32; this.n--;
      const tail = a.mesh.position.clone().addScaledVector(a.fwd, -a.spec.len * 0.55); tail.y -= 0.3;
      GROUND_OPS.dropChute(tail, a.fwd.clone().multiplyScalar(a.v * 0.35), c.m.cargo);
      if (!this.said && c.role === 'lead') { this.said = true; a.say(radioLine(c.m.cargo ? LINES.paradrop.cargo : LINES.paradrop.jump), { prio: 1 }); }
    }
    if (done) a.mesh.visible = false;
    return done;
  }
}
registerLeg(DropPass, 'DROP RUN', 'air');
class ParadropMission extends Mission {
  static key = 'paradrop'; static optIn = true;
  constructor(flight, size) { super(flight, size); this.away = rand(15, 30); this.cargo = Math.random() < 0.35; }
  textKey() { return this.cargo ? 'paradrop.cargo' : 'paradrop.troops'; }
  copyKey() { return 'airlift'; }
  legs(role) { return [Depart, Away, DropPass, Return]; }
}
registerMission(ParadropMission);
