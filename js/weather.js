'use strict';
/* ===== Weather: rain, fog, thunderstorms (CFG.weatherMode) =====
   'default': as it always was (a clear sky; the seasons' snowfall / falling leaves by CFG.weather); 'clear' / 'rain' /
   'fog' / 'storm': that one; 'auto': a cycle, a new kind every 15–40 min by the season's odds (saved with the air wing).
   The kind sets targets the coefficients ease toward over ~2 min: oc (overcast: the sun dims, the sky and the haze go
   grey, shadows go soft and faint), rain (0..1: the rate of the drops), fog (0..1: the haze closes in), wind (× WIND0);
   wet rises in the rain and dries over ~10 min (dark, glossy paving). In winter the rain falls as snow (TERRAIN's
   snowfall, heavier) and a storm has no lightning. Only the look: flights, the fight and the radio don't change.
   Pools are made once (rain drops, splashes, mist, the bolt's segments) and never grow; no new lights (a lightning flash
   is the sky light's intensity: adding or showing a light would recompile every program). */
const WX_KINDS = ['clear', 'rain', 'fog', 'storm'];
const WX_TARGET = {
  clear: { oc: 0, rain: 0, fog: 0, wind: 1 },
  rain: { oc: 0.65, rain: 0.6, fog: 0.25, wind: 1.4 },
  fog: { oc: 0.5, rain: 0, fog: 1, wind: 0.35 },
  storm: { oc: 0.9, rain: 1, fog: 0.3, wind: 2.4 }
};
// the auto cycle's odds by season (summer: the desert, mostly clear, now and then a thunderstorm)
const WX_ODDS = {
  spring: { clear: 5, rain: 3, fog: 2, storm: 1 }, summer: { clear: 8, rain: 1, fog: 0.5, storm: 2 },
  autumn: { clear: 4, rain: 4, fog: 3, storm: 1 }, winter: { clear: 5, rain: 3, fog: 3, storm: 1.5 }
};
const WIND0 = WIND.clone(), RAIN_N = 1800, SPLASH_N = 240, BOLT_N = 48, MIST_N = 48;
const _wg = new V3(), _wq = new THREE.Quaternion(), _wm = new THREE.Matrix4(), _ws = new V3(), _wd = new V3(), _wp = new V3(), _wy = new V3(0, 1, 0), _wc = new THREE.Color();
const WEATHER = {
  kind: 'clear', timer: 0, oc: 0, rain: 0, fog: 0, wind: 1, wet: 0, flash: 0, strikeT: 12, strikes: 0, gustPh: 0, back: false,
  build() {
    // rain: thin streaks along the fall (a box: seen from any side), one instanced draw, a ring buffer of drops
    const drop = new THREE.BoxGeometry(1, 1, 1); drop.translate(0, 0.5, 0);
    this.drops = new THREE.InstancedMesh(drop, new THREE.MeshBasicMaterial({ color: 0xb8c4d0, transparent: true, opacity: 0.35, depthWrite: false }), RAIN_N);
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.drops.frustumCulled = false; this.drops.renderOrder = 2; this.drops.count = 0; this.drops.visible = false;
    this.dp = new Float32Array(RAIN_N * 3); this.dv = new Float32Array(RAIN_N * 3); this.dl = new Float32Array(RAIN_N); this.dNext = 0; this.dAcc = 0;
    // splashes: little rings on the ground where a drop lands (additive: faded out by their colour)
    const ring = new THREE.RingGeometry(0.55, 1, 10); ring.rotateX(-Math.PI / 2);
    this.splash = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), SPLASH_N);
    this.splash.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.splash.frustumCulled = false; this.splash.renderOrder = 2; this.splash.count = 0; this.splash.visible = false;
    for (let i = 0; i < SPLASH_N; i++) this.splash.setColorAt(i, _wc.setRGB(0, 0, 0));
    this.sp = new Float32Array(SPLASH_N * 3); this.sl = new Float32Array(SPLASH_N); this.sNext = 0;
    // the lightning bolt: a jagged line of thin boxes from the cloud base to the ground, HDR white (it glows under bloom)
    const seg = new THREE.BoxGeometry(1, 1, 1); seg.translate(0, 0.5, 0);
    this.bolt = new THREE.InstancedMesh(seg, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.2, 4), fog: false, transparent: true, depthWrite: false }), BOLT_N);
    this.bolt.frustumCulled = false; this.bolt.renderOrder = 7; this.bolt.count = 0; this.bolt.visible = false; this.boltT = 0;
    // fog banks: big soft sprites drifting low over the ground (one sorted SpriteFX pool, in the haze's colour)
    this.mist = FX.mist = new SpriteFX(scene, TEX.smoke, THREE.NormalBlending, MIST_N, true); this.mistAcc = 0;
    scene.add(this.drops, this.splash, this.bolt);
  },
  /* the kind the mode asks for (auto: the cycle's current one) */
  want() { const m = CFG.weatherMode; return m === 'auto' ? this.kind : WX_TARGET[m] ? m : 'clear'; },
  snowy() { return TERRAIN.season === 'winter'; },
  /* the next kind of the auto cycle: by the season's odds, rather a change */
  next() {
    const odds = WX_ODDS[TERRAIN.season] || WX_ODDS.spring;
    this.kind = wpick(WX_KINDS.map(k => ({ k, w: odds[k] * (k === this.kind ? 0.3 : 1) }))).k;
    this.timer = rand(900, 2400);
  },
  /* the saved kind (persist.js), once per page load */
  restore(w) { if (this.back || !w || !WX_TARGET[w.kind]) return; this.back = true; this.kind = w.kind; this.timer = clamp(+w.t || 900, 60, 2400); const tg = WX_TARGET[w.kind]; this.oc = tg.oc; this.rain = tg.rain; this.fog = tg.fog; this.wind = tg.wind; this.wet = tg.rain > 0 ? 1 : 0; },
  save() { return CFG.weatherMode === 'auto' ? { kind: this.kind, t: Math.round(this.timer / 60) * 60 } : null; },
  update(dt) {
    if (CFG.weatherMode === 'auto' && (this.timer -= dt) <= 0) this.next();
    else if (CFG.weatherMode !== 'auto') this.kind = this.want();
    const tg = WX_TARGET[this.kind], k = 1 - Math.exp(-dt / 40);   // ~2 min to settle
    this.oc += (tg.oc - this.oc) * k; this.rain += (tg.rain - this.rain) * k; this.fog += (tg.fog - this.fog) * k; this.wind += (tg.wind - this.wind) * k;
    this.wet = clamp(this.wet + (this.rain > 0.15 && !this.snowy() ? dt * this.rain / 90 : -dt / 600), 0, 1);
    // wet: the paving and the models (PLAIN_MAT) darker and glossy (the lamps shine on the concrete at night), the ground darker
    const wt = this.wet;
    PLAIN_MAT.color.setScalar(1 - 0.2 * wt); PLAIN_MAT.specular.setHex(0x151515).lerp(_wc.setHex(0x5a5a5a), wt); PLAIN_MAT.shininess = 8 + 30 * wt;
    if (TERRAIN.ground) TERRAIN.ground.material.color.setScalar(1 - 0.22 * wt);
    this.applyFog();
    // gusts: the wind (smoke, dust, the rain's slant) swells and eases
    this.gustPh += dt * (0.25 + 0.2 * this.wind);
    const g = 1 + 0.25 * Math.sin(this.gustPh) * Math.sin(this.gustPh * 0.37 + 1.3) * Math.min(1, this.wind - 0.3);
    WIND.copy(WIND0).multiplyScalar(this.wind * g);
    this.updateRain(dt); this.updateMist(dt); this.updateLightning(dt);
    hemi.intensity = ENV.hemiI * (1 + 5 * this.flash);                                      // a lightning flash: the sky light (no extra light)
  },
  updateRain(dt) {
    const on = this.rain > 0.02 && !this.snowy();
    if (on) {
      this.dAcc += dt * this.rain * 1500;
      const fall = 20 + 6 * this.rain;
      while (this.dAcc > 1) {
        this.dAcc--; const i = this.dNext; this.dNext = (this.dNext + 1) % RAIN_N;
        const p = AIRWAR.groundAt(rand(-1.15, 1.15), rand(-1.2, 1.3), 0, _wg), h = rand(6, 24);   // (no allocation: ~1500 a second)
        this.dp[i * 3] = p.x + rand(-6, 6) - WIND.x * h / fall * 3; this.dp[i * 3 + 1] = h; this.dp[i * 3 + 2] = p.z + rand(-6, 6) - WIND.z * h / fall * 3;
        this.dv[i * 3] = WIND.x * 3; this.dv[i * 3 + 1] = -fall * rand(0.9, 1.1); this.dv[i * 3 + 2] = WIND.z * 3; this.dl[i] = 1;
      }
    }
    let n = 0;
    const D = this.drops, len = 0.9 + 0.5 * this.rain, w = 0.06;
    for (let i = 0; i < RAIN_N; i++) {
      if (this.dl[i] <= 0) continue;
      const j = i * 3; this.dp[j] += this.dv[j] * dt; this.dp[j + 1] += this.dv[j + 1] * dt; this.dp[j + 2] += this.dv[j + 2] * dt;
      if (this.dp[j + 1] <= 0) { this.dl[i] = 0; if (Math.random() < 0.3) this.splashAt(this.dp[j], this.dp[j + 2]); continue; }
      _wd.set(-this.dv[j], -this.dv[j + 1], -this.dv[j + 2]).normalize(); _wq.setFromUnitVectors(_wy, _wd);
      D.setMatrixAt(n++, _wm.compose(_wp.set(this.dp[j], this.dp[j + 1], this.dp[j + 2]), _wq, _ws.set(w, len, w)));
    }
    D.count = n; D.visible = n > 0; if (n) D.instanceMatrix.needsUpdate = true;
    D.material.opacity = lerp(0.35, 0.22, ENV.night);
    // splashes: grow and fade over 0.25 s
    let m = 0;
    for (let i = 0; i < SPLASH_N; i++) {
      if (this.sl[i] <= 0) continue;
      this.sl[i] -= dt / 0.25; const u = 1 - Math.max(0, this.sl[i]), s = 0.08 + 0.22 * u, b = Math.max(0, this.sl[i]) * 0.5 * (1 - 0.6 * ENV.night);
      this.splash.setMatrixAt(m, _wm.compose(_wp.set(this.sp[i * 3], 0.06, this.sp[i * 3 + 2]), _wq.identity(), _ws.set(s, 1, s)));
      this.splash.setColorAt(m++, _wc.setRGB(b, b, b * 1.05));
    }
    this.splash.count = m; this.splash.visible = m > 0;
    if (m) { this.splash.instanceMatrix.needsUpdate = true; this.splash.instanceColor.needsUpdate = true; }
  },
  splashAt(x, z) { const i = this.sNext; this.sNext = (this.sNext + 1) % SPLASH_N; this.sp[i * 3] = x; this.sp[i * 3 + 2] = z; this.sl[i] = 1; },
  updateMist(dt) {
    if (this.fog > 0.05) {
      this.mistAcc += dt * this.fog * 1.6;
      while (this.mistAcc > 1) {
        this.mistAcc--;
        // a bank is a sprite facing the camera, 28–40 wide: low down its lower half went into the ground and was cut off
        // along a straight screen-horizontal line (a pale box over the runway in the rain). Its centre is raised by half
        // its final size along the view's vertical (the ortho camera: the same place on screen, only drawn over the ground)
        const s1 = rand(28, 40), p = AIRWAR.groundAt(rand(-1.3, 1.3), rand(-1.3, 1.3), 0); p.y = s1 * 0.5 * Math.cos(CFG.camElev * DEG) + rand(0.5, 2);
        this.mist.spawn(p, { s0: rand(18, 26), s1, life: rand(22, 32), a0: 0.22 * this.fog, color: 0xffffff, smoke: true, v: _wd.set(WIND.x * 0.6, 0, WIND.z * 0.6), drag: 0 });
      }
    }
    this.mist.update(dt, ENV.fogTint, camera);
  },
  /* lightning (storm, not in winter): every 8–30 s a strike 20–60 from the centre — the bolt for ~0.25 s, two flashes of
     the sky light */
  updateLightning(dt) {
    this.flash = Math.max(0, this.flash - dt * 6);
    if (this.boltT > 0 && (this.boltT -= dt) <= 0) { this.bolt.visible = false; this.bolt.count = 0; }
    if (this.boltT > 0) this.bolt.material.opacity = this.boltT > 0.12 || this.boltT < 0.06 ? 1 : 0.25;   // a flicker
    if (this.kind !== 'storm' || this.snowy() || this.rain < 0.6) return;
    if ((this.strikeT -= dt) > 0) return;
    this.strikeT = rand(8, 30);
    const a = rand(0, TAU), r = rand(20, 60);
    this.strike(Math.cos(a) * r + ORBIT_C.x, Math.sin(a) * r + ORBIT_C.z);
  },
  strike(x, z) {
    this.strikes++; this.flash = 1; this.boltT = 0.28;
    let n = 0, px = x + rand(-6, 6), py = 42, pz = z + rand(-6, 6);
    const seg = (ax, ay, az, bx, by, bz, w) => {
      if (n >= BOLT_N) return;
      _wd.set(bx - ax, by - ay, bz - az); const L = _wd.length(); _wd.divideScalar(L || 1); _wq.setFromUnitVectors(_wy, _wd);
      this.bolt.setMatrixAt(n++, _wm.compose(_wp.set(ax, ay, az), _wq, _ws.set(w, L, w)));
    };
    while (py > 0 && n < BOLT_N - 8) {                                        // the main channel, jagged, down to the ground
      const ny = Math.max(0, py - rand(2.5, 5)), t = ny / 42, nx = x + (px - x) * 0.5 + rand(-2.2, 2.2) * (0.3 + t), nz = z + (pz - z) * 0.5 + rand(-2.2, 2.2) * (0.3 + t);
      seg(px, py, pz, nx, ny, nz, 0.22);
      if (ny > 10 && Math.random() < 0.3) { let bx = nx, by = ny, bz = nz; const dx = rand(-1, 1), dz = rand(-1, 1); for (let k = 0; k < 3; k++) { const cx = bx + dx * rand(1.5, 3), cy = by - rand(1.5, 3), cz = bz + dz * rand(1.5, 3); seg(bx, by, bz, cx, cy, cz, 0.1); bx = cx; by = cy; bz = cz; } }   // a branch
      px = nx; py = ny; pz = nz;
    }
    this.bolt.count = n; this.bolt.visible = true; this.bolt.instanceMatrix.needsUpdate = true;
    FX.flash.spawn(_wp.set(x, 0.5, z), { s0: 4, s1: 7, life: 0.3, a0: 0.9, color: 0xdfe8ff });
  },
  /* the look of the hour under this weather (updateEnvironment, every 2 s; k from skyAt) */
  apply(k, elev) {
    const oc = this.oc, night = 1 - smoothstep(-10, 1, elev);
    k.si *= 1 - 0.8 * oc; k.hi *= 1 + 0.2 * oc;   // overcast: no sun, a brighter diffuse sky
    const grey = (c, t) => { const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; c.lerp(_wc.setRGB(l, l, l * 1.04), t); };
    grey(k.sun, 0.5 * oc); grey(k.hs, 0.65 * oc); grey(k.hg, 0.6 * oc); grey(k.fog, Math.max(0.7 * oc, 0.8 * this.fog)); grey(k.smoke, 0.4 * oc);
    k.fog.multiplyScalar(1 - 0.25 * oc);
    k.fog.lerp(_wc.setRGB(0.045, 0.05, 0.06), this.fog * night * 0.7);   // at night the haze glows a little (the base's lamps)
  },
  /* the haze: from the clear-sky band (updateCamera) closing in to a few dozen units */
  applyFog() {
    const vh = camera.top - camera.bottom, f = this.fog * this.fog;
    scene.fog.near = lerp(CAM_D - 30, CAM_D - 0.8 * vh, f); scene.fog.far = lerp(CAM_D + 260, CAM_D + 1.1 * vh, f);
  },
  /* lamps on in bad visibility (by day too): runway / nav lights, windows, the beams — not the real spot lights */
  lamps() { return smoothstep(0.35, 0.8, Math.max(this.fog, this.oc * 0.8)) * 0.85; },
  reset() { this.dl.fill(0); this.sl.fill(0); this.flash = 0; this.boltT = 0; this.bolt.visible = false; }
};
