'use strict';
/* ===== Air combat passes =====
   In combat, armed aircraft leave their orbit and wait off-screen (state cbt_wait). Every few seconds a pass
   sends one or two of them across the screen, edge to edge, straight or curved:
     chase  — a dogfight bandit ahead, our fighters behind it;
     chased — a bandit on a fighter's tail (and the wingman behind the bandit, or a warning from the AWACS);
     sweep  — fighters only;
     boats / cover — attack helicopters, low: fast attack boats come in to meet them, or they hunt whatever
                     flies near the fleet (bandits: Sidewinder, vampires: chin gun).
   Weapons fire on the beat (AIRWAR.onBeat); radio lines are spoken when the pass comes on screen.        */
function combatOn() { return AUD.armed && CFG.fire > 0; }
const _nd = new V3(), _ro = new V3(), _rd = new V3(), _fs = new V3();
// decoy flares: the glow is one flash sprite flying on its own; FLARES mirrors its motion for a thin smoke trail
const FLARES = [], FLARE_DRAG = 0.9, FLARE_G = 5;
const FLARE_STATES = new Set(['orbit', 'climb', 'depart', 'cbt_pass', 'cbt_rtb', 'mission_out', 'mission_back']);
const CBT = { cat: 'combat', prio: 2 }, CBT0 = { cat: 'combat', prio: 0 };
const shortType = e => ENEMY_TYPES[e.type].name.split(' ')[0];

