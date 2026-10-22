'use strict';
/* ===== Airframe models =====
   Every builder returns { group, setFold(f), tick(dt, st) }.
   Axes: +X nose, +Y up, +Z starboard; wheels touch y = 0; 1 unit ≈ 10 m.  */
const CANOPY = () => M(0x1a2838, { shininess: 90, specular: 0x88aacc });
function mirrorZ(pts) { return pts.map(p => [p[0], -p[1]]); }
function glowSprite(g, x, y, z, s, color) {
  const m = new THREE.SpriteMaterial({ map: TEX.flash, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0, color: color || 0xffaa66 });
  const sp = new THREE.Sprite(m); sp.position.set(x, y, z); sp.scale.set(s, s, 1); g.add(sp); return sp;
}
/* landing gear: legs [x, z, kind] — 'n' nose wheel (the first leg's default), 's' single, 't' twin, 'tan' tandem pair,
   'b4' 2x2 bogie, 'b6' 3x2 bogie; h = ground to the gear bay. Light struts and doors, dark tyres with light hubs. The
   group hangs from the bay (y = h) so tickGear folds it up into it. */
function gear(g, legs, h) {
  const gg = new THREE.Group(); gg.position.y = h; g.add(gg);
  const S = M(0xb8bcc0), TY = M(0x1e1e1e), st = clamp(h * 0.2, 0.022, 0.04);
  legs.forEach(([x, z, kind], i) => {
    kind = kind || (i ? 's' : 'n');
    const r = h * (kind === 'n' ? 0.26 : kind === 'b6' || kind === 'b4' ? 0.28 : 0.32), w = r * 0.62, ax = -h + r, sp = w * 0.75, lx = r * 1.15;
    const wh = { n: [[0, 0]], s: [[0, 0]], t: [[0, -sp], [0, sp]], tan: [[-lx, 0], [lx, 0]], b4: [[-lx, -sp], [-lx, sp], [lx, -sp], [lx, sp]],
      b6: [[-2 * lx, -sp], [-2 * lx, sp], [0, -sp], [0, sp], [2 * lx, -sp], [2 * lx, sp]] }[kind];
    box(gg, st, h - r, st, S, x, ax / 2, z);                                                        // strut, bay to axle
    if (wh.length > 1) { const xs = wh.map(q => q[0]), zs = wh.map(q => q[1]); box(gg, Math.max(...xs) - Math.min(...xs) + st, st * 0.8, Math.max(...zs) - Math.min(...zs) + st, S, x, ax, z); }   // axle beam / bogie
    for (const [dx, dz] of wh) {
      cyl(gg, r, r, w, 10, TY, x + dx, ax, z + dz).rotation.x = Math.PI / 2;                        // tyre
      cyl(gg, r * 0.45, r * 0.45, w * 1.08, 8, S, x + dx, ax, z + dz).rotation.x = Math.PI / 2;      // hub
    }
    const side = Math.sign(z) || 1, out = wh.some(q => q[1]) ? sp + w / 2 : 0;
    box(gg, r * 2, (h - r) * 0.75, 0.01, S, x, -(h - r) * 0.42, z + side * (st + 0.012 + out));      // gear door
  });
  return gg;
}
/* gear up / down over about a second (st.gearDown), folding into the bay */
function tickGear(gr, st, dt) {
  if (!gr) return;
  const u = gr.userData, k0 = u.k ?? 1;
  u.k = clamp(k0 + (st.gearDown !== false ? dt : -dt), 0, 1);
  gr.scale.y = Math.max(0.01, smoothstep(0, 1, u.k)); gr.visible = u.k > 0.01;
}
/* a smooth body of revolution along X: profile [[x, r, dy], ...] (back to front; dy lifts the axis there), cross-section
   r wide and r*sy tall, so a nose blends into the fuselage without a step */
function lathe(g, profile, c, y, sy, seg) {
  const geo = new THREE.LatheGeometry(profile.map(([x, r]) => new THREE.Vector2(Math.max(r, 1e-4), x)), seg || 12);
  geo.rotateZ(-Math.PI / 2);                                                                      // the lathe axis (y) onto +x
  const pos = geo.attributes.position, lift = x => {                                              // the axis lift at x
    for (let i = 1; i < profile.length; i++) if (x <= profile[i][0] || i === profile.length - 1) { const [x0, , a] = profile[i - 1], [x1, , b] = profile[i]; return lerp(a || 0, b || 0, clamp((x - x0) / (x1 - x0 || 1), 0, 1)); }
    return 0;
  };
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) * sy + lift(pos.getX(i)) + y);
  geo.computeVertexNormals();
  const m = shade(new THREE.Mesh(geo, mm(c))); g.add(m); return m;
}
/* cockpit glass on a tapering nose: a band of the nose's own surface (x0..x1, radii r0 at x0, r1 at x1, a hair proud of
   it) over the upper front arc (+-arc from the top), so it never sticks out past the skin */
function windscreen(g, x0, x1, r0, r1, y, sy, arc = 1.13) {
  const geo = new THREE.CylinderGeometry(r1 * 1.02, r0 * 1.02, x1 - x0, 12, 1, true, 1.5 * Math.PI - arc, 2 * arc);
  const m = shade(new THREE.Mesh(geo, M(0x14202c, { side: THREE.DoubleSide })), false);
  m.rotation.z = -Math.PI / 2; m.scale.x = sy || 1; m.position.set((x0 + x1) / 2, y, 0); g.add(m); return m;
}
/* a lathe profile at x: [radius, axis lift] */
function profAt(P, x) {
  for (let i = 1; i < P.length; i++) if (x <= P[i][0] || i === P.length - 1) { const a = P[i - 1], b = P[i], u = clamp((x - a[0]) / (b[0] - a[0] || 1), 0, 1); return [lerp(a[1], b[1], u), lerp(a[2] || 0, b[2] || 0, u)]; }
  return [P[0][1], P[0][2] || 0];
}
/* a transport's fuselage in one piece: the nose droops a little to its tip, the tail sweeps up (top line straight), so
   neither steps off the body seen from the side; the cockpit glass hugs the nose. Returns the profile. */
function transportBody(g, C, P, fy, sy, wx0, wx1) {
  lathe(g, P, C, fy, sy, 12);
  const [r0, d0] = profAt(P, wx0), [r1, d1] = profAt(P, wx1);
  windscreen(g, wx0, wx1, r0, r1, fy + (d0 + d1) / 2, sy);
  return P;
}

/* ---------- F-35A Lightning II — stealth (the fold pivots are kept from the carrier version; land jets never fold) ---------- */
function buildF35(color, big) {
  const g = new THREE.Group(), C = M(color || 0x6c747c), C2 = M(0x5e666e), D = M(0x33383d), CAN = M(0x3a3320, { shininess: 90, specular: 0xccaa55 });
  const b = new THREE.Group(); b.position.y = 0.2; g.add(b);
  lathe(b, [[0.2, 0.17], [0.45, 0.14, 0.01], [0.7, 0.1, 0.02], [0.92, 0.055, 0.03], [1.08, 0.004, 0.035]], C, 0.03, 0.72, 4);   // chined forebody to the nose, one piece
  taper(b, 0.9, 0.22, 0.44, C, -0.15, 0.01, 0, 0.9, 0.8);                                    // wide body, single engine
  taper(b, 0.34, 0.1, 0.13, CAN, 0.48, 0.14, 0, 0.6, 0.7, -0.04);
  for (const s of [-1, 1]) taper(b, 0.2, 0.12, 0.07, D, 0.24, 0.0, s * 0.21, 0.7, 1, 0.04);   // DSI intakes
  const inner = [[0.22, 0.2], [-0.24, 0.5], [-0.47, 0.5], [-0.46, 0.2]];
  prism(b, inner, -0.01, 0.03, C); prism(b, mirrorZ(inner), -0.01, 0.03, C);
  const pivots = [];
  for (const s of [1, -1]) {
    const pv = new THREE.Group(); pv.position.set(0, -0.01, s * 0.5); b.add(pv);
    const outer = [[-0.24, 0], [-0.36, 0.17], [-0.49, 0.17], [-0.47, 0]];
    prism(pv, s > 0 ? outer : mirrorZ(outer), 0, 0.03, C);
    pivots.push({ pv, s });
  }
  const stab = [[-0.52, 0.15], [-0.67, 0.38], [-0.8, 0.38], [-0.77, 0.15]];
  prism(b, stab, 0.0, 0.025, C); prism(b, mirrorZ(stab), 0.0, 0.025, C);
  for (const s of [-1, 1]) { const f = taper(b, 0.3, 0.3, 0.03, C2, -0.56, 0.24, s * 0.15, 0.5, 1, -0.1); f.rotation.x = s * 0.4; }
  const n = cyl(b, 0.09, 0.1, 0.14, 8, 0x3a3a3a, -0.68, 0.01, 0); n.rotation.z = Math.PI / 2;
  const gr = big ? null : gear(g, [[0.6, 0], [-0.22, 0.22], [-0.22, -0.22]], 0.2);
  const glow = glowSprite(g, -0.82, 0.21, 0, 0.75);
  mergeStatic(g, [...pivots.map(p => p.pv), gr]);
  return {
    group: g,
    setFold(f) { for (const p of pivots) p.pv.rotation.x = -p.s * f * 1.75; },
    tick(dt, st) { tickGear(gr, st, dt); glow.material.opacity += ((st.glow || 0) - glow.material.opacity) * Math.min(1, dt * 6); const sc = 0.5 + glow.material.opacity * 0.6; glow.scale.set(sc, sc, 1); }
  };
}

