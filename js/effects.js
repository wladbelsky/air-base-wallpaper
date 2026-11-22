'use strict';
/* ===== Effects: tracers, sprites (flashes/smoke), scorch marks, flash lights ===== */

class Tracers {
  constructor(scene, n) {
    this.n = n;
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(-0.5, 0, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });   // (HDR with bloom: updateBloom)
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 6;
    this.items = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), c = new THREE.Color(0, 0, 0);
    for (let i = 0; i < n; i++) {
      this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, c);
      this.items.push({ on: false, p: new V3(), v: new V3(), life: 0, max: 1, len: 1, w: 0.1, col: new THREE.Color(), grav: 0, splash: 0 });
    }
    this.next = 0; this.mesh.visible = false; scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new V3(); this._d = new V3(); this._x = new V3(1, 0, 0);
    this.onSplash = null;
  }
  spawn(p, v, o) {
    const i = this.next, it = this.items[i]; this.next = (this.next + 1) % this.n;
    it.on = true; it.p.copy(p); it.v.copy(v); it.life = it.max = o.life || 1; it.len = o.len || 1; it.w = o.w || 0.1;
    it.col.setHex(o.color || 0xffaa55); it.grav = o.grav || 0; it.splash = o.splash || 0;
    this.mesh.setColorAt(i, it.col); this.mesh.instanceColor.needsUpdate = true; this.mesh.visible = true;
    return it;
  }
  /* idle (no tracers in flight, i.e. most of the time) costs neither a buffer upload nor a draw call */
  update(dt) {
    let active = 0, changed = false;
    for (let i = 0; i < this.n; i++) {
      const it = this.items[i]; if (!it.on) continue;
      changed = true;
      it.v.y -= it.grav * dt; it.p.addScaledVector(it.v, dt); it.life -= dt;
      if (it.splash && it.p.y < groundH(it.p.x, it.p.z)) { if (this.onSplash) this.onSplash(it.p, it.splash); it.life = 0; }
      if (it.life <= 0) { it.on = false; this._m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this._m); continue; }
      active++;
      this._d.copy(it.v).normalize(); this._q.setFromUnitVectors(this._x, this._d);
      const fw = Math.min(1, it.life / 0.2); this._s.set(it.len, it.w * fw, it.w * fw); this._m.compose(it.p, this._q, this._s); this.mesh.setMatrixAt(i, this._m);
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = active > 0;
  }
}

/* Camera-facing particles (flashes / smoke): the whole pool is one instanced Sprite (one draw call) with a node material:
   per instance its position, colour + alpha and size + rotation (instanced attributes), a quad of `size` world units
   rotated in screen space, colour × texture, scene fog. Normal-blended pools are sorted back to front on the CPU (the
   instances are drawn in order).
   The scene is drawn into the linear HDR target, where sprites don't add up as they did on the old sRGB screen: dark
   smoke over light ground came out pale, overlapping flames red instead of yellow-hot. SPRITE_AG bends the alpha of the
   normal-blended pools (smoke: alpha^0.6), SPRITE_CP the colour of the additive ones (flashes, flames: closer to the
   sRGB value, so the layers add up to yellow). uK: the colour scale (> 1: glows under bloom, updateBloom). */
