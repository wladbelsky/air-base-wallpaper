'use strict';
/* ===== Air wing: base classes + aircraft types =====
   To add a new type: subclass FixedWing or Helicopter, give it a static `spec`
   and a buildModel() that returns an airframe from airframes.js, then register
   it in AIRCRAFT_TYPES (and add a count property in project.json if wanted).
   Ground movement goes through airfield.js (homes, taxi routes, runway, doors).  */
const WUP = new V3(0, 1, 0);
const _po = new V3(), _v = new V3(), _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4(), _r = new V3(), _u = new V3(), _u2 = new V3(), _r2 = new V3(), _gd = new V3(), _gl = new V3();
function orientFrom(obj, f, bank) {
  _r.crossVectors(f, WUP); if (_r.lengthSq() < 1e-6) _r.set(0, 0, 1); _r.normalize();
  _u.crossVectors(_r, f).normalize();
  const cb = Math.cos(bank), sb = Math.sin(bank);
  _u2.copy(_u).multiplyScalar(cb).addScaledVector(_r, sb);
  _r2.copy(_r).multiplyScalar(cb).addScaledVector(_u, -sb);
  _m4.makeBasis(f, _u2, _r2); obj.quaternion.setFromRotationMatrix(_m4);
}
const headingOf = d => Math.atan2(d.z, d.x);
const ROOF_CLEAR = 1.6;   // how far above a roof an aircraft passes (rotor / gear clear of it: Aircraft.clearRoofs)
/* fixed guns (jets): a round leaves along the nose f, bent toward the wanted direction d (unit, changed in place) by at most
   GUN_CONE sideways / up and `down` downward (a strafing run has its nose on the ground); true when d was inside that cone */
const GUN_CONE = 0.05, _gr = new V3(), _gu = new V3();
function gunAim(f, d, down = GUN_CONE) {
  _gr.crossVectors(f, WUP).normalize(); _gu.crossVectors(_gr, f);
  const a = d.dot(f), b = d.dot(_gr), c = d.dot(_gu), yaw = Math.atan2(b, a), pit = Math.atan2(c, Math.hypot(a, b));
  const y = clamp(yaw, -GUN_CONE, GUN_CONE), p = clamp(pit, -down, GUN_CONE), cp = Math.cos(p);
  d.copy(f).multiplyScalar(cp * Math.cos(y)).addScaledVector(_gr, cp * Math.sin(y)).addScaledVector(_gu, Math.sin(p));
  return y === yaw && p === pit;
}
const flightOf = a => a.callsign.replace(/\s+\d+$/, '');   // flight = aircraft sharing a callsign (WARDOG 1…4)

const STATUS = {
  parked: ['PARKED', 'deck'], ready: ['ENGINE START', 'busy'], pushback: ['PUSHBACK', 'busy'], taxi_out: ['TAXI', 'busy'], hold_short: ['HOLDING SHORT', 'wait'],
  lineup: ['LINE UP', 'busy'], takeoff_roll: ['TAKEOFF', 'busy'], climb: ['CLIMB', 'air'], orbit: ['AIRBORNE', 'air'],
  approach: ['APPROACH', 'busy'], final: ['FINAL', 'busy'], go_around: ['GO AROUND', 'busy'], rollout: ['LANDING ROLL', 'busy'], taxi_in: ['TAXI', 'busy'],
  cross_out: ['CROSSING', 'busy'], unload: ['UNLOADING', 'busy'],
  spinup: ['SPOOL UP', 'busy'], lift: ['LIFTOFF', 'busy'], depart: ['CLIMB', 'air'], ret: ['RETURN', 'busy'], hover: ['HOVER', 'busy'], descend: ['LANDING', 'busy'], spindown: ['SHUTDOWN', 'busy'],
  cbt_out: ['ENGAGED ▶', 'air'], cbt_wait: ['ENGAGED', 'air'], cbt_pass: ['ATTACK RUN', 'air'], cbt_orbit: ['FIRE SUPPORT', 'air'], cbt_rtb: ['RTB', 'air']
};
const ORBIT_STATES = new Set(['climb', 'depart', 'orbit']);   // flight-mates already given an orbit
const GROUND_STATES = new Set(['parked', 'ready', 'pushback', 'taxi_out', 'hold_short', 'cross_out', 'lineup', 'takeoff_roll', 'rollout', 'taxi_in', 'unload', 'emergency', 'towed', 'spinup', 'spindown']);

/* ======================= Base class ======================= */
class Aircraft {
  static spec = { key: 'base', tag: '?', scale: 1.25, speed: 10, turnR: 10, orbitR: [20, 30], alt: [10, 12], bankMax: 1, len: 2, span: 1.6 };
  constructor(o) {
    const S = this.spec = this.constructor.spec;
    this.callsign = o.callsign; this.host = BASE;
    this.spot = AIRFIELD.assignHome(this);
    this.model = this.buildModel();
    this.mesh = this.model.group; this.mesh.scale.setScalar(S.scale); scene.add(this.mesh);
    this.t = 0; this.landReq = false; this.fwd = new V3(1, 0, 0); this.bank = 0; this.v = 0; this.airT = 0;
    this.fold = 0; this.glow = 0; this.rotor = 0; this.rotorAng = 0; this.searchlights = [];
    this.orbit = { R: 0, tR: 0, alt: 0, v: S.speed, ph: rand(0, 6) }; this.pickOrbit(true);
    this.theta = 0; this.smp = { pos: new V3(), dir: new V3(), turn: 0, R: 1 };
    this.state = 'parked'; this.deckPose(this.spot.x, this.spot.z, this.spot.yaw, 0);
    this.model.setFold(0);
  }
  buildModel() { throw new Error('buildModel() not implemented'); }
  dispose() {
    scene.remove(this.mesh);
    AIRFIELD.release(this); AIRFIELD.rwy.delete(this); AIRFIELD.rwy2.delete(this); AIRFIELD.arrivals.delete(this);
    this.mesh.traverse(o => { if (o.isPoints) { const i = NAV_MATS.indexOf(o.material); if (i >= 0) NAV_MATS.splice(i, 1); } });
    for (const s of this.searchlights) { const i = SEARCHLIGHTS.indexOf(s); if (i >= 0) SEARCHLIGHTS.splice(i, 1); }
    disposeTree(this.mesh);
  }
  get status() {
    if (this.dmgT > 0 && this.state === 'parked') return ['DAMAGED', 'wait'];
    if ((this.state === 'ready' || this.state === 'hold_short') && DAMAGE.closed(this.state === 'hold_short' && this.rwyL || AIRFIELD.depR())) return ['RWY CLOSED', 'wait'];   // what the departures wait for (DAMAGE; none while the other runway takes them)
    return STATUS[this.state] || ['—', 'busy'];
  }
  get airborne() { return this.state === 'orbit' || this.state === 'climb' || this.state === 'depart'; }
  get isAwacs() { return !!this.spec.awacs; }
  get isSupport() { return !!(this.spec.awacs || this.spec.tanker); }   // AWACS / tanker: stay up in combat, scrambled first
  get onGround() { return GROUND_STATES.has(this.state); }
  canLaunch() { return this.state === 'parked' && !(this.dmgT > 0); }   // (hit on the ground: DAMAGE)
  get onMission() { return !!this.mission; }
  get inCombat() { return this.state.startsWith('cbt_'); }
  get aloft() { return this.airborne || this.onMission || this.inCombat || !!this.tank; }   // up: orbit / mission / combat / refuelling pass
  canLand() { return this.aloft && !this.landReq; }
  requestLaunch() { if (this.canLaunch()) this.beginLaunch(); }
  requestLand() { if (this.aloft) this.landReq = true; }
  beginLaunch() {}
  say(text, o) { RADIO.say(this.callsign, text, Object.assign({ role: this.isAwacs ? 'awacs' : (this instanceof Helicopter ? 'heli' : 'pilot') }, o || {})); }
  tower(key, o) { const [l, hot] = opsLine(key, this); RADIO.say(RADIO_NAMES.tower, l, Object.assign({ role: 'tower', hot }, o || {})); }
  call(key, o) { const [l, hot] = opsLine(key, this); this.say(l, Object.assign({ hot }, o || {})); }

