// Renders the Workshop preview (preview.gif, animated 256x256 — Wallpaper Engine's limits: ≤ 256 px, < 1 MB, ideally
// < 500 KB) and the README screenshots (screenshots/<scene>.jpg, 1280x720, see SCENES). Run in Docker:
//   powershell -ExecutionPolicy Bypass -File tools/test.ps1 -c tools/preview.config.js                (everything)
//   powershell -ExecutionPolicy Bypass -File tools/test.ps1 -c tools/preview.config.js -g gif         (only the GIFs)
//   powershell -ExecutionPolicy Bypass -File tools/test.ps1 -c tools/preview.config.js -g "refuel,"   (one scene)
// Candidates for seeds 1..N go to test-results/gif-<seed>.gif (+ gif-<seed>-sheet.png, a few frames to look at) and
// test-results/<scene>-<seed>.jpg; copy the best ones over preview.gif / screenshots/<scene>.jpg. Every run clears
// test-results/.
const fs = require('fs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { test, expect } = require('../tests/support/harness');

test.setTimeout(8 * 60 * 1000);

const SEEDS = 6;
const GIF = { size: 256, render: 1024, zoom: 130, season: 'autumn', frames: 32, fps: 10, colors: 64 };

/* the README screenshots. Each: hour, season, `before` (in the page, right after boot), `fight` (stress level: the music
   starts after the warm-up) or `after` (in the page, after the warm-up, peace), `until(tries)` (in the page, every 0.5 s:
   the moment to take; may start things itself), `tries` (× 0.5 s). The page functions are serialised: no closures. */
const SCENES = {
  // an autumn afternoon dogfight over the base with an intercepted enemy call
  dogfight: { hour: 15.5, season: 'autumn', fight: 0.45, until: (tries) => {
    const inside = p => __seen(p, -0.35), on = document.getElementById('subs').classList.contains('on');
    const pass = AIRWAR.passes.find(p => !p.heli && p.bandit && enemyAlive(p.bandit) && inside(p.bandit.p) && p.crew.some(a => a.state === 'cbt_pass' && inside(a.mesh.position)));
    return !!pass && on && (RADIO.cur.role === 'enemy' || tries > 200);
  } },
  // a winter night under heavy attack: a dogfight pass overhead, armour or missiles coming at the base
  night: { hour: 23, season: 'winter', fight: 0.8, until: (tries) => {
    const inside = p => __seen(p, -0.3), on = document.getElementById('subs').classList.contains('on');
    const pass = AIRWAR.passes.some(p => !p.heli && p.bandit && enemyAlive(p.bandit) && inside(p.bandit.p) && p.crew.some(a => a.state === 'cbt_pass' && inside(a.mesh.position)));
    const raid = ENEMIES.some(e => ['armor', 'cruise', 'ballistic'].includes(e.kind) && enemyAlive(e) && inside(e.p));
    return pass && on && (raid || tries > 150);
  } },
  // a summer morning refuelling pass: the KC-46 with a fighter on the boom (seeds with a KC-130 pass find no moment)
  refuel: { hour: 9.5, season: 'summer', before: () => { CFG.missions = 0; }, after: () => { TANKER.timer = 100; }, tries: 1200, until: (tries) => {
    const ev = TANKER.ev, on = document.getElementById('subs').classList.contains('on');
    return !!ev && !!ev.P && ev.kind === 'boom' && ev.tanker.hoseOut === 1 && __seen(ev.tanker.mesh.position, -0.3) && (on || tries > 900);
  } },
  // a spring evening emergency: crash tenders foaming a jet stopped on the runway (the camera closes in on it)
  emergency: { hour: 19.1, season: 'spring', before: () => { CFG.missions = 0; GROUND_OPS.emTimer = 1e9; }, tries: 1200, until: (tries) => {
    if (!window.__e) {
      const a = AIRCRAFT.find(a => a.spec.armed && a instanceof FixedWing && a.state === 'orbit' && !a.mission && !a.tank && a.airT > 10);
      if (!a) return false;
      window.__e = a; GROUND_OPS.startEmergency(a);
      return false;
    }
    const sc = GROUND_OPS.scenes.find(s => s instanceof EmergencyScene && s.a === __e), on = document.getElementById('subs').classList.contains('on');
    const vis = !!sc && sc.phase === 'foam' && sc.t > 1.5 && __seen(__e.mesh.position, -0.25);
    window.__why = { state: __e.state, phase: sc && sc.phase, seen: __seen(__e.mesh.position, -0.25) };   // shown when no moment is found
    if (vis && !window.__cam) { window.__cam = true; const q = __e.mesh.position; CAM_TGT.set(q.x, 2.5, q.z); CFG.zoom = 150; updateCamera(); return false; }
    return vis && !!window.__cam && (on || sc.t > 5);
  } }
};

/* boot, let flights get up and missions go; then start the music (combat at `fight` stress) or run `after` */
async function warmUp(wp, seed, query, { before, fight, after } = {}) {
  await wp.boot({ seed, query });
  // __seen(p, margin): p is on screen (AIRWAR.onScreen margins) and not hidden under the panel
  await wp.run(() => { const v = new V3(); window.__seen = (p, m = 0) => {
    if (!AIRWAR.onScreen(p, m)) return false;
    v.copy(p).project(camera); const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
    const P = document.getElementById('panel'), r = P && P.getClientRects().length && P.getBoundingClientRect();
    return !r || x < r.left - 40 || x > r.right + 40 || y < r.top - 40 || y > r.bottom + 40;
  }; });
  if (before) await wp.run(before);
  await wp.sim(150);                                   // flights up, taxiing, the tanker and missions out and back
  if (fight !== undefined) {
    await wp.sim(6, { audio: true });                  // the music starts: combat
    await wp.run((s) => { STRESS.level = s; }, fight);
  }
  if (after) await wp.run(after);
}

/* simulate (with music when `audio`) until pred(tries) is true in the page */
async function waitFor(wp, pred, { audio = false, tries = 400 } = {}) {
  for (let i = 0; i < tries; i++) {
    await wp.sim(0.5, { audio, check: false });
    if (await wp.run(pred, i)) return true;
  }
  return false;
}

for (const [name, S] of Object.entries(SCENES)) test.describe(name, () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  for (let seed = 1; seed <= SEEDS; seed++) {
    test(`${name}, seed ${seed}`, async ({ wp, page }) => {
      await warmUp(wp, seed, `?hour=${S.hour}&season=${S.season}`, S);
      const ok = await waitFor(wp, S.until, { audio: S.fight !== undefined, tries: S.tries });
      expect(ok, `the ${name} moment ${JSON.stringify(await wp.run(() => window.__why))}`).toBe(true);
      await wp.run(() => __t.render());
      await page.screenshot({ path: `test-results/${name}-${seed}.jpg`, type: 'jpeg', quality: 90 });
    });
  }
});