const SPRITE_AG = 0.6, SPRITE_CP = 0.6;
const _sfxFwd = new V3(), farFirst = (a, b) => b.depth - a.depth;
class SpriteFX {
  constructor(scene, tex, blending, n, fog, hdr) {
    this.n = n; this.sorted = blending !== THREE.AdditiveBlending;   // additive blending is order independent
    this.items = []; this.live = [];
    for (let i = 0; i < n; i++) this.items.push({ on: false, p: new V3(), v: new V3(), col: new THREE.Color(), rot: 0, life: 0, max: 1, s0: 1, s1: 1, a0: 1, drag: 0, rise: 0, sc: 1, a: 0, depth: 0 });
    const attr = (size) => new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
    this.aPos = attr(3); this.aCol = attr(4); this.aSR = attr(2); this.attrs = [this.aPos, this.aCol, this.aSR];
    const { instancedBufferAttribute: iba, texture, uv, uniform, vec3, vec4, pow } = THREE.TSL;
    const col = iba(this.aCol), sr = iba(this.aSR), t = texture(tex, uv());
    this.uK = uniform(hdr || 1);
    const mat = new THREE.SpriteNodeMaterial({ blending, transparent: true, depthWrite: false, fog: !!fog });
    mat.positionNode = iba(this.aPos); mat.scaleNode = sr.x; mat.rotationNode = sr.y;
    const rgb = col.rgb.mul(t.rgb), a = col.a.mul(t.a);
    mat.colorNode = vec4(this.sorted ? rgb : pow(rgb, vec3(SPRITE_CP)), this.sorted ? pow(a, SPRITE_AG) : a).mul(vec4(vec3(this.uK), 1));
    this.mesh = new THREE.Sprite(mat); this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.visible = false;
    this.mesh.renderOrder = blending === THREE.AdditiveBlending ? 7 : 3; scene.add(this.mesh);
    this.next = 0;
  }
  spawn(p, o) {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.n;
    it.on = true; it.p.copy(p);
    it.life = it.max = o.life || 1; it.s0 = o.s0 || 1; it.s1 = o.s1 || it.s0; it.a0 = o.a0 != null ? o.a0 : 1;
    if (o.v) it.v.copy(o.v); else it.v.set(0, 0, 0);
    it.drag = o.drag || 0; it.rise = o.rise || 0;
    it.col.set(o.color != null ? o.color : 0xffffff); it.rot = Math.random() * 6.28;
    it.tintWithSmoke = !!o.smoke;
    return it;
  }
  update(dt, smokeTint, cam) {
    const live = this.live; live.length = 0;
    for (const it of this.items) {
      if (!it.on) continue;
      it.life -= dt;
      if (it.life <= 0) { it.on = false; continue; }
      const t = 1 - it.life / it.max;
      it.v.multiplyScalar(Math.max(0, 1 - it.drag * dt)); it.v.y += it.rise * dt;
      it.p.addScaledVector(it.v, dt);
      it.sc = lerp(it.s0, it.s1, Math.sqrt(t));
      it.a = it.a0 * (1 - t) * (t < 0.08 ? t / 0.08 : 1);
      if (it.tintWithSmoke && smokeTint) it.col.copy(smokeTint);
      live.push(it);
    }
    if (this.sorted && cam && live.length > 1) {
      cam.getWorldDirection(_sfxFwd);
      for (const it of live) it.depth = it.p.dot(_sfxFwd);
      live.sort(farFirst);
    }
    const P = this.aPos.array, C = this.aCol.array, S = this.aSR.array;
    for (let i = 0; i < live.length; i++) {
      const it = live[i];
      P[i * 3] = it.p.x; P[i * 3 + 1] = it.p.y; P[i * 3 + 2] = it.p.z;
      C[i * 4] = it.col.r; C[i * 4 + 1] = it.col.g; C[i * 4 + 2] = it.col.b; C[i * 4 + 3] = it.a;
      S[i * 2] = it.sc; S[i * 2 + 1] = it.rot;
    }
    if (live.length) for (const a of this.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, live.length * a.itemSize); a.needsUpdate = true; }   // upload only the live part
    this.mesh.count = live.length; this.mesh.visible = live.length > 0;
  }
}

/* Flames: tall tongues of procedural fire instead of round blobs. One instanced Sprite (one draw call), anchored at its
   base (center y 0.12) and stretched up (scale: width, height); per instance its position, size, a seed and its alpha.
   The colour is noise, not a texture: a teardrop mask (wide at the base, narrowing up, swaying more toward the tip)
   cut by fractal noise scrolling up through it (uT: the simulation's time, wrapped — three's `time` is wall-clock and
   loses float precision over days of uptime), so every tongue licks and flickers on its own; its "heat" runs from a
   white-yellow core through orange to a deep red edge and tip. Additive, HDR by uK (bloom) like FX.flash. */
