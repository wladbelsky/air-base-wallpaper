'use strict';
/* ===== Low-poly model helpers, lights, searchlights, weapon mounts (land air defence, tanks) ===== */
const MAT_CACHE = {};
function M(color, o) {
  const k = color + '|' + (o ? JSON.stringify(o) : '');
  if (!MAT_CACHE[k]) {
    MAT_CACHE[k] = new THREE.MeshPhongMaterial(Object.assign({ color: color, flatShading: true, shininess: 8, specular: 0x151515 }, o || {}));
    MAT_CACHE[k].userData.shared = true;   // cached: never disposed with a model
  }
  return MAT_CACHE[k];
}
/* Free a removed model's GPU resources (cached materials and the sprite geometry all sprites share are kept) */
function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry && !o.isSprite) o.geometry.dispose();
    if (o.material && !o.material.userData.shared) o.material.dispose();
  });
}
/* Static meshes that share a material are merged into one mesh per material: far fewer draw calls
   in both the shadow and the main pass. `dynamic` nodes (moving or toggled parts) stay separate;
   the static meshes inside each of them are merged the same way.                                  */
const _mInv = new THREE.Matrix4(), _mRel = new THREE.Matrix4();
function concatF32(arrs) { let n = 0; for (const a of arrs) n += a.length; const out = new Float32Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; }
function mergeStatic(root, dynamic) {
  const skip = new Set(dynamic.filter(Boolean)), nested = [], groups = new Map();
  root.updateMatrixWorld(true); _mInv.copy(root.matrixWorld).invert();
  (function walk(o) {
    for (const c of o.children) {
      if (skip.has(c)) { nested.push(c); continue; }
      const mt = c.material;
      if (c.isMesh && !c.children.length && mt && !Array.isArray(mt) && !mt.transparent && !mt.map && c.geometry.attributes.normal) {
        const key = mt.uuid + '|' + c.castShadow + '|' + c.receiveShadow;
        (groups.get(key) || groups.set(key, []).get(key)).push(c);
      }
      walk(c);
    }
  })(root);
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const pos = [], nor = [];
    for (const m of list) {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(_mRel.multiplyMatrices(_mInv, m.matrixWorld));
      pos.push(g.attributes.position.array); nor.push(g.attributes.normal.array);
      g.dispose(); m.geometry.dispose(); m.removeFromParent();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(concatF32(pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(concatF32(nor), 3));
    const mesh = new THREE.Mesh(geo, list[0].material);
    mesh.castShadow = list[0].castShadow; mesh.receiveShadow = list[0].receiveShadow;
    root.add(mesh);
  }
  for (const d of nested) mergeStatic(d, dynamic);
}
const mm = c => (c && c.isMaterial) ? c : M(c);
function shade(m, cast) { m.castShadow = cast !== false; m.receiveShadow = true; return m; }
function box(p, w, h, d, c, x, y, z) { const m = shade(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mm(c))); m.position.set(x, y, z); p.add(m); return m; }
function cyl(p, rt, rb, h, seg, c, x, y, z) { const m = shade(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mm(c))); m.position.set(x, y, z); p.add(m); return m; }
/* Box whose top face is scaled (tx, tz) and shifted (sx) — sloped walls */
function taper(p, w, h, d, c, x, y, z, tx, tz, sx) {
  const g = new THREE.BoxGeometry(w, h, d), pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) { pos.setX(i, pos.getX(i) * tx + (sx || 0)); pos.setZ(i, pos.getZ(i) * tz); }
  g.computeVertexNormals();
  const m = shade(new THREE.Mesh(g, mm(c))); m.position.set(x, y, z); p.add(m); return m;
}
/* Prism from an XZ outline ([[x,z],...]) from y0 with height h */
function prism(p, pts, y0, h, c) {
  const s = new THREE.Shape();
  pts.forEach((q, i) => i ? s.lineTo(q[0], -q[1]) : s.moveTo(q[0], -q[1]));
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  const m = shade(new THREE.Mesh(g, mm(c))); p.add(m); return m;
}
/* Pole between two points */
function strut(p, a, b, r, c) {
  const d = new V3().subVectors(b, a), L = d.length();
  const m = shade(new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 4), mm(c)));
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize()); p.add(m); return m;
}
const DECK_MARK_MATS = {};
function deckLine(p, x1, z1, x2, z2, w, color, y) {
  if (!DECK_MARK_MATS[color]) {
    DECK_MARK_MATS[color] = new THREE.MeshPhongMaterial({ color, flatShading: true, shininess: 4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    DECK_MARK_MATS[color].userData.shared = true;
  }
  const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz);
  const g = new THREE.PlaneGeometry(L, w); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, DECK_MARK_MATS[color]); m.receiveShadow = true;
  m.position.set((x1 + x2) / 2, y, (z1 + z2) / 2); m.rotation.y = Math.atan2(-dz, dx);
  p.add(m); return m;
}
function dashed(p, x1, z1, x2, z2, w, color, y, dash, gap) {
  const L = Math.hypot(x2 - x1, z2 - z1), ux = (x2 - x1) / L, uz = (z2 - z1) / L;
  for (let s = 0; s < L; s += dash + gap) { const e = Math.min(L, s + dash); deckLine(p, x1 + ux * s, z1 + uz * s, x1 + ux * e, z1 + uz * e, w, color, y); }
}
function windowMat() { return new THREE.MeshPhongMaterial({ color: 0x14202c, emissive: 0x000000, shininess: 70, specular: 0x7090b0, flatShading: true }); }

