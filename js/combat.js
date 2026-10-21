'use strict';
/* ===== Enemies (bandits = fighters, vampires = anti-ship missiles) and beat-synced hits =====
   Weapons pick real targets; a projectile that reaches its target is resolved on the NEXT beat
   of the music (with a short fallback), so kills land on the rhythm.                          */
const ENEMIES = [], PENDING = [], SHIP_FIRES = [];
let banditTimer = 6, vampTimer = 14;
const SAY_CD = {};
function sayOnce(key, cd, fn) { if ((SAY_CD[key] || -99) > T) return; SAY_CD[key] = T + cd; fn(); }
/* intercepted enemy transmission (ENEMY_LINES): one every few seconds at most, more often as stress builds;
   prio 2 like our own combat calls (background chatter passes prio 1) */
function enemySay(who, pool, vars, o) {
  if (who) sayOnce('enemy', rand(4, 8) * (1 - 0.5 * STRESS.level), () => RADIO.say(who, radioLine(pool, vars), Object.assign({ role: 'enemy', cat: 'combat', prio: 2 }, o)));
}
let lastWaveT = -99;                                              // sim time of the last attack wave
const enemyOnAir = () => CFG.enemies && T - lastWaveT < 60;         // their command only talks while it has a fight going
/* a squadron name no enemy in the air is using (waves and dogfight bandits alike) */
function freeSquadron() {
  const busy = new Set(ENEMIES.map(e => enemyAlive(e) && e.cs && e.cs.split(' ')[0])), free = ENEMY_NAMES.squadrons.filter(s => !busy.has(s));
  return pick(free.length ? free : ENEMY_NAMES.squadrons);
}

/* Bandit types (models in airframes.js). A wave is one flight of one type; the newer, stealthier
   fighters show up more often as stress builds. vamp = chance to loose an anti-ship missile on the run in. */
const ENEMY_TYPES = {
  su25: { name: 'Su-25 Frogfoot', build: buildSu25, speed: [18, 22], alt: [12, 18], hp: 3, vamp: 0.5, w: st => 1.3 - st },   // slow, armoured attack jet
  su33: { name: 'Su-33 Flanker', build: buildSu33, speed: [22, 27], alt: [17, 26], hp: 2, vamp: 0.3, w: () => 1 },
  su47: { name: 'Su-47 Berkut', build: buildSu47, speed: [25, 30], alt: [18, 27], hp: 2, vamp: 0.2, w: st => 0.35 + st },
  su57: { name: 'Su-57 Felon', build: buildSu57, speed: [26, 31], alt: [18, 27], hp: 2, vamp: 0.35, w: st => 0.25 + st * 1.2 }
};
function buildVampire() {
  const g = new THREE.Group();
  const body = cyl(g, 0.07, 0.07, 0.8, 6, 0xd8d8d0, 0, 0, 0); body.rotation.z = Math.PI / 2;
  const tip = shade(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 6), M(0x9a9a92))); tip.rotation.z = -Math.PI / 2; tip.position.set(0.49, 0, 0); g.add(tip);
  for (let i = 0; i < 4; i++) { const f = box(g, 0.14, 0.02, 0.18, 0x9a9a92, -0.33, 0, 0); f.rotation.x = i * Math.PI / 2; }
  glowSprite(g, -0.48, 0, 0, 0.7, 0xffc080).material.opacity = 1;
  mergeStatic(g, []);
  return g;
}
/* Enemy models are built once; every enemy is a clone sharing geometry and materials, so spawning
   allocates no GPU buffers and removed enemies leave nothing behind. */
const ENEMY_MODELS = {};
function enemyMesh(key) {     // 'vampire', 'boat' or an ENEMY_TYPES key
  const tpl = ENEMY_MODELS[key] || (ENEMY_MODELS[key] = key === 'vampire' ? buildVampire() : key === 'boat' ? buildBoat() : ENEMY_TYPES[key].build());
  return tpl.clone();
}

