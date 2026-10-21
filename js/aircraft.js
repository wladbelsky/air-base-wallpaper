'use strict';
/* ===== Air wing: base classes + aircraft types =====
   To add a new type: subclass FixedWing or Helicopter, give it a static `spec`
   and a buildModel() that returns an airframe from airframes.js, then register
   it in AIRCRAFT_TYPES (and add a count property in project.json if wanted).  */
const WUP = new V3(0, 1, 0);
const _po = new V3(), _v = new V3(), _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4(), _r = new V3(), _u = new V3(), _u2 = new V3(), _r2 = new V3();
function orientFrom(obj, f, bank) {
  _r.crossVectors(f, WUP); if (_r.lengthSq() < 1e-6) _r.set(0, 0, 1); _r.normalize();
  _u.crossVectors(_r, f).normalize();
  const cb = Math.cos(bank), sb = Math.sin(bank);
  _u2.copy(_u).multiplyScalar(cb).addScaledVector(_r, sb);
  _r2.copy(_r).multiplyScalar(cb).addScaledVector(_u, -sb);
  _m4.makeBasis(f, _u2, _r2); obj.quaternion.setFromRotationMatrix(_m4);
}
const headingOf = d => Math.atan2(d.z, d.x);
const flightOf = a => a.callsign.replace(/\s+\d+$/, '');   // flight = aircraft sharing a callsign (WARDOG 1…4)

/* ---- carrier flight deck resources ---- */
const FD = {
  cats: [{ x0: 3.2, x1: 15.9, z: -1.0, busy: null }, { x0: 3.2, x1: 15.9, z: 1.2, busy: null }],
  runway: null,
  freeCat() { const f = this.cats.filter(c => !c.busy); return f.length ? pick(f) : null; }
};
const DECK = {
  // deck parking for jets, in order of preference. initial: the first INITIAL_DECK spots are pre-filled.
  fixedSpots: [
    { x: 7.6, z: 3.1, yaw: 150 * DEG }, { x: 9.6, z: 3.0, yaw: 150 * DEG },                    // starboard, forward of the island
    { x: -10.8, z: 3.15, yaw: 150 * DEG, aft: true }, { x: -8.4, z: 3.15, yaw: 150 * DEG, aft: true },  // starboard aft
    { x: -12.4, z: -4.5, yaw: 0, port: true }, { x: -9.8, z: -4.9, yaw: 0, port: true }, { x: -7.2, z: -4.75, yaw: 0, port: true } // angled-deck sponson
  ],
  INITIAL_DECK: 3,
  heliSpots: [{ x: -13.8, z: 1.6, yaw: 0 }],
  heliPad: { x: -4.1, z: 2.2, yaw: 0, busy: null }     // served by elevator 2
};
function resetDeck() {
  FD.cats.forEach(c => c.busy = null); FD.runway = null; DECK.heliPad.busy = null; DECK.fixedSpots.forEach(sp => sp.occ = null);
  for (const L of CARRIER.lifts) { L.busy = null; L.y = L.target = L.top; L.grp.position.y = L.y; }
}

const STATUS = {
  hangar: ['IN HANGAR', 'deck'], parked: ['ON DECK', 'deck'],
  lift_wait: ['ELEVATOR QUEUE', 'wait'], lift_prep: ['ELEVATOR', 'busy'], roll_out: ['ELEVATOR', 'busy'], lift_up: ['ELEVATOR ▲', 'busy'],
  queued: ['CATAPULT QUEUE', 'wait'], taxi_out: ['TAXI', 'busy'], hold: ['ON CATAPULT', 'busy'], launch: ['LAUNCH', 'busy'],
  climb: ['CLIMB', 'air'], orbit: ['AIRBORNE', 'air'], approach: ['APPROACH', 'busy'], final: ['FINAL', 'busy'], trap: ['TRAP', 'busy'],
  taxi_in: ['TAXI', 'busy'], taxi_stage: ['TAXI', 'busy'], wait_lift: ['ELEVATOR QUEUE', 'wait'], onto_lift: ['ELEVATOR', 'busy'],
  lift_down: ['ELEVATOR ▼', 'busy'], roll_in: ['STOWING', 'busy'], turn: ['PARKING', 'busy'],
  unfold: ['BLADES SPREAD', 'busy'], fold: ['BLADES FOLD', 'busy'], spinup: ['SPOOL UP', 'busy'], lift: ['LIFTOFF', 'busy'],
  depart: ['CLIMB', 'air'], ret: ['RETURN', 'busy'], pad_wait: ['HOLDING', 'wait'], hover: ['HOVER', 'busy'], descend: ['LANDING', 'busy'],
  spindown: ['SHUTDOWN', 'busy'], tow_pad: ['TOWING', 'busy'], tow_lift: ['TOWING', 'busy'],
  cbt_out: ['ENGAGED ▶', 'air'], cbt_wait: ['ENGAGED', 'air'], cbt_pass: ['DOGFIGHT', 'air'], cbt_rtb: ['RTB', 'air']
};
const ORBIT_STATES = new Set(['climb', 'depart', 'orbit']);   // flight-mates already given an orbit
const LIFT_STATES = new Set(['hangar', 'lift_wait', 'lift_prep', 'roll_out', 'lift_up', 'lift_down', 'roll_in']);

