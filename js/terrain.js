'use strict';
/* ===== Terrain: the ground around the base and its vegetation, by season (SEASONS / seasonNow in core.js) =====
   One big plane with a tiled canvas texture (grass / sand / snow speckles) and large-scale vertex-colour patches;
   vegetation is one InstancedMesh per part (trunks, crowns…): a handful of draw calls for hundreds of trees.
   A season change rebuilds the texture and the vegetation (disposed, never leaked) and recolours roofs / arches.
   Weather: snowfall in winter, falling leaves in autumn — a points pool around the screen centre.          */
const _tm = new THREE.Matrix4(), _tq = new THREE.Quaternion(), _ts = new V3(), _tp = new V3(), _tc = new THREE.Color();
/* cheap value noise for patches and forest clumps (deterministic for a seed) */
function vnoise(x, z, seed) {
  const h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return lerp(lerp(h(xi, zi), h(xi + 1, zi), u), lerp(h(xi, zi + 1), h(xi + 1, zi + 1), u), v);
}
/* areas kept free of vegetation: runway strip, taxiway, apron, buildings, roads (rectangles [x0, z0, x1, z1]) */
function vegBlocked(x, z) {
  const R = BASE_LAYOUT.rwy;
  if (x > R.x0 - 40 && x < R.x1 + 12 && (Math.abs(z - R.z) < 9 || Math.abs(z - BASE_LAYOUT.rwy2.z) < 9)) return true;   // runway strips + approach lights (both, whatever the mode)
  if (x > -76 && x < 76 && z > -32 && z < 2) return true;                               // taxiway, apron, remote stands
  if (x > -54 && x < 46 && z > -54 && z < -30) return true;                             // hangars, tower, buildings
  if (x > 4 && x < 36 && z > 26 && z < 50) return true;                                  // heliport
  if (x > -13 && x < 5 && z > 24 && z < 38) return true;                                 // fire station
  if (roadDist(x, z) < BL.ROAD_W / 2 + 1.2) return true;                                 // roads
  const gp = BASE_LAYOUT.gatePos, go = BASE_LAYOUT.gateOut;
  if (gp) { const dx = x - gp.x, dz = z - gp.z, along = dx * go.x + dz * go.z, side = Math.abs(dx * go.z - dz * go.x); if (along > -6 && side < 4) return true; }
  return false;
}
/* inside the fence polygon (vegetation is sparse there: a few trees between the buildings) */
function insideFence(x, z) {
  const P = BASE_LAYOUT.fence; let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
/* a geometry from parts with per-vertex colours (one InstancedMesh per vegetation kind) */
function vegGeometry(parts) {
  const pos = [], nor = [], col = [], c = new THREE.Color();
  for (const [geo, hex, x, y, z, sx, sy, sz] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo; g.scale(sx || 1, sy || 1, sz || 1); g.translate(x || 0, y || 0, z || 0); g.computeVertexNormals();
    c.setHex(hex);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    g.dispose(); if (g !== geo) geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}
const VEG_MAT = sharedMat(0xffffff, { vertexColors: true });
/* vegetation kinds: geometry (built per season), how many, size range, where (forest clumps or scattered), tint list */
function vegKinds(season) {
  const S = SEASONS[season], ico = (r, d) => new THREE.IcosahedronGeometry(r, d || 0), cone = (r, h, s) => new THREE.ConeGeometry(r, h, s || 6), cy = (a, b, h, s) => new THREE.CylinderGeometry(a, b, h, s || 5);
  if (S.veg === 'fir') return [
    { geo: vegGeometry([[cy(0.12, 0.16, 0.8), 0x4a3a2a, 0, 0.4, 0], [cone(1.0, 1.6, 7), 0x1f3d2a, 0, 1.4, 0], [cone(0.8, 1.3, 7), 0x24452f, 0, 2.2, 0], [cone(0.55, 1.1, 7), 0x2a4d34, 0, 2.95, 0],
      [cone(0.86, 0.5, 7), 0xf2f6fa, 0, 1.78, 0], [cone(0.66, 0.42, 7), 0xf2f6fa, 0, 2.5, 0], [cone(0.42, 0.45, 7), 0xf6f8fb, 0, 3.32, 0]]), n: 900, size: [0.8, 1.6], clump: 0.42, tint: [0xffffff, 0xe8f0e8, 0xf4f4ec] },
    { geo: vegGeometry([[cy(0.06, 0.09, 1.6, 4), 0x8a8478, 0, 0.8, 0], [ico(0.5), 0x9a9488, 0, 1.6, 0, 1, 1.3, 1]]), n: 160, size: [0.7, 1.2], clump: 0.6, tint: [0xffffff, 0xdddddd] },   // bare birch
    { geo: vegGeometry([[ico(0.6), 0xf0f4f8, 0, 0.15, 0, 1.4, 0.45, 1.1]]), n: 260, size: [0.6, 1.8], clump: 0, tint: [0xffffff, 0xe6eef6] }                                        // snow drifts
  ];
  if (S.veg === 'desert') return [
    { geo: vegGeometry([[cy(0.2, 0.22, 2.2, 7), 0x4f7a3a, 0, 1.1, 0], [ico(0.21, 1), 0x4f7a3a, 0, 2.2, 0], [cy(0.13, 0.13, 0.7, 6), 0x4a7236, 0.45, 1.2, 0, 1, 1, 1],
      [cy(0.13, 0.13, 0.9, 6), 0x4a7236, 0.62, 1.7, 0], [ico(0.13, 1), 0x4a7236, 0.62, 2.15, 0], [cy(0.12, 0.12, 0.6, 6), 0x4a7236, -0.4, 1.0, 0.05], [cy(0.12, 0.12, 0.7, 6), 0x4a7236, -0.55, 1.4, 0.05], [ico(0.12, 1), 0x4a7236, -0.55, 1.75, 0.05]]),
      n: 260, size: [0.7, 1.3], clump: 0, tint: [0xffffff, 0xd8e8c8, 0xf0f0d8] },                                                                                                       // saguaro
    { geo: vegGeometry([[ico(0.35, 1), 0x5a8040, 0, 0.3, 0, 1, 0.8, 1]]), n: 200, size: [0.6, 1.2], clump: 0, tint: [0xffffff, 0xe0d8b0] },                                         // barrel cactus
    { geo: vegGeometry([[ico(0.5), 0x9a8a6a, 0, 0.25, 0, 1.2, 0.7, 1]]), n: 420, size: [0.5, 2.2], clump: 0.25, tint: [0xffffff, 0xd8c8a8, 0xb8a888, 0xe0d0b8] },               // rocks
    { geo: vegGeometry([[ico(0.45), 0x8a7a48, 0, 0.3, 0, 1, 0.7, 1], [ico(0.3), 0x7a6a3c, 0.3, 0.25, 0.2]]), n: 380, size: [0.5, 1.1], clump: 0, tint: [0xffffff, 0xd0c090, 0xb8a070] }   // dry shrubs
  ];
  // spring / autumn: deciduous trees (crown tint from the season's leaf colours), bushes, a few firs
  return [
    { geo: vegGeometry([[cy(0.12, 0.17, 1.4), 0x5a4632, 0, 0.7, 0], [ico(0.95, 1), 0xffffff, 0, 1.9, 0, 1, 0.9, 1], [ico(0.6, 1), 0xffffff, 0.45, 2.35, 0.2]]), n: 820, size: [0.8, 1.6], clump: 0.42, tint: S.leaf, leafy: true },
    { geo: vegGeometry([[ico(0.55, 1), 0xffffff, 0, 0.4, 0, 1.2, 0.8, 1]]), n: 360, size: [0.6, 1.3], clump: 0.2, tint: S.leaf, leafy: true },
    { geo: vegGeometry([[cy(0.1, 0.14, 0.7), 0x4a3a2a, 0, 0.35, 0], [cone(0.9, 1.5, 7), 0x2a4a30, 0, 1.3, 0], [cone(0.65, 1.2, 7), 0x2e5236, 0, 2.1, 0]]), n: 160, size: [0.9, 1.5], clump: 0.55, tint: [0xffffff, 0xe0f0e0] }
  ];
}
/* the leafy part of a deciduous geometry is white in the vertex colours: only it takes the tint; trunks stay brown —
   done by tinting per instance and letting the trunk colour be dark enough not to show the tint much */

/* the south runway's strip with one runway: scrub and trees (TERRAIN.fill), clear of the yard there and the fire
   station's way up to the runway */
function fillSpot(x, z) {
  const R = BASE_LAYOUT.rwy, R2 = BASE_LAYOUT.rwy2;
  if (x < R2.x0 - 1 || x > R2.x1 + 1 || z < R.z + R.w / 2 + 2.2 || z > 25.6) return false;
  if (x > -9.5 && x < 1.5) return false;
  for (const [cx, cz, r] of BASE_LAYOUT.fillYard) if (Math.hypot(x - cx, z - cz) < r) return false;
  return true;
}
const TERRAIN = {
  season: null, ground: null, veg: [], fill: [], fillOn: false, tex: null, weather: null,
  /* the fill shows with one runway only (BASE.setRunways) */
  setFill(on) { this.fillOn = on; for (const f of this.fill) f.visible = on; },
  /* build or rebuild for a season */
  build(season) {
    this.season = season;
    const S = SEASONS[season];
    if (!this.ground) {
      let geo = new THREE.PlaneGeometry(1000, 1000, 100, 100); geo.rotateX(-Math.PI / 2);
      geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
      this.ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }));
      this.ground.receiveShadow = true; this.ground.position.y = -0.02; scene.add(this.ground);
    }
    // large-scale patches: darker / lighter areas, a trampled ring inside the fence
    const pos = this.ground.geometry.attributes.position, col = this.ground.geometry.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), n = vnoise(x / 38, z / 38, 3) * 0.6 + vnoise(x / 11, z / 11, 7) * 0.4;
      const k = 0.82 + n * 0.32 - (insideFence(x, z) && S.veg !== 'fir' ? 0.06 : 0);
      col.setXYZ(i, k, k, k);
    }
    col.needsUpdate = true;
    if (this.tex) this.tex.dispose();
    this.tex = this.groundTex(S); this.ground.material.map = this.tex; this.ground.material.needsUpdate = true;
    ROOF_MAT.color.setHex(S.roof); ARCH_MAT.color.setHex(ARCH_COLORS[season]);
    this.buildVeg(season);
    this.buildWeather(season);
  },
  groundTex(S) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.fillStyle = '#' + S.ground.toString(16).padStart(6, '0'); g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = '#' + pick(S.grass).toString(16).padStart(6, '0'); g.globalAlpha = rand(0.25, 0.75);
      const x = rand(0, 256), y = rand(0, 256), w = rand(1, 4), h = rand(1, S.veg === 'leaf' ? 5 : 3);
      g.fillRect(x, y, w, h); if (x + w > 256) g.fillRect(x - 256, y, w, h); if (y + h > 256) g.fillRect(x, y - 256, w, h);
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60); t.anisotropy = 4;
    return t;
  },
  buildVeg(season) {
    for (const v of this.veg) { scene.remove(v); v.geometry.dispose(); v.dispose(); }   // the mesh too: its instance buffers
    for (const f of this.fill) { scene.remove(f); f.dispose(); }                         // shares the geometry of its kind
    this.veg = []; this.fill = [];
    let seed = { spring: 11, summer: 23, autumn: 37, winter: 41 }[season];
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };   // same layout every rebuild
    for (const K of vegKinds(season)) {
      const inst = new THREE.InstancedMesh(K.geo, VEG_MAT, K.n);
      let n = 0, tries = 0;
      while (n < K.n && tries++ < K.n * 30) {
        const r = 12 + Math.pow(rnd(), 0.8) * 230, a = rnd() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (vegBlocked(x, z)) continue;
        if (insideFence(x, z) && rnd() > 0.2) continue;                                     // the base itself is mostly open ground
        if (K.clump && vnoise(x / 24, z / 24, 5 + K.n) < K.clump && rnd() > 0.08) continue;   // forests in clumps
        const s = lerp(K.size[0], K.size[1], rnd());
        _tq.setFromAxisAngle(WUP_T, rnd() * TAU); _ts.set(s, s * lerp(0.85, 1.2, rnd()), s);
        inst.setMatrixAt(n, _tm.compose(_tp.set(x, 0, z), _tq, _ts));
        inst.setColorAt(n, _tc.setHex(K.tint[Math.floor(rnd() * K.tint.length)]));
        n++;
      }
      inst.count = n; inst.castShadow = true; inst.receiveShadow = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      scene.add(inst); this.veg.push(inst);
      // the fill on the south runway's strip: denser, in groves (snow drifts / rocks stay scattered)
      const nF = Math.round(K.n * 0.09), fill = new THREE.InstancedMesh(K.geo, VEG_MAT, nF);
      let m = 0; tries = 0;
      while (m < nF && tries++ < nF * 40) {
        const x = lerp(-66, 66, rnd()), z = lerp(10, 26, rnd());
        if (!fillSpot(x, z) || (K.clump && vnoise(x / 14, z / 14, 9 + K.n) < 0.45)) continue;
        const s = lerp(K.size[0], K.size[1], rnd());
        _tq.setFromAxisAngle(WUP_T, rnd() * TAU); _ts.set(s, s * lerp(0.85, 1.2, rnd()), s);
        fill.setMatrixAt(m, _tm.compose(_tp.set(x, 0, z), _tq, _ts));
        fill.setColorAt(m, _tc.setHex(K.tint[Math.floor(rnd() * K.tint.length)]));
        m++;
      }
      fill.count = m; fill.castShadow = true; fill.receiveShadow = true; fill.visible = this.fillOn;
      if (fill.instanceColor) fill.instanceColor.needsUpdate = true;
      scene.add(fill); this.fill.push(fill);
    }
  },
  /* snowflakes / leaves: a pool of points falling through a box around the screen centre; spawn by time, not by frame */
  buildWeather(season) {
    const kind = season === 'winter' ? 'snow' : season === 'autumn' ? 'leaves' : null;
    if (!this.weather) {
      const n = 900, g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.PointsMaterial({ size: 3, map: TEX.soft, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: false, opacity: 0.9 });
      const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 2; scene.add(pts);
      this.weather = { pts, n, v: new Float32Array(n * 3), life: new Float32Array(n), ph: new Float32Array(n), next: 0, acc: 0, kind: null };
    }
    const w = this.weather; w.kind = kind; w.life.fill(0);
    w.pts.material.size = kind === 'leaves' ? 4 : 3; w.pts.material.blending = kind === 'snow' ? THREE.AdditiveBlending : THREE.NormalBlending;
    w.pts.visible = !!kind;
  },
  update(dt) {
    const w = this.weather; if (!w) return;
    const on = w.kind && CFG.weather; w.pts.visible = !!on;
    if (!on) return;
    const P = w.pts.geometry.attributes.position.array, C = w.pts.geometry.attributes.color.array, snow = w.kind === 'snow';
    w.acc += dt * (snow ? 220 : 26);
    while (w.acc > 1) {
      w.acc--; const i = w.next; w.next = (w.next + 1) % w.n;
      const p = AIRWAR.groundAt(rand(-1.15, 1.15), rand(-1.2, 1.3), 0);
      P[i * 3] = p.x + rand(-8, 8); P[i * 3 + 1] = rand(14, 30); P[i * 3 + 2] = p.z + rand(-8, 8);
      w.v[i * 3] = WIND.x * (snow ? 0.8 : 1.4); w.v[i * 3 + 1] = snow ? -rand(2.2, 3.4) : -rand(1.2, 2); w.v[i * 3 + 2] = WIND.z * (snow ? 0.8 : 1.4);
      w.life[i] = 1; w.ph[i] = rand(0, TAU);
      const c = snow ? _tc.setRGB(0.8, 0.82, 0.86) : _tc.setHex(pick(SEASONS.autumn.leaf));
      C[i * 3] = c.r; C[i * 3 + 1] = c.g; C[i * 3 + 2] = c.b;
    }
    for (let i = 0; i < w.n; i++) {
      if (w.life[i] <= 0) { P[i * 3 + 1] = -50; continue; }
      const sway = Math.sin(T * (snow ? 1.3 : 2.4) + w.ph[i]) * (snow ? 0.6 : 1.6);
      P[i * 3] += (w.v[i * 3] + sway) * dt; P[i * 3 + 1] += w.v[i * 3 + 1] * dt; P[i * 3 + 2] += (w.v[i * 3 + 2] + sway * 0.5) * dt;
      if (P[i * 3 + 1] < 0.05) w.life[i] = 0;
    }
    w.pts.geometry.attributes.position.needsUpdate = true; w.pts.geometry.attributes.color.needsUpdate = true;
    if (snow) w.pts.material.opacity = lerp(0.55, 0.9, ENV.night);
  }
};
const WUP_T = new V3(0, 1, 0);
