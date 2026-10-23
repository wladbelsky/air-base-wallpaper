/* In-page test helpers (injected with addInitScript before the wallpaper's scripts; everything here is resolved at
   call time, so the wallpaper's globals — AIRCRAFT, step, FD, … — are available by then). Exposed as window.__t. */
(() => {
  'use strict';
  const H = window.__t = {};
  let rt = 1000;                       // simulated real time (RT): arming, beat gaps and hold timers run on it
  const DT = 0.05;

  // states in which an aircraft is on a mission leg (registerLeg in missions.js) / a refuelling pass (tanker.js)
  H.MISSION_STATES = new Set(['mission_out', 'mission', 'mission_back', 'drop_pass']);
  H.TANK_STATES = new Set(['tank_out', 'tank_wait', 'tank_pass', 'tank_back']);
  // who may be on the runway (lining up, rolling, landing roll until clear) / on approach
  H.RUNWAY_STATES = new Set(['lineup', 'takeoff_roll', 'rollout', 'taxi_in', 'emergency', 'towed']);
  H.ARRIVAL_STATES = new Set(['approach', 'final']);
  // per-state limits for the stuck detector (s); states missing here use DEFAULT_LIMIT, EXEMPT ones are never stuck
  H.STATE_LIMITS = { ready: 600, pushback: 90, taxi_out: 600, hold_short: 300, lineup: 40, takeoff_roll: 90, climb: 240, approach: 240, final: 60,
    go_around: 120, rollout: 90, taxi_in: 360, emergency: 200, towed: 360, drop_pass: 120, spinup: 60, lift: 30, depart: 240, ret: 300, hover: 30, descend: 30, spindown: 30,
    cbt_out: 180, cbt_rtb: 300, cbt_pass: 240, tank_out: 240, tank_back: 300, tank_pass: 240, mission_out: 400, mission_back: 600 };
  H.DEFAULT_LIMIT = 600;
  H.EXEMPT = new Set(['parked', 'orbit', 'cbt_wait', 'cbt_orbit', 'mission', 'tank_wait']);   // waiting states depend on traffic: checked by "eventually" tests instead

  H.rt = () => rt;
  /* after boot: real time and the clock run on simulated time */
  H.setup = () => {
    window.RT = () => rt;
    if (!THREE.BufferGeometry.prototype.__patched) {           // mark disposed geometries (leak detection, below)
      const d = THREE.BufferGeometry.prototype.dispose;
      THREE.BufferGeometry.prototype.dispose = function () { this.__disposed = true; return d.call(this); };
      THREE.BufferGeometry.prototype.__patched = true;
    }
    CFG.lon = 0;                          // the browser runs in UTC; no timezone dependence
    PERSIST.timer = 1e9;                  // no background saves unless a test asks (persist tests call save())
    H.reset();
  };
  H.reset = () => { H.stateT = new Map(); H.maxT = {}; H.log = new Map(); };

  /* ---- audio: a synthetic 120 bpm track (kick on the beat, snare on 2 and 4) or silence ---- */
  const arr = new Array(128).fill(0);
  H.audioFrame = (on) => {
    arr.fill(0);
    if (on) {
      const ph = rt % 0.5, beat = Math.floor(rt / 0.5);
      for (let i = 0; i < 128; i++) arr[i] = 0.12 + 0.03 * Math.sin(i + rt * 7);
      if (ph < 0.06) for (let i = 0; i < 5; i++) { arr[i] = 0.95; arr[64 + i] = 0.95; }
      if (beat % 2 && ph < 0.05) for (let i = 6; i < 23; i++) { arr[i] = 0.8; arr[64 + i] = 0.8; }
      if (ph > 0.25 && ph < 0.29) for (let i = 26; i < 57; i++) { arr[i] = 0.6; arr[64 + i] = 0.6; }
    }
    return arr;
  };
  const feed = (on) => { const a = H.audioFrame(on); (window.__audio || onAudio)(a); };

  /* ---- invariants checked after every step ---- */
  H.checkInvariants = () => {
    const v = [], known = new Set(Object.keys(STATUS)), inWing = new Set(AIRCRAFT);
    const who = a => a ? `${a.callsign}[${a.state}]` : String(a);
    // runway and arrivals
    for (const set of [AIRFIELD.rwy, AIRFIELD.rwy2]) for (const a of set) if (!inWing.has(a)) v.push(`runway held by an aircraft not in the air wing ${who(a)}`); else if (!H.RUNWAY_STATES.has(a.state)) v.push(`runway held by ${who(a)}`);
    for (const a of AIRFIELD.rwy2) if (a.rwyL !== BASE_LAYOUT.rwy2) v.push(`south runway held by one not using it ${who(a)}`);
    for (const a of AIRFIELD.arrivals) if (!a.rwyL) v.push(`arrival without a runway ${who(a)}`);
    for (const a of AIRFIELD.arrivals) if (!inWing.has(a) || !H.ARRIVAL_STATES.has(a.state)) v.push(`arrival list holds ${who(a)}`);
    for (const a of AIRCRAFT) if (H.ARRIVAL_STATES.has(a.state) && !AIRFIELD.arrivals.has(a)) v.push(`on approach but not sequenced ${who(a)}`);
    for (const set of [AIRFIELD.rwy, AIRFIELD.rwy2]) if ([...set].filter(a => a.state === 'rollout').length > 1) v.push('two landing rolls on one runway');
    // crossing the north runway (home from the south one): only with nothing lining up or rolling toward the connector
    for (const a of AIRCRAFT) if (a.cross && a.cross.ok && AIRFIELD.rwy.has(a) && a.mesh.position.z > BASE_LAYOUT.rwy.z - BASE_LAYOUT.rwy.w / 2 && a.mesh.position.z < BASE_LAYOUT.crossZ)
      for (const b of AIRFIELD.rwy) if (b !== a && (b.state === 'lineup' || (b.state === 'takeoff_roll' && b.rolling && b.rx < a.cross.x + 2 && b.rx > a.cross.x - 30))) v.push(`${who(a)} crossing the runway in front of ${who(b)}`);
    // homes: every slot's occupant lives there, every aircraft has its own home (shared only past the base's capacity)
    for (const l of [PARKING.stands, PARKING.shelters, PARKING.hangars, PARKING.remote, PARKING.heli]) for (const sp of l) {
      if (!sp.occ) continue;
      if (!inWing.has(sp.occ)) v.push(`a home held by an aircraft not in the air wing ${who(sp.occ)}`);
      else if (sp.occ.spot !== sp) v.push(`home occ/spot mismatch: ${who(sp.occ)}`);
    }
    for (const a of AIRCRAFT) if (!a.spot) v.push(`no home ${who(a)}`);
    // the stand markings / helicopter pads drawn = the homes in use
    const m = AIRFIELD.marks;
    if (m && m.stand.count !== m.stands.filter(s => s.occ).length) v.push(`stand marks ${m.stand.count} for ${m.stands.filter(s => s.occ).length} stands in use`);
    if (m && m.pad.count !== PARKING.heli.length) v.push(`heli pads ${m.pad.count} instead of all ${PARKING.heli.length}`);
    // aircraft
    for (const a of AIRCRAFT) {
      if (!known.has(a.state)) v.push(`unknown state ${who(a)}`);
      const p = a.mesh.position;
      if (!Number.isFinite(p.x + p.y + p.z + a.v)) v.push(`non-finite position/speed ${who(a)}`);
      if (a.mesh.visible && a.aloft && p.y < -0.3) v.push(`${who(a)} under ground (y=${p.y.toFixed(2)})`);
      if (!!a.mission !== H.MISSION_STATES.has(a.state)) v.push(`mission context / state mismatch ${who(a)}`);
      if (a.tank && !H.TANK_STATES.has(a.state)) v.push(`tank event outside a tanker state ${who(a)}`);
      if (a.spec.tanker && a.hoseOut && a.state !== 'tank_pass') v.push(`hose out outside the pass ${who(a)}`);
    }
    // nobody taxis into anyone else (parked / ready ones may share the last remote stand when the base is over-full)
    const taxiing = AIRCRAFT.filter(a => a.onGround && a.mesh.visible && a.state !== 'parked' && a.state !== 'ready' && !(a instanceof Helicopter));
    for (let i = 0; i < taxiing.length; i++) for (let j = i + 1; j < taxiing.length; j++) {
      const a = taxiing[i], b = taxiing[j], d = Math.hypot(a.mesh.position.x - b.mesh.position.x, a.mesh.position.z - b.mesh.position.z);
      if (d < 0.3 * (a.spec.len + b.spec.len)) v.push(`ground collision ${who(a)} / ${who(b)} (${d.toFixed(2)} apart at ${a.mesh.position.x.toFixed(0)},${a.mesh.position.z.toFixed(0)})`);
    }
    // ground vehicles (crews, tugs, loaders) never end up under a taxiing aircraft other than their own: inside its
    // fuselage / inner wing footprint
    for (const sc of GROUND_OPS.scenes) if (sc.veh) for (const vh of sc.veh) {
      const p = vh.position; if (!p) continue;
      for (const a of taxiing) {
        if (a === sc.a) continue;
        const dx = p.x - a.mesh.position.x, dz = p.z - a.mesh.position.z, al = dx * a.fwd.x + dz * a.fwd.z, sd = dx * a.fwd.z - dz * a.fwd.x;
        if (Math.abs(al) < a.spec.len * 0.45 && Math.abs(sd) < a.spec.span * 0.3 + 0.3) v.push(`${sc.constructor.name} vehicle under ${who(a)} at ${p.x.toFixed(0)},${p.z.toFixed(0)}`);
      }
    }
    // ground vehicles: none jumps (a step longer than any vehicle drives), two moving ones never overlap, and a tug only
    // goes through a shelter / hangar door that is open
    const vehs = [];
    for (const sc of GROUND_OPS.scenes) {
      const ms = new Map();
      if (sc.veh) for (const vh of sc.veh) { const m = vh.isObject3D ? vh : vh.m; if (m) ms.set(m, (vh.kind || 'veh') + ':' + (vh.stage || sc.phase)); }
      if (sc.trucks) for (const k of sc.trucks) ms.set(k.m, 'firetruck:' + sc.phase);
      if (sc.tug && sc.tug.isObject3D) ms.set(sc.tug, 'tug:' + sc.phase);
      if (sc.m && sc.m.isObject3D) ms.set(sc.m, 'tug:' + sc.phase);
      for (const [m, tag] of ms) if (m.visible && m.scale.x > 0.99) vehs.push({ m, sc, tag });
    }
    const VP = H.vehPrev || (H.vehPrev = new WeakMap()), moved = new Set();
    for (const { m, sc } of vehs) {
      const p = m.position, q = VP.get(m);
      if (q && q.sc === sc) {
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d > 0.8) v.push(`${sc.constructor.name} (${sc.phase || '-'}) vehicle jumped ${d.toFixed(2)} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
        if (d > 0.005) moved.add(m);
        for (const s of [...PARKING.shelters, ...PARKING.hangars]) {             // through the door plane (south face) while it is shut
          const zd = s.z + (s.d || 6) / 2;
          if (Math.abs(p.x - s.x) < (s.w || 4.6) / 2 - 0.3 && (q.z - zd) * (p.z - zd) < 0 && s.door < 0.6) v.push(`${sc.constructor.name} (${sc.phase || '-'}) vehicle through the closed door of ${s.kind} ${s.x},${s.z}`);
        }
      }
      VP.set(m, { x: p.x, z: p.z, sc });
    }
    for (let i = 0; i < vehs.length; i++) for (let j = i + 1; j < vehs.length; j++) {
      const a = vehs[i].m, b = vehs[j].m;
      if (!moved.has(a) || !moved.has(b) || (GROUND_OPS.inShed(a.position) && GROUND_OPS.inShed(b.position))) continue;   // (both out of sight in a shed: fine)
      const d = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
      if (d < 0.65) v.push(`vehicles overlap (${vehs[i].sc.constructor.name} ${vehs[i].tag} / ${vehs[j].sc.constructor.name} ${vehs[j].tag}, ${d.toFixed(2)} apart at ${a.position.x.toFixed(1)},${a.position.z.toFixed(1)})`);
    }
    // enemy armour stays outside the fence
    for (const e of ENEMIES) if (e.kind === 'armor' && !e.dead && insideFence(e.p.x, e.p.z)) v.push(`enemy ${e.type} inside the fence at ${e.p.x.toFixed(0)},${e.p.z.toFixed(0)}`);
    // tanker event
    const ev = TANKER.ev;
    if (ev) {
      if (!ev.tanker.spec.tanker) v.push('tanker event led by a non-tanker');
      if (ev.recv.length < 1 || ev.recv.length > 4) v.push(`tanker event with ${ev.recv.length} receivers`);
      if (new Set(ev.recv.map(flightOf)).size !== 1) v.push('tanker receivers from different flights');
      if (!(ev.cur >= 0 && ev.cur < ev.recv.length)) v.push(`basket index ${ev.cur} out of range`);
      if (ev.kind === 'drogue' && ev.recv.length > 2) v.push('more than two receivers on the hoses');
      for (const a of ev.recv) if (!canReceive(a, ev.kind)) v.push(`receiver ${who(a)} can't take fuel from a ${ev.kind} tanker`);
      if (ev.tanker.spec.tankKind !== ev.kind) v.push('tanker event of another kind than its tanker');
    }
    // bounded pools
    if (RADIO.q.length > 8) v.push(`radio queue ${RADIO.q.length}`);
    if (ENEMIES.length > 80) v.push(`ENEMIES ${ENEMIES.length}`);
    if (MISSILES.length > 300) v.push(`MISSILES ${MISSILES.length}`);
    if (PENDING.length > 300) v.push(`PENDING ${PENDING.length}`);
    if (FLYBYS.length > 8) v.push(`FLYBYS ${FLYBYS.length}`);
    if (GROUND_OPS.chutes.length > 40) v.push(`parachutes ${GROUND_OPS.chutes.length}`);
    if (GROUND_OPS.scenes.length > AIRCRAFT.length + 6) v.push(`ground scenes ${GROUND_OPS.scenes.length}`);
    if (GROUND_OPS.emerg && !inWing.has(GROUND_OPS.emerg)) v.push('emergency of an aircraft not in the air wing');
    return v;
  };

  /* stuck detector: time each aircraft has spent in its current state (by callsign + host, survives rebuilds) */
  const keyOf = a => a.callsign;
  H.track = () => {
    const seen = new Set();
    for (const a of AIRCRAFT) {
      const k = keyOf(a); seen.add(k);
      let s = H.stateT.get(k);
      if (!s || s.state !== a.state) {
        s = { state: a.state, since: T }; H.stateT.set(k, s);
        const log = H.log.get(k) || []; if (log[log.length - 1] !== a.state) log.push(a.state); if (log.length > 400) log.shift(); H.log.set(k, log);
      }
      const d = T - s.since, m = H.maxT[a.state];
      if (!m || d > m.t) H.maxT[a.state] = { t: d, who: k };
    }
    for (const k of H.stateT.keys()) if (!seen.has(k)) H.stateT.delete(k);
  };
  H.stuck = () => {
    const out = [];
    for (const [st, m] of Object.entries(H.maxT)) {
      if (H.EXEMPT.has(st)) continue;
      const lim = H.STATE_LIMITS[st] || H.DEFAULT_LIMIT;
      if (m.t > lim) out.push(`${m.who} spent ${m.t.toFixed(0)} s in ${st} (limit ${lim})`);
    }
    return out;
  };

  /* ---- the simulation driver ----
     o.audio: true (music) / false (silence) / undefined (no audio input at all)
     o.check: run checkInvariants after every step (default true); o.until: stop early when it returns true */
  H.sim = (sec, o = {}) => {
    const n = Math.round(sec / DT), violations = [];
    const check = o.check !== false;
    let i = 0;
    H.track();
    for (; i < n; i++) {
      if (o.audio !== undefined) feed(o.audio);
      step(DT); rt += DT;
      H.track();
      if (check) for (const s of H.checkInvariants()) if (violations.length < 25) violations.push(`T=${T.toFixed(2)} ${s}`);
      if (o.until && o.until()) { i++; break; }
    }
    return { violations, steps: i, t: T };
  };
  /* combat without the 5 s arming: fighting until fightOff() */
  H.forceFight = () => {
    Object.defineProperty(AUD, 'active', { configurable: true, get: () => true });
    AUD.soundStart = rt - 10; AUD.lastActive = rt; AUD.combat = true; AUD.holdUntil = 0;
  };
  H.fightOff = () => { delete AUD.active; AUD.lastActive = rt - 100; AUD.soundStart = -1; };

  H.states = () => AIRCRAFT.map(a => ({ cs: a.callsign, key: a.spec.key, state: a.state, mission: !!a.mission, tank: !!a.tank, retiring: !!a.retiring, landReq: a.landReq }));
  H.find = (key, n = 0) => AIRCRAFT.filter(a => a.spec.key === key)[n];

  /* ---- rendering ---- */
  H.render = () => { if (CFG.shadows) fitShadow(); renderer.render(scene, camera); };   // what frame() does after the steps
  /* average colour [r, g, b] (0..255) of a rectangle in CSS pixels (y from the top), read straight after a render */
  H.sample = (x, y, w, h) => {
    H.render();
    const gl = renderer.getContext(), c = renderer.domElement, sx = c.width / innerWidth, sy = c.height / innerHeight;
    const px = Math.round(x * sx), py = Math.round(c.height - (y + h) * sy), pw = Math.max(1, Math.round(w * sx)), ph = Math.max(1, Math.round(h * sy));
    const buf = new Uint8Array(pw * ph * 4); gl.readPixels(px, py, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const s = [0, 0, 0]; for (let i = 0; i < buf.length; i += 4) { s[0] += buf[i]; s[1] += buf[i + 1]; s[2] += buf[i + 2]; }
    const n = buf.length / 4; return s.map(x => x / n);
  };
  /* Geometry leaks. Every geometry reachable at a check (scene + template / pool caches) is remembered; one that later
     is neither reachable nor disposed was dropped without disposeTree — a leak (the wallpaper never restarts).
     reach (the live count) must plateau; gpu = renderer.info's count of geometries uploaded and not disposed. */
  H.geoSeen = new Set();
  H.geometries = () => {
    H.render();
    const g = new Set(), roots = [scene, ...Object.values(ENEMY_MODELS)];
    for (const l of Object.values(FLYBY_MODELS)) for (const m of l) roots.push(m.group || m);
    roots.push(...Object.values(VEH_TEMPLATES)); for (const l of Object.values(VEH_POOL)) roots.push(...l);   // pooled ground vehicles / parachutes (groundops.js)
    for (const r of roots) r.traverse(x => { if (x.geometry) g.add(x.geometry); });
    for (const x of g) H.geoSeen.add(x);
    const caches = H.GEO_CACHES(), leaked = [...H.geoSeen].filter(x => !g.has(x) && !x.__disposed && !caches.includes(x));
    return { gpu: renderer.info.memory.geometries, reach: g.size, leaked: leaked.length, leakedTypes: [...new Set(leaked.map(x => x.type))] };
  };
  // module-level geometry caches that are kept on purpose while nothing in the scene uses them
  H.GEO_CACHES = () => [];
  H.props = (o) => window.wallpaperPropertyListener.applyUserProperties(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }])));
})();