/* ======================= Base class ======================= */
class Aircraft {
  static spec = { key: 'base', tag: '?', scale: 1.25, speed: 10, turnR: 10, orbitR: [20, 30], alt: [10, 12], liftIndex: 0, bankMax: 1 };
  constructor(o) {
    const S = this.spec = this.constructor.spec;
    this.callsign = o.callsign; this.host = o.host; this.home = o.home; this.spot = o.spot || null;
    // jets always know their elevator: after landing they may park on deck or go below
    this.lift = (this.home === 'hangar' || (this.constructor.spec.outYaw === 90 * DEG && this.host.lifts)) ? this.host.lifts[S.liftIndex] : null;
    if (this.spot && this.home === 'deck') this.spot.occ = this;
    this.model = this.buildModel();
    this.mesh = this.model.group; this.mesh.scale.setScalar(S.scale); scene.add(this.mesh);
    this.t = 0; this.landReq = false; this.fwd = new V3(1, 0, 0); this.bank = 0; this.v = 0; this.airT = 0;
    this.fold = 1; this.glow = 0; this.rotor = 0; this.rotorAng = 0; this.searchlights = [];
    this.orbit = { R: 0, tR: 0, alt: 0, v: S.speed, ph: rand(0, 6) }; this.pickOrbit(true);
    this.theta = 0; this.smp = { pos: new V3(), dir: new V3(), turn: 0, R: 1 };
    if (this.home === 'hangar') { this.state = 'hangar'; this.mesh.visible = false; this.liftPose(this.lift.x, this.lift.hullZ - 1, 0); }
    else { this.state = 'parked'; this.deckPose(this.spot.x, this.spot.z, this.spot.yaw, 0); }
    this.model.setFold(1);
  }
  buildModel() { throw new Error('buildModel() not implemented'); }
  dispose() {
    scene.remove(this.mesh);
    if (this.spot && this.spot.occ === this) this.spot.occ = null;
    this.mesh.traverse(o => { if (o.isPoints) { const i = NAV_MATS.indexOf(o.material); if (i >= 0) NAV_MATS.splice(i, 1); } });
    for (const s of this.searchlights) { const i = SEARCHLIGHTS.indexOf(s); if (i >= 0) SEARCHLIGHTS.splice(i, 1); }
    if (this.lift && this.lift.busy === this) this.lift.busy = null;
    disposeTree(this.mesh);
  }
  get status() { return STATUS[this.state] || ['—', 'busy']; }
  get airborne() { return this.state === 'orbit' || this.state === 'climb' || this.state === 'depart'; }
  get isAwacs() { return !!this.spec.awacs; }
  get isSupport() { return !!(this.spec.awacs || this.spec.tanker); }   // AWACS / tanker: stay up in combat, scrambled first
  canLaunch() { return this.state === 'parked' || this.state === 'hangar'; }
  get onMission() { return !!this.mission; }
  get inCombat() { return this.state.startsWith('cbt_'); }
  get aloft() { return this.airborne || this.onMission || this.inCombat || !!this.tank; }   // up: orbit / mission / combat / refuelling pass
  canLand() { return this.aloft && !this.landReq; }
  requestLaunch() { if (this.state === 'hangar') { this.state = 'lift_wait'; this.t = 0; } else if (this.state === 'parked') this.beginLaunch(); }
  requestLand() { if (this.aloft) this.landReq = true; }
  beginLaunch() {}
  say(text, o) { RADIO.say(this.callsign, text, Object.assign({ role: this.isAwacs ? 'awacs' : (this instanceof Helicopter ? 'heli' : 'pilot') }, o || {})); }

  /* --- poses relative to the host ship --- */
  deckPose(lx, lz, yaw, h) {
    const cg = this.host.group;
    this.mesh.position.set(lx, this.host.deckY + h, lz); cg.localToWorld(this.mesh.position);
    _q.setFromAxisAngle(WUP, yaw); this.mesh.quaternion.copy(cg.quaternion).multiply(_q);
  }
  liftPose(x, z, yaw) { this.deckPose(x, z, yaw, this.lift.y - this.host.deckY); }
  hostFwd(out) { return out.set(1, 0, 0).applyQuaternion(this.host.group.quaternion).setY(0).normalize(); }
  hostToWorld(x, y, z) { return this.host.group.localToWorld(new V3(x, y, z)); }

  /* --- ground movement along a smooth deck path --- */
  startDeckPath(pts, speed) {
    this.dcurve = new THREE.CatmullRomCurve3(pts.map(p => new V3(p[0], 0, p[1])), false, 'centripetal');
    this.dlen = this.dcurve.getLength(); this.ds = 0; this.dspeed = speed;
  }
  followDeck(dt, h) {
    this.ds = Math.min(this.dlen, this.ds + this.dspeed * dt * smoothstep(0, 0.8, this.ds + 0.15));
    const u = this.ds / this.dlen, p = this.dcurve.getPointAt(u), tg = this.dcurve.getTangentAt(u);
    this.dyaw = Math.atan2(-tg.z, tg.x);
    this.deckPose(p.x, p.z, this.dyaw, h || 0);
    return this.ds >= this.dlen - 1e-3;
  }

  /* --- flight along a FlightPath (turn radius limited) --- */
  fly(path, v0, v1) { this.path = path; this.ps = 0; this.pv0 = v0; this.pv1 = v1; this.pathOff = this.pathDy = 0; }
  followPath(dt) {
    const P = this.path, u = this.ps / P.length;
    this.v = lerp(this.pv0, this.pv1, u);
    this.ps = Math.min(P.length, this.ps + this.v * dt);
    const s = P.sample(this.ps, this.smp);
    this.mesh.position.copy(s.pos);
    if (this.pathOff) this.mesh.position.add(_po.set(-s.dir.z, 0, s.dir.x).normalize().multiplyScalar(this.pathOff));   // wingman beside the lead
    if (this.pathDy) this.mesh.position.y += this.pathDy;
    this.orientFlight(s.dir, s.turn * this.bankFor(this.v, s.R), dt);
    return this.ps >= P.length - 1e-4;
  }
  bankFor(v, R) { return Math.min(this.spec.bankMax, Math.atan(v * v / (R * 9.8))); }
  orientFlight(dir, bankT, dt) { this.bank += (bankT - this.bank) * Math.min(1, dt * 1.5); this.fwd.copy(dir).normalize(); orientFrom(this.mesh, this.fwd, this.bank); }
  /* orbit distance: a flight shares one (wingmen take the lead's), otherwise random — the far end runs off-screen.
     now = jump there (the next path is built to it); otherwise the radius eases toward it. fresh = ignore the flight. */
  pickOrbit(now, fresh) {
    // unarmed types keep clear of the fight on a far orbit; only mates on the same kind of orbit are followed
    const S = this.spec, o = this.orbit, far = !!S.farOrbit && combatOn(), [r0, r1] = far ? S.farOrbit : S.orbitR, base = flightOf(this);
    const mate = !fresh && AIRCRAFT.filter(a => a !== this && a.host === this.host && a.far === far && ORBIT_STATES.has(a.state) && flightOf(a) === base).sort((a, b) => csNum(a) - csNum(b))[0];
    if (mate) { o.tR = clamp(mate.orbit.tR + rand(-3, 3), r0, r1); o.alt = mate.orbit.alt + rand(-0.6, 0.6); }
    else { o.tR = rand(r0, r1); o.alt = rand(S.alt[0], S.alt[1]); }
    this.far = far;
    if (now) o.R = o.tR;
    return o;
  }
  orbitPos(th, out) { const o = this.orbit; return out.set(o.R * Math.cos(th), o.alt + 1.2 * Math.sin(th * 2 + o.ph), o.R * Math.sin(th)); }
  orbitStep(dt) {
    const o = this.orbit;
    if (this.spec.farOrbit && combatOn() !== this.far) this.pickOrbit();
    o.R += clamp(o.tR - o.R, -1.5 * dt, 1.5 * dt);
    this.theta += (o.v / o.R) * dt;
    const th = this.theta; this.orbitPos(th, this.mesh.position);
    this.v = o.v;
    this.orientFlight(_v.set(-Math.sin(th), 2.4 * Math.cos(th * 2 + o.ph) / o.R, Math.cos(th)), this.bankFor(o.v, o.R), dt);
  }
  pathToOrbit(path, from, heading, lead) {
    const th0 = Math.atan2(from.z, from.x) + lead;
    this.theta = th0;
    return path.addDubins(from, heading, this.orbitPos(th0, new V3()), th0 + Math.PI / 2, this.spec.turnR);
  }