const AIRWAR = {
  passes: [], timer: 2, heliTimer: 5, flareCd: 0,

  /* --- screen helpers (orthographic camera: any zoom / rotation) --- */
  ndc(p) { return _nd.copy(p).project(camera); },
  onScreen(p, m) { const n = this.ndc(p); return Math.abs(n.x) < 1 + (m || 0) && Math.abs(n.y) < 1 + (m || 0); },
  groundAt(nx, ny, alt, out) {          // the point at height alt seen at screen position (nx, ny)
    _ro.set(nx, ny, -1).unproject(camera); _rd.set(0, 0, -1).transformDirection(camera.matrixWorld);
    return (out || new V3()).copy(_ro).addScaledVector(_rd, (alt - _ro.y) / _rd.y);
  },
  /* a point just beyond the screen edge, in the direction of pos as seen from the screen centre */
  offscreenFrom(pos, alt) {
    const n = this.ndc(pos); let x = n.x, y = n.y, l = Math.hypot(x, y);
    if (l < 0.05) { const a = rand(0, TAU); x = Math.cos(a); y = Math.sin(a); l = 1; }
    x /= l; y /= l; const k = 1.3 / Math.max(Math.abs(x), Math.abs(y));
    const p = this.groundAt(x * k, y * k, alt), c = this.groundAt(0, 0, alt), out = p.clone().sub(c).setY(0).normalize();
    p.addScaledVector(out, 12);
    return { p, h: Math.atan2(p.z - pos.z, p.x - pos.x) };
  },
  /* a path that enters beyond one screen edge and leaves beyond the opposite one; lead = run-in before the edge */
  screenPass(alt, R, lead) {
    const a = rand(0, TAU), c = Math.cos(a), s = Math.sin(a), off = rand(-0.45, 0.45), k = 1.2 / Math.max(Math.abs(c), Math.abs(s));
    const A = this.groundAt(-c * k - s * off, -s * k + c * off, alt), B = this.groundAt(c * k - s * off, s * k + c * off, alt);
    const d = B.clone().sub(A).setY(0).normalize(); A.addScaledVector(d, -(lead + 10)); B.addScaledVector(d, 12);
    const P = new FlightPath();
    if (Math.random() < 0.5) return P.addLine(A, B);
    // curved: an arc (C) or an S, ends rotated off the straight line
    const h = Math.atan2(d.z, d.x), sg = Math.random() < 0.5 ? 1 : -1;
    return P.addDubins(A, h + sg * rand(0.35, 0.7), B, h + (Math.random() < 0.5 ? -sg : sg) * rand(0.35, 0.7), R);
  },

  /* --- starting passes --- */
  idle(cls) { return AIRCRAFT.filter(a => a.state === 'cbt_wait' && a instanceof cls && !a.landReq && a.t > 1.5); },
  crewFrom(list) {                       // one or two aircraft of the same flight, lead first
    const lead = pick(list), mates = list.filter(a => a !== lead && flightOf(a) === flightOf(lead));
    const crew = [lead]; if (mates.length && Math.random() < 0.65) crew.push(pick(mates));
    return crew.sort((a, b) => csNum(a) - csNum(b));
  },
  board(a, p, ps, v, off) {
    a.fly(p.P, v, v); a.ps = ps; a.pathOff = off; a.pass = p; a.cbtTgt = a.chasedBy = null; a.gunT = 0;
    a.state = 'cbt_pass'; a.t = 0; a.mesh.visible = true; a.fwd.copy(p.P.sample(ps).dir).setY(0).normalize(); a.bank = 0;
  },
  startJetPass() {
    const idle = this.idle(FixedWing); if (!idle.length) return;
    const crew = this.crewFrom(idle);
    const kind = !CFG.enemies ? 'sweep' : wpick([{ k: 'chase', w: 0.45 }, { k: 'chased', w: 0.3 }, { k: 'sweep', w: 0.25 }]).k;
    const v = Math.min(...crew.map(a => a.spec.speed)) * 1.45, gap = kind === 'sweep' ? rand(3, 5) : rand(9, 12);
    const order = kind === 'chase' ? ['bandit', ...crew] : kind === 'chased' ? [crew[0], 'bandit', ...crew.slice(1)] : crew;
    const lead = order.length * gap + 4;
    const p = { kind, heli: false, crew, bandit: null, boats: [], intro: false, P: this.screenPass(rand(10, 20), 30, lead) };
    order.forEach((m, i) => {
      if (m === 'bandit') p.bandit = spawnDuelBandit(pickEnemyType(), p.P, lead - i * gap, v);
      else this.board(m, p, lead - i * gap, v, kind === 'sweep' && i ? rand(1.5, 2.5) * (Math.random() < 0.5 ? -1 : 1) : 0);
    });
    if (p.bandit) {
      const bi = order.indexOf('bandit');
      for (const a of crew) if (order.indexOf(a) > bi) a.cbtTgt = p.bandit; else { a.chasedBy = p.bandit; p.bandit.cbtTgt = a; }
    }
    this.passes.push(p);
  },
  startHeliPass() {
    const idle = this.idle(Helicopter); if (!idle.length) return;
    const crew = this.crewFrom(idle), kind = CFG.enemies && Math.random() < 0.65 ? 'boats' : 'cover';
    const v = Math.min(...crew.map(a => a.spec.speed)) * 1.3, gap = rand(4, 6), lead = crew.length * gap + 4;
    const p = { kind, heli: true, crew, bandit: null, boats: [], intro: false, P: this.screenPass(rand(4, 7), 15, lead) };
    crew.forEach((a, i) => this.board(a, p, lead - i * gap, v, i ? rand(1.5, 2.5) * (Math.random() < 0.5 ? -1 : 1) : 0));
    if (kind === 'boats') {
      // the boats come in from off-screen and meet the helicopters around the middle of the pass,
      // heading past the fleet; their start allows for the current (the sea flows by at WAVE.flow)
      const sM = rand(0.45, 0.65) * p.P.length, M = p.P.sample(sM).pos.setY(0), tMeet = (sM - lead) / v;
      const aim = new V3(rand(-25, 25), 0, rand(-25, 25)), dir = aim.sub(M); if (dir.lengthSq() < 1) dir.set(1, 0, 0); dir.normalize();
      const sp = rand(6, 8), wv = dir.clone().multiplyScalar(sp); wv.x -= WAVE.flow;
      const perp = new V3(-dir.z, 0, dir.x), n = randi(1, 3);
      for (let i = 0; i < n; i++) {
        const st = M.clone().addScaledVector(wv, -tMeet).addScaledVector(perp, (i - (n - 1) / 2) * 2.5).addScaledVector(dir, -i * 1.5);
        for (let k = 0; k < 12 && this.onScreen(st, 0.08); k++) st.addScaledVector(wv, -1);   // never pop up on screen
        p.boats.push(spawnBoat(st, dir, sp));
      }
      const b0 = p.boats[0].p, bh = Math.atan2(b0.z, b0.x);
      sayOnce('boats', 25, () => { const [w, role] = hq(); RADIO.say(w, radioLine(AIRWAR_LINES.boatContact, { B: bearingWords(bh), D: compassWord(bh) }), { role, cat: 'combat', prio: 1 }); });
    }
    this.passes.push(p);
  },

  /* --- per frame --- */
  update(dt) {
    camera.updateMatrixWorld();
    this.updateFlares(dt);
    for (let i = this.passes.length - 1; i >= 0; i--) if (!this.tickPass(this.passes[i], dt)) this.passes.splice(i, 1);
    if (!combatOn() || !AUD.fighting) return;   // holding after the music stopped: no new passes
    const st = STRESS.level;
    if ((this.timer -= dt) <= 0) { this.timer = rand(2.5, 5) * (1 - 0.4 * st); if (this.passes.filter(p => !p.heli).length < 2 + st) this.startJetPass(); }
    if ((this.heliTimer -= dt) <= 0) { this.heliTimer = rand(5, 9) * (1 - 0.3 * st); if (this.passes.filter(p => p.heli).length < (st > 0.5 ? 2 : 1)) this.startHeliPass(); }
    // helicopters off-screen report their attacks out there
    if ((SAY_CD.heliAway || -99) > T) return;
    const away = AIRCRAFT.filter(a => a.state === 'cbt_wait' && a instanceof Helicopter && a.t > 4);
    if (away.length) sayOnce('heliAway', rand(14, 22), () => {
      const a = pick(away), h = Math.atan2(a.mesh.position.z, a.mesh.position.x);
      a.say(radioLine(AIRWAR_LINES.heliAway, { D: compassWord(h) }), CBT0);
    });
  },
  tickPass(p, dt) {
    const live = p.crew.filter(a => a.pass === p && a.state === 'cbt_pass'), b = p.bandit;
    if (!p.intro && (live.some(a => this.onScreen(a.mesh.position, -0.1)) || (enemyAlive(b) && this.onScreen(b.p, -0.1)))) { p.intro = true; this.introLines(p); }
    if (b && !p.outcome) {
      if (b.falling) { p.outcome = 'kill'; if (p.kind === 'chased' && Math.random() < 0.7) p.crew[0].say(radioLine(AIRWAR_LINES.thanks), Object.assign({ delay: 1.8 }, CBT0)); }
      else if (b.escaped) {
        p.outcome = 'escaped'; if (p.kind === 'chase' && p.intro && Math.random() < 0.6) p.crew[0].say(radioLine(AIRWAR_LINES.chaseEscape), CBT0);
        if (p.intro && Math.random() < 0.4) enemySay(b.cs, ENEMY_LINES.escape, null, { delay: 1.2 });
      }
    }
    if (enemyAlive(b) && b.gunT > 0) this.enemyGuns(b, b.cbtTgt, dt);
    for (const e of p.boats) if (enemyAlive(e) && e.gunT > 0) this.enemyGuns(e, e.gunAt, dt);
    return live.length > 0 || enemyAlive(b);
  },
  introLines(p) {
    const [a, w] = p.crew, L = AIRWAR_LINES;
    switch (p.kind) {
      case 'chase': a.say(radioLine(L.chaseIntro, { T: shortType(p.bandit) }), CBT); if (Math.random() < 0.5) enemySay(p.bandit.cs, ENEMY_LINES.chased, null, { delay: 1.4 }); break;
      case 'chased':
        if (w) { a.say(radioLine(L.chasedIntro, { T: shortType(p.bandit) }), CBT); w.say(radioLine(L.saveIntro, { C: a.callsign }), Object.assign({ delay: 0.8 }, CBT)); }
        else { const [who, role] = hq(); RADIO.say(who, radioLine(L.sixWarning, { C: a.callsign }), { role, cat: 'combat', prio: 2 }); a.say(radioLine(L.chasedIntro, { T: shortType(p.bandit) }), Object.assign({ delay: 0.8 }, CBT)); }
        if (Math.random() < 0.5) enemySay(p.bandit.cs, ENEMY_LINES.chasing, null, { delay: 1.8 });
        break;
      case 'sweep': if (Math.random() < 0.35) a.say(radioLine(L.sweep), CBT0); break;
      case 'boats': a.say(radioLine(L.boatsIntro), CBT); { const bt = p.boats.find(enemyAlive); if (bt && Math.random() < 0.5) enemySay(bt.cs, ENEMY_LINES.boats, null, { delay: 1.4 }); } break;
      case 'cover': if (Math.random() < 0.4) a.say(radioLine(L.cover), CBT0); break;
    }
  },
  /* enemy gunfire (dogfight bandit at its quarry, boats at the helicopters): aimed a little off — it misses */
  enemyGuns(e, tgt, dt) {
    e.gunT -= dt; e.gunAcc = (e.gunAcc || 0) + dt;
    while (e.gunAcc > 1 / 30) {
      e.gunAcc -= 1 / 30;
      if (!tgt || !tgt.mesh.visible) continue;
      const from = e.p.clone(); if (e.kind === 'bandit') from.addScaledVector(_rd.copy(e.v).normalize(), 1.2); else from.y += 0.2;
      const to = tgt.mesh.position.clone().add(new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1.2, 2.5)));
      const v = to.sub(from).normalize().multiplyScalar(80).add(e.v);
      FX.tracers.spawn(from, v, { life: 0.9, len: 1.6, w: 0.11, color: 0xff7050 });
      if (Math.random() < 0.4) FX.flash.spawn(from, { s0: 0.7, s1: 1.0, life: 0.05, a0: 0.9 });
    }
  },
  /* n flares in pairs, kicked out left and right and down behind the aircraft; returns the release point */
  dropFlares(pos, fwd, speed, n) {
    const side = _fs.set(-fwd.z, 0, fwd.x).normalize(), p = pos.clone().addScaledVector(fwd, -0.6); p.y -= 0.15;
    for (let i = 0; i < n; i++) {
      const v = fwd.clone().multiplyScalar(speed * 0.35).addScaledVector(side, (i % 2 ? 1 : -1) * rand(2, 4)); v.y -= rand(1, 2.5);
      const life = rand(1.1, 1.6);
      FX.flash.spawn(p, { s0: 2.0, s1: 1.1, life, a0: 1, color: 0xfff0c0, v, drag: FLARE_DRAG, rise: -FLARE_G });
      FLARES.push({ p: p.clone(), v: v.clone(), life, tt: rand(0, 0.3) });
    }
    return p;
  },
  updateFlares(dt) {
    for (let i = FLARES.length - 1; i >= 0; i--) {
      const f = FLARES[i];
      if ((f.life -= dt) <= 0) { FLARES.splice(i, 1); continue; }
      f.v.multiplyScalar(Math.max(0, 1 - FLARE_DRAG * dt)); f.v.y -= FLARE_G * dt; f.p.addScaledVector(f.v, dt);   // same motion as the sprite
      if ((f.tt -= dt) <= 0) { f.tt += 0.3; FX.smoke.spawn(f.p, { s0: 0.4, s1: 1.5, life: 1.0, a0: 0.45, smoke: true, v: new V3(-WAVE.flow * 0.5, 0.2, 0), drag: 0.5 }); }
    }
  },
  /* flares on the snare: one aircraft at a time (at most one burst per 1.8 s, 5 s per aircraft), on screen only */
  musicFlares(f) {
    if (T < this.flareCd || Math.random() > (0.2 + 0.3 * AUD.heavy) * f) return;
    const cands = AIRCRAFT.filter(a => a.mesh.visible && FLARE_STATES.has(a.state) && T > (a.flareT || 0) && this.onScreen(a.mesh.position, -0.05));
    for (const fb of FLYBYS) for (const pl of fb.planes) if (T > (pl.flareT || 0) && this.onScreen(pl.p, -0.05)) cands.push(pl);
    if (!cands.length) return;
    const a = pick(cands), n = Math.random() < 0.5 ? 4 : 6;
    a.flareT = T + 5; this.flareCd = T + 1.8;
    if (a instanceof Aircraft) this.dropFlares(a.mesh.position, a.fwd, a.v, n);
    else { const fb = FLYBYS.find(x => x.planes.includes(a)); this.dropFlares(a.p, fb.dir, fb.speed, n); }
  },

  /* --- weapons on the beat (only aircraft on screen fire) --- */
  onBeat(band, f) {
    if (band === 'mid') this.musicFlares(f);
    let shots = 0;
    for (const p of this.passes) for (const a of p.crew) {
      if (a.pass !== p || a.state !== 'cbt_pass' || !this.onScreen(a.mesh.position, -0.05)) continue;
      if (p.heli) this.heliWeapons(a, band, f); else shots += this.jetWeapons(a, p, band, f, shots);
    }
    if (band !== 'mid') return;
    for (const p of this.passes) {                       // return fire
      const b = p.bandit;
      if (enemyAlive(b) && b.cbtTgt && b.cbtTgt.pass === p && this.onScreen(b.p, -0.05) && Math.random() < 0.6 * f) b.gunT = 0.35;
      for (const e of p.boats) {
        if (!enemyAlive(e) || !this.onScreen(e.p, -0.05) || Math.random() > 0.5 * f) continue;
        const h = p.crew.find(a => a.pass === p && a.mesh.position.distanceTo(e.p) < 40); if (!h) continue;
        e.gunT = 0.4; e.gunAt = h; sayOnce('boatFire', 10, () => h.say(radioLine(AIRWAR_LINES.boatFire), CBT0));
      }
    }
  },
  ahead(a, e, d0, d1) { const d = e.p.clone().sub(a.mesh.position), l = d.length(); return l > d0 && l < d1 && d.dot(a.fwd) / l > 0.7; },
  jetWeapons(a, p, band, f, shots) {
    // own dogfight bandit first, otherwise an attack-wave bandit in front of it
    const tg = enemyAlive(a.cbtTgt) ? a.cbtTgt : CFG.enemies ? nearestEnemy(a.mesh.position, ['bandit'], 70) : null, L = AIRWAR_LINES;
    // the kill shot waits until the fight is well inside the screen, so the chase plays out on screen
    const deep = this.onScreen(a.mesh.position, -0.3) && tg && this.onScreen(tg.p, -0.2);
    if (band === 'low') {
      if (deep && shots < 2 && this.ahead(a, tg, 8, 70) && Math.random() < 0.45 * f) { a.fireMissile(tg); if (Math.random() < 0.4) a.say(radioLine(L.fox), CBT0); return 1; }
      if (!CFG.enemies && Math.random() < 0.2 * f) { a.fireMissile(null); return 1; }
      const b = a.chasedBy;
      if (enemyAlive(b) && (a.flareT || 0) < T && this.onScreen(b.p, 0) && Math.random() < 0.6) {
        // the bandit fires a missile, our fighter dumps flares and the missile goes for them
        a.flareT = T + 2.5;
        const decoy = this.dropFlares(a.mesh.position, a.fwd, a.v, 6).addScaledVector(a.fwd, -3), from = b.p.clone().addScaledVector(_rd.copy(b.v).normalize(), 1);
        const v = decoy.sub(from).normalize().multiplyScalar(b.speed + 30); v.y -= 2;
        MISSILES.push({ p: from, v, life: 1.6, smokeT: 0, glow: true });
        sayOnce('flares', 6, () => a.say(radioLine(L.flares), CBT0));
      }
    } else if (band === 'mid' && tg && this.onScreen(tg.p, -0.1) && !(a.gunT > 0) && this.ahead(a, tg, 3, 35) && Math.random() < 0.7 * f) {
      a.startGuns(tg, 0.3, 0.35); sayOnce('guns', 5, () => a.say(radioLine(L.guns), CBT0));
    }
    return 0;
  },
  heliWeapons(a, band, f) {
    const pos = a.mesh.position, L = AIRWAR_LINES;
    const boat = nearestEnemy(pos, ['boat'], 45), vamp = nearestEnemy(pos, ['vampire'], 30);
    if (band === 'low') {
      const bandit = boat ? null : nearestEnemy(pos, ['bandit'], 60);
      if (boat && Math.random() < 0.55 * f) { a.fireMissileAt(boat, 40, 0.8); sayOnce('hellfire', 6, () => a.say(radioLine(L.hellfire), CBT0)); }
      else if (bandit && this.onScreen(bandit.p, 0) && Math.random() < 0.3 * f) { a.fireMissileAt(bandit, 55, 0.55); sayOnce('sidewinder', 6, () => a.say(radioLine(L.sidewinder), CBT0)); }
    } else if (band === 'mid') {
      if (boat && boat.p.distanceTo(pos) < 35 && Math.random() < 0.6 * f) { a.fireRockets(boat); sayOnce('rockets', 5, () => a.say(radioLine(L.rockets), CBT0)); }
      else if (vamp && !(a.gunT > 0) && Math.random() < 0.7 * f) { a.startGuns(vamp, 0.45, 0.4); sayOnce('vampGun', 6, () => a.say(radioLine(L.vampGun), CBT0)); }
    }
  },

  /* --- hooks from the aircraft state machine --- */
  onEngage(a) {
    const heli = a instanceof Helicopter, h = Math.atan2(a.mesh.position.z, a.mesh.position.x);
    sayOnce('engage ' + flightOf(a), 30, () => a.say(heli ? radioLine(AIRWAR_LINES.heliOut, { B: bearingWords(h), D: compassWord(h) }) : radioLine(AIRWAR_LINES.engage), CBT0));
  },
  onRtb(a) { if (!combatOn()) sayOnce('rtb ' + flightOf(a), 40, () => a.say(radioLine(AIRWAR_LINES.rtb), { prio: 1 })); }
};