/* ---------- Enemy fighters (static models; red fin tips mark hostiles) ---------- */
function enemyGlows(g, x, y, zs, s) { for (const z of zs) glowSprite(g, x, y, z, s, 0xff9a50).material.opacity = 0.7; }
/* Su-25 Frogfoot — subsonic attack jet: straight shoulder wing, twin engine pods, wingtip airbrake pods */
function buildSu25() {
  const g = new THREE.Group(), C = M(0x6b6a52), C2 = M(0x55553f), D = M(0x2c2a26), R = M(0x8f2b22), CAN = CANOPY();
  const b = new THREE.Group(); b.position.y = 0.2; g.add(b);
  taper(b, 1.2, 0.17, 0.16, C, 0.05, 0.03, 0, 0.85, 0.75);
  const nose = shade(new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.28, 6), C)); nose.rotation.z = -Math.PI / 2; nose.position.set(0.79, 0.03, 0); b.add(nose);
  taper(b, 0.3, 0.1, 0.12, CAN, 0.42, 0.14, 0, 0.6, 0.7, -0.03);
  const wing = [[0.18, 0.1], [0.04, 0.72], [-0.12, 0.72], [-0.2, 0.1]];
  prism(b, wing, 0.06, 0.03, C); prism(b, mirrorZ(wing), 0.06, 0.03, C);
  for (const s of [-1, 1]) {
    taper(b, 0.72, 0.15, 0.13, C2, -0.12, 0.0, s * 0.15, 0.95, 0.9);                      // engine nacelle
    const nz = cyl(b, 0.055, 0.06, 0.08, 6, 0x222, -0.5, 0.0, s * 0.15); nz.rotation.z = Math.PI / 2;
    box(b, 0.2, 0.04, 0.04, D, -0.04, 0.07, s * 0.73);                                      // wingtip airbrake pod
    for (const z of [0.36, 0.55]) { const bomb = cyl(b, 0.025, 0.025, 0.22, 5, 0x55554a, 0.0, 0.0, s * z); bomb.rotation.z = Math.PI / 2; }
  }
  taper(b, 0.32, 0.36, 0.03, C, -0.56, 0.25, 0, 0.5, 1, -0.12);
  box(b, 0.12, 0.07, 0.035, R, -0.66, 0.42, 0);
  const stab = [[-0.5, 0.06], [-0.66, 0.34], [-0.76, 0.34], [-0.74, 0.06]];
  prism(b, stab, 0.12, 0.025, C); prism(b, mirrorZ(stab), 0.12, 0.025, C);
  enemyGlows(g, -0.58, 0.2, [-0.15, 0.15], 0.55);
  mergeStatic(g, []); return g;
}
/* Su-47 Berkut — forward-swept wings, canards, tail booms, dark finish */
function buildSu47() {
  const g = new THREE.Group(), C = M(0x34383d), C2 = M(0x26292d), D = M(0x1c1d20), R = M(0x8f2b22), CAN = CANOPY();
  const b = new THREE.Group(); b.position.y = 0.22; g.add(b);
  taper(b, 0.75, 0.15, 0.16, C, 0.65, 0.06, 0, 0.75, 0.7);
  const nose = shade(new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.34, 6), C)); nose.rotation.z = -Math.PI / 2; nose.position.set(1.2, 0.06, 0); b.add(nose);
  taper(b, 0.3, 0.1, 0.12, CAN, 0.7, 0.18, 0, 0.6, 0.7, -0.04);
  prism(b, [[0.45, 0.15], [-0.95, 0.27], [-0.95, -0.27], [0.45, -0.15]], -0.02, 0.1, C);
  const wing = [[0.05, 0.2], [0.14, 0.84], [-0.02, 0.86], [-0.62, 0.24]];                   // forward sweep
  prism(b, wing, 0.03, 0.03, C); prism(b, mirrorZ(wing), 0.03, 0.03, C);
  const can = [[0.55, 0.13], [0.38, 0.36], [0.28, 0.36], [0.31, 0.13]];
  prism(b, can, 0.06, 0.02, C); prism(b, mirrorZ(can), 0.06, 0.02, C);
  for (const s of [-1, 1]) {
    taper(b, 0.95, 0.15, 0.15, C2, -0.42, -0.07, s * 0.19, 0.95, 0.9);
    box(b, 0.16, 0.12, 0.13, D, 0.14, -0.08, s * 0.19);
    const nz = cyl(b, 0.065, 0.07, 0.1, 6, 0x111, -0.94, -0.07, s * 0.19); nz.rotation.z = Math.PI / 2;
    const f = taper(b, 0.34, 0.38, 0.03, C, -0.66, 0.29, s * 0.3, 0.5, 1, -0.12); f.rotation.x = s * 0.12;
    box(b, 0.1, 0.06, 0.035, R, -0.8, 0.46, s * 0.33);
    const boom = cyl(b, 0.03, 0.04, 0.3, 5, C2, -1.0, 0.0, s * 0.3); boom.rotation.z = Math.PI / 2;  // tail boom
  }
  const stab = [[-0.82, 0.3], [-0.96, 0.52], [-1.06, 0.52], [-1.04, 0.3]];
  prism(b, stab, 0.0, 0.025, C); prism(b, mirrorZ(stab), 0.0, 0.025, C);
  enemyGlows(g, -1.0, 0.15, [-0.19, 0.19], 0.6);
  mergeStatic(g, []); return g;
}
/* Su-57 Felon — stealth: flat lifting body, LEVCONs, wide-spaced engines, all-moving canted fins */
function buildSu57() {
  const g = new THREE.Group(), C = M(0x7a838c), C2 = M(0x545b62), D = M(0x2c2f33), R = M(0x8f2b22), CAN = M(0x3a3320, { shininess: 90, specular: 0xccaa55 });
  const b = new THREE.Group(); b.position.y = 0.2; g.add(b);
  taper(b, 0.55, 0.14, 0.2, C, 0.8, 0.04, 0, 0.7, 0.55);
  const nose = shade(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 4), C)); nose.rotation.set(Math.PI / 4, 0, -Math.PI / 2); nose.position.set(1.2, 0.04, 0); b.add(nose);
  taper(b, 0.32, 0.1, 0.13, CAN, 0.78, 0.16, 0, 0.6, 0.7, -0.04);
  prism(b, [[0.6, 0.1], [0.2, 0.3], [-0.86, 0.36], [-0.86, -0.36], [0.2, -0.3], [0.6, -0.1]], -0.02, 0.1, C);
  const levcon = [[0.55, 0.12], [0.36, 0.31], [0.28, 0.31], [0.3, 0.12]];
  prism(b, levcon, 0.03, 0.02, C); prism(b, mirrorZ(levcon), 0.03, 0.02, C);
  const wing = [[0.2, 0.3], [-0.38, 0.76], [-0.56, 0.76], [-0.6, 0.3]];
  prism(b, wing, 0.03, 0.03, C); prism(b, mirrorZ(wing), 0.03, 0.03, C);
  for (const s of [-1, 1]) {
    taper(b, 0.9, 0.14, 0.17, C2, -0.42, -0.07, s * 0.24, 0.95, 0.9);
    taper(b, 0.18, 0.12, 0.12, D, 0.14, -0.08, s * 0.24, 0.8, 1, 0.03);
    const nz = cyl(b, 0.065, 0.07, 0.1, 8, 0x222, -0.92, -0.07, s * 0.24); nz.rotation.z = Math.PI / 2;
    const f = taper(b, 0.32, 0.32, 0.03, C2, -0.62, 0.24, s * 0.27, 0.5, 1, -0.12); f.rotation.x = s * 0.45;
    box(b, 0.09, 0.05, 0.035, R, -0.75, 0.37, s * 0.36);
  }
  const stab = [[-0.62, 0.36], [-0.82, 0.6], [-0.95, 0.6], [-0.9, 0.36]];
  prism(b, stab, 0.0, 0.025, C); prism(b, mirrorZ(stab), 0.0, 0.025, C);
  enemyGlows(g, -1.0, 0.13, [-0.24, 0.24], 0.6);
  mergeStatic(g, []); return g;
}