  /* --- missions (js/missions.js): this.mission is the flight's mission context, its legs drive the state --- */
  missionFlow(dt) { if (!this.mission) return false; this.mission.m.update(this, dt); return true; }

  /* --- combat: armed aircraft leave the orbit, wait off-screen and cross the screen on passes (js/airwar.js) --- */
  combatFlow(dt) {
    const S = this.spec;
    if (this.state === 'orbit') {
      if (!S.armed || this.landReq || !combatOn()) { this.cbtDelay = null; return false; }
      if (this.cbtDelay == null) this.cbtDelay = rand(0.3, 1.5) + (csNum(this) - 1) * 1.1;   // wingmen follow their lead
      if ((this.cbtDelay -= dt) > 0) return false;
      this.cbtDelay = null;
      const far = AIRWAR.offscreenFrom(this.mesh.position, this.orbit.alt);
      this.fly(new FlightPath().addDubins(this.mesh.position, headingOf(this.fwd), far.p, far.h, S.turnR), this.orbit.v, S.speed * 1.3);
      this.state = 'cbt_out'; this.t = 0; AIRWAR.onEngage(this);
      return true;
    }
    if (!this.inCombat) return false;
    this.airT += dt;                                   // sortie time (auto recovery to rearm)
    switch (this.state) {
      case 'cbt_out': if (this.followPath(dt)) { this.state = 'cbt_wait'; this.t = 0; this.mesh.visible = false; } break;
      case 'cbt_pass':
        this.gunTick(dt);
        if (this.followPath(dt)) { this.state = 'cbt_wait'; this.t = 0; this.mesh.visible = false; this.pass = this.cbtTgt = this.chasedBy = null; }
        break;
      case 'cbt_wait':
        if (this.landReq || !combatOn()) {
          this.edgeToOrbit(S.speed * 1.2); this.state = 'cbt_rtb'; AIRWAR.onRtb(this);
        }
        break;
      case 'cbt_rtb': if (this.followPath(dt)) { this.state = 'orbit'; this.airT = 0; } break;
    }
    return true;
  }
  /* from beyond the screen edge back to a new orbit (after combat, or a refuelling pass) */
  edgeToOrbit(v0) {
    const from = this.mesh.position.clone(), P = new FlightPath();
    this.pickOrbit(true); this.pathToOrbit(P, from, Math.atan2(-from.z, -from.x), 0.5);
    this.fly(P, v0, this.orbit.v); this.fwd.set(-from.x, 0, -from.z).normalize(); this.mesh.visible = true;
  }
  /* gun burst at a target (jets: nose cannon, helicopters: chin turret); tracers at 40/s, the hit is rolled when it ends */
  startGuns(target, dur, chance) { this.gunT = dur; this.gunAcc = 0; this.gunTgt = target; this.gunChance = chance; }
  gunTick(dt) {
    if (!(this.gunT > 0)) return;
    this.gunT -= dt; this.gunAcc += dt;
    const tg = enemyAlive(this.gunTgt) ? this.gunTgt : null, heli = this instanceof Helicopter, sp = heli ? 60 : this.v + 90;
    while (this.gunAcc > 1 / 40) {
      this.gunAcc -= 1 / 40;
      const mp = this.mesh.position.clone().addScaledVector(this.fwd, heli ? 0.7 : 1.1); if (heli) mp.y -= 0.15;
      const v = (tg ? leadPoint(tg, mp, sp).sub(mp).normalize() : this.fwd.clone()).multiplyScalar(sp);
      v.x += rand(-1.2, 1.2); v.y += rand(-1.2, 1.2); v.z += rand(-1.2, 1.2);
      FX.tracers.spawn(mp, v, { life: 0.7, len: 1.8, w: 0.12, color: 0xffc070 });
      if (Math.random() < 0.4) FX.flash.spawn(mp, { s0: 0.8, s1: 1.1, life: 0.05, a0: 0.9 });
    }
    if (this.gunT <= 0 && tg && tg.p.distanceTo(this.mesh.position) < 45) queueHit(tg, { chance: this.gunChance, dmg: 1, src: this, delay: 0.15 });
  }