class FlameFX {
  constructor(scene, n) {
    this.n = n; this.items = []; this.live = []; this.next = 0;
    for (let i = 0; i < n; i++) this.items.push({ on: false, p: new V3(), v: new V3(), life: 0, max: 1, w0: 1, w1: 1, h: 1.8, seed: 0, a0: 1, w: 1, a: 0 });
    const attr = (size) => new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
    this.aPos = attr(3); this.aD = attr(4); this.attrs = [this.aPos, this.aD];
    const { instancedBufferAttribute: iba, uv, uniform, vec2, vec3, vec4, float, abs, mix, smoothstep, clamp, pow, mx_fractal_noise_float: fbm } = THREE.TSL;
    this.uK = uniform(1); this.uT = uniform(0);
    const d = iba(this.aD), seed = d.z, alpha = d.w, q = uv(), y = q.y, t = this.uT;
    const n1 = fbm(vec3(q.x.mul(2.2).add(seed), y.mul(1.6).sub(t.mul(1.9)), seed.mul(1.7)), 3, 2.0, 0.5);
    const n2 = fbm(vec3(q.x.mul(5).add(seed.mul(3.1)), y.mul(3.4).sub(t.mul(3.6)), seed), 2, 2.0, 0.5);
    const x = q.x.sub(0.5).add(n1.mul(0.16).mul(y.add(0.15)));                    // sways, more toward the tip
    const half = mix(float(0.47), float(0.07), pow(y, 0.9));                      // narrows upward
    const body = smoothstep(half, half.mul(0.25), abs(x));
    const tip = smoothstep(float(0.97), float(0.35).add(n2.mul(0.25)), y);          // the tip breaks up into tongues
    const base = smoothstep(float(0), float(0.1), y);
    const heat = clamp(body.mul(tip).mul(base).mul(n2.mul(0.55).add(0.8)).mul(float(1.05).sub(y.mul(0.55))), 0, 1);
    const red = vec3(0.6, 0.05, 0.0), orange = vec3(1.0, 0.36, 0.03), core = vec3(1.0, 0.78, 0.38);
    const col = mix(mix(red, orange, smoothstep(0.1, 0.5, heat)), core, smoothstep(0.68, 0.98, heat));
    const a = smoothstep(0.04, 0.32, heat).mul(alpha);
    const mat = new THREE.SpriteNodeMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    mat.positionNode = iba(this.aPos); mat.scaleNode = vec2(d.x, d.y);
    mat.colorNode = vec4(col.mul(this.uK.mul(heat.mul(0.5).add(0.6))), a);   // (the core brightest: it blooms)
    this.mesh = new THREE.Sprite(mat); this.mesh.center.set(0.5, 0.12); this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.visible = false;
    this.mesh.renderOrder = 7; scene.add(this.mesh);
  }
  /* o: { w (width at birth), w1 (at the end), h (height / width), life, a0, v } */
  spawn(p, o) {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.n;
    it.on = true; it.p.copy(p); it.life = it.max = o.life || 0.8; it.w0 = o.w || 1; it.w1 = o.w1 || it.w0 * 1.15; it.h = o.h || 1.8;
    it.a0 = o.a0 != null ? o.a0 : 1; it.seed = Math.random() * 50;
    if (o.v) it.v.copy(o.v); else it.v.set(0, 0, 0);
    return it;
  }
  update(dt, T) {
    this.uT.value = T % 600;
    const live = this.live; live.length = 0;
    for (const it of this.items) {
      if (!it.on) continue;
      it.life -= dt;
      if (it.life <= 0) { it.on = false; continue; }
      const k = 1 - it.life / it.max;
      it.p.addScaledVector(it.v, dt);
      it.w = lerp(it.w0, it.w1, k);
      it.a = it.a0 * Math.min(1, k / 0.15) * (1 - k * k);   // grows in, burns, dies away
      live.push(it);
    }
    const P = this.aPos.array, D = this.aD.array;
    for (let i = 0; i < live.length; i++) {
      const it = live[i];
      P[i * 3] = it.p.x; P[i * 3 + 1] = it.p.y; P[i * 3 + 2] = it.p.z;
      D[i * 4] = it.w; D[i * 4 + 1] = it.w * it.h; D[i * 4 + 2] = it.seed; D[i * 4 + 3] = it.a;
    }
    if (live.length) for (const a of this.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, live.length * a.itemSize); a.needsUpdate = true; }
    this.mesh.count = live.length; this.mesh.visible = live.length > 0;
  }
}