/* ---------- Helicopter helpers ---------- */
function heliRotor(g, x, y, n, len, chord, color) {
  const rotor = new THREE.Group(); rotor.position.set(x, y, 0); g.add(rotor);
  cyl(rotor, 0.07, 0.07, 0.06, 6, color, 0, 0, 0);
  const blades = [];
  for (let i = 0; i < n; i++) {
    const h = new THREE.Group(); h.rotation.y = i * TAU / n; rotor.add(h);
    box(h, len, 0.02, chord, color, len / 2 + 0.05, 0, 0).castShadow = false;
    // folded: all blades swing back over the tail in a tight fan
    const fy = Math.PI + (i - (n - 1) / 2) * 0.09;
    blades.push({ h, base: i * TAU / n, fold: fy });
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(len + 0.05, 24), new THREE.MeshBasicMaterial({ color: 0x2a2f34, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2; rotor.add(disc);
  return { rotor, blades, disc, n };
}
function tailRotor(g, x, y, z, r, color) {
  const t = new THREE.Group(); t.position.set(x, y, z); g.add(t);
  box(t, 0.03, r * 2, 0.02, color, 0, 0, 0); box(t, r * 2, 0.03, 0.02, color, 0, 0, 0);
  return t;
}
function heliModel(g, R, T, searchPos) {
  mergeStatic(g, [R.rotor, ...R.blades.map(b => b.h), T]);
  let fold = 1, spin = 0;
  return {
    group: g, searchPos,
    setFold(f) { fold = f; },
    tick(dt, st) {
      spin = st.rotor || 0;
      if (fold > 0.001) {
        R.rotor.rotation.y = 0;
        for (const b of R.blades) b.h.rotation.y = lerp(b.base, b.fold, smoothstep(0, 1, fold));
      } else {
        R.rotor.rotation.y = st.rotorAng || 0;
        for (const b of R.blades) { b.h.rotation.y = b.base; b.h.visible = spin < 0.85 || Math.random() < 0.5; }
      }
      if (T) T.rotation.z = (st.rotorAng || 0) * 1.7;
      R.disc.material.opacity = 0.28 * smoothstep(0.4, 1, spin);
    }
  };
}


/* ---------- shared pieces ---------- */
/* a tube along X from x0 (radius r0) to x1 > x0 (radius r1); sy squashes it vertically */
function tube(g, x0, x1, r0, r1, c, y, z, seg, sy) { const m = cyl(g, r1, r0, x1 - x0, seg || 8, c, (x0 + x1) / 2, y || 0, z || 0); m.rotation.z = -Math.PI / 2; if (sy) m.scale.x = sy; return m; }
function pair(g, pts, y, t, c) { prism(g, pts, y, t, c); prism(g, mirrorZ(pts), y, t, c); }
/* vertical fin: chord len at the root, height h, swept back by sweep at the tip; rx cants it (outward = sign of z) */
function fin(g, x, y, z, len, h, c, sweep, rx, t) { const f = taper(g, len, h, t || 0.03, c, x, y + h / 2, z, 0.5, 1, -(sweep || 0.1)); f.rotation.x = rx || 0; return f; }
function noseCone(g, x, y, r, len, c, sides) { const n = shade(new THREE.Mesh(new THREE.ConeGeometry(r, len, sides || 6), mm(c))); n.rotation.z = -Math.PI / 2; n.position.set(x + len / 2, y, 0); g.add(n); return n; }
/* propeller turning about X: n two-bladed bars + a blur disc; returns { pr, disc } (pr is dynamic) */
function propeller(g, x, y, z, r, n, c) {
  const pr = new THREE.Group(); pr.position.set(x, y, z); g.add(pr);
  for (let i = 0; i < n; i++) { const bl = new THREE.Group(); bl.rotation.x = i * Math.PI / n; pr.add(bl); box(bl, 0.02, r * 2, 0.045, c || 0x2a2d30, 0, 0, 0).castShadow = false; }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 16), new THREE.MeshBasicMaterial({ color: 0x2a2f34, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.y = Math.PI / 2; pr.add(disc);
  return { pr, disc, blades: pr.children.filter(o => o.isGroup) };
}
function spinProps(props, spin, ang) {
  for (const p of props) { p.pr.rotation.x = ang; for (const b of p.blades) b.visible = spin < 0.7 || Math.random() < 0.5; p.disc.material.opacity = 0.25 * smoothstep(0.4, 1, spin); }
}
/* engine glow: one sprite per nozzle following st.glow */
function glows(g, list, s) { return list.map(([x, y, z]) => glowSprite(g, x, y, z, s)); }
function tickGlow(gl, st, dt, base, k) { for (const s of gl) { s.material.opacity += ((st.glow || 0) - s.material.opacity) * Math.min(1, dt * 6); const sc = base + s.material.opacity * k; s.scale.set(sc, sc, 1); } }
/* a jet's standard model object: gear toggles with st.gearDown, glows follow st.glow */
function jetModel(g, gr, gl, base, k, extra) {
  return Object.assign({ group: g, setFold() {}, tick(dt, st) { tickGear(gr, st, dt); tickGlow(gl, st, dt, base, k); if (this.more) this.more(dt, st); } }, extra || {});
}

/* ---------- F-15E Strike Eagle — 19.4 m: big wing, twin fins, conformal tanks, dark grey ---------- */
function buildF15(color, big) {
  const g = new THREE.Group(), C = M(color || 0x5a6168), C2 = M(0x4c535a), D = M(0x2c3035), CAN = CANOPY();
  const b = new THREE.Group(); b.position.y = 0.22; g.add(b);
  lathe(b, [[0.3, 0.1], [0.55, 0.098, 0.005], [0.8, 0.088, 0.015], [1.0, 0.074, 0.02], [1.2, 0.05, 0.025], [1.36, 0.024, 0.03], [1.45, 0.002, 0.03]], C, 0.04, 1, 12);   // forebody to the radome, one piece
  taper(b, 0.44, 0.12, 0.15, CAN, 0.7, 0.16, 0, 0.6, 0.72, -0.05);
  prism(b, [[0.42, 0.17], [-0.98, 0.3], [-0.98, -0.3], [0.42, -0.17]], -0.05, 0.13, C);       // wide lifting body
  for (const s of [-1, 1]) {
    box(b, 0.34, 0.16, 0.13, D, 0.3, -0.02, s * 0.25);                                          // square intakes
    tube(b, -0.95, -0.25, 0.085, 0.095, C2, -0.02, s * 0.13);                                   // engines
    tube(b, -1.04, -0.95, 0.075, 0.085, 0x2a2a2a, -0.02, s * 0.13);
    tube(b, -0.55, 0.25, 0.05, 0.05, C, -0.07, s * 0.29, 6);                                     // conformal tank
    fin(b, -0.78, 0.07, s * 0.2, 0.36, 0.42, C2, 0.12, s * 0.06);
  }
  pair(b, [[0.25, 0.3], [-0.42, 0.66], [-0.6, 0.66], [-0.56, 0.3]], -0.02, 0.03, C);              // wings
  pair(b, [[-0.72, 0.24], [-0.88, 0.5], [-1.0, 0.5], [-0.99, 0.24]], -0.03, 0.025, C);
  for (const s of [-1, 1]) for (const z of [0.42, 0.55]) tube(b, -0.35, 0.0, 0.025, 0.025, 0x8a8f86, -0.1, s * z, 5);   // bombs under the wings
  const gr = big ? null : gear(g, [[0.78, 0], [-0.25, 0.22], [-0.25, -0.22]], 0.22);
  const gl = glows(g, [[-1.08, 0.2, -0.13], [-1.08, 0.2, 0.13]], 0.5);
  mergeStatic(g, [gr]);
  return jetModel(g, gr, gl, 0.4, 0.5);
}
/* ---------- F-16C Fighting Falcon — 15 m: single engine, belly intake, bubble canopy ---------- */
function buildF16(color, big) {
  const g = new THREE.Group(), C = M(color || 0x8a929a), C2 = M(0x7a828a), D = M(0x2c3035), CAN = M(0x4a3f28, { shininess: 90, specular: 0xccaa55 });
  const b = new THREE.Group(); b.position.y = 0.2; g.add(b);
  // one smooth fuselage from the radome to the nozzle, the nose blending into the body (its axis lifted toward the nose)
  lathe(b, [[-0.66, 0.088], [-0.45, 0.1], [-0.1, 0.108], [0.25, 0.104], [0.45, 0.092, 0.012], [0.62, 0.076, 0.025], [0.78, 0.056, 0.035], [0.92, 0.034, 0.04], [1.02, 0.014, 0.042], [1.07, 0.001, 0.042]], C, 0.02, 1.08, 14);
  const cn = shade(new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8, 0, TAU, 0, Math.PI / 2), CAN)); cn.scale.set(0.2, 0.085, 0.068); cn.position.set(0.55, 0.11, 0); b.add(cn);   // bubble canopy
  const sp = shade(new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, TAU, 0, Math.PI / 2), C)); sp.scale.set(0.5, 0.06, 0.07); sp.position.set(-0.02, 0.1, 0); b.add(sp);   // dorsal spine, canopy to fin
  tube(b, 0.06, 0.42, 0.07, 0.066, C, -0.08, 0, 10, 0.85);                                         // chin intake duct
  tube(b, 0.42, 0.45, 0.066, 0.066, D, -0.08, 0, 10, 0.85);                                        // its mouth
  pair(b, [[0.45, 0.07], [0.06, 0.14], [-0.28, 0.46], [-0.42, 0.46], [-0.42, 0.1]], 0.0, 0.03, C);  // LERX + wing
  pair(b, [[-0.48, 0.1], [-0.62, 0.32], [-0.72, 0.32], [-0.7, 0.1]], -0.01, 0.025, C);
  fin(b, -0.55, 0.1, 0, 0.36, 0.4, C2, 0.13);
  tube(b, -0.76, -0.66, 0.07, 0.085, 0x2a2a2a, 0.02, 0);
  for (const s of [-1, 1]) { tube(b, -0.4, -0.05, 0.016, 0.016, 0xe0e0e0, 0.0, s * 0.47, 5); tube(b, -0.25, 0.05, 0.04, 0.04, 0x8a8f86, -0.06, s * 0.27, 6); }   // wingtip AIM-9s, fuel tanks
  const gr = big ? null : gear(g, [[0.5, 0], [-0.16, 0.14], [-0.16, -0.14]], 0.2);
  const gl = glows(g, [[-0.82, 0.22, 0]], 0.6);
  mergeStatic(g, [gr]);
  return jetModel(g, gr, gl, 0.45, 0.6);
}
/* ---------- F-22A Raptor — 18.9 m: diamond wing, canted twin fins, 2D nozzles ---------- */
function buildF22(color, big) {
  const g = new THREE.Group(), C = M(color || 0x6e757c), C2 = M(0x5e656c), D = M(0x2a2e33), CAN = M(0x4a3f28, { shininess: 90, specular: 0xccaa55 });
  const b = new THREE.Group(); b.position.y = 0.2; g.add(b);
  lathe(b, [[0.45, 0.13], [0.75, 0.115, 0.01], [1.0, 0.085, 0.02], [1.2, 0.045, 0.03], [1.36, 0.004, 0.035]], C, 0.04, 0.62, 4);   // chined forebody to the nose, one piece
  taper(b, 0.38, 0.1, 0.13, CAN, 0.72, 0.15, 0, 0.6, 0.7, -0.04);
  prism(b, [[0.6, 0.12], [0.3, 0.3], [-0.86, 0.33], [-0.86, -0.33], [0.3, -0.3], [0.6, -0.12]], -0.04, 0.12, C);
  for (const s of [-1, 1]) {
    taper(b, 0.24, 0.13, 0.1, D, 0.38, -0.01, s * 0.28, 0.75, 1, 0.04);                         // caret intakes
    box(b, 0.12, 0.08, 0.14, 0x2a2a2a, -0.9, -0.01, s * 0.12);                                   // 2D nozzles
    fin(b, -0.66, 0.05, s * 0.25, 0.4, 0.36, C2, 0.13, s * 0.45);
  }
  pair(b, [[0.22, 0.29], [-0.42, 0.68], [-0.6, 0.68], [-0.63, 0.29]], -0.02, 0.03, C);
  pair(b, [[-0.64, 0.3], [-0.86, 0.52], [-0.99, 0.49], [-0.93, 0.3]], -0.03, 0.025, C);
  const gr = big ? null : gear(g, [[0.7, 0], [-0.2, 0.22], [-0.2, -0.22]], 0.2);
  const gl = glows(g, [[-0.98, 0.19, -0.12], [-0.98, 0.19, 0.12]], 0.5);
  mergeStatic(g, [gr]);
  return jetModel(g, gr, gl, 0.4, 0.55);
}
/* ---------- A-10C Thunderbolt II — 16.3 m: straight wing, pod engines high at the back, twin fins, the GAU-8 ---------- */
function buildA10(color, big) {
  const g = new THREE.Group(), C = M(color || 0x6f767a), C2 = M(0x60676b), D = M(0x2c3035), CAN = CANOPY();
  const b = new THREE.Group(); b.position.y = 0.2; g.add(b);
  tube(b, -0.62, 0.55, 0.075, 0.11, C, 0.04, 0, 8);
  noseCone(b, 0.55, 0.03, 0.11, 0.24, C, 8);
  tube(b, 0.75, 0.9, 0.015, 0.015, D, -0.05, 0, 6);                                               // the gun
  const cn = shade(new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6, 0, TAU, 0, Math.PI / 2), CAN)); cn.position.set(0.45, 0.13, 0); cn.scale.set(1.5, 1, 0.9); b.add(cn);
  pair(b, [[0.14, 0.08], [0.1, 0.86], [-0.08, 0.86], [-0.13, 0.08]], -0.06, 0.035, C);            // straight low wing
  for (const s of [-1, 1]) {
    tube(b, -0.48, -0.08, 0.07, 0.075, C2, 0.22, s * 0.17, 10);                                  // engine pods
    tube(b, -0.08, -0.04, 0.072, 0.075, D, 0.22, s * 0.17, 10);
    box(b, 0.2, 0.12, 0.03, C, -0.28, 0.13, s * 0.1);                                             // pylons
    box(b, 0.12, 0.06, 0.08, C2, 0.03, -0.1, s * 0.3);                                            // gear pods
    for (const z of [0.42, 0.55, 0.7]) tube(b, -0.12, 0.12, 0.022, 0.022, z > 0.6 ? 0xd8d8d0 : 0x8a8f86, -0.11, s * z, 5);
    fin(b, -0.83, 0.1, s * 0.3, 0.16, 0.28, C2, 0.02);
  }
  pair(b, [[-0.66, 0.0], [-0.68, 0.32], [-0.82, 0.32], [-0.82, 0.0]], 0.09, 0.022, C);           // H-tail
  const gr = big ? null : gear(g, [[0.5, 0.02], [0.05, 0.3], [0.05, -0.3]], 0.16);
  const gl = glows(g, [[-0.55, 0.42, -0.17], [-0.55, 0.42, 0.17]], 0.3);
  mergeStatic(g, [gr]);
  return jetModel(g, gr, gl, 0.25, 0.25);
}

