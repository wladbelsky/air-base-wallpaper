'use strict';
/* ===== Enemies and beat-synced hits =====
   kinds: bandit (fighters, attack jets, bombers), cruise (low-flying cruise missiles at the base), ballistic (TBMs from
   high above, Patriot targets), heli (attack helicopters), armor (ground columns that drive up to the fence and fire).
   Weapons pick real targets; a projectile that reaches its target is resolved on the NEXT beat of the music (with a
   short fallback), so kills land on the rhythm.                                                                    */
const ENEMIES = [], PENDING = [], BASE_FIRES = [];
let banditTimer = 6, cruiseTimer = 14, ballisticTimer = 40, armorTimer = 12;
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

/* Bandit types (models in airframes.js). A wave is one flight of one type; the newer fighters and the heavy bombers
   show up more often as stress builds. missile = chance to loose a cruise missile on the run in; bombs = a bomber,
   it drops a stick on a base structure (n bombs). */
const ENEMY_TYPES = {
  su25: { name: 'Su-25 Frogfoot', build: buildSu25, speed: [14, 18], alt: [8, 13], hp: 3, missile: 0.2, bombs: 4, w: st => 1.2 - st },   // slow, armoured attack jet
  su35: { name: 'Su-35 Flanker', build: buildSu35, speed: [22, 27], alt: [16, 24], hp: 2, missile: 0.3, w: () => 1 },
  su47: { name: 'Su-47 Berkut', build: buildSu47, speed: [25, 30], alt: [18, 26], hp: 2, missile: 0.2, w: st => 0.15 + st * 0.6 },
  su57: { name: 'Su-57 Felon', build: buildSu57, speed: [26, 31], alt: [18, 26], hp: 2, missile: 0.35, w: st => 0.25 + st * 1.2 },
  su34: { name: 'Su-34 Fullback', build: buildSu34, speed: [17, 21], alt: [12, 17], hp: 3, missile: 0.25, bombs: 6, scale: 1.3, w: st => 0.35 + st * 0.6, bomber: true },
  tu22: { name: 'Tu-22M3 Backfire', build: buildTu22, speed: [20, 23], alt: [26, 32], hp: 4, missile: 0.5, bombs: 10, scale: 1.5, w: st => st > 0.3 ? 0.2 + st * 0.7 : 0.02, bomber: true, single: true }
};
const HELI_TYPES = { ka52: { name: 'Ka-52 Alligator', build: buildKa52, hp: 2 }, mi24: { name: 'Mi-24 Hind', build: buildMi24, hp: 3 } };
const ARMOR_TYPES = { t90: { name: 'T-90', build: buildT90, hp: 3, speed: 2.6 }, bmp: { name: 'BMP-3', build: buildBMP, hp: 2, speed: 3.2 }, btr: { name: 'BTR-82', build: buildBTR, hp: 2, speed: 3.6 } };
function buildCruise() {
  const g = new THREE.Group();
  tube(g, -0.4, 0.35, 0.06, 0.06, 0x8a9088, 0, 0, 6); noseCone(g, 0.35, 0, 0.06, 0.16, 0x7a8078);
  pair(g, [[0.05, 0.05], [-0.05, 0.38], [-0.12, 0.38], [-0.1, 0.05]], -0.02, 0.012, 0x7a8078);
  for (let i = 0; i < 3; i++) { const f = box(g, 0.12, 0.012, 0.14, 0x7a8078, -0.36, 0, 0); f.rotation.x = i * Math.PI * 2 / 3; }
  glowSprite(g, -0.45, 0, 0, 0.6, 0xffc080).material.opacity = 1;
  mergeStatic(g, []); return g;
}
function buildBallistic() {
  const g = new THREE.Group();
  tube(g, -0.8, 0.5, 0.11, 0.11, 0xc8ccc8, 0, 0, 8); noseCone(g, 0.5, 0, 0.11, 0.4, 0x6a6e6a, 8);
  for (let i = 0; i < 4; i++) { const f = box(g, 0.22, 0.012, 0.3, 0x6a6e6a, -0.7, 0, 0); f.rotation.x = i * Math.PI / 2; }
  glowSprite(g, -0.95, 0, 0, 1.4, 0xffd090).material.opacity = 1;
  mergeStatic(g, []); return g;
}
/* Enemy models are built once; every enemy is a clone sharing geometry and materials, so spawning
   allocates no GPU buffers and removed enemies leave nothing behind. */
const ENEMY_MODELS = {};
function enemyMesh(key) {     // 'cruise', 'ballistic' or an ENEMY_TYPES / HELI_TYPES / ARMOR_TYPES key
  const tpl = ENEMY_MODELS[key] || (ENEMY_MODELS[key] = key === 'cruise' ? buildCruise() : key === 'ballistic' ? buildBallistic() : (ENEMY_TYPES[key] || HELI_TYPES[key] || ARMOR_TYPES[key]).build());
  return tpl.clone();
}