  /* --- poses on the ground: x / z in world space (the base is the world), yaw 0 = nose east, + = to the north --- */
  deckPose(lx, lz, yaw, h) { this.mesh.position.set(lx, groundH(lx, lz) + h, lz); _q.setFromAxisAngle(WUP, yaw); this.mesh.quaternion.copy(_q); }
  hostFwd(out) { return out.set(1, 0, 0); }

  /* --- ground movement along a smooth path (taxi routes); reverse = pushback (tail first) --- */
  startDeckPath(pts, speed, reverse) {
    this.dcurve = new THREE.CatmullRomCurve3(pts.map(p => new V3(p[0], 0, p[1])), false, 'centripetal');
    this.dlen = this.dcurve.getLength(); this.ds = 0; this.dspeed = speed; this.drev = !!reverse; this.dv = 0; this.dstop = null;
  }
  /* returns true at the end; stops behind traffic ahead (AIRFIELD.blocked) */
  followDeck(dt, h) {
    const u0 = this.ds / this.dlen, tg = this.dcurve.getTangentAt(Math.min(u0, 1));
    _gd.set(tg.x, 0, tg.z).normalize(); if (this.drev) _gd.negate();
    // the route ahead (now and every 1.5 for 6), for the merge rule in AIRFIELD.blocker
    const L = this.look || (this.look = new Float32Array(10));
    for (let i = 0; i < 5; i++) { this.dcurve.getPointAt(Math.min(1, (this.ds + i * 1.5) / this.dlen), _gl); L[i * 2] = _gl.x; L[i * 2 + 1] = _gl.z; }
    this.lookAt = T;
    const stop = AIRFIELD.blocked(this, this.drev ? _gd.clone().negate() : _gd, dt) || AIRFIELD.holdCross(this);
    const end = this.dstop ?? this.dlen, ease = smoothstep(0, 0.8, this.ds + 0.15) * (0.35 + 0.65 * smoothstep(0, 3, end - this.ds));   // (dstop: a stop on the way, e.g. to unload)
    this.dv += clamp((stop ? 0 : this.dspeed * ease) - this.dv, -dt * 2.5, dt * 1.2);
    this.ds = Math.min(end, this.ds + this.dv * dt);
    const u = this.ds / this.dlen, p = this.dcurve.getPointAt(u), t = this.dcurve.getTangentAt(u);
    this.dyaw = Math.atan2(this.drev ? t.z : -t.z, this.drev ? -t.x : t.x);
    this.fwd.set(Math.cos(this.dyaw), 0, -Math.sin(this.dyaw)); this.v = this.dv;
    this.deckPose(p.x, p.z, this.dyaw, h || 0);
    return this.ds >= this.dlen - 1e-3;
  }