/* ---------- airliner-type airframes (E-3, KC-46): fuselage, swept low wing, pods, tail ---------- */
function airlinerBody(g, C, C2, L, r, wing, pods, fy) {
  transportBody(g, C, [[-L * 0.53, r * 0.18, r * 0.8], [-L * 0.49, r * 0.5, r * 0.48], [-L * 0.45, r * 0.85, r * 0.14], [-L * 0.41, r, 0], [L * 0.37, r, 0],
    [L * 0.42, r * 0.88, -r * 0.06], [L * 0.46, r * 0.62, -r * 0.12], [L * 0.49, r * 0.3, -r * 0.16], [L * 0.505, r * 0.02, -r * 0.17]], fy, 1, L * 0.43, L * 0.46);
  pair(g, wing.map(([x, z]) => [x, z < r * 1.2 ? r * 0.6 : z]), fy - r * 0.55, 0.05, C);   // the roots inside the fuselage (no gap)
  taper(g, L * 0.22, r * 0.4, r * 1.5, C, L * 0.01, fy - r * 0.78, 0, 1, 0.8);             // wing-to-body fairing
  for (const [x, z, len, pr] of pods) for (const s of [-1, 1]) {
    tube(g, x - len, x, pr * 0.9, pr, C2, fy - r * 0.95, s * z, 10); tube(g, x - 0.02, x, pr * 0.8, pr * 0.8, 0x222, fy - r * 0.95, s * z, 10);
    box(g, len * 0.6, 0.12, 0.04, C, x - len * 0.4, fy - r * 0.62, s * z);
  }
  fin(g, -L * 0.47, fy + r * 0.5, 0, L * 0.12, L * 0.17, C, L * 0.05, 0, 0.06);
  pair(g, [[-L * 0.42, r * 0.8], [-L * 0.5, L * 0.16], [-L * 0.54, L * 0.16], [-L * 0.52, r * 0.8]], fy + r * 0.3, 0.035, C);
  // nav lights at the wingtips (red left, green right) and the tail, red anti-collision beacons on top and underneath
  const zt = Math.max(...wing.map(q => q[1])), tip = wing.filter(q => q[1] === zt), xt = tip.reduce((a, q) => a + q[0], 0) / tip.length, wy = fy - r * 0.55 + 0.06;
  navLights(g, [[xt, wy, -zt, 0xff2a1a], [xt, wy, zt, 0x22ff66], [-L * 0.53, fy + r * 0.8, 0, 0xffffff]], null, 1.0);
  navLights(g, [[L * 0.06, fy + r + 0.02, 0, 0xff2020], [L * 0.02, fy - r - 0.02, 0, 0xff2020]], { period: 1.2, duty: 0.15, phase: Math.random() }, 1.1);
}
/* ---------- E-3 Sentry (AWACS) — 46.6 m 707 airframe with the 9 m rotodome on two struts ---------- */
function buildE3(color) {
  const g = new THREE.Group(), C = M(color || 0xc3c7cb), C2 = M(0xa9aeb3), fy = 0.37;
  airlinerBody(g, C, C2, 4.66, 0.19, [[0.6, 0.18], [-0.72, 2.2], [-1.0, 2.2], [-0.32, 0.18]], [[0.55, 0.75, 0.42, 0.07], [0.0, 1.42, 0.42, 0.07]], fy);
  for (const dz of [-0.06, 0.06]) strut(g, new V3(-0.55, fy + 0.18, dz), new V3(-0.75, fy + 0.62, dz * 1.5), 0.035, C2);
  const dome = new THREE.Group(); dome.position.set(-0.75, fy + 0.68, 0); g.add(dome);
  cyl(dome, 0.46, 0.46, 0.08, 20, 0xe6e8ea, 0, 0, 0); box(dome, 0.84, 0.085, 0.06, 0x2e3236, 0, 0, 0);
  const gr = gear(g, [[1.5, 0, 't'], [-0.05, 0.36, 'b4'], [-0.05, -0.36, 'b4']], 0.18);
  mergeStatic(g, [dome, gr]);
  return jetModel(g, gr, [], 0, 0, { more(dt, st) { if (st.airborne) dome.rotation.y += dt * 0.6; } });
}
/* ---------- KC-46 Pegasus — 50.5 m 767 tanker: the flying boom under the tail (lowered for a refuelling pass) ---------- */
const KC46_BOOM = { x: -2.32, y: 0.12, len: 1.45, down: 0.5 };   // pivot (model units), length, lowered angle (rad)
function buildKC46(color) {
  const g = new THREE.Group(), C = M(color || 0xb4b9be), C2 = M(0x9ca2a8), fy = 0.4;
  airlinerBody(g, C, C2, 5.05, 0.25, [[0.7, 0.22], [-0.85, 2.4], [-1.12, 2.4], [-0.42, 0.22]], [[0.62, 0.95, 0.52, 0.12]], fy);
  for (const s of [-1, 1]) tube(g, -0.85, -0.45, 0.04, 0.04, 0xd0d4d8, fy - 0.1, s * 1.75, 6);   // wing refuelling pods
  const B = KC46_BOOM, boom = new THREE.Group(); boom.position.set(B.x, fy + B.y - 0.28, 0); g.add(boom);
  const bm = tube(boom, -B.len, 0, 0.022, 0.03, 0x8a9096, 0, 0, 6); bm.castShadow = false;
  for (const s of [-1, 1]) box(boom, 0.18, 0.012, 0.16, 0x8a9096, -B.len * 0.7, 0, s * 0.09).rotation.x = s * 0.5;   // ruddevators
  const gr = gear(g, [[1.65, 0, 't'], [-0.1, 0.42, 'b4'], [-0.1, -0.42, 'b4']], 0.18);
  mergeStatic(g, [gr, boom]);
  let ext = 0;
  return jetModel(g, gr, [], 0, 0, { more(dt, st) { ext += ((st.hoseOut || 0) - ext) * Math.min(1, dt * 0.9); boom.rotation.z = lerp(0.12, B.down, ext); boom.scale.x = lerp(0.75, 1, ext); } });
}

