'use strict';
/* ===== Low-poly models: carrier, destroyers, jets, helicopters ===== */
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
/* Octagonal phased-array face: normal along azimuth ang (0 = +X), tilted back, on an angled housing of colour mount
   behind it: set at a deckhouse corner, the face sits flush on that bevel instead of half inside the walls. */
function arrayFace(p, x, y, z, ang, r, c, mount) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ang; p.add(g);
  const t = new THREE.Group(); t.rotation.z = 0.25; g.add(t);
  const m = cyl(t, r, r, 0.05, 8, c, 0, 0, 0); m.rotation.z = Math.PI / 2; m.rotation.x = Math.PI / 8;
  box(t, 0.4, r * 2.1, r * 2.1, mount, -0.225, 0, 0);
  return g;
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
/* Hull numbers — redrawn when the WE property changes */
const NUMBER_DECALS = { carrier: [] };
function numberDecal(key, w, h, style) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshPhongMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }));
  const d = { c, tex, style: style || 'deck' }; NUMBER_DECALS[key].push(d);
  drawDecal(d, CFG.numbers[key]); return mesh;
}
function drawDecal(d, text) {
  const x = d.c.getContext('2d'); x.clearRect(0, 0, 256, 128);
  x.font = 'bold 104px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (d.style === 'hull') { x.lineWidth = 10; x.strokeStyle = 'rgba(20,22,26,0.9)'; x.strokeText(text, 128, 68); }
  x.fillStyle = '#ecece4'; x.fillText(text, 128, 68);
  d.tex.needsUpdate = true;
}
function setShipNumbers() { for (const k in NUMBER_DECALS) for (const d of NUMBER_DECALS[k]) drawDecal(d, String(CFG.numbers[k] || '').slice(0, 4)); }
function hullNumber(g, key, x, y, z, w, psi) { const m = numberDecal(key, w, w / 2, 'hull'); m.position.set(x, y, z); m.rotation.y = psi; g.add(m); return m; }
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