/* ===== Navigation lights (point sprites) ===== */
const NAV_MATS = [];
function navLights(parent, list, blink, scale) {
  const pos = [], col = [], c = new THREE.Color();
  list.forEach(l => { pos.push(l[0], l[1], l[2]); c.setHex(l[3]); col.push(c.r, c.g, c.b); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 8, map: TEX.glow, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, fog: false, opacity: 0 });
  m.userData = { scale: scale || 1.1, blink: blink || null };
  NAV_MATS.push(m);
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 5;
  parent.add(pts); return pts;
}

/* ===== Searchlights with visible beam ===== */
const SEARCHLIGHTS = [];
function coneMaterial(color, len) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 }, uLen: { value: len } },
    vertexShader: `uniform float uLen; varying float vD; varying float vRim;
      void main(){ vD = position.z/uLen; vec3 n = normalize(normalMatrix*normal); vRim = abs(n.z);
      gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vD; varying float vRim;
      void main(){ float d = clamp(vD,0.0,1.0); float a = uOpacity*pow(1.0-d,1.7)*(0.25+0.75*pow(vRim,1.3)); gl_FragColor = vec4(uColor*a,1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
}
function makeSearchlight(parent, x, y, z, opts) {
  const o = Object.assign({ color: 0xfff1d6, angle: 0.16, len: 22, intensity: 2.2, cone: true, coneOpacity: 0.35, housing: true }, opts || {});
  const holder = new THREE.Object3D(); holder.position.set(x, y, z); parent.add(holder);
  let light = null;
  if (!o.noLight) {   // real light is optional: many spotlights get expensive on the GPU
    light = new THREE.SpotLight(o.color, 0, o.len * 2.2, o.angle, 0.45, 1.0);
    holder.add(light);
    const target = new THREE.Object3D(); target.position.set(0, 0, 10); holder.add(target); light.target = target;
  }
  if (o.housing) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 6), M(0x2b2f33)); h.rotation.x = Math.PI / 2; holder.add(h); }
  let cone = null;
  if (o.cone) {
    const g = new THREE.ConeGeometry(Math.tan(o.angle) * o.len, o.len, 20, 1, true);
    g.translate(0, -o.len / 2, 0); g.rotateX(-Math.PI / 2);
    cone = new THREE.Mesh(g, coneMaterial(o.color, o.len)); cone.renderOrder = 4; cone.frustumCulled = false;
    holder.add(cone);
  }
  const s = { holder, light, cone, o, enabled: 1 };
  SEARCHLIGHTS.push(s);
  return s;
}

/* ===== Weapons ===== */
function buildCIWS(parent, x, y, z, center, half) {
  cyl(parent, 0.26, 0.32, 0.3, 8, 0x747b83, x, y + 0.15, z);
  const yawG = new THREE.Group(); yawG.position.set(x, y + 0.3, z); parent.add(yawG);
  box(yawG, 0.38, 0.14, 0.38, 0x858c94, 0, 0.07, 0);
  box(yawG, 0.12, 0.3, 0.3, 0x6f767e, -0.2, 0.2, 0);
  const pitchG = new THREE.Group(); pitchG.position.set(0, 0.34, 0); yawG.add(pitchG);
  cyl(pitchG, 0.19, 0.21, 0.42, 8, 0xe6e8ea, -0.06, 0.08, 0);
  const dome = shade(new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), M(0xe6e8ea)));
  dome.position.set(-0.06, 0.29, 0); pitchG.add(dome);
  box(pitchG, 0.2, 0.2, 0.26, 0x9aa0a6, 0.12, -0.02, 0);
  const b = cyl(pitchG, 0.05, 0.05, 0.5, 6, 0x33363a, 0.45, -0.02, 0); b.rotation.z = -Math.PI / 2;
  const yaw = center * DEG;
  return { kind: 'ciws', yawG, pitchG, yaw, pitch: 0.4, tYaw: yaw, tPitch: 0.4, center: center * DEG, half: half * DEG,
    muzzle: new V3(0.72, -0.02, 0), yawRate: 5, pitchRate: 4, burst: 0, acc: 0, pmin: 0.12, pmax: 1.0 };
}
function buildGun(parent, x, y, z, center, half) {
  const yawG = new THREE.Group(); yawG.position.set(x, y, z); parent.add(yawG);
  cyl(yawG, 0.5, 0.55, 0.12, 10, 0x6d747b, 0, 0.06, 0);
  taper(yawG, 1.1, 0.42, 0.78, 0x7d858d, 0.05, 0.33, 0, 0.7, 0.72, -0.12); // faceted stealth turret
  box(yawG, 0.35, 0.12, 0.5, 0x747b83, -0.45, 0.2, 0);
  const pitchG = new THREE.Group(); pitchG.position.set(0.4, 0.3, 0); yawG.add(pitchG);
  const barrelG = new THREE.Group(); pitchG.add(barrelG);
  const b = cyl(barrelG, 0.05, 0.075, 1.8, 6, 0x5e656c, 0.9, 0, 0); b.rotation.z = -Math.PI / 2;
  const mz = cyl(barrelG, 0.07, 0.07, 0.12, 6, 0x4a5056, 1.78, 0, 0); mz.rotation.z = -Math.PI / 2;
  const yaw = center * DEG;
  return { kind: 'gun', yawG, pitchG, barrelG, yaw, pitch: 0.2, tYaw: yaw, tPitch: 0.2, center: center * DEG, half: half * DEG,
    muzzle: new V3(1.85, 0, 0), yawRate: 1.3, pitchRate: 0.8, recoil: 0, pmin: 0.08, pmax: 0.55 };
}
function mountRetarget(m) { m.tYaw = m.center + rand(-m.half, m.half); m.tPitch = rand(m.pmin, m.pmax); }
function mountUpdate(m, dt) {
  m.yaw = approachAngle(m.yaw, m.tYaw, m.yawRate * dt);
  m.pitch += clamp(m.tPitch - m.pitch, -m.pitchRate * dt, m.pitchRate * dt);
  m.yawG.rotation.y = m.yaw; m.pitchG.rotation.z = m.pitch;
  if (m.barrelG) { m.recoil = Math.max(0, m.recoil - dt * 1.4); m.barrelG.position.x = -m.recoil * 0.9; }
}
const _mq = new THREE.Quaternion();
function mountMuzzle(m, outPos, outDir) {
  m.pitchG.updateWorldMatrix(true, false);
  outPos.copy(m.muzzle).applyMatrix4(m.pitchG.matrixWorld);
  m.pitchG.getWorldQuaternion(_mq);
  outDir.set(1, 0, 0).applyQuaternion(_mq);
}


/* ===== Seasonal shared materials: roofs and shelter arches turn white in winter (terrain.js sets their colour) ===== */
function sharedMat(color, o) { const m = new THREE.MeshPhongMaterial(Object.assign({ color, flatShading: true, shininess: 6, specular: 0x111111 }, o || {})); m.userData.shared = true; return m; }
const ROOF_MAT = sharedMat(0x5d636a), ARCH_MAT = sharedMat(0x8a8a80);
const ARCH_COLORS = { spring: 0x8a8a80, summer: 0xa89a7c, autumn: 0x86847a, winter: 0xe4eaf0 };

/* ===== Land air defence and armour (mounts share the ship-gun API: yawG / pitchG / barrelG, muzzle, rates, arcs) =====
   Every builder adds its static parts to `parent` and returns the mount; the caller lists yawG / pitchG / barrelG as
   dynamic for mergeStatic. Local +X of pitchG is the barrel / launch direction. center / half: firing arc (degrees). */
const OLIVE = 0x5a5f45, OLIVE2 = 0x4a4f38, DARK = 0x2a2d2f;
function mountBase(parent, x, y, z, kind, center, half, o) {
  const yawG = new THREE.Group(); yawG.position.set(x, y, z); parent.add(yawG);
  const pitchG = new THREE.Group(); yawG.add(pitchG);
  const yaw = center * DEG;
  return Object.assign({ kind, yawG, pitchG, yaw, pitch: 0.2, tYaw: yaw, tPitch: 0.2, center: yaw, half: half * DEG, yawRate: 1.2, pitchRate: 0.8, recoil: 0, pmin: 0.05, pmax: 0.6, burst: 0, acc: 0 }, o || {});
}
/* local offset (along the facing `deg`) from a site centre, in world x / z */
const fwdX = (deg, d) => Math.cos(deg * DEG) * d, fwdZ = (deg, d) => -Math.sin(deg * DEG) * d;
/* C-RAM: a Phalanx on a flatbed trailer */
function buildCRAM(parent, x, z, center, half) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = center * DEG; parent.add(g);
  box(g, 2.0, 0.35, 1.1, OLIVE, 0, 0.45, 0); box(g, 0.8, 0.12, 0.12, DARK, 1.3, 0.35, 0);
  for (const s of [-1, 1]) cyl(g, 0.16, 0.16, 0.12, 8, DARK, -0.4, 0.16, s * 0.5).rotation.x = Math.PI / 2;
  box(g, 0.6, 0.3, 0.9, OLIVE2, -0.7, 0.75, 0);                                        // generator
  return buildCIWS(parent, x + fwdX(center, 0.3), 0.62, z + fwdZ(center, 0.3), center, half);
}
/* towed twin 35 mm AA gun: carriage, outriggers, two barrels (alternating muzzles) */
function buildAAGun(parent, x, z, center, half) {
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.785; box(parent, 1.1, 0.08, 0.16, OLIVE2, x + Math.cos(a) * 0.55, 0.06, z + Math.sin(a) * 0.55).rotation.y = -a; }
  cyl(parent, 0.45, 0.5, 0.2, 8, OLIVE2, x, 0.15, z);
  const m = mountBase(parent, x, 0.25, z, 'aa', center, half, { yawRate: 2.2, pitchRate: 1.6, pmin: 0.35, pmax: 1.3, muzzles: [new V3(1.6, 0, -0.18), new V3(1.6, 0, 0.18)], mi: 0 });
  box(m.yawG, 0.9, 0.5, 0.9, OLIVE, -0.05, 0.3, 0); box(m.yawG, 0.3, 0.3, 0.5, OLIVE2, -0.55, 0.35, 0);
  // fire control (Gepard / Skyguard style): a search antenna on a short mast at the back, spinning in a fight (m.search:
  // dynamic, the caller lists it), and a tracking dish on the gun cradle that follows the aim
  cyl(m.yawG, 0.04, 0.05, 0.35, 5, DARK, -0.55, 0.66, 0);
  m.search = new THREE.Group(); m.search.position.set(-0.55, 0.86, 0); m.yawG.add(m.search);
  box(m.search, 0.07, 0.22, 0.72, 0x6a6f60, 0.02, 0.06, 0).rotation.z = 0.25; box(m.search, 0.12, 0.05, 0.1, DARK, -0.04, -0.04, 0);
  m.pitchG.position.set(0.15, 0.55, 0);
  const dish = cyl(m.pitchG, 0.17, 0.17, 0.05, 10, 0x6a6f60, 0.05, 0.3, 0); dish.rotation.z = -Math.PI / 2;   // tracking radar, facing along the guns
  m.barrelG = new THREE.Group(); m.pitchG.add(m.barrelG);
  for (const s of [-1, 1]) { box(m.barrelG, 0.5, 0.18, 0.12, OLIVE, 0.25, 0, s * 0.18); const b = cyl(m.barrelG, 0.03, 0.04, 1.3, 5, DARK, 1.0, 0, s * 0.18); b.rotation.z = -Math.PI / 2; }
  m.muzzle = m.muzzles[0];
  return m;
}
/* M1 Abrams in its revetment: hull, tracks, turret (yawG) with the gun (pitchG / barrelG); center = facing (degrees) */
function buildTank(parent, x, z, center, half, revet) {
  const C = 0x6b6a4e, C2 = 0x57563e, base = new THREE.Group(); base.position.set(x, 0, z); base.rotation.y = center * DEG; parent.add(base);
  if (revet) for (const [bx, bz, w, d] of [[-1.9, 0, 0.9, 3.6], [-0.3, 1.75, 4.0, 0.8], [-0.3, -1.75, 4.0, 0.8]]) taper(base, w, 0.7, d, 0x6e6250, bx, 0.35, bz, 0.6, 0.6);   // earth berm, open to the front
  taper(base, 2.6, 0.32, 1.25, C, 0, 0.42, 0, 0.92, 0.95, 0.05);                      // hull
  for (const s of [-1, 1]) { box(base, 2.7, 0.3, 0.32, DARK, 0, 0.17, s * 0.6); box(base, 2.6, 0.06, 0.36, C2, 0, 0.35, s * 0.6); }   // tracks, skirts
  const m = mountBase(parent, x + fwdX(center, -0.1), 0.6, z + fwdZ(center, -0.1), 'tank', center, half, { yawRate: 0.7, pitchRate: 0.4, pmin: 0.0, pmax: 0.22, muzzle: new V3(1.75, 0, 0) });
  taper(m.yawG, 1.5, 0.32, 1.15, C, -0.05, 0.16, 0, 0.85, 0.9, 0.08);                 // turret
  box(m.yawG, 0.45, 0.22, 0.9, C2, -0.85, 0.15, 0);                                    // bustle
  cyl(m.yawG, 0.1, 0.1, 0.1, 6, DARK, -0.2, 0.37, 0.3);                                // commander's weapon station
  m.pitchG.position.set(0.6, 0.15, 0);
  m.barrelG = new THREE.Group(); m.pitchG.add(m.barrelG);
  const b = cyl(m.barrelG, 0.045, 0.06, 1.6, 6, C2, 0.8, 0, 0); b.rotation.z = -Math.PI / 2;
  const ev = cyl(m.barrelG, 0.075, 0.075, 0.25, 6, C2, 0.85, 0, 0); ev.rotation.z = -Math.PI / 2;   // bore evacuator
  return m;
}
/* Patriot / NASAMS launcher: truck or trailer, canister pack raised on pitchG (fixed elevation), slews in yaw */
function buildSamLauncher(parent, x, z, center, half, kind) {
  const nasams = kind === 'nasams', L = nasams ? 1.7 : 2.6, W = nasams ? 0.95 : 1.3, cells = [], el = nasams ? 0.55 : 0.66;
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = center * DEG; parent.add(g);
  box(g, L + 1.2, 0.3, W, OLIVE2, -0.2, 0.4, 0);                                       // bed
  for (const xx of [-0.9, 0.0, 0.9]) for (const s of [-1, 1]) { const w = cyl(g, 0.2, 0.2, 0.16, 8, DARK, xx, 0.2, s * (W / 2)); w.rotation.x = Math.PI / 2; }
  if (!nasams) { box(g, 0.9, 0.7, W, OLIVE, L / 2 + 0.75, 0.75, 0); box(g, 0.05, 0.25, W * 0.8, 0x14202c, L / 2 + 1.21, 0.9, 0); }   // M983 cab
  const m = mountBase(parent, x + fwdX(center, -0.6), 0.7, z + fwdZ(center, -0.6), 'sam', center, half, { yawRate: 0.35, pitchRate: 0.3, pmin: el, pmax: el, pitch: el, tPitch: el, sam: kind });
  cyl(m.yawG, 0.3, 0.35, 0.15, 8, OLIVE2, 0, 0, 0);
  const rows = nasams ? [[-0.25, 0.22], [0.25, 0.22], [-0.25, 0.62], [0.25, 0.62], [-0.25, 1.02], [0.25, 1.02]] : [[-0.3, 0.32], [0.3, 0.32], [-0.3, 0.95], [0.3, 0.95]];
  const pack = new THREE.Group(); pack.position.set(-L * 0.45, 0.1, 0); m.pitchG.add(pack);
  for (const [cz, cy] of rows) {
    box(pack, L, nasams ? 0.36 : 0.58, nasams ? 0.44 : 0.56, nasams ? 0x6a6f55 : OLIVE, L / 2, cy, cz);
    cells.push(new V3(L + 0.05, cy, cz).add(pack.position));
  }
  m.cells = cells; m.muzzle = cells[0];
  return m;
}
/* Avenger: a HMMWV with a turret carrying two Stinger pods */
function buildAvenger(parent, x, z, center, half) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = center * DEG; parent.add(g);
  taper(g, 1.9, 0.45, 0.95, 0x6a6a4c, 0, 0.5, 0, 0.92, 0.95);                           // HMMWV body
  taper(g, 0.6, 0.3, 0.9, 0x6a6a4c, 0.55, 0.85, 0, 0.8, 0.95, -0.05);                  // cab
  box(g, 0.05, 0.18, 0.75, 0x14202c, 0.86, 0.85, 0);
  for (const xx of [-0.6, 0.6]) for (const s of [-1, 1]) { const w = cyl(g, 0.2, 0.2, 0.16, 8, DARK, xx, 0.2, s * 0.45); w.rotation.x = Math.PI / 2; }
  const m = mountBase(parent, x + fwdX(center, -0.4), 0.78, z + fwdZ(center, -0.4), 'shorad', center, half, { yawRate: 2.0, pitchRate: 1.4, pmin: 0.15, pmax: 1.2, muzzles: [new V3(0.75, 0.05, -0.42), new V3(0.75, 0.05, 0.42)], mi: 0 });
  cyl(m.yawG, 0.32, 0.36, 0.3, 8, 0x6a6a4c, 0, 0.15, 0);
  m.pitchG.position.set(0, 0.42, 0);
  for (const s of [-1, 1]) box(m.pitchG, 0.8, 0.28, 0.22, OLIVE, 0.35, 0.05, s * 0.42);
  box(m.pitchG, 0.3, 0.25, 0.5, DARK, 0.05, 0, 0);
  m.muzzle = m.muzzles[0];
  return m;
}
/* Patriot radar (AN/MPQ-65) on its trailer: a tilted phased-array face toward `center`. A phased array doesn't spin: its
   head (g.head: shelter and face on a turntable, dynamic — the caller lists it) is turned toward the threat (updateSite) */
function buildPatriotRadar(parent, x, z, center) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = center * DEG; parent.add(g);
  box(g, 2.6, 0.3, 1.2, OLIVE2, 0, 0.42, 0);
  for (const xx of [-0.9, 0.9]) for (const s of [-1, 1]) { const w = cyl(g, 0.2, 0.2, 0.16, 8, DARK, xx, 0.2, s * 0.6); w.rotation.x = Math.PI / 2; }
  cyl(g, 0.5, 0.55, 0.1, 10, DARK, 0.1, 0.62, 0);                                       // turntable
  const head = g.head = new THREE.Group(); head.position.set(0.1, 0, 0); g.add(head);
  box(head, 1.6, 0.8, 1.15, OLIVE, -0.4, 0.97, 0);
  const face = new THREE.Group(); face.position.set(0.6, 1.0, 0); face.rotation.z = 0.45; head.add(face);
  box(face, 0.18, 1.5, 1.5, OLIVE, 0, 0.55, 0); const d = cyl(face, 0.6, 0.6, 0.04, 12, 0x3f4436, 0.1, 0.55, 0); d.rotation.z = Math.PI / 2;
  return g;
}