/* ---- spawning ---- */
function bearingWords(h) {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
  const deg = Math.round(((90 + h / DEG) % 360 + 360) % 360 / 10) * 10 % 360;
  return String(deg).padStart(3, '0').split('').map(d => words[+d]).join('-');
}
function compassWord(h) { return ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][Math.round(((h / DEG) % 360 + 360) % 360 / 45) % 8]; }
function hq() { const aw = AIRCRAFT.find(a => a.isAwacs && a.airborne); return aw ? [aw.callsign, 'awacs'] : [RADIO_NAMES.carrier, 'ship']; }

const pickEnemyType = () => wpick(Object.keys(ENEMY_TYPES).map(k => ({ k, w: Math.max(0.05, ENEMY_TYPES[k].w(STRESS.level)) }))).k;
function spawnBandits(n) {
  const type = pickEnemyType(), ty = ENEMY_TYPES[type];
  const sq = freeSquadron(); lastWaveT = T;
  const h = rand(0, TAU), perp = new V3(-Math.sin(h), 0, Math.cos(h));
  const pass = new V3(rand(-22, 22), 0, rand(-22, 22)), alt = rand(ty.alt[0], ty.alt[1]), speed = rand(ty.speed[0], ty.speed[1]);
  for (let i = 0; i < n; i++) {
    const p = new V3(Math.cos(h) * 135, alt + rand(-1.5, 1.5), Math.sin(h) * 135).addScaledVector(perp, (i - (n - 1) / 2) * 6);
    p.addScaledVector(new V3(Math.cos(h), 0, Math.sin(h)), i * 5);
    const target = pass.clone().addScaledVector(perp, (i - (n - 1) / 2) * 6); target.y = p.y;
    const v = target.sub(p).normalize().multiplyScalar(speed);
    const mesh = enemyMesh(type); mesh.scale.setScalar(1.25); scene.add(mesh);
    ENEMIES.push({ kind: 'bandit', type, mesh, p, v, hp: ty.hp, age: 0, fired: false, smokeT: 0, sq, cs: `${sq} ${i + 1}` });
  }
  const [who, role] = hq();
  RADIO.say(who, radioLine(COMBAT.newBandits, { B: bearingWords(h), D: compassWord(h), T: ty.name, N: n === 1 ? 'a single bandit' : n === 2 ? 'two bandits' : n === 3 ? 'three bandits' : 'multiple bandits' }), { role, cat: 'combat', prio: 2 });
  if (Math.random() < 0.55) enemySay(`${sq} 1`, ENEMY_LINES.attack, { Q: sq }, { delay: 1.5 });
}
/* dogfight bandit: flies a screen pass (js/airwar.js) ahead of or behind our fighters; never fires at the ships */
function spawnDuelBandit(type, path, ps, speed) {
  const mesh = enemyMesh(type); mesh.scale.setScalar(1.25); scene.add(mesh);
  const s = path.sample(ps);
  const e = { kind: 'bandit', duel: true, type, mesh, p: s.pos, v: s.dir.clone().multiplyScalar(speed), hp: ENEMY_TYPES[type].hp, age: 0, fired: true, smokeT: 0, cs: `${freeSquadron()} ${randi(1, 4)}`, path, ps, speed, smp: { pos: new V3(), dir: new V3(), turn: 0, R: 1 } };
  mesh.position.copy(e.p); orientFrom(mesh, s.dir, 0);   // placed now: it spawns after this step's updateCombat
  ENEMIES.push(e); return e;
}
/* fast attack craft: runs across the water; attack helicopters hunt them */
function spawnBoat(p, dir, speed) {
  const mesh = enemyMesh('boat'); mesh.scale.setScalar(1.25); scene.add(mesh);
  const e = { kind: 'boat', mesh, p: p.clone(), dir: dir.clone().setY(0).normalize(), speed, v: new V3(), hp: 2, age: 0, smokeT: 0, wakeT: 0, cs: `${pick(ENEMY_NAMES.boats)} ${randi(1, 6)}` };
  mesh.position.copy(e.p); orientFrom(mesh, e.dir, 0);
  ENEMIES.push(e); return e;
}
function vampireTarget() {
  const s = pick(SHIPS), half = s.len * 0.35;
  return { ship: s, local: new V3(rand(-half, half), s === CARRIER ? 1.6 : 0.9, (Math.random() < 0.5 ? -1 : 1) * (s === CARRIER ? 3.3 : 1.1)) };
}
function spawnVampire(from) {
  const t = vampireTarget();
  const mesh = enemyMesh('vampire'); mesh.scale.setScalar(1.3); scene.add(mesh);
  const v = new V3(1, 0, 0);
  ENEMIES.push({ kind: 'vampire', mesh, p: from.clone(), v, hp: 1, age: 0, tgt: t, speed: rand(30, 36), smokeT: 0 });
}
function spawnVampireSalvo(n) {
  const h = rand(0, TAU);
  for (let i = 0; i < n; i++) spawnVampire(new V3(Math.cos(h) * 130 + rand(-6, 6), 1.4, Math.sin(h) * 130 + rand(-6, 6)));
  sayOnce('vamp', 6, () => { const sh = pick(SHIPS.slice(1)); RADIO.say(sh.radio, radioLine(COMBAT.vampires, { B: bearingWords(h), D: compassWord(h) }), { role: 'ship', cat: 'combat', prio: 3 }); });
  if (Math.random() < 0.4) enemySay(ENEMY_NAMES.hq, ENEMY_LINES.salvo);
}