/* ===== AIRCRAFT CARRIER ===== */
const CARRIER_DECK_Y = 2.3;
const HANGAR_Y = 1.05;
function buildCarrier() {
  const g = new THREE.Group();
  const HULL = 0x5c636b, HULL2 = 0x4c535a, DECK = 0x3a3e44, Y = CARRIER_DECK_Y, TRIM = 0x6a7179;
  // hull: lower, knuckle, flared upper
  prism(g, [[-15.4, 2.5], [9, 2.7], [15.3, 0.2], [15.3, -0.2], [9, -2.7], [-15.4, -2.5]], -1.4, 1.6, HULL2);
  prism(g, [[-15.6, 2.85], [9, 3.05], [15.6, 0.3], [15.6, -0.3], [9, -3.05], [-15.6, -2.85]], 0.2, 0.8, HULL);
  prism(g, [[-16, 3.25], [9, 3.4], [14.2, 2.1], [16.5, 0.45], [16.5, -0.7], [14, -2.5], [4, -3.4], [-16, -3.3]], 1.0, 1.0, HULL);
  prism(g, [[4.5, -3.3], [2.0, -4.05], [1.75, -5.25], [0, -5.3], [-9, -5.3], [-13.5, -5.1], [-15.6, -3.3]], 1.55, 0.45, HULL);   // angled-deck sponson
  prism(g, [[-15.45, 2.55], [9, 2.75], [15.35, 0.22], [15.35, -0.22], [9, -2.75], [-15.45, -2.55]], -0.05, 0.14, 0x2a2d31);
  // angled-deck sponson supports
  for (const [x, z] of [[0.8, -4.55], [-2, -4.6], [-7, -4.8], [-11.5, -4.9]]) taper(g, 0.5, 0.9, 1.2, HULL2, x, 1.1, z, 1, 1.5);
  // flight deck with notches for the deck-edge elevators; to port it reaches out under the whole angled deck
  // (its forward end is cut square to the landing area)
  const deckPts = [[-16.3, 3.6], [-5.5, 3.75], [-5.5, 3.45], [-2.7, 3.45], [-2.7, 3.78], [4.1, 3.83], [4.1, 3.45], [6.9, 3.45], [6.9, 3.86], [9, 3.9],
    [14.5, 2.6], [16.8, 0.9], [16.8, -1.2], [14, -3.2], [6, -3.8], [2.0, -4.35], [1.75, -5.55], [0, -5.62], [-9, -5.6], [-13.5, -5.4], [-16.3, -3.6]];
  prism(g, deckPts, 2.0, 0.3, DECK);
  // stern: hangar-bay transom openings + fantail
  box(g, 0.06, 0.5, 3.4, 0x1d2024, -16.02, 1.45, 0);
  box(g, 0.8, 0.08, 5.8, HULL, -16.2, 1.02, 0);
  // catwalks / galleries below deck edge
  box(g, 9.8, 0.08, 0.4, TRIM, -10.7, 2.0, 3.72); box(g, 7.4, 0.08, 0.4, TRIM, 0.6, 2.0, 3.72);
  box(g, 10, 0.08, 0.35, TRIM, -3.5, 2.0, -5.78); box(g, 8, 0.08, 0.35, TRIM, 9.5, 2.0, -3.5);
  // boats / life rafts along the hull
  for (let i = 0; i < 5; i++) { cyl(g, 0.12, 0.12, 0.35, 6, 0xd8d8d0, -14 + i * 0.5, 1.72, -3.45).rotation.x = Math.PI / 2; }
  for (let i = 0; i < 3; i++) box(g, 0.9, 0.28, 0.35, 0x6a7078, 8.5 + i * 1.3, 1.45, 3.45);
  // bow anchor hawse
  for (const s of [-1, 1]) box(g, 0.25, 0.25, 0.06, 0x202326, 13.2, 1.4, s * 1.95);

  // --- deck markings
  const my = Y + 0.006;
  const A0 = new V3(-15.6, 0, -1.2), AD = new V3(0.988, 0, -0.156).normalize(), AP = new V3(0.156, 0, 0.988);
  const aEnd = A0.clone().addScaledVector(AD, 17);
  dashed(g, A0.x, A0.z, aEnd.x, aEnd.z, 0.12, 0xd8d8d0, my, 0.8, 0.6);
  for (const s of [-1.35, 1.35]) { const a = A0.clone().addScaledVector(AP, s), b = aEnd.clone().addScaledVector(AP, s); deckLine(g, a.x, a.z, b.x, b.z, 0.08, 0xe0e0d8, my); }
  for (let i = 0; i < 4; i++) { const p = A0.clone().addScaledVector(AD, 5 + i * 1.2); const a = p.clone().addScaledVector(AP, -1.1), b = p.clone().addScaledVector(AP, 1.1); deckLine(g, a.x, a.z, b.x, b.z, 0.05, 0x9a9a92, my); } // arresting wires
  for (const cz of [-1.0, 1.2]) { deckLine(g, 3.2, cz, 15.9, cz, 0.1, 0x22252a, my); deckLine(g, 3.0, cz - 0.5, 3.0, cz + 0.5, 0.12, 0xd8b030, my); }
  deckLine(g, -15.6, 2.45, 13, 2.45, 0.07, 0xd8b030, my);
  const pads = [[-4.1, 2.2], [-13.8, 1.6]];
  for (const [x, z] of pads) { const r = new THREE.Mesh(new THREE.RingGeometry(0.85, 0.97, 18), DECK_MARK_MATS[0xe0e0d8]); r.rotation.x = -Math.PI / 2; r.position.set(x, my, z); g.add(r); }
  const nm = numberDecal('carrier', 3.6, 1.8); nm.rotation.x = -Math.PI / 2; nm.rotation.z = -Math.PI / 2; nm.position.set(13.2, my, 0.4); g.add(nm);
  hullNumber(g, 'carrier', 11.6, 1.5, 2.83, 1.6, 0.245); hullNumber(g, 'carrier', 11.6, 1.5, -2.9, 1.6, Math.PI - 0.3);

  // --- jet blast deflectors (raise behind a jet on the catapult)
  const jbds = [];
  for (const cz of [-1.0, 1.2]) {
    const piv = new THREE.Group(); piv.position.set(1.95, Y + 0.01, cz); g.add(piv);
    const pnl = box(piv, 0.9, 0.06, 1.7, 0x4b5057, -0.45, 0.03, 0);
    for (let i = -2; i <= 2; i++) box(pnl, 0.85, 0.03, 0.05, 0x3a3e44, 0, 0.04, i * 0.34);
    jbds.push({ piv, a: 0, z: cz });
  }

  // --- deck-edge elevators
  const lifts = [];
  function makeLift(x, z, w, d, hullZ) {
    const grp = new THREE.Group(); grp.position.set(x, Y, z); g.add(grp);
    box(grp, w, 0.15, d, DECK, 0, -0.075, 0);
    deckLine(grp, -w / 2 + 0.05, -d / 2 + 0.05, w / 2 - 0.05, -d / 2 + 0.05, 0.06, 0xd8b030, 0.004);
    deckLine(grp, -w / 2 + 0.05, d / 2 - 0.05, w / 2 - 0.05, d / 2 - 0.05, 0.06, 0xd8b030, 0.004);
    deckLine(grp, -w / 2 + 0.05, -d / 2, -w / 2 + 0.05, d / 2, 0.06, 0xd8b030, 0.004);
    deckLine(grp, w / 2 - 0.05, -d / 2, w / 2 - 0.05, d / 2, 0.06, 0xd8b030, 0.004);
    box(grp, 0.05, 0.25, d, 0x8a9096, -w / 2 - 0.02, 0.12, 0); // stanchions
    box(g, w - 0.1, 0.95, 0.06, 0x121518, x, HANGAR_Y + 0.47, hullZ); // hangar door opening
    box(g, w + 0.3, 0.08, 0.2, TRIM, x, HANGAR_Y + 0.98, hullZ + 0.08);
    for (const s of [-1, 1]) box(g, 0.12, 1.4, 0.12, TRIM, x + s * (w / 2 + 0.05), 1.55, hullZ + 0.08); // guide rails
    const L = { grp, x, z, w, d, hullZ, y: Y, target: Y, top: Y, bottom: HANGAR_Y, busy: null };
    lifts.push(L); return L;
  }
  makeLift(5.5, 4.72, 2.7, 2.5, 3.38);   // L1 — jets
  makeLift(-4.1, 4.62, 2.7, 2.4, 3.3);   // L2 — helicopters

  // --- island
  const I = new THREE.Group(); I.position.set(1.5, Y, 3.05); g.add(I);
  const W = windowMat();
  taper(I, 4.4, 1.1, 1.15, HULL, 0, 0.55, 0, 0.97, 0.92);
  box(I, 4.7, 0.06, 1.35, TRIM, 0, 1.12, 0);                          // catwalk
  taper(I, 3.8, 0.9, 1.05, HULL, -0.15, 1.6, 0, 0.96, 0.9);
  taper(I, 3.84, 0.14, 1.08, W, -0.15, 1.82, 0, 0.96, 0.9);
  box(I, 4.1, 0.06, 1.25, TRIM, -0.15, 2.07, 0);
  taper(I, 2.1, 0.62, 1.2, HULL, 0.85, 2.4, 0, 1.06, 1.1);            // navigation bridge (fwd)
  taper(I, 2.14, 0.2, 1.24, W, 0.85, 2.52, 0, 1.06, 1.1);
  taper(I, 1.4, 0.62, 1.15, HULL, -1.1, 2.4, 0, 1.08, 1.12);           // Pri-Fly (aft)
  taper(I, 1.44, 0.22, 1.2, W, -1.1, 2.52, 0, 1.08, 1.12);
  taper(I, 2.9, 0.4, 1.0, HULL, -0.1, 2.93, 0, 0.9, 0.85);
  box(I, 3.1, 0.05, 1.15, TRIM, -0.1, 3.14, 0);
  for (const [x, z] of [[-1.6, 0.3], [-0.9, -0.3], [1.2, 0.35]]) box(I, 0.35, 0.22, 0.3, 0x6f767d, x, 3.28, z); // AC units / lockers
  const num = numberDecal('carrier', 1.1, 0.55); num.position.set(-0.2, 1.35, 0.53); I.add(num);
  // tripod mast
  const mt = new V3(0.1, 6.3, 0);
  strut(I, new V3(-0.5, 3.15, -0.35), mt, 0.05, 0x50565d); strut(I, new V3(-0.5, 3.15, 0.35), mt, 0.05, 0x50565d); strut(I, new V3(0.7, 3.15, 0), mt, 0.05, 0x50565d);
  cyl(I, 0.05, 0.07, 1.75, 5, 0x50565d, 0.1, 7.125, 0);   // pole up through the radar: the masthead lights sit on top
  box(I, 0.9, 0.05, 0.9, TRIM, 0.1, 4.4, 0); box(I, 0.7, 0.05, 0.7, TRIM, 0.1, 5.4, 0);
  box(I, 0.06, 0.06, 2.0, 0x50565d, 0.1, 5.9, 0); box(I, 0.06, 0.06, 1.4, 0x50565d, 0.1, 6.5, 0);
  for (const s of [-1, 1]) { cyl(I, 0.012, 0.012, 0.8, 3, 0x333, 0.1, 6.35, s * 0.95); cyl(I, 0.012, 0.012, 0.6, 3, 0x333, 0.1, 6.8, s * 0.65); }
  // 3D air-search slab at the masthead, above the strut apex and the yards: its sweep (r ≈ 0.46) clears the whips
  const radar1 = new THREE.Group(); radar1.position.set(0.1, 7.0, 0); I.add(radar1);
  const slab = box(radar1, 0.1, 0.75, 0.75, 0x9aa1a8, 0.22, 0.35, 0); slab.rotation.z = 0.25; box(radar1, 0.18, 0.12, 0.18, 0x444, 0, 0.05, 0);
  const radar2 = new THREE.Group(); radar2.position.set(-1.6, 3.2, 0); I.add(radar2);          // 2D mesh antenna
  cyl(radar2, 0.06, 0.08, 0.5, 6, 0x555, 0, 0.25, 0);
  const mesh2 = box(radar2, 0.06, 0.45, 1.3, 0x8d949b, 0.12, 0.62, 0); mesh2.rotation.z = 0.2;
  for (const [x, y, r] of [[1.3, 3.35, 0.24], [-0.9, 3.35, 0.2], [0.6, 4.6, 0.16]]) { const d = shade(new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), M(0xdcdee0))); d.position.set(x, y, 0.35); I.add(d); }
  for (const [x, z, h] of [[1.7, -0.4, 0.9], [-1.9, 0.4, 0.42], [1.9, 0.4, 0.6]]) cyl(I, 0.015, 0.02, h, 3, 0x333, x, 3.15 + h / 2, z);   // whips (the aft one stays under the mesh antenna's sweep)

  // --- CIWS & RAM sponsons
  const ciws = [];
  const sp = [[12.4, 3.35, -80, 75], [-15.7, 3.2, -140, 50], [-15.2, -3.95, 140, 50], [10.8, -3.55, 80, 75]];
  for (const [x, z, c, h] of sp) { taper(g, 1.1, 0.5, 1.1, HULL, x, 1.7, z, 1, 1, 0); ciws.push(buildCIWS(g, x, 1.95, z, c, h)); }
  for (const [x, z] of [[8.2, -3.75], [-13.5, 3.6]]) {
    taper(g, 1.0, 0.4, 0.9, HULL, x, 1.75, z, 1, 1); const r = box(g, 0.45, 0.35, 0.45, 0xb8bcc0, x, 2.15, z); r.rotation.z = 0.35;
  }

  // --- navigation lights
  const lights = [];
  lights.push(navLights(g, [[1.6, Y + 8.05, 3.05, 0xffffff], [2.35, Y + 2.6, 2.35, 0xff2a1a], [2.35, Y + 2.6, 3.75, 0x22ff66], [-16.3, 2.1, 0, 0xffffff], [16.7, 2.4, 0, 0xffffff]], null, 1.5));
  lights.push(navLights(g, [[1.6, Y + 8.2, 3.05, 0xff2020]], { period: 1.2, duty: 0.25 }, 1.5));
  const edge = [];
  for (let s = 0; s <= 17; s += 1.4) for (const off of [-1.35, 1.35]) { const p = A0.clone().addScaledVector(AD, s).addScaledVector(AP, off); edge.push([p.x, Y + 0.05, p.z, 0xffd27a]); }
  for (let s = 0; s <= 17; s += 1.4) { const p = A0.clone().addScaledVector(AD, s); edge.push([p.x, Y + 0.05, p.z, 0xffffff]); }
  for (let x = -15; x <= 15; x += 2.5) if (!(x > -6 && x < -2.5) && !(x > 3.8 && x < 7.2)) edge.push([x, Y + 0.05, 3.5, 0x6aa8ff]);
  for (const cz of [-1.0, 1.2]) for (let x = 4; x <= 15.5; x += 1.6) edge.push([x, Y + 0.05, cz, 0x66ffaa]);
  lights.push(navLights(g, edge, null, 0.55));
  lights.push(navLights(g, [[-16.2, 1.2, -1.2, 0xffb040], [-16.2, 1.0, -1.2, 0xffb040], [-16.2, 0.8, -1.2, 0xffb040]], null, 0.9));

  const flood1 = makeSearchlight(g, 0.4, Y + 3.3, 2.4, { angle: 0.45, len: 16, intensity: 1.6, coneOpacity: 0.06, color: 0xffe6c0 });
  const flood2 = makeSearchlight(g, 2.6, Y + 3.3, 2.4, { angle: 0.45, len: 16, intensity: 1.6, coneOpacity: 0.06, color: 0xffe6c0 });
  flood1.localAim = new V3(-8, Y, -1.5); flood2.localAim = new V3(9, Y, -0.5);

  const wakeEmit = [
    { p: new V3(-16.2, 0, -2.2), rate: 26, vz: [-1.2, -0.2], life: 9 }, { p: new V3(-16.2, 0, 2.2), rate: 26, vz: [0.2, 1.2], life: 9 },
    { p: new V3(-16.4, 0, 0), rate: 22, vz: [-0.4, 0.4], life: 10 },
    { p: new V3(15.4, 0, -0.9), rate: 18, vz: [-2.2, -1.2], life: 5 }, { p: new V3(15.4, 0, 0.9), rate: 18, vz: [1.2, 2.2], life: 5 },
    { p: new V3(6, 0, -3.0), rate: 6, vz: [-1.2, -0.6], life: 5 }, { p: new V3(6, 0, 3.0), rate: 6, vz: [0.6, 1.2], life: 5 }
  ];
  mergeStatic(g, [...ciws.flatMap(c => [c.yawG, c.pitchG]), radar1, radar2, ...jbds.map(j => j.piv), ...lifts.map(L => L.grp), flood1.holder, flood2.holder]);
  return { group: g, ciws, guns: [], lights, radars: [radar1, radar2], winMat: W, floods: [flood1, flood2], wakeEmit, name: 'carrier',
    angled: { A0, AD, AP }, bob: 0.2, len: 33, lifts, jbds, pads };
}