  /* --- hangar <-> deck via elevator (shared by all types) --- */
  liftFlow() {
    const L = this.lift;
    switch (this.state) {
      case 'hangar': this.mesh.visible = false; return true;
      case 'lift_wait':
        if (!L.busy && this.liftGate()) { L.busy = this; L.target = L.bottom; this.state = 'lift_prep'; }
        return true;
      case 'lift_prep':
        this.liftPose(L.x, L.hullZ - 1, this.spec.outYaw || 0);
        if (L.y <= L.bottom + 1e-3) { this.state = 'roll_out'; this.t = 0; this.mesh.visible = true; }
        return true;
      case 'roll_out':
        this.liftPose(L.x, lerp(L.hullZ - 1, L.z, smoothstep(0, 2.4, this.t)), this.spec.outYaw || 0);
        if (this.t > 2.4) { L.target = L.top; this.state = 'lift_up'; }
        return true;
      case 'lift_up':
        this.liftPose(L.x, L.z, this.spec.outYaw || 0);
        if (L.y >= L.top - 1e-3) this.onLiftTop();
        return true;
      case 'lift_down':
        this.liftPose(L.x, L.z, this.spec.inYaw || 0);
        if (L.y <= L.bottom + 1e-3) { this.state = 'roll_in'; this.t = 0; }
        return true;
      case 'roll_in':
        this.liftPose(L.x, lerp(L.z, L.hullZ - 1, smoothstep(0, 2.4, this.t)), this.spec.inYaw || 0);
        if (this.t > 2.4) { this.mesh.visible = false; L.busy = null; L.target = L.top; this.state = 'hangar'; }
        return true;
    }
    return false;
  }
  liftGate() { return true; }
  onLiftTop() {}

  update(dt) {
    this.t += dt;
    if (!(this.lift && this.liftFlow())) this.updateState(dt);
    const ft = this.foldTarget();
    this.fold += clamp(ft - this.fold, -dt * this.spec.foldRate, dt * this.spec.foldRate);
    this.model.setFold(this.fold);
    this.model.tick(dt, this);
  }
}

/* ======================= Fixed wing (catapult / arrested landing) ======================= */
const FIXED_FOLDED = new Set(['hangar', 'lift_wait', 'lift_prep', 'roll_out', 'lift_up', 'parked', 'taxi_in', 'taxi_stage', 'wait_lift', 'onto_lift', 'lift_down', 'roll_in', 'turn']);
class FixedWing extends Aircraft {
  static spec = Object.assign({}, Aircraft.spec, { outYaw: 90 * DEG, inYaw: -90 * DEG, foldRate: 0.45, approachV: 14, bankMax: 1.0 });
  foldTarget() { return FIXED_FOLDED.has(this.state) && !(this.state === 'taxi_in' && this.ds < 3) ? 1 : 0; }
  get engineOn() { return !LIFT_STATES.has(this.state) && this.state !== 'parked' && this.state !== 'wait_lift' && this.state !== 'onto_lift'; }
  get sweepTarget() { return this.aloft || this.state === 'approach' || this.state === 'final' ? lerp(20, 68, clamp((this.v - 11) / 9, 0, 1)) : 20; }
  get gearDown() {
    if (this.state === 'orbit' || this.onMission || this.inCombat || this.tank) return false;
    if (this.state === 'climb') return this.ps < 18;
    if (this.state === 'approach') return this.ps > this.finalS - 25;
    return true;
  }
  beginLaunch() { this.state = 'queued'; this.t = 0; }
  onLiftTop() { this.state = 'queued'; this.onLift = true; }