/* ---- spawning ---- */
function bearingWords(h) {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
  const deg = Math.round(((90 + h / DEG) % 360 + 360) % 360 / 10) * 10 % 360;
  return String(deg).padStart(3, '0').split('').map(d => words[+d]).join('-');
}
function compassWord(h) { return ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][Math.round(((h / DEG) % 360 + 360) % 360 / 45) % 8]; }
function hq() { const aw = AIRCRAFT.find(a => a.isAwacs && a.airborne); return aw ? [aw.callsign, 'awacs'] : [RADIO_NAMES.tower, 'tower']; }
const baseTarget = () => pick(BASE.targets);

const pickEnemyType = () => wpick(Object.keys(ENEMY_TYPES).map(k => ({ k, w: Math.max(0.02, ENEMY_TYPES[k].w(STRESS.level)) }))).k;
function spawnBandits(n) {
  const type = pickEnemyType(), ty = ENEMY_TYPES[type]; if (ty.single) n = Math.min(n, 2);
  const sq = freeSquadron(); lastWaveT = T;
  const h = rand(0, TAU), perp = new V3(-Math.sin(h), 0, Math.cos(h));
  const tgt = ty.bombs ? baseTarget().p : null;
  const pass = tgt ? new V3(tgt.x, 0, tgt.z) : new V3(rand(-22, 22), 0, rand(-26, 18)), alt = rand(ty.alt[0], ty.alt[1]), speed = rand(ty.speed[0], ty.speed[1]);
  for (let i = 0; i < n; i++) {
    const p = new V3(Math.cos(h) * 135, alt + rand(-1.5, 1.5), Math.sin(h) * 135).addScaledVector(perp, (i - (n - 1) / 2) * 6);
    p.addScaledVector(new V3(Math.cos(h), 0, Math.sin(h)), i * 5);
    const target = pass.clone().addScaledVector(perp, (i - (n - 1) / 2) * (ty.bombs ? 3 : 6)); target.y = p.y;
    const v = target.clone().sub(p).normalize().multiplyScalar(speed);
    const mesh = enemyMesh(type); mesh.scale.setScalar(1.25 * (ty.scale || 1)); scene.add(mesh);
    ENEMIES.push({ kind: 'bandit', type, mesh, p, v, hp: ty.hp, age: 0, fired: false, smokeT: 0, sq, cs: `${sq} ${i + 1}`, bombAt: ty.bombs ? target.setY(0) : null, bombs: ty.bombs || 0 });
  }
  const [who, role] = hq(), vars = { B: bearingWords(h), D: compassWord(h), T: ty.name, N: n === 1 ? 'a single bandit' : n === 2 ? 'two bandits' : n === 3 ? 'three bandits' : 'multiple bandits' };
  RADIO.say(who, radioLine(ty.bomber ? COMBAT.bombers : COMBAT.newBandits, vars), { role, cat: 'combat', prio: 2 });
  if (Math.random() < 0.55) enemySay(`${sq} 1`, ty.bomber ? ENEMY_LINES.bombRun : ENEMY_LINES.attack, { Q: sq }, { delay: 1.5 });
}
/* dogfight bandit: flies a screen pass (js/airwar.js) ahead of or behind our fighters; never attacks the base */
function spawnDuelBandit(type, path, ps, speed) {
  const mesh = enemyMesh(type); mesh.scale.setScalar(1.25 * (ENEMY_TYPES[type].scale || 1)); scene.add(mesh);
  const s = path.sample(ps);
  const e = { kind: 'bandit', duel: true, type, mesh, p: s.pos, v: s.dir.clone().multiplyScalar(speed), hp: ENEMY_TYPES[type].hp, age: 0, fired: true, smokeT: 0, cs: `${freeSquadron()} ${randi(1, 4)}`, path, ps, speed, smp: { pos: new V3(), dir: new V3(), turn: 0, R: 1 } };
  mesh.position.copy(e.p); orientFrom(mesh, s.dir, 0);   // placed now: it spawns after this step's updateCombat
  ENEMIES.push(e); return e;
}
const fighterDuelType = () => { let k; do k = pickEnemyType(); while (ENEMY_TYPES[k].bomber); return k; };
/* p is inside the fence or within r of it */
const _cv = new V3();
const nearFence = (p, r) => { for (let k = 0; k < 8; k++) if (insideFence(p.x + Math.cos(k * Math.PI / 4) * r, p.z + Math.sin(k * Math.PI / 4) * r)) return true; return insideFence(p.x, p.z); };
/* an armoured column: off-screen, driving in along `dir` to a stop line outside the fence, then firing at the base */
function spawnArmor(p, dir, type, stopAt, sq, i) {
  const ty = ARMOR_TYPES[type], mesh = enemyMesh(type); scene.add(mesh);
  // the stop well outside the fence (its corners and the approach-light annex reach out), and the way there clear of it
  const back = dir.clone().setY(0).normalize().negate();
  for (let k = 0; k < 80 && nearFence(stopAt, 7); k++) stopAt.addScaledVector(back, 1);
  const go = stopAt.clone().sub(p).setY(0), L = go.length(); go.divideScalar(L || 1);
  for (let t = 0; t < L; t += 1) if (nearFence(_cv.copy(p).addScaledVector(go, t), 3)) { stopAt.copy(p).addScaledVector(go, Math.max(0, t - 2)); break; }
  // heading straight for the stop: the line checked above is the way it drives (turning in from `dir` it would cut a
  // corner of the fence)
  const e = { kind: 'armor', ground: true, type, mesh, p: p.clone(), dir: L > 0.6 ? go.clone() : dir.clone().setY(0).normalize(), speed: ty.speed * rand(0.9, 1.1), v: new V3(), hp: ty.hp, age: 0, smokeT: 0, dustT: 0,
    stopAt, fireT: rand(2, 5), cs: `${sq} ${i + 1}`, sq, turret: mesh.getObjectByName('turret') };
  mesh.position.copy(e.p); orientFrom(mesh, e.dir, 0);
  ENEMIES.push(e); return e;
}
/* how far the fence is from the base centre along the unit vector u (ground columns stop outside it) */
function fenceRadius(u) { let r = 120; while (r > 0 && !insideFence(u.x * r, u.z * r)) r -= 1; return r + 1; }
/* the direction a column comes from: down the road to the gate, or across country from the west / south / east */
function spawnColumn(meetPos) {
  const st = STRESS.level, sq = pick(ENEMY_NAMES.armor);
  let from, dir;
  if (meetPos) { dir = new V3(-meetPos.x, 0, -meetPos.z).normalize(); from = meetPos; }
  else if (Math.random() < 0.45 && BASE_LAYOUT.gatePos) { const g = BASE_LAYOUT.gatePos, o = BASE_LAYOUT.gateOut; dir = o.clone().negate(); from = g.clone().addScaledVector(o, 22); }
  else { const a = pick([180, 150, 120, 215, 245, 60, 30]) * DEG + rand(-0.15, 0.15); dir = new V3(-Math.cos(a), 0, Math.sin(a)); from = new V3(Math.cos(a) * 92, 0, -Math.sin(a) * 92); }
  const n = randi(2, 3 + Math.round(st * 2)), perp = new V3(-dir.z, 0, dir.x), list = [];
  for (let i = 0; i < n; i++) {
    const stop = from.clone().addScaledVector(perp, (i - (n - 1) / 2) * 3.5).addScaledVector(dir, -rand(0, 4));
    const p = stop.clone().addScaledVector(dir, -(40 + i * 6));
    for (let k = 0; k < 30 && AIRWAR.onScreen(p, 0.1); k++) p.addScaledVector(dir, -4);   // never pop up on screen
    list.push(spawnArmor(p, dir, i === 0 || Math.random() < 0.4 ? 't90' : pick(['bmp', 'btr']), stop, sq, i));
  }
  if (Math.random() < 0.25 + st * 0.5) spawnHeli(from.clone().addScaledVector(dir, -50).setY(rand(5, 8)), dir, from);
  const h = Math.atan2(-dir.z, -dir.x);
  sayOnce('armor', 18, () => { RADIO.say(RADIO_NAMES.armor, radioLine(COMBAT.armor, { B: bearingWords(h), D: compassWord(h) }), { role: 'ground', cat: 'combat', prio: 2 }); });
  if (Math.random() < 0.5) enemySay(list[0].cs, ENEMY_LINES.armor, null, { delay: 1.6 });
  return list;
}
/* attack helicopter: low, slow, comes in with the armour and hovers near its stop line, firing rockets at the fence */
function spawnHeli(p, dir, hold, type) {
  type = type || pick(Object.keys(HELI_TYPES));
  const mesh = enemyMesh(type); mesh.scale.setScalar(1.25); scene.add(mesh);
  for (let k = 0; k < 30 && AIRWAR.onScreen(p, 0.1); k++) p.addScaledVector(dir, -4);
  const e = { kind: 'heli', type, mesh, p: p.clone(), v: dir.clone().multiplyScalar(7), hp: HELI_TYPES[type].hp, age: 0, smokeT: 0, hold: hold.clone().setY(p.y), fireT: rand(3, 6), ph: rand(0, 6),
    cs: `${freeSquadron()} ${randi(1, 4)}`, rotors: ['rotor', 'rotor2', 'trotor'].map(n => mesh.getObjectByName(n)).filter(Boolean) };
  mesh.position.copy(e.p); orientFrom(mesh, dir, 0);
  ENEMIES.push(e); return e;
}
function spawnCruise(from) {
  const t = baseTarget(), mesh = enemyMesh('cruise'); mesh.scale.setScalar(1.3); scene.add(mesh);
  ENEMIES.push({ kind: 'cruise', mesh, p: from.clone(), v: t.p.clone().sub(from).setY(0).normalize().multiplyScalar(26), hp: 1, age: 0, tgt: t, speed: rand(24, 30), smokeT: 0 });
}
function spawnCruiseSalvo(n) {
  const h = rand(0, TAU);
  for (let i = 0; i < n; i++) spawnCruise(new V3(Math.cos(h) * 130 + rand(-6, 6), 3, Math.sin(h) * 130 + rand(-6, 6)));
  sayOnce('cruise', 6, () => RADIO.say(RADIO_NAMES.tower, radioLine(COMBAT.cruise, { B: bearingWords(h), D: compassWord(h) }), { role: 'tower', cat: 'combat', prio: 3 }));
  if (Math.random() < 0.4) enemySay(ENEMY_NAMES.hq, ENEMY_LINES.salvo);
}
/* ballistic missiles: coming down steeply out of the sky onto a base structure */
function spawnBallistic(n) {
  const h = rand(0, TAU);
  for (let i = 0; i < n; i++) {
    const t = baseTarget(), mesh = enemyMesh('ballistic'); mesh.scale.setScalar(1.3); scene.add(mesh);
    const from = t.p.clone().add(new V3(Math.cos(h) * 70 + rand(-8, 8), 110 + i * 12, Math.sin(h) * 70 + rand(-8, 8)));
    ENEMIES.push({ kind: 'ballistic', mesh, p: from, v: t.p.clone().sub(from).normalize().multiplyScalar(40), hp: 1, age: 0, tgt: t, speed: 40, smokeT: 0 });
  }
  sayOnce('ballistic', 10, () => RADIO.say(RADIO_NAMES.patriot, radioLine(COMBAT.ballistic, { B: bearingWords(h), D: compassWord(h) }), { role: 'ground', cat: 'combat', prio: 3 }));
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
  m.tPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), m.pmin, m.kind === 'ciws' ? 1.45 : m.pmax);
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
    else if (h.e.ground) groundHit(h.e.p.clone().add(new V3(rand(-2.5, 2.5), 0, rand(-2.5, 2.5))), 1);
    else airburst(h.e.p.clone().add(new V3(rand(-2.5, 2.5), rand(-1.5, 1.5), rand(-2.5, 2.5))), 0.7);
  }
}
const drift = (k, up) => new V3(WIND.x * k, up, WIND.z * k);
function airburst(p, s) {
  FX.flash.spawn(p, { s0: 2.2 * s, s1: 3.8 * s, life: 0.15, a0: 1 });
  FX.smoke.spawn(p.clone(), { s0: 1.2 * s, s1: 3.6 * s, life: 2.4, a0: 0.6, color: 0x2e3034, v: drift(0.6, 0.15), drag: 0.6 });
}
function explosion(p, s) {
  FX.flash.spawn(p, { s0: 3.5 * s, s1: 6 * s, life: 0.22, a0: 1 });
  for (let i = 0; i < 5; i++) {
    const q = p.clone().add(new V3(rand(-1, 1), rand(-0.6, 0.8), rand(-1, 1)).multiplyScalar(s));
    FX.flash.spawn(q, { s0: 1.4 * s, s1: 3.2 * s, life: rand(0.35, 0.6), a0: 1, color: 0xff8a30 });
    FX.smoke.spawn(q.clone(), { s0: 1.4 * s, s1: 5 * s, life: rand(2.5, 4), a0: 0.75, color: 0x222222, v: new V3(rand(-1, 1) + WIND.x * 0.5, rand(0.3, 1), rand(-1, 1) + WIND.z * 0.5), drag: 0.5 });
  }
  FX.lights.flash(p, 6, 0.35);
}
/* a shell, rocket or bomb hitting the ground: dust (in the season's colour), a flash for the big ones, a scorch mark */
function groundHit(p, big) {
  const y = groundH(p.x, p.z), at = new V3(p.x, y + 0.2, p.z);
  if (big < 0.5) { if (Math.random() < 0.35) FX.smoke.spawn(at, { s0: 0.4, s1: 1.2, life: 1.0, a0: 0.35, color: ENV.dustTint, v: drift(0.6, 0.6), drag: 0.8 }); return; }   // bullets: a little dust
  if (big >= 1.5) explosion(at, big * 0.6); else FX.flash.spawn(at, { s0: 1.2 * big, s1: 2 * big, life: 0.1, a0: 0.9 });
  for (let i = 0; i < 2 + Math.round(big); i++) FX.smoke.spawn(at.clone().add(new V3(rand(-0.4, 0.4), 0.2, rand(-0.4, 0.4))), { s0: big * 0.9, s1: big * 2.8, life: rand(1.4, 2.2), a0: 0.5, color: ENV.dustTint, v: drift(0.8, rand(0.8, 1.6)), drag: 0.8 });
  if (big >= 0.9) FX.scorch.spawn(at, big * 0.9);
}
function sayKill(src, line) {
  if (!src) return;
  if (src instanceof Aircraft) src.say(line, { cat: 'combat', prio: 2 });
  else RADIO.say(src.radio || RADIO_NAMES.tower, line, { role: 'ground', cat: 'combat', prio: 2 });
}
function damageEnemy(e, dmg, src) {
  FX.flash.spawn(e.p, { s0: 1.5, s1: 2.2, life: 0.1, a0: 1 });
  e.hp -= dmg;
  if (e.hp > 0) { if ((e.kind === 'bandit' || e.kind === 'heli') && !e.smoking && Math.random() < 0.35) enemySay(e.cs, ENEMY_LINES.damaged); e.smoking = true; return; }
  // the enemy side: a wingman reports the loss, or the pilot himself goes out
  const mate = (e.kind === 'bandit' || e.kind === 'armor') && Math.random() < 0.5 && ENEMIES.find(o => o !== e && o.kind === e.kind && enemyAlive(o) && o.cs !== e.cs && e.sq && o.sq === e.sq);
  if (e.kind === 'bandit' || e.kind === 'heli') {
    explosion(e.p, 1.3); e.falling = true; e.spin = rand(3, 6) * (Math.random() < 0.5 ? -1 : 1);
    sayKill(src, radioLine(COMBAT.splash));
    if (mate) enemySay(mate.cs, ENEMY_LINES.lost, { K: e.cs }, { delay: 1.2 }); else if (Math.random() < 0.4) enemySay(e.cs, ENEMY_LINES.eject, null, { delay: 0.6 });
    if (CFG.shake) camShake = Math.min(1, camShake + 0.25);
  } else if (e.kind === 'armor') {
    explosion(e.p.clone().setY(0.6), 1.0); e.falling = true; e.burnT = 0; FX.scorch.spawn(e.p, 1.6, 60);
    sayKill(src, radioLine(AIRWAR_LINES.armorKill));
    if (mate) enemySay(mate.cs, ENEMY_LINES.armorLost, { K: e.cs }, { delay: 1 });
  } else {
    explosion(e.p, e.kind === 'ballistic' ? 1.6 : 0.8); e.dead = true; scene.remove(e.mesh);
    if (Math.random() < 0.6) sayKill(src, radioLine(e.kind === 'ballistic' ? COMBAT.ballisticDown : COMBAT.missileDown));
  }
}
/* something got through: an impact on the base — explosion, scorch, a fire on the structure for a while */
function baseImpact(p, s, name) {
  explosion(p, s); FX.scorch.spawn(p, 2.2 * s, 90);
  BASE_FIRES.push({ p: p.clone(), t: 14 + s * 6, name: name || 'BASE' });
  sayOnce('hit', 5, () => RADIO.say(RADIO_NAMES.tower, radioLine(COMBAT.baseHit), { role: 'tower', cat: 'combat', prio: 4 }));
  if (Math.random() < 0.6) { const b = ENEMIES.find(o => o.kind === 'bandit' && !o.duel && enemyAlive(o)); enemySay(b ? b.cs : ENEMY_NAMES.hq, ENEMY_LINES.baseHit, null, { delay: 1.4 }); }
  STRESS.bump(0.03);
  if (CFG.shake) camShake = 1;
}
/* bombs (ours on armour, theirs on the base) are tracers with gravity; the impact comes through Tracers.onSplash */
function dropBombStick(e, n) {
  for (let i = 0; i < n; i++) {
    const p = e.p.clone(); p.y -= 0.4;
    const v = e.v.clone().multiplyScalar(0.92); v.x += rand(-0.6, 0.6); v.z += rand(-0.6, 0.6);
    FX.tracers.spawn(p.addScaledVector(e.v, -i * 0.11), v, { life: 6, len: 0.5, w: 0.16, color: 0x3a3c38, grav: 9.8, splash: 2.4 });
  }
}