/* ---------- C-130J family — 29.8 m, high wing, four six-bladed turboprops, beaver-tail ramp ----------
   v: 'c130' (airlifter), 'kc130' (two hose-and-drogue pods under the outer wing), 'ac130' (gunship: guns on the left side) */
const KC130_POD = { x: -0.42, y: 0.43, z: 1.62, len: 1.2, ang: 0.16 };   // hose exit (model units) on each side
function buildC130(v, color) {
  const ac = v === 'ac130', kc = v === 'kc130';
  const g = new THREE.Group(), C = M(color || (ac ? 0x575d63 : kc ? 0x6c7276 : 0x6f7568)), C2 = M(ac ? 0x4c5257 : 0x5e645a), D = M(0x2c3035), fy = 0.34, r = 0.21;
  transportBody(g, C, [[-1.76, 0.05, 0.16], [-1.55, 0.09, 0.12], [-1.3, 0.15, 0.06], [-1.05, 0.205, 0.005], [-0.9, r, 0], [1.05, r, 0],
    [1.2, 0.185, -0.015], [1.32, 0.155, -0.03], [1.42, 0.115, -0.045], [1.5, 0.06, -0.055], [1.54, 0.005, -0.06]], fy, 1.05, 1.24, 1.36);   // upswept tail (the ramp) to the nose
  fin(g, -1.62, fy + 0.2, 0, 0.55, 0.8, C, 0.22, 0, 0.05);
  pair(g, [[-1.38, 0.08], [-1.55, 0.62], [-1.75, 0.62], [-1.72, 0.08]], fy + 0.2, 0.03, C);
  const wy = fy + r * 0.86;                                                                       // high wing, through the top of the fuselage
  pair(g, [[0.32, 0], [0.13, 2.02], [-0.1, 2.02], [-0.18, 0]], wy, 0.05, C);
  taper(g, 0.56, 0.07, r * 1.3, C, 0.07, wy + 0.06, 0, 0.75, 0.7);                               // wing-root fairing on top
  for (const s of [-1, 1]) taper(g, 0.6, 0.14, 0.12, C2, -0.1, fy - 0.14, s * 0.21, 0.9, 1);    // gear sponsons
  const props = [];
  for (const z of [0.68, 1.3]) for (const s of [-1, 1]) {
    tube(g, -0.2, 0.52, 0.06, 0.08, C2, wy - 0.02, s * z, 8);
    noseCone(g, 0.52, wy - 0.02, 0.05, 0.1, D, 8);
    props.push(propeller(g, 0.58, wy - 0.02, s * z, 0.22, 3));
  }
  const dyn = [...props.flatMap(p => [p.pr, ...p.blades])];
  let hoses = [];
  if (kc) for (const s of [-1, 1]) {
    const P = KC130_POD;
    tube(g, P.x - 0.05, P.x + 0.4, 0.04, 0.05, 0xd0d4d8, P.y, s * P.z, 6); box(g, 0.25, 0.06, 0.02, C, P.x + 0.15, wy - 0.02, s * P.z);
    const hose = new THREE.Group(); hose.position.set(P.x - 0.05, P.y, s * P.z); hose.rotation.z = P.ang; g.add(hose);
    const hm = cyl(hose, 0.01, 0.01, 1, 4, 0x2a2a2a, -0.5, 0, 0); hm.rotation.z = Math.PI / 2; hm.castShadow = false;
    const drogue = new THREE.Group(); g.add(drogue);
    const dc = shade(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.09, 8, 1, true), M(0xd9dde0, { side: THREE.DoubleSide })), false); dc.rotation.z = -Math.PI / 2; drogue.add(dc);
    hoses.push({ hose, drogue, s }); dyn.push(hose, drogue);
  }
  if (ac) {
    for (const [x, len, rr] of [[-0.45, 0.32, 0.04], [0.15, 0.22, 0.025], [0.45, 0.18, 0.02]]) { const gb = cyl(g, rr, rr, len, 6, D, x, fy - 0.05, -r - len / 2 + 0.05); gb.rotation.x = Math.PI / 2; }   // 105 / 40 / 25 mm out of the left side
    const ball = shade(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), D)); ball.position.set(1.12, fy - 0.2, -0.08); g.add(ball);
  }
  const gr = gear(g, [[1.12, 0, 't'], [-0.15, 0.2, 'tan'], [-0.15, -0.2, 'tan']], 0.13);
  const ramp = new THREE.Group(); ramp.position.set(-1.0, fy - r * 0.95, 0); g.add(ramp); box(ramp, 0.5, 0.03, 0.34, C2, -0.25, 0, 0);   // loading ramp (st.rampT)
  dyn.push(gr, ramp);
  navLights(g, [[0.0, wy + 0.03, -2.02, 0xff2a1a], [0.0, wy + 0.03, 2.02, 0x22ff66], [-1.9, fy + 0.3, 0, 0xffffff]], null, 0.9);
  navLights(g, [[-0.4, fy + 0.25, 0, 0xff2020]], { period: 1.2, duty: 0.15, phase: Math.random() }, 1.0);
  mergeStatic(g, dyn);
  let spin = 0, ang = 0, ext = 0, rk = 0;
  return jetModel(g, gr, [], 0, 0, {
    more(dt, st) {
      spin += ((st.engineOn ? 1 : 0) - spin) * Math.min(1, dt * 0.8); ang += spin * 40 * dt; spinProps(props, spin, ang);
      rk += ((st.rampT || 0) - rk) * Math.min(1, dt * 1.2); ramp.rotation.z = lerp(-0.32, 0.29, rk);
      if (!hoses.length) return;
      ext += ((st.hoseOut || 0) - ext) * Math.min(1, dt * 0.9);
      const P = KC130_POD, L = P.len * ext;
      for (const h of hoses) { h.hose.visible = ext > 0.02; h.hose.scale.x = Math.max(L, 1e-3); h.drogue.position.set(P.x - 0.08 - L * Math.cos(P.ang), P.y - L * Math.sin(P.ang), h.s * P.z); }
    }
  });
}
/* ---------- C-17 Globemaster III — 53 m: high swept wing with winglets, four turbofans, T-tail ---------- */
function buildC17(color) {
  const g = new THREE.Group(), C = M(color || 0x6a7177), C2 = M(0x5c6369), fy = 0.5, r = 0.33;
  transportBody(g, C, [[-2.68, 0.08, 0.25], [-2.4, 0.16, 0.17], [-2.1, 0.26, 0.07], [-1.85, 0.32, 0.01], [-1.6, r, 0], [1.8, r, 0],
    [2.05, 0.28, -0.03], [2.25, 0.2, -0.05], [2.38, 0.12, -0.06], [2.46, 0.04, -0.065], [2.48, 0.003, -0.065]], fy, 1.05, 2.12, 2.28);
  fin(g, -2.35, fy + 0.35, 0, 0.75, 1.0, C, 0.32, 0, 0.07);
  pair(g, [[-2.55, 0.03], [-2.8, 0.85], [-3.02, 0.85], [-2.98, 0.03]], fy + 1.34, 0.04, C);       // T-tail
  const wy = fy + r * 0.86;                                                                       // high wing, through the top of the fuselage
  pair(g, [[0.75, 0], [-0.55, 2.55], [-0.85, 2.55], [-0.42, 0]], wy, 0.06, C);
  taper(g, 1.1, 0.09, r * 1.3, C, 0.12, wy + 0.08, 0, 0.75, 0.7);                                // wing-root fairing on top
  for (const s of [-1, 1]) { fin(g, -0.7, wy, s * 2.56, 0.26, 0.28, C, 0.12, 0, 0.03); taper(g, 1.0, 0.2, 0.18, C2, 0.1, fy - 0.22, s * 0.32, 0.9, 1); }
  for (const [x, z] of [[0.5, 0.95], [-0.08, 1.72]]) for (const s of [-1, 1]) {
    tube(g, x - 0.58, x, 0.1, 0.12, C2, wy - 0.18, s * z, 10); tube(g, x - 0.03, x, 0.1, 0.1, 0x222, wy - 0.18, s * z, 10);
    box(g, 0.4, 0.14, 0.04, C, x - 0.25, wy - 0.06, s * z);
  }
  const gr = gear(g, [[1.75, 0, 't'], [-0.1, 0.3, 'b6'], [-0.1, -0.3, 'b6']], 0.17);
  const ramp = new THREE.Group(); ramp.position.set(-1.9, fy - r * 0.95, 0); g.add(ramp); box(ramp, 0.8, 0.04, 0.55, C2, -0.4, 0, 0);   // loading ramp (st.rampT)
  navLights(g, [[-0.7, wy + 0.3, -2.56, 0xff2a1a], [-0.7, wy + 0.3, 2.56, 0x22ff66], [-2.7, fy + 0.4, 0, 0xffffff]], null, 1.0);
  navLights(g, [[-1.2, fy + 0.36, 0, 0xff2020]], { period: 1.2, duty: 0.15, phase: Math.random() }, 1.1);
  mergeStatic(g, [gr, ramp]);
  let rk = 0;
  return jetModel(g, gr, [], 0, 0, { more(dt, st) { rk += ((st.rampT || 0) - rk) * Math.min(1, dt * 1.2); ramp.rotation.z = lerp(-0.3, 0.24, rk); } });
}
/* ---------- MQ-9 Reaper — 11 m, 20 m wing: bulbous nose, Y-tail, pusher propeller ---------- */
function buildMQ9(color) {
  const g = new THREE.Group(), C = M(color || 0x9aa0a6), C2 = M(0x878d93), D = M(0x2c3035), fy = 0.22;
  tube(g, -0.5, 0.3, 0.045, 0.065, C, fy, 0, 8);
  const nose = shade(new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), C)); nose.position.set(0.36, fy + 0.02, 0); nose.scale.set(1.6, 1, 1); g.add(nose);
  const ball = shade(new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), D)); ball.position.set(0.3, fy - 0.07, 0); g.add(ball);
  pair(g, [[0.06, 0.05], [0.03, 1.0], [-0.06, 1.0], [-0.09, 0.05]], fy + 0.02, 0.02, C);
  for (const s of [-1, 1]) { fin(g, -0.48, fy, s * 0.03, 0.14, 0.24, C2, 0.06, s * 0.75, 0.015); tube(g, -0.1, 0.1, 0.015, 0.015, 0xd8d8d0, fy - 0.05, s * 0.45, 5); }   // V-tail, Hellfires
  const vf = fin(g, -0.48, fy - 0.2, 0, 0.12, 0.2, C2, -0.04, 0, 0.015); vf.rotation.z = Math.PI;   // ventral fin
  const P = propeller(g, -0.53, fy, 0, 0.15, 2, D);
  const gr = gear(g, [[0.25, 0], [-0.05, 0.14], [-0.05, -0.14]], 0.1);
  mergeStatic(g, [gr, P.pr, ...P.blades]);
  let spin = 0, ang = 0;
  return jetModel(g, gr, [], 0, 0, { more(dt, st) { spin += ((st.engineOn ? 1 : 0) - spin) * Math.min(1, dt * 0.8); ang += spin * 40 * dt; spinProps([P], spin, ang); } });
}