  updateState(dt) {
    if (this.tank) { TANKER.fly(this, dt); return; }   // refuelling pass (js/tanker.js)
    if (this.missionFlow(dt)) { this.glow = 0.4; return; }
    if (this.combatFlow(dt)) { this.glow = this.state === 'cbt_pass' ? 0.9 : 0.6; return; }
    const S = this.spec, L = this.lift;
    let glow = 0;
    switch (this.state) {
      case 'parked': this.deckPose(this.spot.x, this.spot.z, this.spot.yaw, 0); break;
      case 'queued': {
        if (this.onLift) this.liftPose(L.x, L.z, S.outYaw); else this.deckPose(this.spot.x, this.spot.z, this.spot.yaw, 0);
        const cat = S.catIndex != null ? (FD.cats[S.catIndex].busy ? null : FD.cats[S.catIndex]) : FD.freeCat();
        if (cat) {
          this.cat = cat; cat.busy = this;
          let pts;
          // paths end straight along the next pose's heading, so 'hold' / 'wait_lift' don't snap the yaw
          if (this.onLift) pts = [[L.x, L.z], [L.x, 3.0], [4.2, cat.z + 0.3], [2.0, cat.z - 0.5], [cat.x0 - 0.6, cat.z], [cat.x0, cat.z]];
          else {
            const s = this.spot, nx = Math.cos(s.yaw), nz = -Math.sin(s.yaw);
            pts = [[s.x, s.z], [s.x + nx * 1.4, s.z + nz * 1.4]];
            if (s.aft) pts.push([-8, -0.2]);
            pts.push([cat.x0 - 2.6, cat.z], [cat.x0, cat.z]);
            if (s.occ === this) s.occ = null;          // spot is free once we taxi away
          }
          this.startDeckPath(pts, 1.8); this.state = 'taxi_out';
        }
        break;
      }
      case 'taxi_out':
        glow = 0.15;
        if (this.onLift && this.ds > 2.8) { this.onLift = false; L.busy = null; }
        if (this.followDeck(dt)) {
          this.state = 'hold'; this.t = 0;
          const [c, hot] = opsLine('launchClear', this); RADIO.say(RADIO_NAMES.carrier, c, { role: 'ship', hot });
          this.say(opsLine('launchReady', this)[0], { delay: 0.2, hot });
        }
        break;
      case 'hold':
        this.deckPose(this.cat.x0, this.cat.z, 0, 0); glow = 0.25 + 0.5 * smoothstep(1.0, 2.2, this.t);
        if (Math.random() < dt * 12) FX.smoke.spawn(this.hostToWorld(this.cat.x0 + rand(0, 3), this.host.deckY + 0.2, this.cat.z), { s0: 0.5, s1: 1.6, life: 1.2, a0: 0.35, color: 0xffffff, v: new V3(rand(-1, 0), 0.6, rand(-0.3, 0.3)) });
        if (this.t > 3.0 && this.fold < 0.03) { this.state = 'launch'; this.s = 0; this.v = 0; }
        break;
      case 'launch': {
        glow = 1; this.v += S.speed * S.speed / (2 * 12.7) * dt; this.s += this.v * dt;
        const x = this.cat.x0 + this.s;
        this.deckPose(Math.min(x, this.cat.x1), this.cat.z, 0, 0);
        if (Math.random() < dt * 30) FX.smoke.spawn(this.hostToWorld(this.cat.x0 + this.s - 0.5, this.host.deckY + 0.15, this.cat.z), { s0: 0.4, s1: 1.2, life: 0.8, a0: 0.3, color: 0xffffff });
        if (x >= this.cat.x1) {
          this.cat.busy = null; this.cat = null;
          const p0 = this.mesh.position.clone(), f = this.hostFwd(new V3());
          const p1 = p0.clone().addScaledVector(f, S.climbOut || 30); p1.y += 5;
          const P = new FlightPath().addLine(p0, p1);
          this.pickOrbit(true); this.pathToOrbit(P, p1, headingOf(f), 0.9);
          this.fly(P, this.v, S.speed);
          this.fwd.copy(f); this.state = 'climb'; this.airT = 0;
          { const [l, hot] = opsLine('airborne', this); this.say(l, { delay: 0.6, hot }); }
        }
        break;
      }
      case 'climb': glow = 0.6; if (this.followPath(dt)) this.state = 'orbit'; break;
      case 'orbit':
        glow = 0.3; this.airT += dt; this.orbitStep(dt);
        if (this.landReq && !FD.runway) {
          FD.runway = this; this.landReq = false;
          const A = this.host.angled, td = A.A0.clone().addScaledVector(A.AD, 4);
          this.TDw = this.hostToWorld(td.x, this.host.deckY + 0.05, td.z);
          const adw = A.AD.clone().applyQuaternion(this.host.group.quaternion).setY(0).normalize();
          const gate = this.TDw.clone().addScaledVector(adw, -52); gate.y += 9;
          const P = new FlightPath().addDubins(this.mesh.position, headingOf(this.fwd), gate, headingOf(adw), S.turnR).addLine(gate, this.TDw);
          this.finalS = P.lastDubinsEnd;
          this.fly(P, this.orbit.v, S.approachV); this.state = 'approach';
          { const [l, hot] = opsLine('approach', this); this.say(l, { hot }); }
        }
        break;
      case 'approach':
      case 'final':
        glow = 0.3;
        if (this.state === 'approach' && this.ps >= this.finalS) {
          this.state = 'final';
          if (S.ballName) {                    // unmanned (MQ-25): no ball call
            { const [l, hot] = opsLine('callBall', this); RADIO.say(RADIO_NAMES.lso, l, { role: 'ship', hot }); }
            this.say(`${S.ballName} ball, ${rand(2.8, 5.5).toFixed(1)}.`, { delay: 0.3, hot: AUD.armed });
          }
        }
        if (this.followPath(dt)) { this.state = 'trap'; this.ls = 4; this.v = S.approachV; this.trapDecel = this.v * this.v / 16; }
        break;
      case 'trap': {
        const A = this.host.angled;
        this.v = Math.max(0, this.v - this.trapDecel * dt); this.ls += this.v * dt;
        const p = A.A0.clone().addScaledVector(A.AD, this.ls);
        this.deckPose(p.x, p.z, Math.atan2(-A.AD.z, A.AD.x), 0); glow = 0.15;
        if (this.v <= 0.2) {
          { const [l, hot] = opsLine('trap', this); RADIO.say(RADIO_NAMES.lso, l, { role: 'ship', hot }); }
          const E = A.A0.clone().addScaledVector(A.AD, this.ls), E2 = E.clone().addScaledVector(A.AD, 1.3);
          const pts = [[E.x, E.z], [E2.x, E2.z]];
          // park on deck if there is room; now and then (or when full) strike below via the elevator
          const free = DECK.fixedSpots.filter(sp => !sp.occ);
          const below = !free.length || (L && Math.random() < 0.1);
          if (below && L) { this.home = 'hangar'; this.spot = null; pts.push([1.0, 0.3], [3.4, 1.3], [L.x, 2.0], [L.x, 2.7]); this.startDeckPath(pts, 1.8); this.state = 'taxi_stage'; }
          else {
            const s = free[0]; s.occ = this; this.spot = s; this.home = 'deck';
            const nx = Math.cos(s.yaw), nz = -Math.sin(s.yaw);
            if (s.port) pts.push([E2.x + 0.6, E2.z - 0.9], [s.x + 1.8, s.z + 0.1], [s.x, s.z]);
            else {
              if (s.aft) pts.push([-6, -0.8]); else pts.push([E.x + 4, 0.2]);
              pts.push([s.x + nx * 1.6, s.z + nz * 1.6], [s.x, s.z]);
            }
            this.startDeckPath(pts, 1.8); this.state = 'taxi_in';
          }
        }
        break;
      }
      case 'taxi_stage':
        glow = 0.12; if (this.ds > 3.5 && FD.runway === this) FD.runway = null;
        if (this.followDeck(dt)) this.state = 'wait_lift';
        break;
      case 'wait_lift':
        if (FD.runway === this) FD.runway = null;
        this.deckPose(L.x, 2.7, -90 * DEG, 0);
        if (!L.busy && L.y >= L.top - 1e-3) { L.busy = this; this.startDeckPath([[L.x, 2.7], [L.x, 3.8], [L.x, L.z]], 1.1); this.state = 'onto_lift'; }
        break;
      case 'onto_lift': if (this.followDeck(dt)) { L.target = L.bottom; this.state = 'lift_down'; } break;
      case 'taxi_in':
        glow = 0.12; if (this.ds > 3.5 && FD.runway === this) FD.runway = null;
        if (this.followDeck(dt)) { this.state = 'turn'; this.t = 0; this.turnFrom = this.dyaw; }
        break;
      case 'turn':
        this.deckPose(this.spot.x, this.spot.z, this.turnFrom + angleWrap(this.spot.yaw - this.turnFrom) * smoothstep(0, 2.2, this.t), 0);
        if (FD.runway === this) FD.runway = null;
        if (this.t > 2.2) this.state = 'parked';
        break;
    }
    this.glow = glow;
  }
  /* combat: fire a missile from under the wing along the flight direction */
  fireMissile(target) {
    const perp = new V3(-this.fwd.z, 0, this.fwd.x), side = (this._w = -(this._w || 1));
    const p = this.mesh.position.clone().addScaledVector(perp, side * 0.8); p.y -= 0.3;
    const v = this.fwd.clone().multiplyScalar(this.v + 38); v.y -= 1.5;
    if (target) { MISSILES.push({ p, v, life: 5, smokeT: 0, target, chance: 0.72, dmg: 2, src: this, speed: 55, glow: true }); return; }
    MISSILES.push({ p, v, life: 2.8, smokeT: 0 });
    FX.tracers.spawn(p, v, { life: 2.4, len: 1.0, w: 0.25, color: 0xfff2d0, splash: 0.9 });
  }
}

