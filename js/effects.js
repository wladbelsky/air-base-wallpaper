'use strict';
/* ===== Effects: tracers, sprites (flashes/smoke), splashes, foam, flash lights ===== */

class Tracers {
  constructor(scene, n) {
    this.n = n;
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(-0.5, 0, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
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
      if (it.splash && it.p.y < waveH(it.p.x, it.p.z)) { if (this.onSplash) this.onSplash(it.p, it.splash); it.life = 0; }
      if (it.life <= 0) { it.on = false; this._m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this._m); continue; }
      active++;
      this._d.copy(it.v).normalize(); this._q.setFromUnitVectors(this._x, this._d);
      const fw = Math.min(1, it.life / 0.2); this._s.set(it.len, it.w * fw, it.w * fw); this._m.compose(it.p, this._q, this._s); this.mesh.setMatrixAt(i, this._m);
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = active > 0;
  }
}

/* Camera-facing particles (flashes / smoke): the whole pool is one instanced draw call instead of a
   THREE.Sprite per particle. Same look as SpriteMaterial (quad of `scale` world units rotated in screen
   space, color × texture, alpha = opacity, scene fog). Normal-blended pools are sorted back to front
   on the CPU, exactly like three.js sorted the individual sprites.                                   */
const SPRITE_VS = `attribute vec3 iPos; attribute vec4 iCol; attribute vec2 iSR;
  varying vec2 vUv; varying vec4 vCol;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv; vCol = iCol;
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    vec2 q = position.xy * iSR.x; float c = cos(iSR.y), s = sin(iSR.y);
    mvPosition.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const SPRITE_FS = `uniform sampler2D map; varying vec2 vUv; varying vec4 vCol;
  #include <fog_pars_fragment>
  void main() {
    gl_FragColor = vCol * texture2D(map, vUv);
    #include <fog_fragment>
  }`;
const _sfxFwd = new V3(), farFirst = (a, b) => b.depth - a.depth;
class SpriteFX {
  constructor(scene, tex, blending, n, fog) {
    this.n = n; this.sorted = blending !== THREE.AdditiveBlending;   // additive blending is order independent
    this.items = []; this.live = [];
    for (let i = 0; i < n; i++) this.items.push({ on: false, p: new V3(), v: new V3(), col: new THREE.Color(), rot: 0, life: 0, max: 1, s0: 1, s1: 1, a0: 1, drag: 0, rise: 0, sc: 1, a: 0, depth: 0 });
    const quad = new THREE.PlaneGeometry(1, 1), geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index; geo.setAttribute('position', quad.attributes.position); geo.setAttribute('uv', quad.attributes.uv);
    const attr = (k, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, a); return a; };
    this.aPos = attr('iPos', 3); this.aCol = attr('iCol', 4); this.aSR = attr('iSR', 2); this.attrs = [this.aPos, this.aCol, this.aSR];
    geo.instanceCount = 0;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]); uniforms.map = { value: tex };
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: SPRITE_VS, fragmentShader: SPRITE_FS, blending, transparent: true, depthWrite: false, fog: !!fog });
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; this.mesh.visible = false;
    this.mesh.renderOrder = blending === THREE.AdditiveBlending ? 7 : 3; scene.add(this.mesh);
    this.geo = geo; this.next = 0;
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
    if (live.length) for (const a of this.attrs) { a.needsUpdate = true; a.updateRange.count = live.length * a.itemSize; }   // upload only the live part
    this.geo.instanceCount = live.length; this.mesh.visible = live.length > 0;
  }
}

class Splashes {
  constructor(scene, n) {
    this.items = [];
    const geo = new THREE.ConeGeometry(0.55, 1, 7, 1, true); geo.translate(0, 0.5, 0);
    const rg = new THREE.RingGeometry(0.6, 1.0, 14); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const m = new THREE.MeshPhongMaterial({ color: 0xf2f6f8, transparent: true, opacity: 0, flatShading: true, depthWrite: false });
      const cone = new THREE.Mesh(geo, m); cone.visible = false; scene.add(cone);
      const rm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      const ring = new THREE.Mesh(rg, rm); ring.visible = false; scene.add(ring);
      this.items.push({ cone, ring, on: false, t: 0, big: 1, x: 0, z: 0 });
    }
    this.next = 0;
  }
  spawn(p, big) {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.items.length;
    it.on = true; it.t = 0; it.big = big; it.x = p.x; it.z = p.z; it.cone.visible = it.ring.visible = true;
  }
  update(dt, flowSpeed, tint) {
    for (const it of this.items) {
      if (!it.on) continue;
      it.t += dt; it.x -= flowSpeed * dt;
      const T = 1.8;
      if (it.t > T) { it.on = false; it.cone.visible = it.ring.visible = false; continue; }
      const k = it.t / T, y = waveH(it.x, it.z);
      const h = it.big * 3.2 * Math.sin(Math.min(1, k * 1.6) * Math.PI) + 0.01;
      it.cone.position.set(it.x, y - 0.2, it.z); it.cone.scale.set(it.big * (0.6 + k), h, it.big * (0.6 + k));
      it.cone.material.opacity = 0.85 * (1 - k); it.cone.material.color.copy(tint);
      const r = it.big * (0.5 + k * 3.5);
      it.ring.position.set(it.x, y + 0.05, it.z); it.ring.scale.set(r, 1, r); it.ring.material.opacity = 0.5 * (1 - k);
      it.ring.material.color.copy(tint);
    }
  }
}

class Foam {
  constructor(scene, n) {
    this.n = n; this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.v = new Float32Array(n * 2); this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.PointsMaterial({ size: 10, map: TEX.soft, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, fog: false });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 2; scene.add(this.pts);
    this.geo = g; this.next = 0; this.bright = 0.5;
  }
  emit(x, z, vx, vz, life) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 2] = z; this.v[i * 2] = vx; this.v[i * 2 + 1] = vz; this.life[i] = this.max[i] = life;
  }
  update(dt, flow) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.life[i] -= dt;
      const damp = Math.max(0, 1 - dt * 0.35); this.v[i * 2] *= damp; this.v[i * 2 + 1] *= damp;
      const x = this.pos[i * 3] += (this.v[i * 2] - flow) * dt;
      const z = this.pos[i * 3 + 2] += this.v[i * 2 + 1] * dt;
      this.pos[i * 3 + 1] = waveH(x, z) + 0.12;
      const t = this.life[i] / this.max[i];
      const a = this.bright * Math.min(1, t * 1.4) * Math.min(1, (1 - t) * 8 + 0.3);
      this.col[i * 3] = a; this.col[i * 3 + 1] = a; this.col[i * 3 + 2] = a;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
}

class FlashLights {
  constructor(scene, n) {
    this.items = [];
    for (let i = 0; i < n; i++) { const l = new THREE.PointLight(0xffb060, 0, 22, 2); scene.add(l); this.items.push({ l, t: 0, max: 0.1, I: 0 }); }
    this.next = 0;
  }
  flash(p, I, dur) {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.items.length;
    it.l.position.copy(p); it.t = it.max = dur; it.I = I;
  }
  update(dt, nightBoost) {
    for (const it of this.items) { it.t = Math.max(0, it.t - dt); it.l.intensity = it.t > 0 ? it.I * (it.t / it.max) * nightBoost : 0; }
  }
}
