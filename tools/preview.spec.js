// Renders the Workshop preview (preview.jpg, square 1080x1080) and the README screenshot (screenshot.jpg, 1280x720):
// an afternoon fight with a dogfight pass on screen, a radio subtitle and the flight-deck panel. Run in Docker:
//   powershell -ExecutionPolicy Bypass -File tools/test.ps1 -c tools/preview.config.js
// Candidates for seeds 1..N go to test-results/<preview|screenshot>-<seed>.jpg; copy the best ones over
// preview.jpg / screenshot.jpg. Every run clears test-results/ (`-g "preview, seed"` renders only the square ones).
const { test, expect } = require('../tests/support/harness');

test.setTimeout(5 * 60 * 1000);

const SEEDS = 6;
// the square preview with a smaller panel, so it doesn't cover the carrier
const SHOTS = { preview: { viewport: { width: 1080, height: 1080 }, panel: 70 }, screenshot: { viewport: { width: 1280, height: 720 }, panel: 100 } };
for (const [name, { viewport, panel }] of Object.entries(SHOTS)) test.describe(name, () => {
  test.use({ viewport });
  for (let seed = 1; seed <= SEEDS; seed++) {
    test(`${name}, seed ${seed}`, async ({ wp, page }) => {
      await wp.boot({ seed, query: '?hour=15.5' });
      await wp.run((s) => { CFG.panelScale = s; applySettings(); }, panel);
      await wp.sim(150);                                   // flights up, the tanker and missions out and back
      await wp.sim(6, { audio: true });                    // the music starts: combat
      await wp.run(() => { STRESS.level = 0.45; });
      // fight until a dogfight pass is well inside the screen with a subtitle up (an enemy one if it comes within ~100 s)
      let ok = false;
      for (let i = 0; i < 400 && !ok; i++) {
        await wp.sim(0.5, { audio: true, check: false });
        ok = await wp.run((tries) => { window.__tries = tries;
          const inside = p => AIRWAR.onScreen(p, -0.35);
          const pass = AIRWAR.passes.find(p => !p.heli && p.bandit && enemyAlive(p.bandit) && inside(p.bandit.p) && p.crew.some(a => a.state === 'cbt_pass' && inside(a.mesh.position)));
          // ideally an intercepted enemy transmission (red) is on the radio at that moment
          return !!pass && document.getElementById('subs').classList.contains('on') && (RADIO.cur.role === 'enemy' || __tries > 200);
        }, i);
      }
      expect(ok, 'a dogfight on screen with a subtitle').toBe(true);
      await wp.run(() => __t.render());
      await page.screenshot({ path: `test-results/${name}-${seed}.jpg`, type: 'jpeg', quality: 90 });
    });
  }
});