/* craters where shells and bombs hit the ground: a low lathe (dark bowl, a raised rim of turned-up earth that catches
   the light, soot-dark ejecta thinning out to the ground) in vertex colours; one instanced mesh, a fixed pool of slots; old
   ones flatten and shrink away. A hit on a live crater widens it instead of stacking a second one on it (merge); on paved
   ground they are cleared sooner, a repair (runway crew, a mount back on line) fills them in over 3 s */
const CRATER_PROFILE = [[0, 0.004, 0x17130f, 1], [0.35, 0.006, 0x1f1a15, 1], [0.62, 0.05, 0x2e271f, 1], [0.8, 0.13, 0x5a4b3a, 1], [0.92, 0.1, 0x4a3e30, 1], [1.15, 0.035, 0x2a241d, 0.8], [1.5, 0.0, 0x3a332a, 0]];   // [r, y, colour, alpha]: the ejecta fades into the ground
function craterGeometry() {
  const geo = new THREE.LatheGeometry(CRATER_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)).reverse(), 11), pos = geo.attributes.position, col = new Float32Array(pos.count * 4), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i)); let j = 0; while (j < CRATER_PROFILE.length - 2 && CRATER_PROFILE[j + 1][0] < r - 1e-4) j++;
    const P = CRATER_PROFILE[j], Q = CRATER_PROFILE[j + 1], u = clamp((r - P[0]) / (Q[0] - P[0]), 0, 1);
    c.setHex(P[2]).lerp(new THREE.Color(Q[2]), u); c.toArray(col, i * 4); col[i * 4 + 3] = lerp(P[3], Q[3], u);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));   // rgba: vertex alpha (three picks it up from the item size)
  return geo;
}
class Scorch {
  static MERGE = 0.6;                                // two craters closer than MERGE × (r1 + r2) become one
  static CROWD = 30;                                 // slots kept free (crowd): a 3 s fade frees them at ~10/s
  static LIFT = 0.055;                               // its base over the ground: above the paving and its painted lines (≤ 0.048; lower, the taxiway lines showed through)
  constructor(scene, n) {
    const geo = craterGeometry();
    // no depth write: its faded ejecta would cut holes in ground decals drawn after it (runway lettering); nearly flat, so it doesn't need it
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, transparent: true, depthWrite: false, flatShading: true, shininess: 0, specular: 0x000000, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, n); this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; this.mesh.count = n;
    this.items = []; const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) { this.mesh.setMatrixAt(i, zero); this.items.push({ on: false, fade: false, k: 0, p: new V3(), r: 1, base: 1, t: 0, max: 1, rot: 0 }); }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new V3(); this._y = new V3(0, 1, 0);
    scene.add(this.mesh);
  }
  spawn(p, r, life) {
    r *= 0.8; life = life || 45;
    if (pavedAt(p.x, p.z) && !runwayAt(p.x, p.z, 0.3)) life = Math.min(life, 40);   // (a runway's stays until it is repaired / patched)
    if (r < 1.1) life = Math.min(life, 20);          // shell holes (tank rounds far out past the wire, several a second): not for long
    let it = this.items.find(o => o.on && !o.fade && Math.hypot(o.p.x - p.x, o.p.z - p.z) < Scorch.MERGE * (o.r + r));
    if (it) {                                        // on a live one: it grows (up to 1.4× the bigger of the two), its centre a little toward the hit
      const b = Math.max(it.base, r), w = 0.25 * r / (it.r + r);
      it.r = Math.min(Math.max(it.r, r) * 1.12, 1.4 * b); it.base = b; it.p.x += (p.x - it.p.x) * w; it.p.z += (p.z - it.p.z) * w;
      it.t = it.max = Math.max(it.t, life);
      this.absorb(it);
      return it;
    }
    // a free slot (crowding keeps some); with none at all this one isn't made — rather than cut a showing one short
    it = this.items.find(o => !o.on); if (!it) return null;
    it.on = true; it.fade = false; it.k = 1; it.p.set(p.x, groundH(p.x, p.z) + Scorch.LIFT, p.z); it.r = it.base = r; it.t = it.max = life; it.rot = rand(0, TAU);
    this.crowd();
    return it;
  }
  /* a grown crater takes in the neighbours it now overlaps (mostly under it): they shrink away */
  absorb(it) { for (const o of this.items) if (o !== it && o.on && !o.fade && Math.hypot(o.p.x - it.p.x, o.p.z - it.p.z) < Scorch.MERGE * (o.r + it.r)) { it.t = it.max = Math.max(it.t, o.t); this.fadeOut(o); } }
  /* a crater on its way out: it shrinks away over (at most) 3 s — never just switched off */
  fadeOut(o) { if (!o.fade) { o.fade = true; o.max = 12; o.t = Math.min(o.t, 3); } }
  /* fewer than CROWD slots free (heavy bombing): the oldest start shrinking away, so a new one never takes a live one's slot */
  crowd() {
    let free = 0; for (const o of this.items) if (!o.on) free++;
    if (free >= Scorch.CROWD) return;
    const live = this.items.filter(o => o.on && !o.fade).sort((a, b) => a.t - b.t);
    for (let i = 0; i < Scorch.CROWD - free && i < live.length; i++) this.fadeOut(live[i]);
  }
  /* fill in the craters around p (within r of their rim) */
  repair(p, r) { for (const it of this.items) if (it.on && Math.hypot(it.p.x - p.x, it.p.z - p.z) < r + it.r * 0.5) this.fadeOut(it); }
  update(dt) {
    let changed = false;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]; if (!it.on) continue;
      it.t -= dt; changed = true;
      const k = it.k = it.t <= 0 ? 0 : Math.min(1, it.t / (it.max * 0.25));
      if (it.t <= 0) it.on = false;
      this._q.setFromAxisAngle(this._y, it.rot); this._s.set(it.r * k, it.r * 0.8 * k * k, it.r * k * 0.85);   // flattens as it shrinks
      this.mesh.setMatrixAt(i, this._m.compose(it.p, this._q, this._s));
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* the burning structures (BASE_FIRES) light their surroundings with a flicker: a fixed pool of point lights given to the
   biggest fires (clustered lighting only, WebGPU: GPU.clustered) */