/* ===== DESTROYER ===== */
function buildDestroyer(side) { // side: -1 = port of the carrier, +1 = starboard
  const g = new THREE.Group();
  const HULL = 0x646c75, HULL2 = 0x50575f, DECK = 0x474c52, TRIM = 0x737b84;
  prism(g, [[-7.4, 0.95], [2, 1.1], [7.6, 0.02], [7.6, -0.02], [2, -1.1], [-7.4, -0.95]], -0.7, 1.0, HULL2);
  prism(g, [[-7.5, 1.12], [2.3, 1.28], [7.95, 0.05], [7.95, -0.05], [2.3, -1.28], [-7.5, -1.12]], 0.3, 0.55, HULL);
  prism(g, [[-7.45, 1.1], [2.3, 1.26], [7.85, 0.05], [7.85, -0.05], [2.3, -1.26], [-7.45, -1.1]], 0.85, 0.25, HULL);
  prism(g, [[-7.4, 1.06], [2.3, 1.22], [7.75, 0.05], [7.75, -0.05], [2.3, -1.22], [-7.4, -1.06]], 1.1, 0.03, DECK);
  prism(g, [[-7.45, 0.97], [2, 1.12], [7.65, 0.04], [7.65, -0.04], [2, -1.12], [-7.45, -0.97]], -0.05, 0.12, 0x2a2d31);
  // bow bulwark & breakwater
  const bw = box(g, 0.08, 0.2, 1.6, TRIM, 4.35, 1.23, 0); bw.rotation.y = 0;
  // forward superstructure (bridge block) — sloped stealth walls
  const W = windowMat();
  taper(g, 2.4, 1.0, 2.05, HULL, 1.5, 1.63, 0, 0.9, 0.82);
  taper(g, 1.7, 0.72, 1.7, HULL, 1.65, 2.49, 0, 0.92, 0.85);
  taper(g, 1.74, 0.2, 1.74, W, 1.72, 2.62, 0, 0.93, 0.9, 0.05);
  for (const s of [-1, 1]) box(g, 0.5, 0.08, 0.5, TRIM, 2.0, 2.55, s * 1.05); // bridge wings
  taper(g, 1.2, 0.35, 1.3, HULL, 1.5, 3.02, 0, 0.85, 0.8);
  // SPY array faces (forward pair)
  // on the bridge block's forward corners (just outside them, on their angled housings)
  arrayFace(g, 2.57, 2.2, 0.87, -45 * DEG, 0.42, 0x7c848c, HULL);
  arrayFace(g, 2.57, 2.2, -0.87, 45 * DEG, 0.42, 0x7c848c, HULL);
  // midship deckhouse
  taper(g, 4.0, 1.0, 1.8, HULL, -1.4, 1.62, 0, 0.95, 0.84);
  // funnels (raked, tapered)
  for (const x of [-0.2, -2.3]) {
    const f = taper(g, 0.95, 1.0, 1.1, 0x5a6168, x, 2.6, 0, 0.8, 0.8, -0.1); f.rotation.z = 0.05;
    box(g, 0.6, 0.06, 0.75, 0x1d1f22, x - 0.12, 3.1, 0);
    for (const s of [-1, 1]) box(g, 0.2, 0.12, 0.2, 0x2a2d31, x - 0.2, 3.15, s * 0.2);
  }
  // aft superstructure with aft SPY faces
  taper(g, 1.4, 0.9, 1.6, HULL, -3.6, 2.5, 0, 0.9, 0.85);
  arrayFace(g, -4.28, 2.6, 0.75, -135 * DEG, 0.36, 0x7c848c, HULL);   // on the aft corners, same way
  arrayFace(g, -4.28, 2.6, -0.75, 135 * DEG, 0.36, 0x7c848c, HULL);
  cyl(g, 0.04, 0.06, 1.2, 5, 0x50565d, -3.6, 3.5, 0); box(g, 0.05, 0.05, 0.8, 0x50565d, -3.6, 3.8, 0);
  // hangar + flight deck
  taper(g, 1.8, 1.05, 1.9, HULL, -5.1, 1.63, 0, 0.95, 0.9);
  box(g, 0.04, 0.8, 1.2, 0x1d2024, -6.02, 1.55, 0);
  deckLine(g, -7.3, 0, -6.1, 0, 0.06, 0xe0e0d8, 1.14);
  const hr = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.52, 14), DECK_MARK_MATS[0xe0e0d8]); hr.rotation.x = -Math.PI / 2; hr.position.set(-6.7, 1.14, 0); g.add(hr);
  // tripod mast with yards, platforms & radars
  const top = new V3(0.8, 5.1, 0);
  strut(g, new V3(0.4, 3.2, -0.45), top, 0.045, 0x50565d); strut(g, new V3(0.4, 3.2, 0.45), top, 0.045, 0x50565d); strut(g, new V3(1.3, 3.2, 0), top, 0.045, 0x50565d);
  cyl(g, 0.035, 0.05, 1.1, 5, 0x50565d, 0.8, 5.6, 0);
  box(g, 0.06, 0.06, 1.6, 0x50565d, 0.8, 4.6, 0); box(g, 0.06, 0.06, 1.0, 0x50565d, 0.8, 5.25, 0);
  box(g, 0.55, 0.05, 0.55, TRIM, 0.8, 4.2, 0);
  const radar = new THREE.Group(); radar.position.set(0.8, 6.15, 0); g.add(radar);
  box(radar, 0.08, 0.14, 0.7, 0x9aa1a8, 0.08, 0.05, 0);
  const dome = shade(new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), M(0xdcdee0))); dome.position.set(0.8, 4.35, 0.35); g.add(dome);
  for (const s of [-1, 1]) cyl(g, 0.012, 0.012, 0.7, 3, 0x333, 0.8, 4.95, s * 0.75);
  // VLS
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) box(g, 0.3, 0.05, 0.3, 0x2f3338, 3.2 + i * 0.34, 1.15, -0.2 + j * 0.4);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) box(g, 0.3, 0.05, 0.3, 0x2f3338, -6.95 + i * 0.34, 1.15, -0.4 + j * 0.4);
  // anti-ship missile canisters
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) { const c = cyl(g, 0.07, 0.07, 0.9, 6, 0x6b7279, -1.2, 2.2 + i * 0.16, s * 0.35); c.rotation.z = Math.PI / 2 - 0.2; }
  // boats
  for (const s of [-1, 1]) { taper(g, 0.9, 0.22, 0.35, 0x8a8f94, -1.6, 1.3, s * 1.0, 0.9, 0.8); box(g, 0.9, 0.05, 0.36, 0xd06a2a, -1.6, 1.2, s * 1.0); }

  const outward = side < 0 ? 80 : -80;
  const gun = buildGun(g, 5.2, 1.13, 0, outward, 100);
  const ciws = [buildCIWS(g, -5.1, 2.15, 0, side < 0 ? 125 : -125, 65)];

  const lights = [];
  lights.push(navLights(g, [[0.8, 5.7, 0, 0xffffff], [2.0, 2.65, -1.3, 0xff2a1a], [2.0, 2.65, 1.3, 0x22ff66], [-7.5, 1.25, 0, 0xffffff]], null, 1.3));
  lights.push(navLights(g, [[0.8, 6.2, 0, 0xff2020]], { period: 1.5, duty: 0.2, phase: side * 0.4 }, 1.3));
  const sl = makeSearchlight(g, 2.1, 2.72, side * 1.3, { angle: 0.1, len: 26, intensity: 2.6, coneOpacity: 0.4 });
  sl.sweep = { base: -side * 90 * DEG, amp: 55 * DEG, speed: rand(0.12, 0.2), ph: rand(0, 6), dist: 20 };

  const wakeEmit = [
    { p: new V3(-7.5, 0, -0.8), rate: 14, vz: [-0.8, -0.1], life: 7 }, { p: new V3(-7.5, 0, 0.8), rate: 14, vz: [0.1, 0.8], life: 7 },
    { p: new V3(7.7, 0, -0.3), rate: 10, vz: [-1.8, -0.9], life: 4 }, { p: new V3(7.7, 0, 0.3), rate: 10, vz: [0.9, 1.8], life: 4 }
  ];
  mergeStatic(g, [gun.yawG, gun.pitchG, gun.barrelG, ...ciws.flatMap(c => [c.yawG, c.pitchG]), radar, sl.holder]);
  return { group: g, ciws, guns: [gun], lights, radars: [radar], winMat: W, floods: [], searchlights: [sl], wakeEmit, name: 'destroyer', side, bob: 0.55, len: 15 };
}