/* ---- targeting helpers ---- */
const enemyAlive = e => e && !e.dead && !e.falling;
function nearestEnemy(pos, kinds, maxDist) {
  let best = null, bd = maxDist;
  // dogfight bandits are left to the fighters
  for (const e of ENEMIES) if (enemyAlive(e) && !e.duel && kinds.includes(e.kind)) { const d = e.p.distanceTo(pos); if (d < bd) { bd = d; best = e; } }
  return best;
}
const _al = new V3();
function aimMountAt(m, target) {
  _al.copy(target); m.yawG.parent.worldToLocal(_al);
  const dx = _al.x - m.yawG.position.x, dy = _al.y - m.yawG.position.y - 0.3, dz = _al.z - m.yawG.position.z;
  m.tYaw = Math.atan2(-dz, dx);
  m.tPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), 0.02, m.kind === 'gun' ? 1.15 : 1.45);
}
function leadPoint(e, from, speed) { const tt = e.p.distanceTo(from) / speed; return e.p.clone().addScaledVector(e.v, tt); }

/* ---- hits, resolved on the beat ---- */
function queueHit(e, o) {
  const ready = T + (o.delay || 0);
  PENDING.push({ e, chance: o.chance, dmg: o.dmg || 1, src: o.src, missile: o.missile || null, readyAt: ready, deadline: ready + 0.7 });
}
function resolveHits(onBeat) {
  for (let i = PENDING.length - 1; i >= 0; i--) {
    const h = PENDING[i];
    if (T < h.readyAt || (!onBeat && T < h.deadline)) continue;
    PENDING.splice(i, 1);
    if (h.missile) h.missile.life = 0;
    if (!enemyAlive(h.e)) { if (h.missile) airburst(h.missile.p, 0.6); continue; }
    if (Math.random() < h.chance) damageEnemy(h.e, h.dmg, h.src);
    else airburst(h.e.p.clone().add(new V3(rand(-2.5, 2.5), rand(-1.5, 1.5), rand(-2.5, 2.5))), 0.7);
  }
}
function airburst(p, s) {
  FX.flash.spawn(p, { s0: 2.2 * s, s1: 3.8 * s, life: 0.15, a0: 1 });
  FX.smoke.spawn(p.clone(), { s0: 1.2 * s, s1: 3.6 * s, life: 2.4, a0: 0.6, color: 0x2e3034, v: new V3(-WAVE.flow * 0.6, 0.15, 0), drag: 0.6 });
}
function explosion(p, s) {
  FX.flash.spawn(p, { s0: 3.5 * s, s1: 6 * s, life: 0.22, a0: 1 });
  for (let i = 0; i < 5; i++) {
    const q = p.clone().add(new V3(rand(-1, 1), rand(-0.6, 0.8), rand(-1, 1)).multiplyScalar(s));
    FX.flash.spawn(q, { s0: 1.4 * s, s1: 3.2 * s, life: rand(0.35, 0.6), a0: 1, color: 0xff8a30 });
    FX.smoke.spawn(q.clone(), { s0: 1.4 * s, s1: 5 * s, life: rand(2.5, 4), a0: 0.75, color: 0x222222, v: new V3(rand(-1, 1) - WAVE.flow * 0.5, rand(0.3, 1), rand(-1, 1)), drag: 0.5 });
  }
  FX.lights.flash(p, 6, 0.35);
}
function sayKill(src, line) {
  if (!src) return;
  if (src instanceof Aircraft) src.say(line, { cat: 'combat', prio: 2 });
  else RADIO.say(src.radio || RADIO_NAMES.carrier, line, { role: 'ship', cat: 'combat', prio: 2 });
}
function damageEnemy(e, dmg, src) {
  FX.flash.spawn(e.p, { s0: 1.5, s1: 2.2, life: 0.1, a0: 1 });
  e.hp -= dmg;
  if (e.hp > 0) { if (e.kind === 'bandit' && !e.smoking && Math.random() < 0.35) enemySay(e.cs, ENEMY_LINES.damaged); e.smoking = true; return; }
  // the enemy side: a wingman reports the loss, or the pilot himself goes out
  const mate = e.kind !== 'vampire' && Math.random() < 0.5 && ENEMIES.find(o => o !== e && o.kind === e.kind && enemyAlive(o) && o.cs !== e.cs && (e.kind === 'boat' || (e.sq && o.sq === e.sq)));
  if (e.kind === 'bandit') {
    explosion(e.p, 1.3); e.falling = true; e.spin = rand(3, 6) * (Math.random() < 0.5 ? -1 : 1);
    sayKill(src, radioLine(COMBAT.splash));
    if (mate) enemySay(mate.cs, ENEMY_LINES.lost, { K: e.cs }, { delay: 1.2 }); else if (Math.random() < 0.4) enemySay(e.cs, ENEMY_LINES.eject, null, { delay: 0.6 });
    if (CFG.shake) camShake = Math.min(1, camShake + 0.25);
  } else if (e.kind === 'boat') {
    explosion(e.p, 0.9); e.falling = true; e.sinkT = 0;
    sayKill(src, radioLine(AIRWAR_LINES.boatKill));
    if (mate) enemySay(mate.cs, ENEMY_LINES.boatLost, { K: e.cs }, { delay: 1 });
  } else {
    explosion(e.p, 0.8); e.dead = true; scene.remove(e.mesh);
    if (Math.random() < 0.6) sayKill(src, radioLine(COMBAT.vampireDown));
  }
}
function shipImpact(e) {
  const s = e.tgt.ship, w = s.group.localToWorld(e.tgt.local.clone());
  explosion(w, 1.4);
  SHIP_FIRES.push({ ship: s, local: e.tgt.local.clone(), t: 14 });
  sayOnce('hit', 5, () => RADIO.say(s.radio || RADIO_NAMES.carrier, radioLine(COMBAT.shipHit), { role: 'ship', cat: 'combat', prio: 4 }));
  if (Math.random() < 0.6) { const b = ENEMIES.find(o => o.kind === 'bandit' && !o.duel && enemyAlive(o)); enemySay(b ? b.cs : ENEMY_NAMES.hq, ENEMY_LINES.shipHit, null, { delay: 1.4 }); }
  STRESS.bump(0.03);
  if (CFG.shake) camShake = 1;
}