/* ======================= Helicopter ======================= */
const HELI_LIGHTS = { n: 0 };   // only the first few helicopters cast real light (GPU budget)
const _hz = new V3(), _hf = new V3();
const HELI_FOLDED = new Set(['hangar', 'lift_wait', 'lift_prep', 'roll_out', 'lift_up', 'parked', 'tow_pad', 'tow_lift', 'lift_down', 'roll_in', 'wait_lift', 'fold', 'pad_wait']);
class Helicopter extends Aircraft {
  static spec = Object.assign({}, Aircraft.spec, { liftIndex: 1, outYaw: 0, inYaw: 0, foldRate: 0.5, turnR: 5, bankMax: 0.35 });
  constructor(o) {
    super(o);
    const sp = this.model.searchPos || new V3(0.7, 0.2, 0);
    this.lit = HELI_LIGHTS.n < 4; if (this.lit) HELI_LIGHTS.n++;
    const sl = makeSearchlight(this.mesh, sp.x, sp.y, sp.z, { angle: 0.2, len: 14, intensity: 2.4, coneOpacity: 0.32, housing: false, noLight: !this.lit });
    sl.holder.quaternion.setFromUnitVectors(new V3(0, 0, 1), new V3(1, -1.1, 0).normalize());
    sl.fixed = true; sl.enabled = 0; this.searchlights.push(sl);
  }
  dispose() { if (this.lit) HELI_LIGHTS.n--; super.dispose(); }      // its real light can go to the next helicopter
  get pad() { return this.home === 'hangar' ? DECK.heliPad : null; }
  foldTarget() { return HELI_FOLDED.has(this.state) ? 1 : 0; }
  liftGate() { return !this.pad.busy && (this.pad.busy = this, true); }
  onLiftTop() { this.state = 'tow_pad'; this.t = 0; }
  beginLaunch() { this.state = 'unfold'; this.t = 0; }
  orientFlight(dir, bankT, dt) {
    this.bank += (bankT - this.bank) * Math.min(1, dt * 1.5);
    // own scratch vectors: orbitStep() passes the shared _v in as `dir`
    const hz = _hz.set(dir.x, 0, dir.z); if (hz.lengthSq() < 1e-6) hz.copy(this.fwd); hz.normalize();
    this.fwd.copy(hz);
    const p = (this.spec.noseDown ?? 0.1) * clamp(this.v / this.spec.speed, 0, 1.2) - dir.y * 0.3;
    orientFrom(this.mesh, _hf.set(hz.x * Math.cos(p), -Math.sin(p), hz.z * Math.cos(p)), this.bank);
  }
  updateState(dt) {
    if (this.missionFlow(dt)) { this.rotor = 1; this.rotorAng += 30 * dt; return; }
    const s = this.spot, L = this.lift, S = this.spec; let air = 0;
    if (this.combatFlow(dt)) { air = 1; this.rotor = 1; } else switch (this.state) {
      case 'parked': this.rotor = 0; this.deckPose(s.x, s.z, s.yaw, 0); break;
      case 'tow_pad': {
        const k = smoothstep(0, 2.6, this.t);
        this.deckPose(lerp(L.x, s.x, k), lerp(L.z, s.z, k), s.yaw, 0);
        if (this.t > 2.6) { L.busy = null; this.state = 'unfold'; this.t = 0; }
        break;
      }
      case 'unfold': this.deckPose(s.x, s.z, s.yaw, 0); if (this.fold < 0.01) { this.state = 'spinup'; this.t = 0; } break;
      case 'spinup': this.rotor = Math.min(1, this.t / 3.5); this.deckPose(s.x, s.z, s.yaw, 0); if (this.t > 3.5) { this.state = 'lift'; this.t = 0; } break;
      case 'lift':
        air = 1; this.rotor = 1;
        this.deckPose(s.x, s.z, s.yaw, smoothstep(0, 3, this.t) * 4);
        if (this.t > 3) {
          const f = this.hostFwd(new V3()); this.fwd.copy(f); this.airT = 0;
          const P = new FlightPath(); this.pickOrbit(true); this.pathToOrbit(P, this.mesh.position.clone(), headingOf(f), 0.7);
          this.fly(P, 1.5, S.speed); this.state = 'depart';
          if (this.pad && this.pad.busy === this) this.pad.busy = null;
          { const [l, hot] = opsLine('heliUp', this); this.say(l, { hot }); }
        }
        break;
      case 'depart': air = 1; this.rotor = 1; if (this.followPath(dt)) this.state = 'orbit'; break;
      case 'orbit':
        air = 1; this.rotor = 1; this.airT += dt; this.orbitStep(dt);
        if (this.landReq && (!this.pad || !this.pad.busy)) {
          if (this.pad) this.pad.busy = this;
          this.landReq = false;
          const P0 = this.hostToWorld(s.x, this.host.deckY + 4, s.z), f = this.hostFwd(new V3());
          this.fly(new FlightPath().addDubins(this.mesh.position, headingOf(this.fwd), P0, headingOf(f), S.turnR), this.orbit.v, 0.7);
          this.state = 'ret';
          { const [l, hot] = opsLine('heliCleared', this); RADIO.say(this.host.radio || RADIO_NAMES.carrier, l, { role: 'ship', hot }); }
        }
        break;
      case 'ret': air = 1; this.rotor = 1; if (this.followPath(dt)) { this.state = 'hover'; this.t = 0; this.v = 0; } break;
      case 'hover': air = 1; this.deckPose(s.x, s.z, s.yaw, 4 + Math.sin(this.t * 2) * 0.05); if (this.t > 1.2) { this.state = 'descend'; this.t = 0; } break;
      case 'descend':
        air = 1; this.deckPose(s.x, s.z, s.yaw, 4 * (1 - smoothstep(0, 3.5, this.t)));
        if (this.t > 3.5) { this.state = 'spindown'; this.t = 0; const [l, hot] = opsLine('heliDown', this); this.say(l, { hot }); }
        break;
      case 'spindown':
        this.rotor = Math.max(0, 1 - this.t / 3.5); this.deckPose(s.x, s.z, s.yaw, 0);
        if (this.t > 3.5) { const n = TAU / (S.blades || 4); this.rotorAng = Math.round(this.rotorAng / n) * n; this.state = 'fold'; }
        break;
      case 'fold': this.deckPose(s.x, s.z, s.yaw, 0); if (this.fold > 0.99) this.state = this.home === 'hangar' ? 'wait_lift' : 'parked'; break;
      case 'wait_lift':
        this.deckPose(s.x, s.z, s.yaw, 0);
        if (!L.busy && L.y >= L.top - 1e-3) { L.busy = this; this.state = 'tow_lift'; this.t = 0; }
        break;
      case 'tow_lift': {
        const k = smoothstep(0, 2.6, this.t);
        this.deckPose(lerp(s.x, L.x, k), lerp(s.z, L.z, k), s.yaw, 0);
        if (this.t > 2.6) { if (this.pad && this.pad.busy === this) this.pad.busy = null; L.target = L.bottom; this.state = 'lift_down'; }
        break;
      }
    }
    this.rotorAng += this.rotor * 30 * dt;
    const sl = this.searchlights[0]; sl.enabled += ((air ? 1 : 0) - sl.enabled) * Math.min(1, dt * 2);
  }
  /* rocket ripple; with a target (boat) the rockets fly at it and a hit is rolled on arrival */
  fireRockets(target) {
    const aim = target && enemyAlive(target) ? target.p : null;
    let tt = 2.0;
    for (let i = 0; i < 4; i++) {
      const p = this.mesh.position.clone(); p.y -= 0.2;
      let v;
      if (aim) { tt = p.distanceTo(aim) / 45; v = aim.clone().sub(p).normalize().multiplyScalar(45); v.x += rand(-1, 1); v.y += rand(-0.6, 0.6); v.z += rand(-1, 1); }
      else { v = this.fwd.clone().multiplyScalar(this.v + 45); v.y -= 8 + rand(-1, 1); v.x += rand(-1.5, 1.5); v.z += rand(-1.5, 1.5); }
      FX.tracers.spawn(p, v, { life: aim ? tt : 2.0, len: 0.9, w: 0.2, color: 0xfff0c0, splash: 0.7 });
      MISSILES.push({ p: p.clone(), v: v.clone(), life: aim ? tt : 2.0, smokeT: -i * 0.01, small: true, grav: 0 });
      FX.flash.spawn(p, { s0: 0.8, s1: 1.2, life: 0.06, a0: 0.9 });
    }
    if (aim) queueHit(target, { chance: 0.5, dmg: 1, src: this, delay: tt });
  }
  /* Hellfire at a boat, Sidewinder at a bandit: homing, the hit is resolved on the beat */
  fireMissileAt(target, speed, chance) {
    const p = this.mesh.position.clone(); p.y -= 0.25;
    const v = this.fwd.clone().multiplyScalar(this.v + 15); v.y -= 1;
    MISSILES.push({ p, v, life: 6, smokeT: 0, target, chance, dmg: 2, src: this, speed, glow: true });
    FX.flash.spawn(p, { s0: 1.0, s1: 1.4, life: 0.08, a0: 1 });
  }
}

