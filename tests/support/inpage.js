/* In-page test helpers (injected with addInitScript before the wallpaper's scripts; everything here is resolved at
   call time, so the wallpaper's globals — AIRCRAFT, step, FD, … — are available by then). Exposed as window.__t. */
(() => {
  'use strict';
  const H = window.__t = {};
  let rt = 1000;                       // simulated real time (RT): arming, beat gaps and hold timers run on it
  const DT = 0.05;

  // states in which an aircraft is on a mission leg (registerLeg in missions.js) / a refuelling pass (tanker.js)
  H.MISSION_STATES = new Set(['mission_out', 'mission', 'mission_back', 'sling_to', 'sling_hook', 'sling_drop', 'ship_out', 'ship_hover', 'ship_watch']);
  H.TANK_STATES = new Set(['tank_out', 'tank_wait', 'tank_pass', 'tank_back']);
  H.CAT_STATES = new Set(['queued', 'taxi_out', 'hold', 'launch']);
  // who may hold the landing area (from 'orbit' straight into approach; released while taxiing clear) / an elevator
  H.RUNWAY_STATES = new Set(['approach', 'final', 'trap', 'taxi_in', 'taxi_stage', 'wait_lift', 'turn']);
  H.LIFT_STATES = new Set(['lift_wait', 'lift_prep', 'roll_out', 'lift_up', 'queued', 'taxi_out', 'wait_lift', 'onto_lift', 'lift_down', 'roll_in', 'tow_pad', 'tow_lift']);
  // per-state limits for the stuck detector (s); states missing here use DEFAULT_LIMIT, EXEMPT ones are never stuck
  H.STATE_LIMITS = { hold: 30, launch: 20, trap: 20, final: 90, approach: 240, lift_up: 40, lift_down: 40, roll_out: 40, roll_in: 40,
    lift_prep: 60, taxi_out: 60, taxi_in: 60, turn: 30, spinup: 30, spindown: 30, unfold: 40, fold: 40, tow_pad: 60, tow_lift: 60,
    hover: 60, descend: 60, lift: 40, climb: 240, depart: 240, ret: 300, cbt_out: 180, cbt_rtb: 300, cbt_pass: 240,
    tank_out: 240, tank_back: 300, tank_pass: 240, mission_out: 400, mission_back: 600, sling_to: 300, sling_hook: 120, sling_drop: 400,
    ship_out: 600 };
  H.DEFAULT_LIMIT = 600;
  H.EXEMPT = new Set(['parked', 'hangar', 'orbit', 'cbt_wait', 'mission', 'ship_hover', 'ship_watch', 'tank_wait',
    'queued', 'lift_wait', 'wait_lift', 'pad_wait']);   // waiting states depend on traffic: checked by "eventually" tests instead

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
    // deck resources
    FD.cats.forEach((c, i) => {
      if (!c.busy) return;
      if (!inWing.has(c.busy)) v.push(`cat ${i} held by an aircraft not in the air wing`);
      else if (!H.CAT_STATES.has(c.busy.state)) v.push(`cat ${i} held by ${who(c.busy)}`);
    });
    if (FD.runway) {
      if (!inWing.has(FD.runway)) v.push('runway held by an aircraft not in the air wing');
      else if (!H.RUNWAY_STATES.has(FD.runway.state)) v.push(`runway held by ${who(FD.runway)}`);
    }
    DECK.fixedSpots.forEach((sp, i) => {
      if (!sp.occ) return;
      if (!inWing.has(sp.occ)) v.push(`spot ${i} held by an aircraft not in the air wing`);
      else if (sp.occ.spot !== sp) v.push(`spot ${i} occ/spot mismatch: ${who(sp.occ)}`);
      else if (sp.occ.aloft) v.push(`spot ${i} held by an aloft ${who(sp.occ)}`);
    });
    const pad = DECK.heliPad.busy;
    if (pad && (!inWing.has(pad) || pad.aloft)) v.push(`heli pad held by ${who(pad)}`);
    for (const s of SHIPS) for (const [i, L] of (s.lifts || []).entries()) {
      if (L.y < L.bottom - 1e-6 || L.y > L.top + 1e-6) v.push(`lift ${i} out of range: ${L.y}`);
      const b = L.busy;
      if (b && !b.m) { if (!inWing.has(b)) v.push(`lift ${i} held by an aircraft not in the air wing`); else if (!H.LIFT_STATES.has(b.state)) v.push(`lift ${i} held by ${who(b)}`); }
      if (b && b.m && !AIRCRAFT.some(a => a.mission === b)) v.push(`lift ${i} held by a finished mission`);
    }
    // aircraft
    for (const a of AIRCRAFT) {
      if (!known.has(a.state)) v.push(`unknown state ${who(a)}`);
      const p = a.mesh.position;
      if (!Number.isFinite(p.x + p.y + p.z + a.v)) v.push(`non-finite position/speed ${who(a)}`);
      if (a.mesh.visible && a.aloft && p.y < -0.3) v.push(`${who(a)} under water (y=${p.y.toFixed(2)})`);
      if (!!a.mission !== H.MISSION_STATES.has(a.state)) v.push(`mission context / state mismatch ${who(a)}`);
      if (a.tank && !H.TANK_STATES.has(a.state)) v.push(`tank event outside a tanker state ${who(a)}`);
      if (a.spec.tanker && a.hoseOut && a.state !== 'tank_pass') v.push(`hose out outside the pass ${who(a)}`);
    }
    // tanker event
    const ev = TANKER.ev;
    if (ev) {
      if (!ev.tanker.spec.tanker) v.push('tanker event led by a non-tanker');
      if (ev.recv.length < 1 || ev.recv.length > 4) v.push(`tanker event with ${ev.recv.length} receivers`);
      if (new Set(ev.recv.map(flightOf)).size !== 1) v.push('tanker receivers from different flights');
      if (!(ev.cur >= 0 && ev.cur < ev.recv.length)) v.push(`basket index ${ev.cur} out of range`);
      for (const a of ev.recv) if (!a.spec.armed || !(a instanceof FixedWing)) v.push(`receiver ${who(a)} is not an armed jet`);
    }
    // bounded pools
    if (RADIO.q.length > 8) v.push(`radio queue ${RADIO.q.length}`);
    if (ENEMIES.length > 80) v.push(`ENEMIES ${ENEMIES.length}`);
    if (MISSILES.length > 300) v.push(`MISSILES ${MISSILES.length}`);
    if (PENDING.length > 300) v.push(`PENDING ${PENDING.length}`);
    if (FLYBYS.length > 8) v.push(`FLYBYS ${FLYBYS.length}`);
    return v;
  };

  /* stuck detector: time each aircraft has spent in its current state (by callsign + host, survives rebuilds) */
  const keyOf = a => a.callsign + '@' + SHIPS.indexOf(a.host);
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

  H.states = () => AIRCRAFT.map(a => ({ cs: a.callsign, key: a.spec.key, host: SHIPS.indexOf(a.host), state: a.state, mission: !!a.mission, tank: !!a.tank, retiring: !!a.retiring, landReq: a.landReq }));
  H.find = (key, n = 0) => AIRCRAFT.filter(a => a.spec.key === key && a.host === CARRIER)[n];

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
    const g = new Set(), roots = [scene, ...Object.values(ENEMY_MODELS), ...Object.values(VESSEL_MODELS)];
    for (const l of Object.values(FLYBY_MODELS)) for (const m of l) roots.push(m.group || m);
    for (const r of roots) r.traverse(x => { if (x.geometry) g.add(x.geometry); });
    for (const x of g) H.geoSeen.add(x);
    const caches = H.GEO_CACHES(), leaked = [...H.geoSeen].filter(x => !g.has(x) && !x.__disposed && !caches.includes(x));
    return { gpu: renderer.info.memory.geometries, reach: g.size, leaked: leaked.length, leakedTypes: [...new Set(leaked.map(x => x.type))] };
  };
  // module-level geometry caches that are kept on purpose while nothing in the scene uses them
  H.GEO_CACHES = () => [typeof _figGeo !== 'undefined' && _figGeo].filter(Boolean);
  H.props = (o) => window.wallpaperPropertyListener.applyUserProperties(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }])));
})();