/* ---- per-frame update ---- */
function updateCombat(dt) {
  const armed = AUD.armed && CFG.enemies && CFG.fire > 0;
  const st = STRESS.level;
  if (armed && AUD.fighting) {                // no new waves while the fleet holds after the music stopped
    const alive = ENEMIES.filter(e => e.kind === 'bandit' && !e.duel && enemyAlive(e)).length;   // dogfight bandits don't count
    banditTimer -= dt;
    if (banditTimer <= 0) {
      banditTimer = rand(9, 16) * (1 - 0.55 * st);
      if (alive < 2 + st * 5) spawnBandits(randi(1, 2 + Math.round(st * 2)));
    }
    vampTimer -= dt;
    if (vampTimer <= 0) { vampTimer = rand(14, 24) * (1 - 0.4 * st); if (st > 0.1 || Math.random() < 0.5) spawnVampireSalvo(randi(1, 1 + Math.round(st * 2))); }
  } else {
    if (!armed) { banditTimer = rand(1.5, 3); vampTimer = rand(10, 16); }
    // when the music stops (hold or stand-down), inbound missiles are intercepted / self-destruct
    for (const e of ENEMIES) if (e.kind === 'vampire' && !e.dead) { explosion(e.p, 0.6); e.dead = true; scene.remove(e.mesh); }
    for (const e of ENEMIES) if (e.kind === 'boat' && !e.retreat) { e.retreat = true; e.dir.set(e.p.x, 0, e.p.z).normalize(); e.speed = 9; }   // boats turn and run
  }
  if (armed) for (const m of ALL_CIWS) {
    if (m.burst > 0 || (m.cd || 0) > 0 || !m.track || m.track.kind !== 'vampire' || !enemyAlive(m.track)) continue;
    if (m.track.p.distanceTo(m.yawG.getWorldPosition(_al)) < 40) { m.burst = rand(0.35, 0.6); m.acc = 0; m.burstTarget = m.track; m.lastDitch = true; }
  }
  for (const e of ENEMIES) {
    if (e.dead) continue;
    e.age += dt;
    if (e.kind === 'bandit') {
      if (e.falling) {
        e.v.y -= 9 * dt; e.v.multiplyScalar(1 - 0.15 * dt); e.p.addScaledVector(e.v, dt);
        e.mesh.position.copy(e.p); e.mesh.rotateX(e.spin * dt);
        e.smokeT += dt; while (e.smokeT > 0.03) { e.smokeT -= 0.03; FX.smoke.spawn(e.p.clone(), { s0: 0.8, s1: 3, life: 2.5, a0: 0.7, color: 0x1e1e1e, v: new V3(-WAVE.flow, 0.4, 0) }); if (Math.random() < 0.5) FX.flash.spawn(e.p, { s0: 1, s1: 1.4, life: 0.08, a0: 0.9, color: 0xff7a20 }); }
        if (e.p.y < waveH(e.p.x, e.p.z)) { FX.splash.spawn(e.p, 1.8); explosion(e.p, 0.8); e.dead = true; scene.remove(e.mesh); }
        continue;
      }
      if (e.path) {                            // dogfight bandit: follows its pass, leaves the scene at the end
        e.ps += e.speed * dt; const s = e.path.sample(e.ps, e.smp);
        e.p.copy(s.pos); e.v.copy(s.dir).multiplyScalar(e.speed);
        if (e.ps >= e.path.length) { e.dead = e.escaped = true; scene.remove(e.mesh); continue; }
      } else e.p.addScaledVector(e.v, dt);
      e.mesh.position.copy(e.p); orientFrom(e.mesh, _al.copy(e.v).normalize(), e.path ? -e.smp.turn * 0.7 : 0.15 * Math.sin(e.age));
      if (e.smoking) { e.smokeT += dt; while (e.smokeT > 0.06) { e.smokeT -= 0.06; FX.smoke.spawn(e.p.clone(), { s0: 0.5, s1: 2, life: 1.8, a0: 0.5, color: 0x333333, v: new V3(-WAVE.flow, 0.3, 0) }); } }
      // bandits loose anti-ship missiles on their run in
      const dc = Math.hypot(e.p.x, e.p.z);
      if (armed && !e.fired && dc < 85 && dc > 50) { e.fired = true; if (Math.random() < ENEMY_TYPES[e.type].vamp + st * 0.25) {
        spawnVampire(e.p.clone()); if (Math.random() < 0.5) enemySay(e.cs, ENEMY_LINES.missile);
        sayOnce('vamp', 6, () => { const sh = pick(SHIPS.slice(1)); RADIO.say(sh.radio, radioLine(COMBAT.vampLaunch), { role: 'ship', cat: 'combat', prio: 3 }); });
      } }
      if (dc > 175 && e.age > 3) { e.dead = true; scene.remove(e.mesh); }
    } else if (e.kind === 'boat') {
      if (e.falling) {                         // burning, then down by the stern
        e.sinkT += dt; e.p.y -= dt * 0.12 * (1 + e.sinkT); e.mesh.position.copy(e.p); e.mesh.rotateZ(dt * 0.12);
        if (Math.random() < dt * 12) FX.smoke.spawn(e.p.clone(), { s0: 0.6, s1: 2.6, life: 2.2, a0: 0.6, color: 0x1e1e1e, v: new V3(-WAVE.flow, 0.6, 0) });
        if (e.sinkT > 4) { FX.splash.spawn(e.p, 0.8); e.dead = true; scene.remove(e.mesh); }
        continue;
      }
      // keep clear of the ships: inside a ship's circle the course turns away from it
      for (const s of SHIPS) { const dx = e.p.x - s.base.x, dz = e.p.z - s.base.z, r = s.len * 0.55 + 4; if (dx * dx + dz * dz < r * r) e.dir.lerp(_al.set(dx, 0, dz).normalize(), Math.min(1, dt * 1.5)).normalize(); }
      // speed through the water + the current (the sea flows past the fleet at WAVE.flow)
      e.v.copy(e.dir).multiplyScalar(e.speed); e.v.x -= WAVE.flow; e.p.addScaledVector(e.v, dt);
      e.p.y = waveH(e.p.x, e.p.z) - 0.05;
      e.mesh.position.copy(e.p); orientFrom(e.mesh, e.dir, 0.06 * Math.sin(e.age * 1.7));
      e.wakeT += dt; while (e.wakeT > 1 / 40) { e.wakeT -= 1 / 40; FX.foam.emit(e.p.x - e.dir.x * 0.8 + rand(-0.15, 0.15), e.p.z - e.dir.z * 0.8 + rand(-0.15, 0.15), rand(-0.4, 0.4) - e.dir.x * 0.5, rand(-0.4, 0.4) - e.dir.z * 0.5, rand(1.2, 2.2)); }
      if (e.smoking) { e.smokeT += dt; while (e.smokeT > 0.08) { e.smokeT -= 0.08; FX.smoke.spawn(e.p.clone(), { s0: 0.4, s1: 1.8, life: 1.6, a0: 0.5, color: 0x333333, v: new V3(-WAVE.flow, 0.4, 0) }); } }
      if (Math.hypot(e.p.x, e.p.z) > 160 && e.age > 3) { e.dead = true; scene.remove(e.mesh); }
    } else {                                   // vampire: descend to sea-skimming height and run at a ship
      const tw = e.tgt.ship.group.localToWorld(e.tgt.local.clone());
      const to = tw.sub(e.p), d = to.length();
      const desired = to.normalize().multiplyScalar(e.speed);
      if (d > 20) desired.y = (1.4 - e.p.y) * 2;
      e.v.lerp(desired, Math.min(1, dt * 2)); e.p.addScaledVector(e.v, dt);
      e.mesh.position.copy(e.p); orientFrom(e.mesh, _al.copy(e.v).normalize(), 0);
      e.smokeT += dt; while (e.smokeT > 0.04) { e.smokeT -= 0.04; FX.smoke.spawn(e.p.clone(), { s0: 0.3, s1: 1.4, life: 1.4, a0: 0.45, smoke: true, v: new V3(-WAVE.flow, 0.2, 0) }); }
      if (d < 1.6) { shipImpact(e); e.dead = true; scene.remove(e.mesh); }
    }
  }
  for (let i = ENEMIES.length - 1; i >= 0; i--) if (ENEMIES[i].dead) ENEMIES.splice(i, 1);
  resolveHits(false);
  for (let i = SHIP_FIRES.length - 1; i >= 0; i--) {
    const f = SHIP_FIRES[i]; f.t -= dt;
    if (f.t <= 0) { SHIP_FIRES.splice(i, 1); continue; }
    const w = f.ship.group.localToWorld(f.local.clone());
    if (Math.random() < dt * 14) FX.smoke.spawn(w.clone(), { s0: 0.8, s1: 3.6, life: 3, a0: 0.6 * Math.min(1, f.t / 4), color: 0x262626, v: new V3(-WAVE.flow * 1.2, rand(0.8, 1.6), 0) });
    if (Math.random() < dt * 10) FX.flash.spawn(w, { s0: 0.9, s1: 1.4, life: 0.12, a0: 0.9 * Math.min(1, f.t / 4), color: 0xff7a20 });
  }
}