/* ======================= Aircraft types ======================= */
class FA18 extends FixedWing {
  static spec = Object.assign({}, FixedWing.spec, { key: 'fa18', tag: 'F/A-18', speed: 17, turnR: 22, orbitR: [30, 70], alt: [12, 17], ballName: 'Hornet', armed: true });
  buildModel() { return buildFA18(); }
}
class F14 extends FixedWing {
  static spec = Object.assign({}, FixedWing.spec, { key: 'f14', tag: 'F-14', speed: 18, turnR: 24, orbitR: [32, 72], alt: [14, 19], ballName: 'Tomcat', armed: true });
  buildModel() { return buildF14(); }
}
class F35 extends FixedWing {
  static spec = Object.assign({}, FixedWing.spec, { key: 'f35', tag: 'F-35C', speed: 17, turnR: 22, orbitR: [30, 70], alt: [13, 18], ballName: 'Lightning', armed: true });
  buildModel() { return buildF35(); }
}
class E2D extends FixedWing {
  static spec = Object.assign({}, FixedWing.spec, { key: 'e2d', tag: 'E-2D', speed: 12, turnR: 26, orbitR: [46, 80], farOrbit: [72, 88], alt: [21, 24], ballName: 'Hawkeye', catIndex: 0, approachV: 11, climbOut: 36, awacs: true, voice: 'awacs', bankMax: 0.5, callsignGroup: 1 });
  buildModel() { return buildE2D(); }
}
/* unmanned carrier tanker: flies refuelling passes with a flight in tow (js/tanker.js), no missions */
class MQ25 extends FixedWing {
  static spec = Object.assign({}, FixedWing.spec, { key: 'mq25', tag: 'MQ-25', speed: 13, turnR: 24, orbitR: [44, 76], farOrbit: [70, 86], alt: [18, 21], approachV: 12, climbOut: 32, bankMax: 0.6, callsignGroup: 1, tanker: true, voice: 'tanker', missions: [] });
  get hoseOut() { return this.tank && this.state === 'tank_pass' ? 1 : 0; }
  buildModel() { return buildMQ25(); }
}
class MH60 extends Helicopter {
  static spec = Object.assign({}, Helicopter.spec, { key: 'mh60', tag: 'MH-60', speed: 7, orbitR: [18, 46], farOrbit: [50, 62], alt: [8.5, 10.5], transport: true });
  buildModel() { return buildMH60(); }
}
class CH53 extends Helicopter {
  static spec = Object.assign({}, Helicopter.spec, { key: 'ch53', tag: 'CH-53', blades: 7, speed: 6.5, orbitR: [22, 48], farOrbit: [50, 62], alt: [10, 12.5], transport: true });
  buildModel() { return buildCH53(); }
}
class AH1 extends Helicopter {
  static spec = Object.assign({}, Helicopter.spec, { key: 'ah1', tag: 'AH-1Z', speed: 8.5, orbitR: [15, 40], alt: [7, 9], armed: true });
  buildModel() { return buildAH1(); }
}
/* Tiltrotor: takes off and lands like a helicopter, converts to airplane mode (nacelles forward, gear up) in cruise */
class CMV22 extends Helicopter {
  static spec = Object.assign({}, Helicopter.spec, { key: 'cmv22', tag: 'CMV-22B', speed: 11, turnR: 12, orbitR: [30, 60], farOrbit: [58, 70], alt: [11, 14], bankMax: 0.55, foldRate: 0.12, blades: 3, noseDown: 0.02, missions: ['cod'] });
  get conv() { return this.state === 'orbit' || this.onMission ? 1 : this.state === 'depart' || this.state === 'ret' ? smoothstep(0.3, 0.85, this.v / this.spec.speed) : 0; }
  get gearDown() { return this.conv < 0.5; }
  buildModel() { return buildCMV22(); }
}
const AIRCRAFT_TYPES = { fa18: FA18, f14: F14, f35: F35, e2d: E2D, mq25: MQ25, mh60: MH60, ch53: CH53, ah1: AH1, cmv22: CMV22 };
const FIXED_ORDER = ['fa18', 'f14', 'f35', 'e2d', 'mq25'], HELI_ORDER = ['mh60', 'ch53', 'ah1', 'cmv22'];