/* ===== Ships met on missions (missions.js VESSEL_KINDS): templates, cloned per mission; +X bow, waterline y = 0 ===== */
const hullPts = (L, B, bow) => [[-L / 2, B * 0.95], [L / 2 - bow, B], [L / 2, 0.03], [L / 2, -0.03], [L / 2 - bow, -B], [-L / 2, -B * 0.95]];
/* container feeder, ~120 m: containers forward, accommodation and funnel aft */
function buildFeeder() {
  const g = new THREE.Group(), RED = 0x6e2620, NAVY = 0x253445, DECK = 0x4a4f53, WH = 0xe6e6e0, WIN = M(0x14202c);
  prism(g, hullPts(12, 1.0, 2.6), -0.6, 0.6, RED);
  prism(g, hullPts(12.1, 1.05, 2.6), 0, 0.9, NAVY);
  prism(g, hullPts(11.9, 1.0, 2.5), 0.9, 0.03, DECK);
  const cols = [0x9a5b2e, 0x2f6b8a, 0x6f7f3a, 0xb8b8b0, 0x8a2f2f, 0x3c4f8a];
  let n = 0;
  for (let i = 0; i < 8; i++) for (const z of [-0.62, 0, 0.62]) {
    const tiers = 1 + ((i * 7 + Math.round(z * 10) * 3) % 3 === 0 ? 0 : 1) + (i % 3 === 1 ? 1 : 0);
    for (let k = 0; k < tiers; k++) box(g, 0.6, 0.27, 0.58, cols[(n++ * 5 + k) % cols.length], -3.0 + i * 0.72, 1.07 + k * 0.28, z);
  }
  taper(g, 1.5, 1.6, 1.8, WH, -4.7, 1.73, 0, 0.95, 0.9);                       // accommodation
  box(g, 1.52, 0.14, 1.82, WIN, -4.6, 2.3, 0);
  box(g, 1.7, 0.08, 2.2, WH, -4.5, 2.58, 0);                                     // bridge deck with wings
  const f = taper(g, 0.6, 0.9, 0.6, NAVY, -5.45, 2.95, 0, 0.85, 0.85); f.rotation.z = 0.05;   // funnel
  box(g, 0.62, 0.12, 0.62, 0xb83a2a, -5.45, 3.05, 0);
  cyl(g, 0.03, 0.04, 1.0, 5, 0x50565d, 5.2, 1.4, 0);                             // foremast
  mergeStatic(g, []); return g;
}
/* fishing trawler, ~35 m: wheelhouse forward, gantry and net drum aft */
function buildTrawler() {
  const g = new THREE.Group(), BLUE = 0x24507a, WH = 0xeeeeea, D = 0x2e3236, WIN = M(0x14202c);
  prism(g, hullPts(3.6, 0.42, 0.8), -0.35, 0.85, BLUE);
  prism(g, hullPts(3.62, 0.43, 0.8), -0.06, 0.1, 0xa83228);                       // red boot-top at the waterline
  prism(g, hullPts(3.5, 0.4, 0.78), 0.5, 0.02, 0x6a5e52);
  box(g, 3.5, 0.05, 0.87, WH, -0.05, 0.49, 0);                                   // white rail
  taper(g, 0.8, 0.6, 0.62, WH, 0.65, 0.81, 0, 0.9, 0.9);                         // wheelhouse
  box(g, 0.74, 0.12, 0.6, WIN, 0.7, 0.99, 0);
  cyl(g, 0.02, 0.03, 1.2, 5, D, 0.55, 1.63, 0);                                  // mast
  box(g, 0.04, 0.04, 0.5, D, 0.55, 1.88, 0);
  for (const s of [-1, 1]) strut(g, new V3(-1.65, 0.5, s * 0.33), new V3(-1.45, 1.43, s * 0.1), 0.025, 0xd06a2a);   // A-frame
  box(g, 0.05, 0.05, 0.3, 0xd06a2a, -1.45, 1.43, 0);
  const drum = cyl(g, 0.15, 0.15, 0.5, 8, 0x3a6a3a, -0.85, 0.68, 0); drum.rotation.x = Math.PI / 2;   // net drum
  mergeStatic(g, []); return g;
}
/* allied destroyer: the escort model without its searchlight (an extra light on a mission ship would cost every lit
   fragment and recompile the shaders whenever the ship comes and goes) */