class FireLights {
  constructor(scene, n) { this.items = []; for (let i = 0; i < n; i++) { const l = new THREE.PointLight(0xff8a3a, 0, 16, 2); l.layers.enable(2); scene.add(l); this.items.push(l); } this.ph = 0; }
  update(dt, nightBoost) {
    // the biggest fires: burning structures, then burning wrecks (an armour wreck's flames: `fire`, updateArmor)
    this.ph += dt; const fires = BASE_FIRES.slice();
    for (const e of ENEMIES) if (e.kind === 'armor' && e.falling && e.fire > 0.05) fires.push({ p: e.p, r: 0.7 * e.fire, t: 8 });
    fires.sort((a, b) => b.r * Math.min(1, b.t / 8) - a.r * Math.min(1, a.t / 8));
    this.items.forEach((l, i) => {
      const f = fires[i]; if (!f) { l.intensity = 0; return; }
      const k = Math.min(1, f.t / 8) * f.r, fl = 0.75 + 0.25 * Math.sin(this.ph * 13 + i * 2.1) * Math.sin(this.ph * 7.3 + i);
      l.position.set(f.p.x, f.p.y + 1.2, f.p.z); l.intensity = 2.2 * FLASH_K * k * fl * nightBoost * CFG.fire / 100;
    });
  }
}
class FlashLights {
  constructor(scene, n) {
    this.items = [];
    for (let i = 0; i < n; i++) { const l = new THREE.PointLight(0xffb060, 0, 22, 2); l.layers.enable(2); scene.add(l); this.items.push({ l, t: 0, max: 0.1, I: 0 }); }
    this.next = 0;
  }
  flash(p, I, dur) {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.items.length;
    it.l.position.copy(p); it.t = it.max = dur; it.I = I;
  }
  update(dt, nightBoost) {
    for (const it of this.items) { it.t = Math.max(0, it.t - dt); it.l.intensity = it.t > 0 ? it.I * FLASH_K * (it.t / it.max) * nightBoost : 0; }
  }
}