/* ---- per-frame update ---- */
function updateCombat(dt) {
  const armed = AUD.armed && CFG.enemies && CFG.fire > 0;
  const st = STRESS.level;
  if (armed && AUD.fighting) {                // no new waves while the base holds after the music stopped
    const alive = ENEMIES.filter(e => e.kind === 'bandit' && !e.duel && enemyAlive(e)).length;   // dogfight bandits don't count
    if ((banditTimer -= dt) <= 0) { banditTimer = rand(9, 16) * (1 - 0.55 * st); if (alive < 2 + st * 5) spawnBandits(randi(1, 2 + Math.round(st * 2))); }
    if ((cruiseTimer -= dt) <= 0) { cruiseTimer = rand(14, 24) * (1 - 0.4 * st); if (st > 0.1 || Math.random() < 0.5) spawnCruiseSalvo(randi(1, 1 + Math.round(st * 2))); }
    if ((ballisticTimer -= dt) <= 0) { ballisticTimer = rand(35, 60) * (1 - 0.4 * st); if (st > 0.2 || Math.random() < 0.3) spawnBallistic(randi(1, 1 + Math.round(st * 2))); }
    if ((armorTimer -= dt) <= 0) { armorTimer = rand(28, 50) * (1 - 0.35 * st); if (ENEMIES.filter(e => e.kind === 'armor' && enemyAlive(e)).length < 4 + st * 6) spawnColumn(); }
  } else {
    if (!armed) { banditTimer = rand(1.5, 3); cruiseTimer = rand(10, 16); ballisticTimer = rand(30, 50); armorTimer = rand(8, 14); }
    // when the music stops (hold or stand-down), inbound missiles are intercepted / self-destruct, the ground units pull back
    for (const e of ENEMIES) if ((e.kind === 'cruise' || e.kind === 'ballistic') && !e.dead) { explosion(e.p, 0.6); e.dead = true; scene.remove(e.mesh); }
    for (const e of ENEMIES) if ((e.kind === 'armor' || e.kind === 'heli') && !e.retreat) { e.retreat = true; e.dir = new V3(e.p.x, 0, e.p.z).normalize(); }
  }
  if (armed) for (const m of ALL_CIWS) {
    if (m.burst > 0 || (m.cd || 0) > 0 || !m.track || m.track.kind !== 'cruise' || !enemyAlive(m.track)) continue;
    if (m.track.p.distanceTo(m.yawG.getWorldPosition(_al)) < 40) { m.burst = rand(0.35, 0.6); m.acc = 0; m.burstTarget = m.track; m.lastDitch = true; }
  }
  for (const e of ENEMIES) {
    if (e.dead) continue;
    e.age += dt;
    // they only attack while the fight is on: nothing new is launched or dropped in the hold after the music stopped
    const attack = armed && AUD.fighting;
    if (e.kind === 'bandit') updateBandit(e, dt, attack, st);
    else if (e.kind === 'heli') updateHeli(e, dt, attack);
    else if (e.kind === 'armor') updateArmor(e, dt, attack);
    else {                                     // cruise: low level, terrain hugging, at a structure; ballistic: straight down
      const tw = e.tgt.p, to = tw.clone().sub(e.p), d = to.length();
      const desired = to.normalize().multiplyScalar(e.speed);
      if (e.kind === 'cruise' && d > 14) desired.y = (3 - e.p.y) * 2;
      if (e.kind === 'ballistic') { e.speed = Math.min(70, e.speed + dt * 6); e.v.copy(desired); } else e.v.lerp(desired, Math.min(1, dt * 2));
      e.p.addScaledVector(e.v, dt);
      e.mesh.position.copy(e.p); orientFrom(e.mesh, _al.copy(e.v).normalize(), 0);
      const iv = e.kind === 'ballistic' ? 0.025 : 0.04;
      e.smokeT += dt; while (e.smokeT > iv) { e.smokeT -= iv; FX.smoke.spawn(e.p.clone(), e.kind === 'ballistic' ? { s0: 0.6, s1: 2.6, life: 2.4, a0: 0.55, smoke: true, v: drift(0.4, 0.1) } : { s0: 0.3, s1: 1.4, life: 1.4, a0: 0.45, smoke: true, v: drift(1, 0.2) }); }
      if (d < 1.6 || e.p.y < groundH(e.p.x, e.p.z)) { baseImpact(tw, e.kind === 'ballistic' ? 1.8 : 1.3, e.tgt.name); e.dead = true; scene.remove(e.mesh); }
    }
  }
  for (let i = ENEMIES.length - 1; i >= 0; i--) if (ENEMIES[i].dead) ENEMIES.splice(i, 1);
  resolveHits(false);
  for (let i = BASE_FIRES.length - 1; i >= 0; i--) {
    const f = BASE_FIRES[i]; f.t -= dt;
    if (f.t <= 0) { BASE_FIRES.splice(i, 1); continue; }
    if (Math.random() < dt * 14) FX.smoke.spawn(f.p.clone(), { s0: 0.8, s1: 3.6, life: 3, a0: 0.6 * Math.min(1, f.t / 4), color: 0x262626, v: drift(1.2, rand(0.8, 1.6)) });
    if (Math.random() < dt * 10) FX.flash.spawn(f.p, { s0: 0.9, s1: 1.4, life: 0.12, a0: 0.9 * Math.min(1, f.t / 4), color: 0xff7a20 });
  }
}
function fallStep(e, dt) {          // shot-down aircraft: spinning down in smoke until it hits the ground
  e.v.y -= 9 * dt; e.v.multiplyScalar(1 - 0.15 * dt); e.p.addScaledVector(e.v, dt);
  e.mesh.position.copy(e.p); e.mesh.rotateX(e.spin * dt);
  e.smokeT += dt; while (e.smokeT > 0.03) { e.smokeT -= 0.03; FX.smoke.spawn(e.p.clone(), { s0: 0.8, s1: 3, life: 2.5, a0: 0.7, color: 0x1e1e1e, v: drift(1, 0.4) }); if (Math.random() < 0.5) FX.flash.spawn(e.p, { s0: 1, s1: 1.4, life: 0.08, a0: 0.9, color: 0xff7a20 }); }
  if (e.p.y < groundH(e.p.x, e.p.z)) { groundHit(e.p, 2.2); e.dead = true; scene.remove(e.mesh); }
}
function updateBandit(e, dt, armed, st) {
  if (e.falling) { fallStep(e, dt); return; }
  if (e.path) {                            // dogfight bandit: follows its pass, leaves the scene at the end
    e.ps += e.speed * dt; const s = e.path.sample(e.ps, e.smp);
    e.p.copy(s.pos); e.v.copy(s.dir).multiplyScalar(e.speed);
    if (e.ps >= e.path.length) { e.dead = e.escaped = true; scene.remove(e.mesh); return; }
  } else e.p.addScaledVector(e.v, dt);
  e.mesh.position.copy(e.p); orientFrom(e.mesh, _al.copy(e.v).normalize(), e.path ? -e.smp.turn * 0.7 : 0.15 * Math.sin(e.age));
  if (e.smoking) { e.smokeT += dt; while (e.smokeT > 0.06) { e.smokeT -= 0.06; FX.smoke.spawn(e.p.clone(), { s0: 0.5, s1: 2, life: 1.8, a0: 0.5, color: 0x333333, v: drift(1, 0.3) }); } }
  const dc = Math.hypot(e.p.x, e.p.z), ty = ENEMY_TYPES[e.type];
  // bombers (and attack jets) drop their stick when they get over the target; the others may loose a cruise missile on the run in
  if (armed && e.bombAt && e.bombs > 0) {
    const t = Math.sqrt(2 * e.p.y / 9.8), ahead = e.bombAt.clone().sub(e.p).setY(0), along = ahead.dot(_al.copy(e.v).setY(0).normalize());
    if (along < e.v.length() * t && along > -4) { dropBombStick(e, e.bombs); e.bombs = 0; if (Math.random() < 0.5) enemySay(e.cs, ENEMY_LINES.bombRun); }
  }
  if (armed && !e.fired && dc < 85 && dc > 50) { e.fired = true; if (Math.random() < ty.missile + st * 0.25) {
    spawnCruise(e.p.clone()); if (Math.random() < 0.5) enemySay(e.cs, ENEMY_LINES.missile);
    sayOnce('cruise', 6, () => RADIO.say(RADIO_NAMES.cram, radioLine(COMBAT.missileLaunch), { role: 'ground', cat: 'combat', prio: 3 }));
  } }
  if (dc > 175 && e.age > 3) { e.dead = true; scene.remove(e.mesh); }
}
function updateHeli(e, dt, armed) {
  for (const r of e.rotors) r.rotation[r.name === 'trotor' ? 'z' : 'y'] += dt * (r.name === 'rotor2' ? -30 : 30);
  if (e.falling) { fallStep(e, dt); return; }
  // fly to the hold point, then hover and weave there (facing the base), rockets at the fence now and then
  const to = (e.retreat ? _al.set(e.p.x, 0, e.p.z).normalize().multiplyScalar(200).setY(e.p.y) : e.hold.clone().add(_al.set(Math.sin(e.age * 0.4 + e.ph) * 6, Math.sin(e.age * 0.7) * 0.8, Math.cos(e.age * 0.3 + e.ph) * 4))).sub(e.p);
  const d = to.length(), want = to.normalize().multiplyScalar(Math.min(e.retreat ? 9 : 7, d * 0.5));
  e.v.lerp(want, Math.min(1, dt * 1.2)); e.p.addScaledVector(e.v, dt);
  const face = d > 6 || e.retreat ? _al.copy(e.v).setY(0) : _al.set(-e.p.x, 0, -e.p.z);
  if (face.lengthSq() > 1e-4) orientFrom(e.mesh, face.normalize(), -e.v.dot(_cpo.set(-face.z, 0, face.x)) * 0.04);
  e.mesh.position.copy(e.p); e.mesh.rotateZ(-clamp(e.v.length() / 7, 0, 1) * 0.12);
  if (e.smoking) { e.smokeT += dt; while (e.smokeT > 0.08) { e.smokeT -= 0.08; FX.smoke.spawn(e.p.clone(), { s0: 0.4, s1: 1.6, life: 1.6, a0: 0.5, color: 0x333333, v: drift(1, 0.3) }); } }
  if (armed && !e.retreat && d < 10 && (e.fireT -= dt) <= 0) {
    e.fireT = rand(4, 8);
    const aim = new V3(e.p.x * 0.75, 0, e.p.z * 0.75);
    for (let i = 0; i < 4; i++) { const v = aim.clone().add(new V3(rand(-3, 3), 0, rand(-3, 3))).sub(e.p).normalize().multiplyScalar(40); FX.tracers.spawn(e.p.clone(), v, { life: 3, len: 0.9, w: 0.2, color: 0xffd0a0, splash: 0.9 }); }
    if (Math.random() < 0.3) enemySay(e.cs, ENEMY_LINES.heli);
  }
  if (Math.hypot(e.p.x, e.p.z) > 170 && e.age > 3) { e.dead = true; scene.remove(e.mesh); }
}
function updateArmor(e, dt, armed) {
  if (e.falling) {                           // knocked out: burns, then the wreck is removed
    e.burnT += dt;
    if (Math.random() < dt * 10 * Math.max(0.2, 1 - e.burnT / 20)) FX.smoke.spawn(e.p.clone().setY(0.8), { s0: 0.6, s1: 3, life: 3, a0: 0.6, color: 0x1e1e1e, v: drift(1, 0.8) });
    if (e.burnT < 6 && Math.random() < dt * 6) FX.flash.spawn(e.p.clone().setY(0.6), { s0: 0.7, s1: 1.1, life: 0.1, a0: 0.9, color: 0xff7a20 });
    if (e.burnT > 24) { e.dead = true; scene.remove(e.mesh); }
    return;
  }
  const toStop = e.stopAt.clone().sub(e.p).setY(0), d = toStop.length();
  let speed = e.speed;
  if (e.retreat) { e.dir.lerp(_al.set(e.p.x, 0, e.p.z).normalize(), Math.min(1, dt)).normalize(); }
  else if (d < 0.6) speed = 0;
  else e.dir.lerp(toStop.normalize(), Math.min(1, dt * 0.6)).normalize();
  e.v.copy(e.dir).multiplyScalar(speed); e.p.addScaledVector(e.v, dt); e.p.y = groundH(e.p.x, e.p.z);
  e.mesh.position.copy(e.p); orientFrom(e.mesh, e.dir, 0);
  if (speed > 0 && (e.dustT += dt) > 0.25) { e.dustT = 0; FX.smoke.spawn(e.p.clone().addScaledVector(e.dir, -1.2).setY(0.3), { s0: 0.6, s1: 2.2, life: 1.6, a0: 0.28, color: ENV.dustTint, v: drift(0.6, 0.4) }); }
  // the turret swings toward the base; at the stop line it fires at the perimeter (cosmetic: shells land near the fence)
  if (e.turret) { const want = Math.atan2(e.p.z, -e.p.x) - Math.atan2(-e.dir.z, e.dir.x); e.turret.rotation.y = approachAngle(e.turret.rotation.y, angleWrap(want), dt * 0.6); }
  if (armed && !e.retreat && speed === 0 && (e.fireT -= dt) <= 0) {
    e.fireT = rand(3, 7);
    const from = e.p.clone().setY(0.9), aim = new V3(e.p.x * 0.72 + rand(-4, 4), 0, e.p.z * 0.72 + rand(-4, 4)), tt = aim.distanceTo(from) / 45;
    const v = aim.sub(from).divideScalar(tt); v.y += 0.5 * 9.8 * tt;
    FX.tracers.spawn(from, v, { life: tt + 0.5, len: 1.2, w: 0.2, color: 0xffb070, grav: 9.8, splash: 1.3 });
    FX.flash.spawn(from, { s0: 1.6, s1: 2.6, life: 0.12, a0: 1 });
    FX.smoke.spawn(from.clone(), { s0: 0.8, s1: 2.6, life: 1.6, a0: 0.5, color: ENV.dustTint, v: drift(0.6, 0.4) });
  }
  if (Math.hypot(e.p.x, e.p.z) > 170 && e.age > 3) { e.dead = true; scene.remove(e.mesh); }
}
const _cpo = new V3();