/* ---------- UH-60 Black Hawk (HH-60 style refuelling probe for the KC-130) — 15.3 m fuselage, 16.4 m rotor ---------- */
function buildUH60(color) {
  const g = new THREE.Group(), C = M(color || 0x474d3c), C2 = M(0x3f4535), D = M(0x2a2d2a), CAN = CANOPY();
  taper(g, 0.46, 0.2, 0.24, C, 0.03, 0.14, 0, 1.0, 0.85);                             // cabin
  taper(g, 0.22, 0.2, 0.235, C, 0.37, 0.14, 0, 0.55, 0.8, -0.05);                     // cockpit
  taper(g, 0.14, 0.11, 0.2, C, 0.53, 0.095, 0, 0.6, 0.8, -0.03);                      // nose
  taper(g, 0.12, 0.1, 0.24, CAN, 0.43, 0.2, 0, 0.4, 0.8, -0.035);                     // windscreen
  for (const s of [-1, 1]) { box(g, 0.15, 0.065, 0.006, CAN, 0.36, 0.175, s * 0.119); box(g, 0.06, 0.05, 0.006, CAN, 0.17, 0.18, s * 0.121); box(g, 0.17, 0.14, 0.006, D, 0.04, 0.12, s * 0.122); }
  taper(g, 0.5, 0.07, 0.19, C, -0.01, 0.275, 0, 0.85, 0.75);
  for (const s of [-1, 1]) {
    tube(g, -0.19, 0.09, 0.045, 0.045, C2, 0.285, s * 0.1);
    const x = box(g, 0.08, 0.04, 0.05, D, -0.21, 0.29, s * 0.13); x.rotation.y = s * 0.5;
    box(g, 0.1, 0.015, 0.2, C, -0.05, 0.22, s * 0.2); tube(g, -0.12, 0.05, 0.035, 0.035, C2, 0.17, s * 0.28, 6);   // ESSS stub wings with tanks
  }
  cyl(g, 0.025, 0.035, 0.07, 6, D, 0.0, 0.345, 0);
  const tc = taper(g, 0.17, 0.64, 0.16, C, -0.49, 0.145, 0, 0.35, 0.38, 0.05); tc.rotation.z = Math.PI / 2;
  taper(g, 0.17, 0.32, 0.045, C, -0.86, 0.36, 0, 0.55, 0.8, -0.06);
  pair(g, [[-0.8, 0.0], [-0.82, 0.22], [-0.92, 0.22], [-0.92, 0.0]], 0.22, 0.015, C);
  for (const s of [-1, 1]) { const st = box(g, 0.025, 0.09, 0.025, D, 0.33, 0.07, s * 0.145); st.rotation.x = s * 0.35; const w = cyl(g, 0.035, 0.035, 0.03, 8, 0x1a1a1a, 0.33, 0.035, s * 0.165); w.rotation.x = Math.PI / 2; }
  box(g, 0.025, 0.06, 0.025, D, -0.42, 0.06, 0); const tw = cyl(g, 0.03, 0.03, 0.025, 8, 0x1a1a1a, -0.43, 0.03, 0); tw.rotation.x = Math.PI / 2;
  const pb = tube(g, 0.4, 0.95, 0.008, 0.01, D, 0.24, 0.12, 5); pb.rotation.y = 0.05;            // refuelling probe (starboard)
  const R = heliRotor(g, 0.0, 0.38, 4, 0.77, 0.055, 0x2a2d30);
  const th = new THREE.Group(); th.position.set(-0.9, 0.43, 0.04); th.rotation.x = -0.35; g.add(th);
  const T = tailRotor(th, 0, 0, 0, 0.167, 0x2a2d30);
  navLights(g, [[0.1, 0.2, -0.13, 0xff2a1a], [0.1, 0.2, 0.13, 0x22ff66], [-0.96, 0.3, 0, 0xffffff]], null, 0.8);
  navLights(g, [[0, 0.03, 0, 0xff2020], [0, 0.33, 0, 0xff3030]], { period: 1.0, duty: 0.18, phase: Math.random() }, 1.0);
  return heliModel(g, R, T, new V3(0.5, 0.08, 0));
}
/* ---------- AH-64D Apache Longbow — 17.7 m: tandem cockpit, TADS nose, chin gun, stub wings, mast radar ---------- */
function buildAH64(color) {
  const g = new THREE.Group(), C = M(color || 0x3e4436), C2 = M(0x363b30), D = M(0x262924), CAN = CANOPY();
  taper(g, 0.5, 0.17, 0.13, C, 0.3, 0.16, 0, 0.9, 0.8);                                         // forward fuselage
  taper(g, 0.16, 0.08, 0.11, CAN, 0.43, 0.27, 0, 0.7, 0.75, -0.01);                             // gunner
  taper(g, 0.18, 0.11, 0.115, CAN, 0.25, 0.29, 0, 0.75, 0.75, -0.02);                           // pilot, raised
  box(g, 0.1, 0.1, 0.09, D, 0.6, 0.14, 0);                                                        // TADS/PNVS
  taper(g, 0.4, 0.2, 0.15, C, -0.08, 0.18, 0, 1, 0.8);
  for (const s of [-1, 1]) { tube(g, -0.25, 0.08, 0.05, 0.05, C2, 0.26, s * 0.13, 8); box(g, 0.08, 0.04, 0.06, D, -0.28, 0.27, s * 0.15).rotation.y = s * 0.6; }   // engine nacelles
  taper(g, 0.32, 0.08, 0.12, C, 0.02, 0.33, 0, 0.8, 0.7);
  cyl(g, 0.02, 0.03, 0.08, 6, D, 0.02, 0.39, 0);
  const lb = shade(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), C2)); lb.position.set(0.02, 0.52, 0); lb.scale.y = 0.55; g.add(lb);   // Longbow radar over the rotor
  tube(g, 0.42, 0.56, 0.008, 0.008, D, 0.06, 0, 4);                                              // 30 mm chain gun
  const ws = [[0.05, 0.06], [0.03, 0.3], [-0.08, 0.3], [-0.1, 0.06]]; pair(g, ws, 0.17, 0.02, C);
  for (const s of [-1, 1]) {
    tube(g, -0.1, 0.1, 0.028, 0.028, D, 0.12, s * 0.15, 8);                                      // rocket pod
    for (const dz of [-0.015, 0.015]) for (const dy of [0, 0.03]) tube(g, -0.08, 0.08, 0.01, 0.01, 0xd8d8d0, 0.11 + dy, s * 0.26 + dz, 5);   // Hellfires
  }
  const tb = taper(g, 0.11, 0.55, 0.08, C, -0.55, 0.2, 0, 0.45, 0.5, 0.04); tb.rotation.z = Math.PI / 2;
  pair(g, [[-0.82, 0.0], [-0.84, 0.17], [-0.92, 0.17], [-0.92, 0.0]], 0.2, 0.012, C);
  taper(g, 0.12, 0.28, 0.025, C, -0.84, 0.36, 0, 0.55, 0.8, -0.05);
  for (const s of [-1, 1]) { const st = box(g, 0.02, 0.1, 0.02, D, 0.36, 0.07, s * 0.12); st.rotation.x = s * 0.4; const w = cyl(g, 0.035, 0.035, 0.025, 8, 0x1a1a1a, 0.36, 0.035, s * 0.15); w.rotation.x = Math.PI / 2; }
  const tw = cyl(g, 0.025, 0.025, 0.02, 8, 0x1a1a1a, -0.86, 0.025, 0); tw.rotation.x = Math.PI / 2;
  const R = heliRotor(g, 0.02, 0.43, 4, 0.73, 0.05, 0x262924);
  const th = new THREE.Group(); th.position.set(-0.88, 0.48, -0.03); g.add(th);
  const T = tailRotor(th, 0, 0, 0, 0.14, 0x262924);
  navLights(g, [[-0.02, 0.18, -0.3, 0xff2a1a], [-0.02, 0.18, 0.3, 0x22ff66], [-0.95, 0.3, 0, 0xffffff]], null, 0.8);
  navLights(g, [[0.03, 0.36, 0, 0xff3030]], { period: 0.9, duty: 0.18, phase: Math.random() }, 1.0);
  return heliModel(g, R, T, new V3(0.62, 0.1, 0));
}
/* ---------- UH-1Y "Huey" — 12.7 m fuselage, two-bladed rotor, skids, door gunners ---------- */
function buildUH1(color) {
  const g = new THREE.Group(), C = M(color || 0x4c5440), C2 = M(0x434b38), D = M(0x2a2d2a), CAN = CANOPY();
  taper(g, 0.42, 0.22, 0.2, C, 0.05, 0.17, 0, 0.95, 0.9);                                        // cabin
  taper(g, 0.2, 0.2, 0.2, C, 0.36, 0.16, 0, 0.6, 0.85, -0.05);                                    // nose
  taper(g, 0.12, 0.13, 0.2, CAN, 0.42, 0.22, 0, 0.4, 0.85, -0.035);
  for (const s of [-1, 1]) { box(g, 0.2, 0.15, 0.006, D, 0.05, 0.16, s * 0.102); box(g, 0.04, 0.02, 0.1, D, 0.05, 0.2, s * 0.13); }   // open doors, door guns
  taper(g, 0.35, 0.1, 0.15, C, -0.02, 0.32, 0, 0.8, 0.75);
  tube(g, -0.2, 0.02, 0.04, 0.04, C2, 0.34, 0, 8);
  cyl(g, 0.02, 0.03, 0.08, 6, D, 0.02, 0.4, 0);
  const tb = taper(g, 0.1, 0.62, 0.08, C, -0.5, 0.22, 0, 0.45, 0.55, 0.04); tb.rotation.z = Math.PI / 2;
  taper(g, 0.12, 0.25, 0.03, C, -0.82, 0.36, 0, 0.6, 0.8, -0.05);
  pair(g, [[-0.5, 0.0], [-0.52, 0.14], [-0.6, 0.14], [-0.6, 0.0]], 0.22, 0.012, C);
  for (const s of [-1, 1]) {
    const sk = tube(g, -0.25, 0.35, 0.01, 0.01, D, 0.012, s * 0.14, 5); const toe = tube(g, 0.35, 0.41, 0.01, 0.01, D, 0.03, s * 0.14, 5); toe.rotation.z = -Math.PI / 2 + 0.7;
    for (const x of [-0.12, 0.2]) { const leg = box(g, 0.012, 0.07, 0.012, D, x, 0.045, s * 0.12); leg.rotation.x = s * 0.5; }
  }
  const R = heliRotor(g, 0.02, 0.44, 2, 0.73, 0.06, 0x2a2d30);
  const th = new THREE.Group(); th.position.set(-0.84, 0.42, 0.04); g.add(th);
  const T = tailRotor(th, 0, 0, 0, 0.13, 0x2a2d30);
  navLights(g, [[0.05, 0.3, -0.12, 0xff2a1a], [0.05, 0.3, 0.12, 0x22ff66], [-0.88, 0.32, 0, 0xffffff]], null, 0.8);
  navLights(g, [[0, 0.42, 0, 0xff3030]], { period: 1.1, duty: 0.18, phase: Math.random() }, 1.0);
  return heliModel(g, R, T, new V3(0.45, 0.08, 0));
}