  /* --- flight along a FlightPath (turn radius limited) --- */
  fly(path, v0, v1, acc = 0) { this.path = path; this.ps = 0; this.pv0 = v0; this.pv1 = v1; this.pacc = acc; this.pathOff = this.pathDy = 0; }   // acc: speeds up at that rate instead of over the whole path
  followPath(dt) {
    const P = this.path, u = this.ps / P.length;
    this.v = this.pacc ? Math.min(this.pv1, this.v + this.pacc * dt) : lerp(this.pv0, this.pv1, u);
    this.ps = Math.min(P.length, this.ps + this.v * dt);
    const s = P.sample(this.ps, this.smp);
    this.mesh.position.copy(s.pos);
    if (this.pathOff) this.mesh.position.add(_po.set(-s.dir.z, 0, s.dir.x).normalize().multiplyScalar(this.pathOff));   // wingman beside the lead
    if (this.pathDy) this.mesh.position.y += this.pathDy;
    this.clearRoofs(dt);
    this.orientFlight(s.dir, s.turn * this.bankFor(this.v, s.R), dt);
    return this.ps >= P.length - 1e-4;
  }
  bankFor(v, R) { return Math.min(this.spec.bankMax, Math.atan(v * v / (R * 9.8))); }
  /* rooftops (OBSTACLES): looking ahead along its way (about 1.5 s) it rises to ROOF_CLEAR above any roof under it —
     eased up, and back down after; away from the buildings nothing changes (a helicopter coming home low once flew
     through the big hangar) */
  clearRoofs(dt) {
    const p = this.mesh.position, f = this.fwd, hl = Math.hypot(f.x, f.z) || 1, ahead = Math.max(6, (this.v || 0) * 1.5);
    if (!this.mesh.visible) { this.roofLift = 0; return; }                              // waiting off-screen: the next pass starts afresh
    if (!this.roofLift && p.y > OBSTACLES.top + ROOF_CLEAR) return;                     // above them all anyway
    let top = 0; for (let k = 0; k <= ahead; k += 1.5) top = Math.max(top, obstacleTop(p.x + f.x / hl * k, p.z + f.z / hl * k, 1));   // (1 around: a mast is narrower than the step)
    const want = top ? Math.max(0, top + ROOF_CLEAR - p.y) : 0, l = this.roofLift || 0;
    this.roofLift = l + clamp(want - l, -1.5 * dt, 4 * dt); p.y += this.roofLift;
  }
  orientFlight(dir, bankT, dt) {
    this.bank += (bankT - this.bank) * Math.min(1, dt * 1.5);
    // the pitch eases toward the path's: no snap where pieces join (a climb levelling off, the flare); orientation only
    const hl = Math.hypot(dir.x, dir.z) || 1e-6, tp = Math.atan2(dir.y, hl);
    this.pitch = this.pitch == null ? tp : this.pitch + (tp - this.pitch) * Math.min(1, dt * 2.5);
    const c = Math.cos(this.pitch); this.fwd.set(dir.x / hl * c, Math.sin(this.pitch), dir.z / hl * c);
    orientFrom(this.mesh, this.fwd, this.bank);
  }
  /* orbit distance: a flight shares one (wingmen take the lead's), otherwise random — the far end runs off-screen.
     now = jump there (the next path is built to it); otherwise the radius eases toward it. fresh = ignore the flight. */
  pickOrbit(now, fresh) {
    // unarmed types keep clear of the fight on a far orbit; only mates on the same kind of orbit are followed
    const S = this.spec, o = this.orbit, far = !!S.farOrbit && combatOn(), [r0, r1] = far ? S.farOrbit : S.orbitR, base = flightOf(this);
    const mate = !fresh && AIRCRAFT.filter(a => a !== this && a.far === far && ORBIT_STATES.has(a.state) && flightOf(a) === base).sort((a, b) => csNum(a) - csNum(b))[0];
    if (mate) { o.tR = clamp(mate.orbit.tR + rand(-3, 3), r0, r1); o.alt = mate.orbit.alt + rand(-0.6, 0.6); }
    else { o.tR = rand(r0, r1); o.alt = rand(S.alt[0], S.alt[1]); }
    this.far = far;
    if (now) o.R = o.tR;
    return o;
  }
  orbitPos(th, out) { const o = this.orbit; return out.set(ORBIT_C.x + o.R * Math.cos(th), o.alt + 1.2 * Math.sin(th * 2 + o.ph), ORBIT_C.z + o.R * Math.sin(th)); }
  orbitStep(dt) {
    const o = this.orbit;
    if (this.spec.farOrbit && combatOn() !== this.far) this.pickOrbit();
    o.R += clamp(o.tR - o.R, -1.5 * dt, 1.5 * dt);
    this.theta += (o.v / o.R) * dt;
    const th = this.theta; this.orbitPos(th, this.mesh.position);
    this.v = o.v; this.clearRoofs(dt);
    this.orientFlight(_v.set(-Math.sin(th), 2.4 * Math.cos(th * 2 + o.ph) / o.R, Math.cos(th)), this.bankFor(o.v, o.R), dt);
  }
  pathToOrbit(path, from, heading, lead, slope0) {   // slope0: the climb rate it arrives with (no kink in the climb)
    const th0 = Math.atan2(from.z - ORBIT_C.z, from.x - ORBIT_C.x) + lead;
    this.theta = th0;
    return path.addDubins(from, heading, this.orbitPos(th0, new V3()), th0 + Math.PI / 2, this.spec.turnR, slope0);
  }

  /* --- missions (js/missions.js): this.mission is the flight's mission context, its legs drive the state --- */
  missionFlow(dt) { if (!this.mission) return false; this.mission.m.update(this, dt); return true; }

  /* --- combat: armed aircraft leave the orbit, wait off-screen and cross the screen on passes (js/airwar.js);
         gunships (AC-130, MQ-9) circle over the fight instead (cbt_orbit), firing at ground targets on the beat --- */
  combatFlow(dt) {
    const S = this.spec;
    if (this.state === 'orbit') {
      if (!S.armed || this.landReq || !combatOn()) { this.cbtDelay = null; return false; }
      if (this.cbtDelay == null) this.cbtDelay = rand(0.3, 1.5) + (csNum(this) - 1) * 1.1;   // wingmen follow their lead
      if ((this.cbtDelay -= dt) > 0) return false;
      this.cbtDelay = null;
      if (S.gunship) { AIRWAR.toGunOrbit(this); this.state = 'cbt_out'; this.t = 0; AIRWAR.onEngage(this); return true; }
      const far = AIRWAR.offscreenFrom(this.mesh.position, this.orbit.alt);
      this.fly(new FlightPath().addDubins(this.mesh.position, headingOf(this.fwd), far.p, far.h, S.turnR), this.orbit.v, S.speed * 1.3);
      this.state = 'cbt_out'; this.t = 0; AIRWAR.onEngage(this);
      return true;
    }
    if (!this.inCombat) return false;
    this.airT += dt;                                   // sortie time (auto recovery to rearm)
    switch (this.state) {
      case 'cbt_out':
        if (this.followPath(dt)) { if (S.gunship) { this.state = 'cbt_orbit'; this.t = 0; } else { this.state = 'cbt_wait'; this.t = 0; this.mesh.visible = false; } }
        break;
      case 'cbt_orbit':
        AIRWAR.gunOrbitStep(this, dt); this.gunTick(dt);
        if (this.landReq || !combatOn()) { const P = new FlightPath(); this.pickOrbit(true); this.pathToOrbit(P, this.mesh.position.clone(), headingOf(this.fwd), 0.5); this.fly(P, this.v, this.orbit.v); this.state = 'cbt_rtb'; AIRWAR.onRtb(this); }
        break;
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
    this.pickOrbit(true); this.pathToOrbit(P, from, Math.atan2(ORBIT_C.z - from.z, ORBIT_C.x - from.x), 0.5);
    this.fly(P, v0, this.orbit.v); this.fwd.set(ORBIT_C.x - from.x, 0, ORBIT_C.z - from.z).normalize(); this.mesh.visible = true;
  }
  /* gun burst at a target (jets: nose cannon, helicopters: chin turret, gunships: side guns); tracers at 40/s, the hit is rolled when it ends */
  startGuns(target, dur, chance, o) { this.gunT = dur; this.gunAcc = 0; this.gunTgt = target; this.gunChance = chance; this.gunO = o || null; }
  gunTick(dt) {
    if (!(this.gunT > 0)) return;
    this.gunT -= dt; this.gunAcc += dt;
    const tg = enemyAlive(this.gunTgt) ? this.gunTgt : null, heli = this instanceof Helicopter, o = this.gunO || {}, sp = o.speed || (heli ? 60 : this.v + 90), rate = o.rate || 40;
    while (this.gunAcc > 1 / rate) {
      this.gunAcc -= 1 / rate;
      const mp = this.mesh.position.clone();
      if (o.side) mp.addScaledVector(_po.set(this.fwd.z, 0, -this.fwd.x), o.side).y -= 0.3; else { mp.addScaledVector(this.fwd, heli ? 0.7 : 1.1); if (heli) mp.y -= 0.15; }
      const v = tg ? leadPoint(tg, mp, sp).sub(mp).normalize() : this.fwd.clone();
      if (!heli && !o.side) this.gunOn = gunAim(this.fwd, v, o.down);   // a jet's gun is fixed: along the nose (a turret, door gun or gunship's side gun aims)
      v.multiplyScalar(sp);
      v.x += rand(-1.2, 1.2); v.y += rand(-1.2, 1.2); v.z += rand(-1.2, 1.2);
      FX.tracers.spawn(mp, v, { life: o.life || 0.7, len: o.len || 1.8, w: o.w || 0.12, color: o.color || 0xffc070, splash: o.splash || 0.2 });
      if (Math.random() < 0.4) FX.flash.spawn(mp, { s0: 0.8, s1: 1.1, life: 0.05, a0: 0.9 });
    }
    if (this.gunT <= 0 && tg && (heli || o.side || this.gunOn) && tg.p.distanceTo(this.mesh.position) < (o.range || 45)) queueHit(tg, { chance: this.gunChance, dmg: o.dmg || 1, src: this, delay: 0.15 });
  }

  update(dt) {
    this.t += dt;
    this.updateState(dt);
    this.model.tick(dt, this);
    const on = this.lightsOn;                                       // nav lights / beacons: off while shut down on the ground
    if (on !== this.navOn) { this.navOn = on; if (!this.navPts) { this.navPts = []; this.mesh.traverse(o => { if (o.isPoints) this.navPts.push(o); }); } for (const p of this.navPts) p.visible = on; }
  }
  /* engines running (or stopped on the runway in an emergency): nav lights and beacons on */
  get lightsOn() { return this.state !== 'parked' && this.state !== 'towed'; }
}
const ORBIT_C = new V3(0, 0, -4);   // orbits are flown around the airfield's centre

/* ======================= Fixed wing (runway) ======================= */
class FixedWing extends Aircraft {
  // rollTo: fraction of the runway past the touchdown point used to brake to a fast taxi; decel: an emergency's hard stop
  static spec = Object.assign({}, Aircraft.spec, { approachV: 8.5, taxiV: 1.8, toRoll: 60, vR: 8, decel: 1.6, rollTo: 0.35, climbOut: 26, bankMax: 1.0, park: 'f' });
  get engineOn() { return this.state !== 'parked' && this.state !== 'towed' && this.state !== 'emergency'; }
  get gearDown() {
    if (this.state === 'orbit' || this.onMission || this.inCombat || this.tank) return false;
    if (this.state === 'climb' || this.state === 'go_around') return this.ps < 14;
    if (this.state === 'approach') return this.ps > this.finalS - 30;
    return true;
  }
  beginLaunch() { this.state = 'ready'; this.t = 0; this.pb = AIRFIELD.pushback(this.spot); this.needsService = false; this.rwyL = null; }   // its landing runway: chosen again when it comes back
  /* on the runway L (the north one by default) at x, rolling east */
  rwyPose(x, dz, L = RW) { this.deckPose(x, L.z + (dz || 0), 0, 0); this.fwd.set(1, 0, 0); }
  get rdz() { return this._rdz || 0; }
  set rdz(v) { this._rdz = v; }

