'use strict';
/* ===== Airfield ground operations: homes, taxi routes, runway use, doors, stand markings =====
   Every aircraft has a home (a PARKING slot, kept while it flies): fighters a shelter (HAS) or a front-row stand,
   heavies a hangar or a stand, the drone a small hangar, helicopters a pad; when those are full, the remote stands.
   Traffic is one-way, so taxiing aircraft only ever follow each other:
     - the parallel taxiway runs west, to the holding point of the departure link at its west end;
     - the apron lane (z = BL.lane, behind the front row) runs east: it is entered from the taxiway by the west or the
       centre channel and left by the east channel (on to the taxiway at the runway's east link);
     - front-row stands open onto the taxiway, shelters / hangars / the back remote row onto the lane.
   Parking is nose in (facing north); leaving starts with a pushback. Takeoffs and landings are all to the east.
   The runway is shared: lining up needs it empty and no arrival close in; an arrival that finds it occupied at the
   start of its final goes around. AIRFIELD.blocked() is the car-following rule on the ground (with a time-out, so
   two aircraft can never block each other for good).                                                          */
const RW = BASE_LAYOUT.rwy, TWZ = BASE_LAYOUT.twy.z, LANE = BASE_LAYOUT.lane;
const HOLD = BASE_LAYOUT.hold;
const AIRFIELD = {
  rwy: new Set(),            // aircraft on the runway (lining up, rolling, landing roll until clear)
  arrivals: new Set(),       // on approach or final
  reset() {
    this.rwy.clear(); this.arrivals.clear();
    for (const l of [PARKING.stands, PARKING.shelters, PARKING.hangars, PARKING.remote, PARKING.heli]) for (const s of l) s.occ = null;
    for (const s of [...PARKING.shelters, ...PARKING.hangars]) { s.door = 0; this.setDoor(s); }
  },
  /* ---- homes ---- */
  assignHome(a) {
    const P = PARKING, k = a.spec.park, free = l => l.find(s => !s.occ);
    const s = k === 'heli' ? free(P.heli) : k === 'f' ? free(P.shelters) || free(P.stands.filter(x => x.kind === 'f')) || free(P.remote)
      : k === 'd' ? free(P.hangars.filter(x => x.kind === 'd')) || free(P.remote) || free(P.stands.filter(x => x.kind === 'f'))
      : free(P.hangars.filter(x => x.kind === 'h' && (x.size === 'big' || !a.spec.big))) || free(P.stands.filter(x => x.kind === 'h')) || free(P.remote);
    const spot = s || P.remote[P.remote.length - 1];   // all full (counts beyond the base's capacity): share the last remote stand
    if (!spot.occ) spot.occ = a;
    return spot;
  },
  release(a) { if (a.spot && a.spot.occ === a) a.spot.occ = null; },
  sheltered: s => !!(s && s.leaves || s && s.panels),       // a shelter or hangar (has doors)
  /* ---- routes: [x, z] points through the corners (followDeck smooths them with a Catmull-Rom curve) ---- */
  // a corner rounded with radius r: the two points r before and after it instead of the corner itself
  // (two corners closer than 2r meet in the middle of their side: that point only once — a doubled point makes the
  // centripetal Catmull-Rom curve loop, the aircraft spun round on the spot)
  round(pts, r) {
    const out = [pts[0]], put = (x, z) => { const q = out[out.length - 1]; if (Math.hypot(x - q[0], z - q[1]) > 0.05) out.push([x, z]); };
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i], [cx, cz] = pts[i + 1];
      const l1 = Math.hypot(bx - ax, bz - az), l2 = Math.hypot(cx - bx, cz - bz), k1 = Math.min(r, l1 / 2) / l1, k2 = Math.min(r, l2 / 2) / l2;
      put(bx - (bx - ax) * k1, bz - (bz - az) * k1); put(bx + (cx - bx) * k2, bz + (cz - bz) * k2);
    }
    put(...pts[pts.length - 1]); return out;
  },
  onLane: s => s.row !== 'a',
  /* pushback out of the home: backwards onto the taxiway (front row: ending nose west) or the lane (nose east) */
  pushback(s) {
    if (this.onLane(s)) return [[s.x, s.z], [s.x, LANE - 2.4], [s.x - 1.6, LANE - 0.3], [s.x - 3.4, LANE]];
    return [[s.x, s.z], [s.x, TWZ - 2.2], [s.x + 1.6, TWZ - 0.3], [s.x + 3.4, TWZ]];
  },
  /* from the end of the pushback to the holding point (from the lane: east along it, out by the east channel) */
  toHold(s) {
    const pts = [];
    if (this.onLane(s)) { const ec = BASE_LAYOUT.channels[2]; pts.push([s.x - 3.4, LANE], [ec, LANE], [ec, TWZ]); }
    else pts.push([s.x + 3.4, TWZ]);
    pts.push([HOLD.x, TWZ], [HOLD.x, HOLD.z]);
    return this.round(pts, 2.2);
  },
  // onto the runway; dz: side of the centreline (a pair takes off side by side), dx: further along (the lead of a pair)
  lineUp(dz, dx) { const z = RW.z + (dz || 0), x = HOLD.x + 4.5 + (dx || 0); return [[HOLD.x, HOLD.z], [HOLD.x, Math.min(z, RW.z) - 1.6], [HOLD.x + 2.2, z - 0.15], [x, z]]; },
  /* the lane is entered from the taxiway by the west or the centre channel, whichever is west of the slot */
  channelFor: s => s.x > -4 ? -4 : -44,
  /* the runway exit for a landing aircraft that will be down to taxi speed at xStop: the first link it can use */
  exitFor(s, xStop) {
    const min = Math.max(xStop + 3, this.onLane(s) ? this.channelFor(s) + 4 : s.x + 5);
    const links = BASE_LAYOUT.links.slice(1).filter(x => x >= min);
    return links.length ? links[0] : 64;
  },
  homeRoute(s, x0, lk) {
    const pts = [[x0, RW.z], [lk - 3.2, RW.z], [lk, RW.z - 2.6], [lk, TWZ]];
    if (this.onLane(s)) { const cx = this.channelFor(s); pts.push([cx, TWZ], [cx, LANE], [s.x - 5, LANE], [s.x, LANE - 3.2], [s.x, s.z]); }
    else pts.push([s.x + 5, TWZ], [s.x, TWZ - 3.2], [s.x, s.z]);
    return this.round(pts, 2.4);
  },
  /* ---- runway ---- */
  eta(a) { return a.path ? (a.path.length - a.ps) / Math.max(1, a.v) : 99; },
  canLineUp(a) {
    if (this.rwy.size || GROUND_OPS.emerg) return false;              // an emergency closes the runway until it is towed clear
    for (const b of this.arrivals) if (b.state === 'final' || this.eta(b) < 32) return false;
    return true;
  },
  // one arrival at a time (the next may start its approach once the one ahead is on final); a departure kept waiting
  // at the holding point gets its turn: no new approaches until it has gone
  canApproach(a) {
    if (a.emerg) return ![...this.arrivals].some(b => b.state === 'final');   // priority: the ones on approach will go around
    if (GROUND_OPS.emerg) return false;
    if (AIRCRAFT.some(b => b.state === 'hold_short' && b.t > 25)) return false;
    for (const b of this.arrivals) if (b.state !== 'final') return false;
    return this.arrivals.size < 2;
  },
  // at the start of its final the runway has to be clear but for a landing roll or a departure rolling fast;
  // close in (late) nothing may be left on it but a departure about to lift off
  clearToLand(a, late) {
    for (const b of this.rwy) {
      if (b.state === 'takeoff_roll' && b.rolling && b.v > b.spec.vR * (late ? 0.75 : 0.4)) continue;
      if (!late && (b.state === 'rollout' || b.state === 'taxi_in') && b.mesh.position.x > RW.td + 25) continue;
      return false;
    }
    return true;
  },
  /* ---- ground traffic: stop behind whoever is close ahead (parked ones sit in their homes, off the routes). Aircraft
     blocking each other round a cycle (two crossing at a junction, a pushback and one passing behind it) can't all
     wait: one of the knot goes — a pushback first (it's under way), else the first in AIRCRAFT. Nobody ever drives
     on through the one in front. ---- */
  blocker(a, dir) {
    const p = a.mesh.position, reach = 1.0 + a.spec.len * 0.9;
    const ahead = (b, x, z, min = 0.1) => {
      const dx = x - p.x, dz = z - p.z, along = dx * dir.x + dz * dir.z;
      if (along <= min || along > reach + b.spec.len * 0.5) return false;
      // in the way, or close in front whatever the side (one turning off just ahead still has its tail across our path)
      return Math.abs(dx * dir.z - dz * dir.x) < (a.spec.span + b.spec.span) * 0.32 + 0.3 || Math.hypot(dx, dz) < (a.spec.len + b.spec.len) * 0.4 + 0.5;
    };
    for (const b of AIRCRAFT) {
      if (b === a || !b.onGround || !b.mesh.visible || b.state === 'parked') continue;
      // one waiting to push back for a while: stop short of where its pushback ends and let it out (unless already there)
      if (b.state === 'ready') { if (a.state !== 'pushback' && this.wantsOut(b) && ahead(b, ...b.pb[b.pb.length - 1], a.blockBy === b ? 0.1 : this.gap(a, b))) return b; continue; }
      if (ahead(b, b.mesh.position.x, b.mesh.position.z)) return b;
      if (b.state === 'pushback' && ahead(b, ...b.pb[b.pb.length - 1])) return b;   // keep clear of where a pushback ends
    }
    return null;
  },
  wantsOut: b => b.state === 'ready' && b.t > 20 && !b.groundBusy && b.pb,
  gap: (a, b) => (a.spec.len + b.spec.len) * 0.5 + 1,       // nose to tail with room to spare
  yielding: (b, a) => b.blockBy === a && T - (b.blockAt ?? -1) < 0.2,
  blocked(a, dir, dt) {
    const b = a.blockBy = this.blocker(a, dir); a.blockAt = T;
    if (!b) { a.blockT = 0; return false; }
    a.blockT = (a.blockT || 0) + dt;
    const k = this.knot(a);
    return !k || this.knotFirst(k) !== a;
  },
  // the cycle of blockBy links through a (only links set in the last moments: one standing at the hold keeps an old one)
  knot(a) {
    const seen = [a];
    for (let c = a.blockBy; c && T - (c.blockAt ?? -1) < 0.2; c = c.blockBy) {
      if (c === a) return seen;
      if (seen.includes(c) || seen.length > 8) return null;
      seen.push(c);
    }
    return null;
  },
  knotFirst: k => k.find(c => c.state === 'pushback') || k.reduce((m, c) => AIRCRAFT.indexOf(c) < AIRCRAFT.indexOf(m) ? c : m),
  /* a pushback waits until nobody is near its path or taxiing toward where it ends (it takes 10-20 s, blocking the lane /
     taxiway); after 20 s the traffic stops short of it (blocker), those holding for it a gap away don't count */
  pushbackClear(a, pts) {
    const [ex, ez] = pts[pts.length - 1];
    for (const b of AIRCRAFT) {
      if (b === a || !b.onGround || b.state === 'parked' || b.state === 'ready' || b instanceof Helicopter) continue;
      const bp = b.mesh.position, r = this.yielding(b, a) ? (a.spec.len + b.spec.len) * 0.5 : 2 + (a.spec.len + b.spec.len) * 0.6;
      for (const [x, z] of pts) if (Math.hypot(bp.x - x, bp.z - z) < r) return false;
      if (b.state === 'pushback' && Math.hypot(b.pb[b.pb.length - 1][0] - ex, b.pb[b.pb.length - 1][1] - ez) < r + 4) return false;
      const dx = ex - bp.x, dz = ez - bp.z, d = Math.hypot(dx, dz);
      if (d < 40 && dx * b.fwd.x + dz * b.fwd.z > 0.8 * d && b.v > 0.05) return false;   // moving toward it
    }
    return true;
  },
  /* ---- shelter / hangar doors: open while their aircraft moves in or out, closed otherwise ---- */
  doorWanted(s) {
    const a = s.occ; if (!a) return 0;
    if (a.state === 'parked') return a.t < 4 ? 1 : 0;
    if (a.state === 'ready' || a.state === 'pushback') return 1;
    if (a.state === 'taxi_in') return a.dlen - a.ds < 40 ? 1 : 0;
    return 0;
  },
  setDoor(s) {
    const k = smoothstep(0, 1, s.door);
    if (s.leaves) for (const l of s.leaves) l.g.position.x = l.sx * (s.w / 4 + k * (s.w / 2 + 0.3));
    if (s.panels) for (const q of s.panels) q.g.position.x = lerp(q.x0, q.x1, k);
  },
  update(dt) {
    for (const s of [...PARKING.shelters, ...PARKING.hangars]) {
      const t = this.doorWanted(s); if (t === s.door) continue;
      s.door += clamp(t - s.door, -dt * 0.4, dt * 0.4); this.setDoor(s);
    }
    // an aircraft parked in a closed shelter / hangar isn't drawn (or shadowed)
    for (const a of AIRCRAFT) if (a.state === 'parked' && this.sheltered(a.spot)) a.mesh.visible = a.spot.door > 0.02;
  },
  /* ---- stand markings (one instanced mesh, a mark only where an aircraft lives) and the helicopter pads (all of them, always) ---- */
  marks: null,
  buildMarks() {
    const box3 = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const stand = vegGeometry([[box3(0.08, 0.01, 4.6), 0xd8b030, 0, 0.05, 0.6], [box3(1.6, 0.01, 0.12), 0xd8b030, 0, 0.05, -1.2], [box3(0.1, 0.01, 0.9), 0xe6e6de, 0, 0.051, -1.6]]);
    const pad = vegGeometry([[new THREE.CylinderGeometry(1.9, 1.9, 0.05, 20), 0x9a9890, 0, 0.03, 0], [new THREE.RingGeometry(1.45, 1.6, 20).rotateX(-Math.PI / 2), 0xd8b030, 0, 0.062, 0],
      [box3(0.16, 0.01, 1.1), 0xe6e6de, -0.38, 0.062, 0], [box3(0.16, 0.01, 1.1), 0xe6e6de, 0.38, 0.062, 0], [box3(0.6, 0.01, 0.16), 0xe6e6de, 0, 0.062, 0]]);
    const mk = (geo, n) => { const m = new THREE.InstancedMesh(geo, VEG_MAT, n); m.receiveShadow = true; m.count = 0; scene.add(m); return m; };
    const stands = [...PARKING.stands, ...PARKING.remote];
    this.marks = { stand: mk(stand, stands.length), pad: mk(pad, PARKING.heli.length), stands };
  },
  updateMarks() {
    if (!this.marks) this.buildMarks();
    const m = this.marks, M4 = new THREE.Matrix4(), c = new THREE.Color(0xffffff);
    let n = 0;
    for (const s of m.stands) if (s.occ) { m.stand.setMatrixAt(n, M4.makeTranslation(s.x, 0, s.z)); m.stand.setColorAt(n++, c); }
    m.stand.count = n; m.stand.instanceMatrix.needsUpdate = true; if (m.stand.instanceColor) m.stand.instanceColor.needsUpdate = true;
    n = 0;
    for (const s of PARKING.heli) { m.pad.setMatrixAt(n, M4.makeTranslation(s.x, 0, s.z)); m.pad.setColorAt(n++, c); }
    m.pad.count = n; m.pad.instanceMatrix.needsUpdate = true; if (m.pad.instanceColor) m.pad.instanceColor.needsUpdate = true;
  }
};