test.describe('gif', () => {
  test.use({ viewport: { width: GIF.render, height: GIF.render } });
  for (let seed = 1; seed <= SEEDS; seed++) {
    test(`gif, seed ${seed}`, async ({ wp }) => {
      // only the scene: the panel and subtitles are unreadable at 256 px
      await warmUp(wp, seed, `?hour=15.5&zoom=${GIF.zoom}&season=${GIF.season}`, { fight: 0.45, before: () => { CFG.showPanel = false; CFG.subtitles = false; applySettings(); } });
      // a dogfight pass coming onto the screen
      const ok = await waitFor(wp, () => AIRWAR.passes.some(p => !p.heli && p.bandit && enemyAlive(p.bandit) &&
        AIRWAR.onScreen(p.bandit.p, 0) && p.crew.some(a => a.state === 'cbt_pass' && AIRWAR.onScreen(a.mesh.position, 0))), { audio: true });
      expect(ok, 'a dogfight pass on screen').toBe(true);

      const frames = [];
      for (let i = 0; i < GIF.frames; i++) {
        await wp.sim(1 / GIF.fps, { audio: true, check: false });
        const b64 = await wp.run(([size, i, n]) => {
          __t.render();
          // downscale in halving steps (smooth, no aliasing) — in the same task as the render, so the WebGL buffer is still there
          const C = window.__gifC || (window.__gifC = {});
          let src = renderer.domElement, w = src.width;
          while (w > size) {
            w = Math.max(size, w >> 1);
            const c = C[w] || (C[w] = Object.assign(document.createElement('canvas'), { width: w, height: w }));
            const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, w); src = c;
          }
          // a contact sheet of four frames, to look at the candidates without a GIF viewer
          const sheet = C.sheet || (C.sheet = Object.assign(document.createElement('canvas'), { width: size * 2, height: size * 2 }));
          const k = [0, n / 3, 2 * n / 3, n - 1].map(Math.floor).indexOf(i);
          if (k >= 0) sheet.getContext('2d').drawImage(src, (k % 2) * size, (k >> 1) * size);
          const d = src.getContext('2d').getImageData(0, 0, size, size).data;
          let s = ''; for (let j = 0; j < d.length; j += 0x8000) s += String.fromCharCode.apply(null, d.subarray(j, j + 0x8000));
          return btoa(s);
        }, [GIF.size, i, GIF.frames]);
        frames.push(new Uint8Array(Buffer.from(b64, 'base64')));
      }
      const sheet = await wp.run(() => __gifC.sheet.toDataURL('image/png').split(',')[1]);
      fs.writeFileSync(`test-results/gif-${seed}-sheet.png`, Buffer.from(sheet, 'base64'));

      // one palette for all frames (no flicker between frames), from every other frame
      const all = new Uint8Array(frames[0].length * Math.ceil(frames.length / 2));
      frames.filter((f, i) => i % 2 === 0).forEach((f, i) => all.set(f, i * f.length));
      const palette = quantize(all, GIF.colors);
      const gif = GIFEncoder();
      frames.forEach((f, i) => gif.writeFrame(applyPalette(f, palette), GIF.size, GIF.size,
        i ? { delay: 1000 / GIF.fps } : { palette, delay: 1000 / GIF.fps, repeat: 0 }));
      gif.finish();
      const bytes = gif.bytes();
      fs.writeFileSync(`test-results/gif-${seed}.gif`, bytes);
      console.log(`gif-${seed}.gif: ${(bytes.length / 1024).toFixed(0)} KB`);
      expect(bytes.length, 'Wallpaper Engine takes previews under 1 MB').toBeLessThan(1024 * 1024);
    });
  }
});