  updateState(dt) {
    if (this.tank) { TANKER.fly(this, dt); return; }   // refuelling pass (js/tanker.js)
    if (this.missionFlow(dt)) { this.glow = 0.4; return; }
    if (this.combatFlow(dt)) { this.glow = this.state === 'cbt_pass' ? 0.9 : 0.6; return; }
    const S = this.spec, sp = this.spot;
    let glow = 0;
    switch (this.state) {
      case 'parked': this.deckPose(sp.x, sp.z, sp.yaw, 0); this.v = 0; break;
      case 'ready':                                    // engines running; the tug (groundops.js) hooks up, waits for the door and for traffic (and for the crew to finish)
        glow = 0.12; this.deckPose(sp.x, sp.z, sp.yaw, 0); this.mesh.visible = true;
        if (this.groundBusy) { this.t = 0; break; }
        if (this.t > 2 && (this.tugReady || this.t > 90) && (!AIRFIELD.sheltered(sp) || sp.door > 0.95) && AIRFIELD.pushbackClear(this, this.pb)) {
          this.startDeckPath(this.pb, 0.7, true); this.state = 'pushback';
          if (Math.random() < 0.5) this.call('taxiReq');
        }
        break;
      case 'pushback':
        glow = 0.12;
        if (this.followDeck(dt)) { this.startDeckPath(AIRFIELD.toHold(sp), S.taxiV); this.state = 'taxi_out'; this.t = 0; this.tugHold = !!this.tug; if (Math.random() < 0.6) this.tower('taxiClear'); }
        break;
      case 'taxi_out':
        glow = 0.15;
        if (this.tugHold && this.t < 12) { this.v = 0; break; }   // the tug is still unhooking in front of it
        if (this.followDeck(dt)) { this.state = 'hold_short'; this.t = 0; }
        break;
      case 'hold_short': {
        glow = 0.2; this.v = 0;
        const R = this.rwyL || RW;                     // its runway: the north one, or 09R once across to it (hold2)
        // 09L closed and 09R open: across 09L's end to 09R's holding point (AIRFIELD.depR, canCross: clear of the repair)
        if (R === RW && !this.pairL && !this.pairW && this.t > 1.5 && AIRFIELD.depR() === RW2 && AIRFIELD.canCross(this, HOLD.x)) {
          AIRFIELD.rwy.add(this); this.rwyL = RW2; this.startDeckPath([[HOLD.x, HOLD.z], [HOLD.x, BASE_LAYOUT.hold2.z]], S.taxiV); this.state = 'cross_out'; this.t = 0;
          this.tower('crossClear'); break;
        }
        // the lead of a pair lines up on the left half and waits there for its wingman (formation takeoff; 09L only)
        const L = this.pairL, pairOk = L && AIRFIELD.rwy.has(L) && (L.state === 'lineup' || (L.state === 'takeoff_roll' && !L.rolling));
        if (L && !pairOk) this.pairL = L.pairW = null;
        if (this.t > 1.5 && (pairOk || (!this.pairL && AIRFIELD.canLineUp(this)))) {
          const w = !pairOk && R === RW && AIRCRAFT.find(b => b !== this && b.state === 'taxi_out' && flightOf(b) === flightOf(this) && b.spec.key === S.key && b.dlen - b.ds < 10 && b.blockT > 0.3);
          if (w) { this.pairW = w; w.pairL = this; }
          this.rdz = pairOk ? 1.0 : w ? -1.0 : 0;
          AIRFIELD.setOf(R).add(this); this.startDeckPath(AIRFIELD.lineUp(this.rdz, pairOk ? 0 : w ? 4 : 0, R), S.taxiV * 0.9); this.state = 'lineup';
          if (!pairOk) { this.tower(w ? 'takeoffClearPair' : 'takeoffClear'); this.call('takeoffReady', { delay: 0.3 }); }
        }
        break;
      }
      case 'cross_out':                                // across 09L to 09R's holding point
        glow = 0.15;
        if (AIRFIELD.rwy.has(this) && this.mesh.position.z - this.spec.len * 0.5 > RW.z + RW.w / 2 + 0.6) AIRFIELD.rwy.delete(this);   // its tail past 09L's edge
        if (this.followDeck(dt)) { AIRFIELD.rwy.delete(this); this.state = 'hold_short'; this.t = 0; }
        break;
      case 'lineup':
        glow = 0.3;
        if (this.followDeck(dt)) { this.state = 'takeoff_roll'; this.t = 0; this.v = 0; this.rx = this.mesh.position.x; this.rolling = false; }
        break;
      case 'takeoff_roll': {
        if (!this.rolling) {                           // brakes on, spooling up; a pair's lead waits for its wingman, who rolls a second after it
          glow = 0.5; this.rwyPose(this.rx, this.rdz, this.rwyL || RW);
          const W = this.pairW, L = this.pairL;
          let ahead = false; for (const b of AIRFIELD.setOf(this.rwyL || RW)) if (b !== this && b !== L && b !== W && (b.state === 'takeoff_roll' || b.cross)) ahead = true;   // the one before is still rolling, or one is crossing
          const go = !ahead && (L ? !(L.state === 'takeoff_roll' && !L.rolling) && (L.state !== 'takeoff_roll' || L.t > 0.9) : this.t > 1.2 && (!W || W.pairL !== this || W.state === 'takeoff_roll' || this.t > 14));
          if (go && this.t > 0.6) { this.rolling = true; this.t = 0; }
          break;
        }
        const acc = S.vR * S.vR / (2 * S.toRoll), R = this.rwyL || RW;
        glow = 1; this.v += acc * dt; this.rx += this.v * dt;   // lifts off toRoll down the runway
        const rot = smoothstep(S.vR * 0.85, S.vR, this.v);
        this.rwyPose(this.rx, this.rdz, R); this.mesh.rotateZ(rot * 0.12);
        if (Math.random() < dt * 8) FX.smoke.spawn(new V3(this.rx - 1.2, 0.2, R.z + this.rdz), { s0: 0.5, s1: 1.8, life: 1.2, a0: 0.2, color: 0xd8d8d0, v: new V3(-1, 0.3, 0) });
        if (this.v >= S.vR) {
          AIRFIELD.setOf(R).delete(this); this.pairL = this.pairW = null; this.rwyL = null;   // (its landing runway is picked when it comes back)
          const p0 = this.mesh.position.clone(), f = new V3(1, 0, 0);
          const run = Math.max(S.climbOut, R.x1 + 10 - p0.x), p1 = p0.clone().addScaledVector(f, run); p1.y += 5;   // straight out past the runway end, then the turn
          const P = new FlightPath().addLine(p0, p1);
          this.pickOrbit(true); this.pathToOrbit(P, p1, 0, 0.9, 5 / run); this.pitch = 0.12;   // the climb carries on into the turn; pitch from the rotation
          // keeps accelerating after lift-off (not spread over the whole way to the orbit), at least enough to be at the orbit's speed by its end
          this.fly(P, this.v, S.speed, Math.max(acc * 1.5, (S.speed * S.speed - this.v * this.v) / (1.8 * P.length)));
          this.fwd.copy(f); this.state = 'climb'; this.airT = 0;
          this.call('airborne', { delay: 0.6 });
        }
        break;
      }
      case 'climb': glow = 0.6; if (this.followPath(dt)) this.state = 'orbit'; break;
      case 'go_around': glow = 0.8; if (this.followPath(dt)) { this.state = 'orbit'; } break;
      case 'orbit':
        glow = 0.3; this.airT += dt; this.orbitStep(dt); if (this.emerg) this.trail(dt);
        if (this.landReq && AIRFIELD.canApproach(this)) {
          const L = this.rwyL = AIRFIELD.landR(); AIRFIELD.arrivals.add(this);
          // straight-in from the west: a Dubins turn to the gate, then the glide path to the touchdown point
          const td = new V3(L.td, 0.02, L.z), gate = new V3(L.td - 52, 6.5, L.z), flare = new V3(L.td - 9, 0.9, L.z);
          const P = new FlightPath().addDubins(this.mesh.position, headingOf(this.fwd), gate, 0, S.turnR).addLine(gate, flare).addLine(flare, td);
          this.finalS = P.lastDubinsEnd;
          this.fly(P, this.orbit.v, S.approachV); this.state = 'approach'; this.landReq = false;
          this.call('approach');
        }
        break;
      case 'approach':
      case 'final':
        glow = 0.3;
        if (this.state === 'approach' && this.ps >= this.finalS) {
          if (!AIRFIELD.clearToLand(this)) { this.goAround(); break; }
          this.state = 'final'; this.tower('landClear');
        }
        if (this.state === 'final' && this.ps > this.path.length - 14 && !AIRFIELD.clearToLand(this, true)) { this.goAround(); break; }   // something rolled out in front
        if (this.emerg) this.trail(dt);
        if (this.followPath(dt)) {
          AIRFIELD.arrivals.delete(this); AIRFIELD.setOf(this.rwyL).add(this);
          this.state = 'rollout'; this.rx = this.mesh.position.x; this.v = S.approachV;
          // braking by type: down to a fast taxi `rollTo` of the runway beyond the touchdown point, then to taxi speed for the exit
          const vf = S.taxiV * 1.8, run = S.rollTo * (this.rwyL.x1 - this.rwyL.td);
          this.rdec = (this.v * this.v - vf * vf) / (2 * run);
          const xStop = this.rx + run + (vf * vf - S.taxiV * S.taxiV) / (2 * this.rdec);
          this.exitX = AIRFIELD.exitFor(this.spot, xStop);
          for (let i = 0; i < 4; i++) FX.smoke.spawn(new V3(this.rx, 0.15, this.rwyL.z + rand(-0.4, 0.4)), { s0: 0.4, s1: 1.6, life: 1.4, a0: 0.45, color: 0xd8d8d0, v: new V3(rand(0.5, 2), 0.3, 0) });   // tyre smoke
          if (Math.random() < 0.6) this.call('touchdown', { delay: 0.4 });
        }
        break;
      case 'rollout': {
        glow = 0.12;
        if (this.emerg) {                              // an emergency stops on the runway: crash crews and a tug (groundops.js)
          this.v = Math.max(0, this.v - S.decel * dt); this.rx += this.v * dt; this.rwyPose(this.rx, 0, this.rwyL); this.trail(dt);
          if (this.v <= 0) { this.state = 'emergency'; this.t = 0; this.smokeOut = 1; GROUND_OPS.onStopped(this); }
          break;
        }
        // brake to a fast taxi on the runway, down to taxi speed for the turn off
        this.v = Math.max(this.rx < this.exitX - 10 ? S.taxiV * 1.8 : S.taxiV, this.v - (this.rdec || S.decel) * dt); this.rx += this.v * dt;
        this.rwyPose(this.rx, 0, this.rwyL);
        if (this.rx >= this.exitX - 4.5 || this.rx > this.rwyL.x1 - 2) {
          this.startDeckPath(AIRFIELD.homeRoute(this.spot, this.rx, this.exitX, this.rwyL), S.taxiV); this.dv = this.v; this.state = 'taxi_in'; this.crossAt(this.exitX);
          if (this.cargo && AIRFIELD.sheltered(this.spot) && !AUD.armed) this.dstop = AIRFIELD.unloadStop(this);   // a transport home with cargo: unloaded at its hangar door (UnloadScene)
        }
        break;
      }
      case 'emergency': this.rwyPose(this.rx, 0, this.rwyL); this.v = 0; this.trail(dt); break;
      case 'taxi_in':
      case 'towed':
        glow = this.state === 'towed' ? 0 : 0.12;
        for (const L of [RW, RW2]) { const set = AIRFIELD.setOf(L); if (set.has(this) && this.mesh.position.z < L.z - L.w / 2 - 1.2) set.delete(this); }   // north of a runway's edge: clear of it
        if (this.dstop != null && this.ds >= this.dstop - 1e-3) { this.state = 'unload'; this.t = 0; this.v = this.dv = 0; break; }
        if (this.followDeck(dt)) { AIRFIELD.rwy.delete(this); AIRFIELD.rwy2.delete(this); this.state = 'parked'; this.t = 0; this.needsService = true; this.cross = null; }   // the ground crew comes (groundops.js)
        break;
      case 'unload':                                   // nose in its open hangar door, the ramp down over the lane: the K-loader takes the cargo (UnloadScene)
        glow = 0.12; this.v = 0;
        if (!this.cargo || (AUD.armed && !this.groundBusy) || this.t > 90) { this.cargo = false; this.dstop = null; this.state = 'taxi_in'; this.t = 0; }   // done (a fight before the loader came: in at once)
        break;
    }
    this.glow = glow;
  }
  /* the tug has it: towed home along the way it would have taxied */
  startTow() { const lk = AIRFIELD.exitFor(this.spot, this.rx); this.startDeckPath(AIRFIELD.homeRoute(this.spot, this.rx, lk, this.rwyL), 1.0); this.state = 'towed'; this.t = 0; this.crossAt(lk); }
  /* home from the south runway: across the north one at the connector lk (AIRFIELD.holdCross) */
  crossAt(lk) { this.cross = this.rwyL === RW2 ? { ok: false, x: lk, t: null } : null; }
  /* an emergency: smoke from the engine (it thins out once the crash crews have foamed it) */
  trail(dt) {
    const k = this.smokeOut ?? 1; if (k <= 0.02) return;
    this.trailT = (this.trailT || 0) + dt;
    while (this.trailT > 0.05) { this.trailT -= 0.05; FX.smoke.spawn(this.mesh.position.clone().addScaledVector(this.fwd, -this.spec.len * 0.4).setY(this.mesh.position.y + 0.3), { s0: 0.4 * k, s1: 2.2 * k, life: 2.2, a0: 0.55 * k, color: 0x1e1e1e, v: new V3(WIND.x, 0.8, WIND.z) }); }
  }
  goAround() {
    AIRFIELD.arrivals.delete(this);
    const p0 = this.mesh.position.clone(), p1 = p0.clone().addScaledVector(this.fwd.clone().setY(0).normalize(), 40); p1.y = Math.max(p0.y + 6, 9);
    const P = new FlightPath().addLine(p0, p1); this.pickOrbit(true); this.pathToOrbit(P, p1, headingOf(this.fwd), 0.9, (p1.y - p0.y) / 40);
    this.fly(P, this.v, this.spec.speed); this.state = 'go_around'; this.landReq = true;
    this.tower('goAround'); this.call('goingAround', { delay: 0.4 });
  }
  /* combat: fire a missile from under the wing along the flight direction */
  fireMissile(target) {
    const perp = new V3(-this.fwd.z, 0, this.fwd.x), side = (this._w = -(this._w || 1));
    const p = this.mesh.position.clone().addScaledVector(perp, side * 0.8); p.y -= 0.3;
    const v = this.fwd.clone().multiplyScalar(this.v + 38); v.y -= 1.5;
    if (target) { MISSILES.push({ p, v, life: 5, smokeT: 0, target, chance: target.ground ? 0.8 : 0.72, dmg: 2, src: this, speed: 55, glow: true }); return; }
    MISSILES.push({ p, v, life: 2.8, smokeT: 0 });
    FX.tracers.spawn(p, v, { life: 2.4, len: 1.0, w: 0.25, color: 0xfff2d0, splash: 0.9 });
  }
  /* a stick of bombs on a ground target ahead (strike passes): ballistic tracers onto it, the hit is rolled on impact */
  dropBombs(target, n) {
    const tt = Math.sqrt(2 * Math.max(1, this.mesh.position.y - target.p.y) / 9.8) * 1.1;
    for (let i = 0; i < n; i++) {
      const p = this.mesh.position.clone(); p.y -= 0.35;
      const aim = target.p.clone().addScaledVector(target.v, tt).add(new V3(rand(-1.5, 1.5), 0, rand(-1.5, 1.5)));
      const v = aim.sub(p).divideScalar(tt); v.y += 0.5 * 9.8 * tt;
      FX.tracers.spawn(p, v, { life: tt + 1, len: 0.5, w: 0.16, color: 0x3a3c38, grav: 9.8, splash: 2.0 });
    }
    queueHit(target, { chance: 0.85, dmg: 3, src: this, delay: tt });
  }
}

/* ======================= Helicopter (vertical from its pad) ======================= */
const HELI_LIGHTS = { n: 0 };   // only the first few helicopters cast real light (GPU budget)
const _hz = new V3(), _hf = new V3();
class Helicopter extends Aircraft {
  static spec = Object.assign({}, Aircraft.spec, { turnR: 5, bankMax: 0.35, park: 'heli', len: 1.9, span: 1.6 });
  constructor(o) {
    super(o);
    const sp = this.model.searchPos || new V3(0.7, 0.2, 0);
    this.lit = HELI_LIGHTS.n < 4; if (this.lit) HELI_LIGHTS.n++;
    const sl = makeSearchlight(this.mesh, sp.x, sp.y, sp.z, { angle: 0.2, len: 14, intensity: 2.4, coneOpacity: 0.32, housing: false, noLight: !this.lit });
    sl.holder.quaternion.setFromUnitVectors(new V3(0, 0, 1), new V3(1, -1.1, 0).normalize());
    sl.fixed = true; sl.enabled = 0; this.searchlights.push(sl);
  }
  dispose() { if (this.lit) HELI_LIGHTS.n--; super.dispose(); }      // its real light can go to the next helicopter
  get onGround() { return false; }                                   // pads are their own: no ground traffic rules
  beginLaunch() { this.state = 'spinup'; this.t = 0; this.needsService = false; }
  orientFlight(dir, bankT, dt) {
    this.bank += (bankT - this.bank) * Math.min(1, dt * 1.5);
    // own scratch vectors: orbitStep() passes the shared _v in as `dir`
    const hz = _hz.set(dir.x, 0, dir.z); if (hz.lengthSq() < 1e-6) hz.copy(this.fwd); hz.normalize();
    this.fwd.copy(hz);
    const p = (this.spec.noseDown ?? 0.1) * clamp(this.v / this.spec.speed, 0, 1.2) - dir.y * 0.3;
    orientFrom(this.mesh, _hf.set(hz.x * Math.cos(p), -Math.sin(p), hz.z * Math.cos(p)), this.bank);
  }
  updateState(dt) {
    if (this.tank) { TANKER.fly(this, dt); this.rotor = 1; this.rotorAng += 30 * dt; return; }
    if (this.missionFlow(dt)) { this.rotor = 1; this.rotorAng += 30 * dt; return; }
    const s = this.spot, S = this.spec; let air = 0;
    if (this.combatFlow(dt)) { air = 1; this.rotor = 1; } else switch (this.state) {
      case 'parked': this.rotor = 0; this.deckPose(s.x, s.z, s.yaw, 0); break;
      case 'spinup': this.rotor = Math.min(1, this.t / 3.5); this.deckPose(s.x, s.z, s.yaw, 0); if (this.groundBusy) this.t = Math.min(this.t, 3.4); else if (this.t > 3.5) { this.state = 'lift'; this.t = 0; } break;   // a hot refuel finishes first
      case 'lift':
        air = 1; this.rotor = 1;
        this.deckPose(s.x, s.z, s.yaw, smoothstep(0, 3, this.t) * 4);
        if (this.t > 3) {
          const f = new V3(Math.cos(s.yaw), 0, -Math.sin(s.yaw)); this.fwd.copy(f); this.airT = 0;
          const P = new FlightPath(); this.pickOrbit(true); this.pathToOrbit(P, this.mesh.position.clone(), headingOf(f), 0.7);
          this.fly(P, 1.5, S.speed); this.state = 'depart';
          this.call('heliUp');
        }
        break;
      case 'depart': air = 1; this.rotor = 1; if (this.followPath(dt)) this.state = 'orbit'; break;
      case 'orbit':
        air = 1; this.rotor = 1; this.airT += dt; this.orbitStep(dt);
        if (this.landReq) {
          this.landReq = false;
          const P0 = new V3(s.x, 4, s.z), f = new V3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
          this.fly(new FlightPath().addDubins(this.mesh.position, headingOf(this.fwd), P0, headingOf(f), S.turnR), this.orbit.v, 0.7);
          this.state = 'ret'; this.tower('heliCleared');
        }
        break;
      case 'ret': air = 1; this.rotor = 1; if (this.followPath(dt)) { this.state = 'hover'; this.t = 0; this.v = 0; } break;
      case 'hover': air = 1; this.deckPose(s.x, s.z, s.yaw, 4 + Math.sin(this.t * 2) * 0.05); if (this.t > 1.2) { this.state = 'descend'; this.t = 0; } break;
      case 'descend':
        air = 1; this.deckPose(s.x, s.z, s.yaw, 4 * (1 - smoothstep(0, 3.5, this.t)));
        if (Math.random() < dt * 10 * (1 - this.t / 3.5)) FX.smoke.spawn(new V3(s.x + rand(-1.2, 1.2), 0.2, s.z + rand(-1.2, 1.2)), { s0: 0.6, s1: 2, life: 1.2, a0: 0.18, color: 0xc8b898, v: new V3(rand(-2, 2), 0.3, rand(-2, 2)) });   // rotor wash
        if (this.t > 3.5) { this.state = 'spindown'; this.t = 0; this.call('heliDown'); }
        break;
      case 'spindown':
        this.rotor = Math.max(0, 1 - this.t / 3.5); this.deckPose(s.x, s.z, s.yaw, 0);
        if (this.t > 3.5) { const n = TAU / (S.blades || 4); this.rotorAng = Math.round(this.rotorAng / n) * n; this.state = 'parked'; this.t = 0; this.needsService = true; }
        break;
    }
    this.rotorAng += this.rotor * 30 * dt;
    const sl = this.searchlights[0]; sl.enabled += ((air ? 1 : 0) - sl.enabled) * Math.min(1, dt * 2);
  }
  /* rocket ripple; with a target (ground vehicle) the rockets fly at it and a hit is rolled on arrival */
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
  /* Hellfire at armour, Stinger at aircraft: homing, the hit is resolved on the beat */
  fireMissileAt(target, speed, chance) {
    const p = this.mesh.position.clone(); p.y -= 0.25;
    const v = this.fwd.clone().multiplyScalar(this.v + 15); v.y -= 1;
    MISSILES.push({ p, v, life: 6, smokeT: 0, target, chance, dmg: 2, src: this, speed, glow: true });
    FX.flash.spawn(p, { s0: 1.0, s1: 1.4, life: 0.08, a0: 1 });
  }
}

/* ======================= Aircraft types =======================
   len / span: ground footprint (units, scaled) for taxi spacing; park: home kind ('f' fighter, 'h' heavy, 'd' drone);
   refuel: 'boom' (KC-46) / 'probe' (KC-130); tankKind on the tankers; gunship: circles over the fight (cbt_orbit) */
const FW = FixedWing.spec, HELI = Helicopter.spec;
const fighter = o => Object.assign({}, FW, { speed: 17, turnR: 22, orbitR: [36, 84], alt: [12, 17], armed: true, refuel: 'boom', len: 2.4, span: 1.7, vR: 11.5, toRoll: 52 }, o);   // a fighter accelerates hard: ~2.5× a heavy's
const heavy = o => Object.assign({}, FW, { scale: 1.05, park: 'h', taxiV: 1.6, toRoll: 80, vR: 6.5, decel: 0.9, rollTo: 0.55, approachV: 7.5, climbOut: 34, bankMax: 0.55, callsignGroup: 1, turnR: 24 }, o);
class F15 extends FixedWing { static spec = fighter({ key: 'f15', tag: 'F-15E', speed: 17.5, alt: [13, 18] }); buildModel() { return buildF15(); } }
class F16 extends FixedWing { static spec = fighter({ key: 'f16', tag: 'F-16C', turnR: 20, alt: [12, 16], len: 1.9, span: 1.2, vR: 11 }); buildModel() { return buildF16(); } }
class F22 extends FixedWing { static spec = fighter({ key: 'f22', tag: 'F-22A', speed: 18.5, turnR: 22, alt: [15, 20] }); buildModel() { return buildF22(); } }
class F35 extends FixedWing { static spec = fighter({ key: 'f35', tag: 'F-35A', alt: [13, 18], len: 2.0, span: 1.4 }); buildModel() { return buildF35(); } }
class A10 extends FixedWing { static spec = fighter({ key: 'a10', tag: 'A-10C', speed: 12, turnR: 15, orbitR: [28, 66], alt: [8, 12], cas: true, len: 2.1, span: 2.2, vR: 8, toRoll: 50, approachV: 7 }); buildModel() { return buildA10(); } }
class E3 extends FixedWing { static spec = heavy({ key: 'e3', tag: 'E-3', speed: 12, turnR: 30, orbitR: [80, 120], farOrbit: [108, 128], alt: [21, 24], awacs: true, voice: 'awacs', len: 4.9, span: 4.6, toRoll: 88, rollTo: 0.6 }); buildModel() { return buildE3(); } }
/* tankers fly refuelling passes with a flight in tow (js/tanker.js), no missions; the KC-46 has a boom, the KC-130 two hoses */
class KC46 extends FixedWing {
  static spec = heavy({ key: 'kc46', tag: 'KC-46', speed: 13, turnR: 30, orbitR: [80, 120], farOrbit: [108, 128], alt: [18, 21], tanker: true, tankKind: 'boom', voice: 'tanker', missions: [], len: 5.3, span: 5.0, big: true, toRoll: 88, rollTo: 0.6 });
  get hoseOut() { return this.tank && this.state === 'tank_pass' ? 1 : 0; }
  buildModel() { return buildKC46(); }
}
class KC130 extends FixedWing {
  static spec = heavy({ key: 'kc130', tag: 'KC-130J', speed: 10, orbitR: [64, 104], farOrbit: [96, 116], alt: [11, 14], tanker: true, tankKind: 'drogue', voice: 'tanker', missions: [], len: 3.2, span: 4.2, vR: 5.5 });
  get hoseOut() { return this.tank && this.state === 'tank_pass' ? 1 : 0; }
  buildModel() { return buildC130('kc130'); }
}
class C130 extends FixedWing { static spec = heavy({ key: 'c130', tag: 'C-130J', speed: 10, orbitR: [64, 104], farOrbit: [96, 116], alt: [14, 18], transport: true, missions: ['airlift', 'paradrop'], len: 3.2, span: 4.2, vR: 5.5 }); buildModel() { return buildC130('c130'); } }
class AC130 extends FixedWing { static spec = heavy({ key: 'ac130', tag: 'AC-130J', speed: 9.5, orbitR: [52, 88], alt: [16, 20], armed: true, gunship: true, len: 3.2, span: 4.2, vR: 5.5 }); buildModel() { return buildC130('ac130'); } }
class C17 extends FixedWing { static spec = heavy({ key: 'c17', tag: 'C-17', speed: 12, turnR: 30, orbitR: [80, 120], farOrbit: [108, 128], alt: [16, 20], transport: true, missions: ['airlift', 'paradrop'], len: 5.6, span: 5.4, big: true, vR: 6, toRoll: 88, rollTo: 0.5 }); buildModel() { return buildC17(); } }
/* unmanned: no radio of its own on the ground (its operator talks for it), circles over the fight with Hellfires */
class MQ9 extends FixedWing { static spec = Object.assign({}, FW, { key: 'mq9', tag: 'MQ-9', scale: 1.15, park: 'd', speed: 8, turnR: 14, orbitR: [48, 86], alt: [18, 22], armed: true, gunship: true, drone: true, callsignGroup: 1, len: 1.3, span: 2.3, taxiV: 1.5, vR: 4.5, toRoll: 45, approachV: 5.5, decel: 1.2, bankMax: 0.5 }); buildModel() { return buildMQ9(); } }
class UH60 extends Helicopter { static spec = Object.assign({}, HELI, { key: 'uh60', tag: 'UH-60', speed: 7.5, orbitR: [18, 46], farOrbit: [50, 62], alt: [8.5, 10.5], transport: true, refuel: 'probe' }); buildModel() { return buildUH60(); } }
class AH64 extends Helicopter { static spec = Object.assign({}, HELI, { key: 'ah64', tag: 'AH-64D', speed: 8.5, orbitR: [15, 40], alt: [7, 9], armed: true }); buildModel() { return buildAH64(); } }
class UH1 extends Helicopter { static spec = Object.assign({}, HELI, { key: 'uh1', tag: 'UH-1Y', speed: 7, orbitR: [16, 42], alt: [7.5, 9.5], armed: true, blades: 2, doorGuns: true }); buildModel() { return buildUH1(); } }
const AIRCRAFT_TYPES = { f15: F15, f16: F16, f22: F22, f35: F35, a10: A10, e3: E3, kc46: KC46, c130: C130, kc130: KC130, ac130: AC130, c17: C17, mq9: MQ9, uh60: UH60, ah64: AH64, uh1: UH1 };
const FIXED_ORDER = ['f15', 'f16', 'f22', 'f35', 'a10', 'e3', 'kc46', 'c130', 'kc130', 'ac130', 'c17', 'mq9'], HELI_ORDER = ['uh60', 'ah64', 'uh1'];

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
const FLYBY_JETS = { f15: () => buildF15(0x5c636a, true), f16: () => buildF16(0x7e868e, true), f22: () => buildF22(0x666d74, true) };
const FLYBY_MODELS = { f15: [], f16: [], f22: [] };   // jets of finished fly-bys, reused instead of rebuilt
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
      pl.model.tick(dt, { glow: 0.7 });
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