/* ---- callsign allocation: groups of 4 jets / 2 helicopters per type ---- */
function callsignsFor(key, n, offset) {
  const Cls = AIRCRAFT_TYPES[key] || { spec: {} }, pool = CALLSIGNS[key];
  const size = Cls.spec.callsignGroup || (Cls.prototype instanceof Helicopter ? 2 : 4);
  const out = [];
  for (let i = offset || 0; out.length < n; i++) {
    const g = Math.floor(i / size), k = i % size, name = pool[g % pool.length] + (g >= pool.length ? '-' + (Math.floor(g / pool.length) + 1) : '');
    out.push(size === 1 ? name : `${name} ${k + 1}`);
  }
  return out;
}

/* ======================= Fly-bys past the camera ======================= */
const FLYBY_JETS = { f14: () => buildF14(0x626b74, true), fa18: () => buildFA18(0x646e78, true), f35: () => buildF35(0x5e666e, true) };
const FLYBY_MODELS = { f14: [], fa18: [], f35: [] };   // jets of finished fly-bys, reused instead of rebuilt
class Flyby {
  constructor() {
    this.planes = [];
    const n = randi(1, 3), ang = rand(0, TAU);
    this.dir = new V3(Math.cos(ang), 0, Math.sin(ang));
    const perp = new V3(-this.dir.z, 0, this.dir.x), off = rand(-18, 18), alt = rand(30, 42);
    this.speed = rand(42, 55); this.bankPh = rand(0, 6); this.bankAmp = rand(0.05, 0.35);
    this.type = pick(Object.keys(FLYBY_JETS));
    const cs = callsignsFor('flyby', n, randi(0, CALLSIGNS.flyby.length - 1) * 4);
    for (let i = 0; i < n; i++) {
      const model = FLYBY_MODELS[this.type].pop() || FLYBY_JETS[this.type]();
      model.setFold(0); model.group.scale.setScalar(2.4); scene.add(model.group);
      const side = i === 0 ? 0 : (i % 2 ? 1 : -1);
      const p = this.dir.clone().multiplyScalar(-150 - i * 7).addScaledVector(perp, off + side * 7);
      p.y = alt - i * 1.2;
      this.planes.push({ model, m: model.group, p, gun: 0, gunAcc: 0, wing: 1, cs: cs[i] });
    }
    this.t = 0; this.dead = false; this.announced = false;
  }
  update(dt) {
    this.t += dt;
    const bank = Math.sin(this.t * 0.8 + this.bankPh) * this.bankAmp;
    for (const pl of this.planes) {
      pl.p.addScaledVector(this.dir, this.speed * dt);
      pl.m.position.copy(pl.p); orientFrom(pl.m, this.dir, bank);
      pl.model.tick(dt, { glow: 0.7, sweepTarget: 68 });
      if (pl.gun > 0) {
        pl.gun -= dt; pl.gunAcc += dt;
        while (pl.gunAcc > 0.035) {
          pl.gunAcc -= 0.035;
          const mp = pl.p.clone().addScaledVector(this.dir, 2.4);
          const v = this.dir.clone().multiplyScalar(this.speed + 110); v.y -= rand(8, 14); v.x += rand(-2, 2); v.z += rand(-2, 2);
          FX.tracers.spawn(mp, v, { life: 0.9, len: 2.6, w: 0.16, color: 0xffc070, splash: 0.25 });
          FX.flash.spawn(mp, { s0: 1.2, s1: 1.6, life: 0.06, a0: 0.9 });
        }
      }
    }
    if (!this.announced && AUD.armed && this.planes[0].p.length() < 90) {
      this.announced = true; RADIO.say(this.planes[0].cs, radioLine(COMBAT.flybyIn), { role: 'ace', cat: 'combat', prio: 0 });
    }
    if (this.t * this.speed > 310) { this.dead = true; for (const pl of this.planes) { scene.remove(pl.m); FLYBY_MODELS[this.type].push(pl.model); } }
  }
  inView(pl) { return pl.p.length() < 75; }
  fireGuns(dur) { for (const pl of this.planes) if (this.inView(pl)) pl.gun = Math.max(pl.gun, dur); }
  fireMissile() {
    const cands = this.planes.filter(p => this.inView(p)); if (!cands.length) return;
    const pl = pick(cands); pl.wing *= -1;
    const perp = new V3(-this.dir.z, 0, this.dir.x);
    const p = pl.p.clone().addScaledVector(perp, pl.wing * 1.6); p.y -= 0.4;
    const v = this.dir.clone().multiplyScalar(this.speed + 45); v.y -= rand(4, 9);
    MISSILES.push({ p, v, life: 2.6, smokeT: 0 });
    FX.tracers.spawn(p, v, { life: 2.6, len: 1.2, w: 0.3, color: 0xfff2d0, splash: 0.9 });
  }
}
const MISSILES = [];