function buildDestroyerTemplate() {
  const d = buildDestroyer(1);
  for (const s of d.searchlights) { const i = SEARCHLIGHTS.indexOf(s); if (i >= 0) SEARCHLIGHTS.splice(i, 1); s.holder.removeFromParent(); disposeTree(s.holder); }
  return d.group;
}
/* foreign corvette, ~90 m: grey hull, gun forward, superstructure and mast midships, helideck aft */
function buildCorvette() {
  const g = new THREE.Group(), HULL = 0x737d76, HULL2 = 0x5b645e, DECK = 0x454b47, D = 0x30353a, WIN = M(0x14202c);
  prism(g, hullPts(9, 0.55, 2.4), -0.5, 0.8, HULL2);
  prism(g, hullPts(9.1, 0.6, 2.4), 0.3, 0.45, HULL);
  prism(g, hullPts(9, 0.58, 2.35), 0.75, 0.03, DECK);
  taper(g, 2.6, 0.9, 1.0, HULL, 0.1, 1.23, 0, 0.92, 0.85);                     // superstructure
  taper(g, 1.0, 0.5, 0.9, HULL, 0.9, 1.92, 0, 0.85, 0.85);                     // bridge
  box(g, 0.86, 0.12, 0.8, WIN, 0.95, 2.05, 0);
  const f = taper(g, 0.7, 0.6, 0.6, HULL, -0.8, 1.95, 0, 0.8, 0.8, -0.05);       // funnel
  box(g, 0.5, 0.05, 0.4, D, -0.85, 2.28, 0);
  strut(g, new V3(0.2, 1.7, -0.3), new V3(0.4, 3.0, 0), 0.03, D); strut(g, new V3(0.2, 1.7, 0.3), new V3(0.4, 3.0, 0), 0.03, D);   // mast
  box(g, 0.1, 0.1, 0.6, 0x9aa1a8, 0.4, 3.05, 0);                                 // radar
  cyl(g, 0.22, 0.26, 0.22, 8, HULL, 2.7, 0.88, 0);                               // gun mount
  const bar = cyl(g, 0.03, 0.03, 0.7, 5, D, 3.1, 0.95, 0); bar.rotation.z = Math.PI / 2 - 0.08;
  for (const s of [-1, 1]) { const c = cyl(g, 0.06, 0.06, 0.7, 6, 0x6b7279, -1.6, 1.0, s * 0.3); c.rotation.z = Math.PI / 2; }   // missile canisters
  deckLine(g, -4.2, 0, -3.0, 0, 0.05, 0xe0e0d8, 0.785);                           // helideck line
  mergeStatic(g, []); return g;
}