/* ---------- more enemies: Su-35, Su-34, Tu-22M3 (static templates; red fin tips) ---------- */
function buildSu35() {
  const g = new THREE.Group(), C = M(0x6b7a88), C2 = M(0x56636f), D = M(0x2c2f33), R = M(0x8f2b22), CAN = CANOPY();
  const b = new THREE.Group(); b.position.y = 0.22; g.add(b);
  taper(b, 0.72, 0.15, 0.16, C, 0.62, 0.06, 0, 0.75, 0.7); noseCone(b, 0.98, 0.06, 0.075, 0.34, C);
  taper(b, 0.3, 0.1, 0.12, CAN, 0.66, 0.18, 0, 0.6, 0.7, -0.04);
  prism(b, [[0.4, 0.15], [-0.95, 0.3], [-0.95, -0.3], [0.4, -0.15]], -0.02, 0.1, C);
  pair(b, [[0.45, 0.14], [-0.12, 0.4], [-0.45, 0.8], [-0.6, 0.8], [-0.62, 0.28]], 0.03, 0.03, C);
  for (const s of [-1, 1]) {
    taper(b, 0.95, 0.15, 0.16, C2, -0.42, -0.07, s * 0.2, 0.95, 0.9); box(b, 0.16, 0.12, 0.14, D, 0.12, -0.08, s * 0.2);
    tube(b, -1.0, -0.9, 0.07, 0.075, 0x222, -0.07, s * 0.2);
    taper(b, 0.38, 0.42, 0.03, C, -0.68, 0.3, s * 0.3, 0.5, 1, -0.14); box(b, 0.1, 0.06, 0.035, R, -0.85, 0.49, s * 0.3);
    tube(b, -0.5, -0.2, 0.02, 0.02, 0x8a8f86, 0.0, s * 0.82, 5);                                   // wingtip pods
  }
  pair(b, [[-0.7, 0.28], [-0.9, 0.6], [-1.02, 0.6], [-1.0, 0.28]], -0.03, 0.025, C);
  enemyGlows(g, -1.02, 0.15, [-0.2, 0.2], 0.6);
  mergeStatic(g, []); return g;
}
/* Su-34 Fullback — side-by-side cockpit in a wide flat "platypus" nose, canards, big Flanker body */
function buildSu34() {
  const g = new THREE.Group(), C = M(0x6a7680), C2 = M(0x56606a), D = M(0x2c2f33), R = M(0x8f2b22), CAN = CANOPY();
  const b = new THREE.Group(); b.position.y = 0.24; g.add(b);
  taper(b, 0.8, 0.17, 0.26, C, 0.7, 0.06, 0, 0.7, 0.65); const n = noseCone(b, 1.1, 0.04, 0.1, 0.36, C); n.scale.z = 1.4;
  taper(b, 0.34, 0.12, 0.2, CAN, 0.76, 0.2, 0, 0.6, 0.75, -0.04);
  prism(b, [[0.45, 0.17], [-1.0, 0.32], [-1.0, -0.32], [0.45, -0.17]], -0.02, 0.11, C);
  pair(b, [[0.5, 0.16], [-0.12, 0.44], [-0.48, 0.86], [-0.64, 0.86], [-0.66, 0.3]], 0.03, 0.03, C);
  pair(b, [[0.45, 0.16], [0.28, 0.36], [0.18, 0.36], [0.2, 0.16]], 0.06, 0.02, C);
  for (const s of [-1, 1]) {
    taper(b, 1.0, 0.16, 0.17, C2, -0.45, -0.07, s * 0.21, 0.95, 0.9); box(b, 0.17, 0.13, 0.15, D, 0.12, -0.08, s * 0.21);
    tube(b, -1.05, -0.95, 0.075, 0.08, 0x222, -0.07, s * 0.21);
    taper(b, 0.4, 0.44, 0.03, C, -0.72, 0.31, s * 0.32, 0.5, 1, -0.14); box(b, 0.1, 0.06, 0.035, R, -0.9, 0.51, s * 0.32);
    for (const z of [0.42, 0.58]) tube(b, -0.3, 0.05, 0.035, 0.035, 0x55554a, -0.02, s * z, 6);       // bombs
  }
  pair(b, [[-0.74, 0.3], [-0.95, 0.62], [-1.07, 0.62], [-1.05, 0.3]], -0.03, 0.025, C);
  tube(b, -1.2, -1.0, 0.04, 0.05, C2, 0.0, 0, 6);
  enemyGlows(g, -1.07, 0.17, [-0.21, 0.21], 0.6);
  mergeStatic(g, []); return g;
}
/* Tu-22M3 Backfire — long-range swing-wing bomber, ~42 m: big intakes, swept wings, tall fin (scaled up in ENEMY_TYPES) */
function buildTu22() {
  const g = new THREE.Group(), C = M(0xb8bcc0), C2 = M(0x9ea3a8), D = M(0x2c2f33), R = M(0x8f2b22), CAN = CANOPY();
  tube(g, -1.7, 1.2, 0.16, 0.17, C, 0.3, 0, 10);
  noseCone(g, 1.2, 0.3, 0.17, 0.75, C, 10);
  taper(g, 0.5, 0.12, 0.2, CAN, 1.25, 0.43, 0, 0.6, 0.7, -0.04);
  for (const s of [-1, 1]) { taper(g, 1.6, 0.26, 0.2, C2, -0.6, 0.28, s * 0.22, 0.95, 0.9); box(g, 0.2, 0.24, 0.16, D, 0.25, 0.28, s * 0.25); }   // intake trunks
  pair(g, [[0.6, 0.2], [-0.2, 0.62], [-0.3, 0.62], [-0.3, 0.2]], 0.32, 0.05, C);                    // glove
  pair(g, [[-0.15, 0.6], [-1.1, 1.75], [-1.3, 1.75], [-0.35, 0.6]], 0.33, 0.035, C);                // swept outer wings
  fin(g, -1.6, 0.42, 0, 0.9, 0.75, C, 0.35, 0, 0.05); box(g, 0.2, 0.1, 0.06, R, -2.0, 1.12, 0);
  pair(g, [[-1.3, 0.12], [-1.75, 0.75], [-1.95, 0.75], [-1.9, 0.12]], 0.36, 0.03, C);
  for (const s of [-1, 1]) tube(g, -2.0, -1.75, 0.1, 0.11, 0x222, 0.28, s * 0.22, 8);
  enemyGlows(g, -2.05, 0.28, [-0.22, 0.22], 0.8);
  mergeStatic(g, []); return g;
}
/* ---------- enemy attack helicopters (the rotor group is named 'rotor' — combat.js spins it on the clones) ---------- */
function enemyRotor(g, x, y, n, len, color, name) {
  const r = new THREE.Group(); r.name = name || 'rotor'; r.position.set(x, y, 0); g.add(r);
  for (let i = 0; i < n; i++) { const h = new THREE.Group(); h.rotation.y = i * TAU / n; r.add(h); box(h, len, 0.02, 0.05, color, len / 2 + 0.05, 0, 0).castShadow = false; }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(len + 0.05, 20), new THREE.MeshBasicMaterial({ color: 0x2a2f34, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2; r.add(disc);
  return r;
}
/* Ka-52 Alligator — coaxial rotors, side-by-side cockpit, stub wings, no tail rotor */
function buildKa52() {
  const g = new THREE.Group(), C = M(0x4e5446), C2 = M(0x444a3c), D = M(0x26292a), R = M(0x8f2b22), CAN = CANOPY();
  taper(g, 0.55, 0.2, 0.17, C, 0.2, 0.18, 0, 0.9, 0.85); taper(g, 0.22, 0.16, 0.16, C, 0.55, 0.15, 0, 0.6, 0.8, -0.04);
  taper(g, 0.2, 0.12, 0.17, CAN, 0.42, 0.3, 0, 0.6, 0.8, -0.03);
  for (const s of [-1, 1]) { tube(g, -0.22, 0.12, 0.05, 0.05, C2, 0.3, s * 0.13, 8); box(g, 0.25, 0.02, 0.22, C, -0.02, 0.2, s * 0.18); tube(g, -0.12, 0.1, 0.028, 0.028, D, 0.15, s * 0.26, 8); }
  const tb = taper(g, 0.1, 0.6, 0.08, C, -0.58, 0.22, 0, 0.45, 0.5, 0.04); tb.rotation.z = Math.PI / 2;
  pair(g, [[-0.78, 0.0], [-0.8, 0.18], [-0.9, 0.18], [-0.9, 0.0]], 0.2, 0.015, C);
  for (const s of [-1, 1]) { taper(g, 0.1, 0.18, 0.02, C, -0.88, 0.26, s * 0.18, 0.6, 1, -0.03); box(g, 0.06, 0.03, 0.025, R, -0.9, 0.36, s * 0.18); }
  cyl(g, 0.025, 0.025, 0.2, 6, D, 0.02, 0.45, 0);
  enemyRotor(g, 0.02, 0.42, 3, 0.68, 0x262924, 'rotor'); enemyRotor(g, 0.02, 0.55, 3, 0.68, 0x262924, 'rotor2');
  mergeStatic(g, g.children.filter(o => o.name)); return g;
}
/* Mi-24 Hind — tandem bubble cockpits, troop cabin, stub wings with pylons, five blades */
function buildMi24() {
  const g = new THREE.Group(), C = M(0x6a6648), C2 = M(0x5a5640), D = M(0x26292a), R = M(0x8f2b22), CAN = CANOPY();
  taper(g, 0.6, 0.22, 0.2, C, 0.05, 0.18, 0, 0.9, 0.85); taper(g, 0.28, 0.16, 0.16, C, 0.48, 0.14, 0, 0.6, 0.8, -0.04);
  for (const [x, y, s] of [[0.58, 0.22, 0.06], [0.4, 0.29, 0.07]]) { const c = shade(new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6, 0, TAU, 0, Math.PI / 2), CAN)); c.position.set(x, y, 0); c.scale.set(1.4, 1, 1); g.add(c); }
  for (const s of [-1, 1]) { tube(g, -0.2, 0.15, 0.05, 0.05, C2, 0.33, s * 0.11, 8); box(g, 0.24, 0.02, 0.3, C, -0.05, 0.2, s * 0.22).rotation.x = s * -0.2; tube(g, -0.15, 0.08, 0.03, 0.03, D, 0.13, s * 0.3, 8); }
  const tb = taper(g, 0.1, 0.7, 0.08, C, -0.62, 0.24, 0, 0.45, 0.5, 0.04); tb.rotation.z = Math.PI / 2;
  taper(g, 0.14, 0.26, 0.025, C, -0.98, 0.36, 0, 0.6, 0.8, -0.05); box(g, 0.07, 0.04, 0.03, R, -1.0, 0.48, 0);
  const tr = new THREE.Group(); tr.name = 'trotor'; tr.position.set(-1.0, 0.38, 0.04); g.add(tr); box(tr, 0.03, 0.3, 0.02, 0x262924, 0, 0, 0); box(tr, 0.3, 0.03, 0.02, 0x262924, 0, 0, 0);
  cyl(g, 0.025, 0.03, 0.08, 6, D, 0.0, 0.42, 0);
  enemyRotor(g, 0.0, 0.46, 5, 0.85, 0x262924, 'rotor');
  mergeStatic(g, g.children.filter(o => o.name)); return g;
}
/* ---------- enemy armour (static templates; the turret group is named 'turret' so combat.js can aim it) ---------- */
function enemyTurret(g, x, y) { const t = new THREE.Group(); t.name = 'turret'; t.position.set(x, y, 0); g.add(t); return t; }
/* T-90 — low hull, rounded turret with ERA blocks, long 125 mm gun */
function buildT90() {
  const g = new THREE.Group(), C = M(0x4f5638), C2 = M(0x434a30), D = M(0x26292a), R = M(0x8f2b22);
  taper(g, 2.3, 0.3, 1.15, C, 0, 0.4, 0, 0.9, 0.95, 0.05);
  for (const s of [-1, 1]) { box(g, 2.4, 0.3, 0.3, D, 0, 0.17, s * 0.55); box(g, 2.3, 0.05, 0.34, C2, 0, 0.34, s * 0.55); }
  box(g, 0.25, 0.25, 0.9, C2, -1.15, 0.45, 0);                                                    // fuel drums at the back
  const t = enemyTurret(g, 0.1, 0.55);
  const tu = shade(new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 6, 0, TAU, 0, Math.PI / 2), C)); tu.scale.set(1.1, 0.55, 1); t.add(tu);
  for (const s of [-1, 1]) box(t, 0.35, 0.12, 0.25, C2, 0.35, 0.12, s * 0.3).rotation.y = s * 0.4;   // ERA
  tube(t, 0.4, 2.0, 0.045, 0.04, C2, 0.12, 0, 6);
  box(t, 0.12, 0.08, 0.12, R, -0.3, 0.28, 0);
  mergeStatic(g, [t]); return g;
}
/* BMP-3 — infantry fighting vehicle: low hull, small turret with the 100 mm / 30 mm pair */
function buildBMP() {
  const g = new THREE.Group(), C = M(0x5a5e40), C2 = M(0x4c5036), D = M(0x26292a);
  taper(g, 2.0, 0.42, 1.05, C, 0, 0.42, 0, 0.85, 0.95, -0.1);
  for (const s of [-1, 1]) box(g, 2.0, 0.26, 0.28, D, 0, 0.15, s * 0.5);
  const t = enemyTurret(g, 0.05, 0.66);
  taper(t, 0.65, 0.2, 0.6, C2, 0, 0.08, 0, 0.8, 0.85); tube(t, 0.3, 1.2, 0.035, 0.03, D, 0.1, 0.05, 6); tube(t, 0.3, 0.9, 0.015, 0.015, D, 0.12, -0.08, 5);
  mergeStatic(g, [t]); return g;
}
/* BTR-82 — eight-wheeled APC with a small MG turret */
function buildBTR() {
  const g = new THREE.Group(), C = M(0x5c6244), C2 = M(0x4e5438), D = M(0x26292a);
  taper(g, 2.3, 0.45, 0.95, C, 0, 0.55, 0, 0.88, 0.85);
  for (const x of [-0.8, -0.3, 0.3, 0.8]) for (const s of [-1, 1]) { const w = cyl(g, 0.17, 0.17, 0.14, 8, D, x, 0.17, s * 0.45); w.rotation.x = Math.PI / 2; }
  const t = enemyTurret(g, 0.35, 0.8);
  cyl(t, 0.22, 0.25, 0.18, 8, C2, 0, 0.09, 0); tube(t, 0.2, 0.75, 0.02, 0.018, D, 0.1, 0, 5);
  mergeStatic(g, [t]); return g;
}
