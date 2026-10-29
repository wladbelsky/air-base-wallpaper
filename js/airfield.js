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
const RW = BASE_LAYOUT.rwy, RW2 = BASE_LAYOUT.rwy2, TWZ = BASE_LAYOUT.twy.z, LANE = BASE_LAYOUT.lane;
const HOLD = BASE_LAYOUT.hold;
/* extra points every `step` along the long straight legs of a route: a Catmull-Rom curve bows out sideways on a long
   segment next to short ones (an aircraft rolled 1.6 off the taxiway line) */
function densify(pts, step = 3) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], n = Math.floor(Math.hypot(bx - ax, bz - az) / step);
    for (let k = 1; k < n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
    out.push(pts[i]);
  }
  return out;
}
const AIRFIELD = {
  rwy: new Set(),            // aircraft on the north runway (lining up, rolling, landing roll until clear, crossing it)
  rwy2: new Set(),           // on the south one (landing roll until clear; a departure from it while the north one is closed)
  arrivals: new Set(),       // on approach or final (to a.rwyL)
  reset() {
    this.rwy.clear(); this.rwy2.clear(); this.arrivals.clear();
    for (const l of [PARKING.stands, PARKING.shelters, PARKING.hangars, PARKING.remote, PARKING.heli]) for (const s of l) s.occ = null;
    for (const s of [...PARKING.shelters, ...PARKING.hangars]) { s.door = 0; s.tugIn = null; this.setDoor(s); }
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
    put(...pts[pts.length - 1]); return densify(out);
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
    if (this.onLane(s)) { const ec = this.outFor(s); pts.push([s.x - 3.4, LANE], [ec, LANE], [ec, TWZ]); }
    else pts.push([s.x + 3.4, TWZ]);
    pts.push([HOLD.x, TWZ], [HOLD.x, HOLD.z]);
    return this.round(pts, 2.2);
  },
  // onto the runway L from its holding point (09R: hold2); dz: side of the centreline (a pair takes off side by side), dx:
  // further along (the lead of a pair)
  lineUp(dz, dx, L = RW) {
    const H = L === RW2 ? BASE_LAYOUT.hold2 : HOLD, z = L.z + (dz || 0), x = H.x + 4.5 + (dx || 0);
    return [[H.x, H.z], [H.x, Math.min(z, L.z) - 1.6], [H.x + 2.2, z - 0.15], [x, z]];
  },
  /* the lane is entered from the taxiway by the west or the centre channel, whichever is west of the slot */
  channelFor: s => s.x > BASE_LAYOUT.chIn[1] ? BASE_LAYOUT.chIn[1] : BASE_LAYOUT.chIn[0],
  /* and left by the first out channel east of the end of the pushback */
  outFor: s => BASE_LAYOUT.chOut.find(c => c > s.x - 1.4) ?? BASE_LAYOUT.chOut[BASE_LAYOUT.chOut.length - 1],
  /* the runway exit for a landing aircraft that will be down to taxi speed at xStop: the first link it can use */
  exitFor(s, xStop) {
    const min = Math.max(xStop + 3, this.onLane(s) ? this.channelFor(s) + 4 : s.x + 5);
    const links = BASE_LAYOUT.links.slice(1).filter(x => x >= min);
    return links.length ? links[0] : 64;
  },
  /* a transport home with cargo to a hangar stops with its nose in the open door, the tail and ramp out over the lane
     (UnloadScene): the distance along its route home (a.dcurve) where its centre crosses that line */
  unloadStop(a) {
    const s = a.spot, z = s.z + s.d / 2 + 0.3, n = Math.ceil(a.dlen / 0.25), p = new V3();
    for (let i = n; i >= 0; i--) if (a.dcurve.getPointAt(i / n, p).z >= z) return Math.min(a.dlen, (i + 1) / n * a.dlen);
    return null;
  },
  homeRoute(s, x0, lk, L = RW) {   // from the runway L (the south one: across the north one on the connector)
    const pts = [[x0, L.z], [lk - 3.2, L.z], [lk, L.z - 2.6], [lk, TWZ]];
    if (this.onLane(s)) { const cx = this.channelFor(s); pts.push([cx, TWZ], [cx, LANE], [s.x - 5, LANE], [s.x, LANE - 3.2], [s.x, s.z]); }
    else pts.push([s.x + 5, TWZ], [s.x, TWZ - 3.2], [s.x, s.z]);
    return this.round(pts, 2.4);
  },
  /* ---- runways: the north one (RW) takes the departures, the south one (RW2) the arrivals; every rule goes by the
     runway an aircraft actually uses (a.rwyL, fixed when its approach starts / its crossing to 09R), so a closure may
     move the traffic any time ---- */
  setOf(L) { return L === RW2 ? this.rwy2 : this.rwy; },
  onRunway(a) { return this.rwy.has(a) || this.rwy2.has(a); },
  // the landing runway: the south one — but the north one (shared with the departures) while an emergency or a crater
  // (DAMAGE) has the south one closed (they would all hold in orbit for minutes)
  landR() { const e = GROUND_OPS.emerg; return (e && e.rwyL === RW2) || DAMAGE.closed(RW2) ? RW : RW2; },
  // the departure runway: the north one — but the south one (shared with the arrivals) while the north one is closed and
  // it is open: across 09L's end to 09R's holding point (hold2; FixedWing hold_short)
  depR() {
    const e = GROUND_OPS.emerg, shut = L => DAMAGE.closed(L) || (e && e.rwyL === L);
    return shut(RW) && !shut(RW2) ? RW2 : RW;
  },
  eta(a) { return a.path ? (a.path.length - a.ps) / Math.max(1, a.v) : 99; },
  // the next departure may line up behind one already rolling fast down the runway (it rolls once that one is off)
  // (by its runway: a.rwyL is 09R for one across at hold2, else the north one)
  canLineUp(a) {
    const L = (a && a.rwyL) || RW, e = GROUND_OPS.emerg; if (e && (e.rwyL || this.landR()) === L) return false;   // an emergency closes its runway until it is towed clear
    if (DAMAGE.closed(L)) return false;                                                    // so does a crater, until it is repaired
    for (const b of this.setOf(L)) if (!(b.state === 'takeoff_roll' && b.rolling && b.v > b.spec.vR * 0.5)) return false;
    for (const b of this.arrivals) if (b.rwyL === L && (b.state === 'final' || this.eta(b) < 32)) return false;
    if (L === RW) for (const b of AIRCRAFT) if (b.cross && !b.cross.ok && b.cross.t != null && T - b.cross.t > 20) return false;   // one has waited to cross: its turn
    return true;
  },
  // one arrival at a time (the next may start its approach once the one ahead is on final); a departure kept waiting
  // at the holding point gets its turn: no new approaches until it has gone
  canApproach(a) {
    const L = this.landR(); let n = 0;
    if (DAMAGE.closed(L)) return false;
    if (a.emerg) { for (const b of this.arrivals) if (b.rwyL === L && b.state === 'final') return false; return true; }   // priority: the ones on approach will go around
    const e = GROUND_OPS.emerg; if (e && (e.rwyL || L) === L) return false;
    if (AIRCRAFT.some(b => b.state === 'hold_short' && (b.rwyL || RW) === L && b.t > 25)) return false;   // sharing the runway with departures (09L, or 09R while 09L is closed)
    for (const b of this.arrivals) if (b.rwyL === L) { if (b.state !== 'final') return false; n++; }
    return n < 2;
  },
  // at the start of its final the runway has to be clear but for a landing roll or a departure rolling fast;
  // close in (late) nothing may be left on it but a departure about to lift off
  clearToLand(a, late) {
    const L = a.rwyL || RW; if (DAMAGE.closed(L)) return false;   // closed for a crater: go around
    for (const b of this.setOf(L)) {
      if (b.state === 'takeoff_roll' && b.rolling && b.v > b.spec.vR * (late ? 0.75 : 0.4)) continue;
      if (!late && (b.state === 'rollout' || b.state === 'taxi_in') && b.mesh.position.x > L.td + 25) continue;
      return false;
    }
    return true;
  },
  /* ---- crossing the north runway, on the way home from the south one: hold at the line on the connector (crossZ)
     until the runway is clear there, then it holds the runway (rwy) until across. Called from followDeck. ---- */
  holdCross(a) {
    const c = a.cross; if (!c || c.ok) return false;
    if (a.mesh.position.z - a.spec.len * 0.5 > BASE_LAYOUT.crossZ + 1.0) return false;          // its nose not at the line yet
    if (c.t == null) c.t = T;
    if (!this.canCross(a, c.x)) return true;
    c.ok = true; this.rwy.add(a); if (a.state !== 'towed') a.tower('crossClear');
    return false;
  },
  canCross(a, lx) {
    // closed for a crater: not near the repair truck's stretch (its entry link to the crater, DAMAGE.rwy.zone) or the truck,
    // nor while the truck waits to go on (RepairScene: until the runway is empty)
    const c = DAMAGE.rwy, sc = c && c.scene;
    if (c && c.L === RW && (!c.zone || (lx > c.zone[0] - 8 && lx < c.zone[1] + 8) || (sc && sc.phase === 'in' && !sc.through) || GROUND_OPS.vehicleNear(lx, RW.z, 8))) return false;
    for (const b of this.rwy) {
      if (b === a) continue;
      if (b.state === 'lineup') return false;
      if (b.state === 'takeoff_roll') { if (b.rolling ? b.rx < lx + 4 : b.rx > lx - 6) return false; continue; }   // rolling toward the connector (one waiting further back doesn't move yet)
      if (b.state === 'rollout' && b.mesh.position.x < lx + 4) return false;                    // a landing roll still coming this way (east): a slow tow across met an E-3's
      if (Math.abs(b.mesh.position.x - lx) < 8) return false;                                    // a landing roll / a tow / another crossing there
    }
    for (const b of this.arrivals) if (b.rwyL === RW && (b.state === 'final' || this.eta(b) < 20)) return false;   // landing on it (one runway)
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
      const q = b.mesh.position; if (ahead(b, q.x, q.z)) return b;
      // unloading at its hangar door (UnloadScene): its tail and the K-loader behind it are out on the lane
      if (b.state === 'unload') { const k = b.spec.len * 0.5 + 1.65; if (ahead(b, q.x - b.fwd.x * k, q.z - b.fwd.z * k)) return b; }
      // where one on the move will be in a moment: don't nose into a lane / taxiway in front of traffic coming along it
      if (b.v > 0.1 && b.state !== 'pushback') { const k = Math.min(3, b.v * 1.5); if (ahead(b, q.x + b.fwd.x * k, q.z + b.fwd.z * k)) return b; }
      if (b.state === 'pushback' && ahead(b, ...b.pb[b.pb.length - 1])) return b;   // keep clear of where a pushback ends
    }
    return null;
  },
  /* merging: both taxiing with routes that meet within the next 6 units (look: set in followDeck) — the one farther
     from the meeting point waits (both see the same pair of distances, so exactly one of them yields). Kept apart from
     the physical blocking above: it never forms a knot (no blockBy link), so nobody is let through by a knot into the
     one in front of it */
  yieldsTo(a, b) {
    const A = a.look, B = b.look;
    if (!A || !B || a.state === 'pushback' || b.state === 'pushback' || T - a.lookAt > 0.2 || T - b.lookAt > 0.2) return false;
    const ra = this.onRunway(a), rb = this.onRunway(b);
    if (ra && !rb) return false;                                // one still clearing the runway never waits (the runway would stay shut)
    const d = (a.spec.span + b.spec.span) * 0.35 + 0.6;
    let ia = 9, ib = 9;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (Math.hypot(A[i * 2] - B[j * 2], A[i * 2 + 1] - B[j * 2 + 1]) < d) { ia = Math.min(ia, i); ib = Math.min(ib, j); }
    // already where the ways meet (ia 0): b comes up from behind and waits there (blocker) — even one still clearing the
    // runway: the head of a queue never waits for its own tail
    return ia > 0 && ia < 9 && (rb && !ra || ia > ib || (ia === ib && AIRCRAFT.indexOf(a) > AIRCRAFT.indexOf(b)));
  },
  wantsOut(b) { return b.state === 'ready' && b.t > 20 && !b.groundBusy && b.pb && b.tugReady && !this.queueFull(); },   // (only when it may go: else the traffic waits for nothing)
  gap: (a, b) => (a.spec.len + b.spec.len) * 0.5 + 1,       // nose to tail with room to spare
  yielding: (b, a) => b.blockBy === a && T - (b.blockAt ?? -1) < 0.2,
  blocked(a, dir, dt) {
    const b = a.blockBy = this.blocker(a, dir); a.blockAt = T;
    if (!b) {
      // nobody in the way: give way at a merge (not to one that is stuck behind us: that would never clear)
      for (const c of AIRCRAFT) if (c !== a && c.onGround && !(c.blockBy === a && T - c.blockAt < 0.2) && this.yieldsTo(a, c)) { a.blockT = (a.blockT || 0) + dt; return true; }
      a.blockT = 0; return false;
    }
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
  /* departures on their way to the runway (taxiing out, at the hold, lining up): at most 4, so their queue never
     reaches back over the runway exits — an arrival that can't get off the runway would keep it shut, for good, for
     the very queue in front of it */
  queueFull() { let n = 0; for (const b of AIRCRAFT) if (b.state === 'taxi_out' || b.state === 'hold_short' || b.state === 'cross_out' || b.state === 'lineup') n++; return n >= 4; },
  /* a pushback waits until nobody is near its path or taxiing toward where it ends (it takes 10-20 s, blocking the lane /
     taxiway); after 20 s the traffic stops short of it (blocker), those holding for it a gap away don't count */
  pushbackClear(a, pts) {
    if (this.queueFull()) return false;                           // flow control: enough on their way to the runway
    const [ex, ez] = pts[pts.length - 1];
    for (const b of AIRCRAFT) {
      if (b === a || !b.onGround || b.state === 'parked' || b.state === 'ready' || b instanceof Helicopter) continue;
      const bp = b.mesh.position, r = this.yielding(b, a) ? (a.spec.len + b.spec.len) * 0.5 : 2 + (a.spec.len + b.spec.len) * 0.6;
      for (const [x, z] of pts) if (Math.hypot(bp.x - x, bp.z - z) < r) return false;
      if (b.state === 'pushback' && Math.hypot(b.pb[b.pb.length - 1][0] - ex, b.pb[b.pb.length - 1][1] - ez) < r + 4) return false;
      const dx = ex - bp.x, dz = ez - bp.z, d = Math.hypot(dx, dz);
      if (d < 40 && dx * b.fwd.x + dz * b.fwd.z > 0.8 * d && b.v > 0.05) return false;   // moving toward it
    }
    for (const [x, z] of pts) if (GROUND_OPS.vehicleNear(x, z, 1.2 + a.spec.len * 0.5, a)) return false;   // a ground vehicle in the way (it gives way to taxiing aircraft, but not to one still parked)
    return true;
  },
  /* ---- shelter / hangar doors: open while their aircraft moves in or out, closed otherwise ---- */
  doorWanted(s) {
    if (s.tugIn) return 1;                                         // a tug on its way back in (groundops.js)
    const a = s.occ; if (!a) return 0;
    if (a.state === 'parked') return a.t < 4 ? 1 : 0;
    if (a.state === 'ready' || a.state === 'pushback') return 1;
    if (a.state === 'taxi_in' || a.state === 'towed') return a.dlen - a.ds < 40 ? 1 : 0;
    if (a.state === 'unload') return 1;
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
