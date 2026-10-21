# Carrier Strike Group — Wallpaper Engine web wallpaper

Isometric three.js scene (carrier, two destroyers, air wing, enemies) that reacts to system audio.
Runs 24/7 inside Wallpaper Engine (CEF/Chromium); also previewable in a normal browser.
User-facing docs: `README.md` (keep it in sync when behaviour or properties change).

## Stack & layout
- Plain JS, no build step, no npm. `'use strict'` classic scripts sharing **global** scope
  (no modules). three.js **r149** is vendored as `js/three.min.js` — never edit it.
- `index.html` loads scripts in dependency order (later files use globals of earlier ones):
  `core → flightpath → models → airframes → effects → radio → aircraft → missions → persist → combat → airwar → tanker → main → properties → settings`,
  then an inline script registers the WE audio listener (or starts the browser demo beat).
  `main.js` calls `init()` at its end, so anything `init()` needs must be defined before `main.js`.

| File | Contents |
|---|---|
| `js/core.js` | utils (`V3`, `rand`, `clamp`, `lerp`, `smoothstep`, `pick`…), `CFG` defaults, waves (JS + generated GLSL — keep in sync), sun position, sky palette, canvas textures `TEX` |
| `js/flightpath.js` | `FlightPath`: Dubins CSC curves (turn-radius-limited flight) + lines |
| `js/models.js` | mesh helpers (`M`, `box`, `cyl`, `taper`, `prism`…), `mergeStatic`, `disposeTree`, nav lights, searchlights, CIWS/gun mounts, `buildCarrier`, `buildDestroyer`, mission ships `buildFeeder` / `buildTrawler` / `buildCorvette` / `buildDestroyerTemplate` |
| `js/airframes.js` | aircraft model builders → `{ group, setFold(f), tick(dt, st) }` (`buildMQ25`: refuelling hose reads `st.hoseOut`); `buildWreck` (crashed jet template for pilot rescues) |
| `js/effects.js` | `Tracers` (InstancedMesh), `SpriteFX` (flash/smoke pools), `Splashes`, `Foam` (points), `FlashLights` |
| `js/radio.js` | callsigns (+ `ENEMY_NAMES`), `RADIO` subtitle queue, mission orders, `STRESS` + `THREAT_TIERS`, `radioLine()`, line pools `OPS` / `OPS_VOICE` / `OPS_UNARMED` / `COMBAT` / `AIRWAR_LINES` / `ENEMY_LINES` / `TANKER_LINES` / `LINES` (see "Radio lines & threat tiers") |
| `js/aircraft.js` | `Aircraft` → `FixedWing` / `Helicopter` state machines, deck resources `FD` / `DECK`, types, `Flyby` |
| `js/persist.js` | `PERSIST`: remembers who is in the air / on a mission (`localStorage`, `CFG.saveState`), restores it after a fresh `buildAirWing()` (orbit / `Mission.resume`), radio `LINES.restore` |
| `js/missions.js` | missions: `Leg` steps, `Mission` types (`patrol`, `cod`, `sling`, `ship`, `pilot`), `pickMission`, mission-world objects `CARGO` / `VESSELS` / `ROPES` — see "Missions" |
| `js/combat.js` | enemies: `ENEMY_TYPES` (Su-25/33/47/57 — model builders live in `airframes.js`; speed, altitude, hp, anti-ship missile chance, stress-based weight), vampires, boats, dogfight bandits (`duel`, flying a pass path), beat-synced hit resolution, ship damage |
| `js/airwar.js` | `AIRWAR`: combat passes — armed aircraft wait off-screen (`cbt_wait`) and cross the screen chasing / chased by a dogfight bandit or hunting boats; screen helpers (`ndc`, `onScreen`, `groundAt`), pass weapons on the beat (`AIRWAR.onBeat`), pass radio |
| `js/tanker.js` | `TANKER` (a mission-world object): refuelling passes — an MQ-25 and a fighter flight cross the screen together, one random receiver in the basket per pass (the rest fly along on the wings), their `airT` is reset (see "Refuelling passes") |
| `js/main.js` | WE property listener, scene init, audio analysis + `onBeat`, weapons, ships, missions, chatter, panel UI, main loop |
| `js/properties.js` | **generated** from `project.json` — do not edit by hand |
| `js/settings.js` | browser-only settings drawer, demo beat, audio-file player (returns early inside WE) |
| `tools/gen_properties.py` | regenerates `js/properties.js` |
| `tools/preview.spec.js` | renders image candidates (`powershell -ExecutionPolicy Bypass -File tools/test.ps1 -c tools/preview.config.js` → `test-results/preview-<seed>.jpg` square 1080², the Workshop preview `preview.jpg` from `project.json`; `test-results/screenshot-<seed>.jpg` 1280x720, `screenshot.jpg` in README.md; copy the best over them) |
| `tests/`, `playwright.config.js`, `package.json` | automated tests (Playwright Test) — see "Running & testing"; `tools/test.ps1` runs them in Docker, `.github/workflows/tests.yml` in CI |

## Rules / conventions
- **After changing any JS/CSS file, bump the cache-buster** `?v=N` on all `<script>`/`<link>` tags in
  `index.html` (WE's CEF caches aggressively). Current: `v=62`.
- **New WE property**: add it to `project.json`, read it in `applyUserProperties` (`main.js`) into `CFG`,
  then run `python tools/gen_properties.py`. Property `order` decides the browser-drawer group
  (0–9 camera/time, 10–19 audio/combat, 20–29 sea, 30–39 panel, 40–49 air wing, 50–59 hull number).
  `<key>count` sliders are picked up automatically for every key in `AIRCRAFT_TYPES`.
- **New aircraft type**: builder in `airframes.js`, subclass with static `spec` + `buildModel()` in
  `aircraft.js`, register in `AIRCRAFT_TYPES` and `FIXED_ORDER`/`HELI_ORDER`, callsign pool in `radio.js`,
  `<key>count` slider in `project.json`.
  Optional `spec` keys: `farOrbit` (orbit range for unarmed types during combat; `armed` types fly combat passes instead),
  `missions` (allow-list of mission type keys, e.g. `['cod']`; `[]` = never sent on missions — see "Missions"),
  `awacs` / `tanker` (support types, `isSupport`: no auto-recovery in combat; only the AWACS is scrambled for a fight), `voice` (key into `OPS_VOICE`),
  no `ballName` = unmanned (no ball call), `blades` (rotor blade count, for the
  stop-index snap), `noseDown` (helicopter cruise pitch), `callsignGroup`.
  The CMV-22B tiltrotor is a `Helicopter` with `conv` (0 = VTOL, 1 = airplane mode) and `gearDown` getters read by its model.
- Match the existing style: dense one-liners, short comments, `const` scratch vectors at module level.
- Sim time is `T` (advances only in `step(dt)`); real time is `RT()` (audio arming, beat gaps).
- **No scrolling UI**: WE passes clicks and mouse movement to the wallpaper but not the wheel. Long content gets
  click targets instead — the panel's aircraft list is paged (`PAGER` in `main.js`, pager only when it doesn't fit).
- **Session state** (`js/persist.js`): saved every 10 s and on pagehide / WE pause; only *who* is up (`AIR_STATES`,
  `cbt_*`) or on a mission, never positions. A new airborne state must go into `AIR_STATES`. The start-up splash
  (`#splash`, hidden in `step` at `T > 3.2`) covers the build / restore / start-up rebuild. The threat level
  (`STRESS.level`, in 0.05 steps) is saved too and restored once per page load.
- **Combat state** is latched in `updateArming()` (`main.js`, first thing in `step`): `AUD.hot` = sound for
  `ARM_DELAY` s → `AUD.combat` (read everywhere as `AUD.armed`). When the sound stops, `AUD.holding` is true for
  `DISARM_DELAY` s: still `armed` (aircraft stay engaged, no missions), but not `AUD.fighting` — no new waves, passes,
  weapons on the beat or chatter, and inbound vampires are intercepted / boats turn away. Radio `COMBAT.lull`, then
  `COMBAT.end` on stand-down, or `COMBAT.resume` if sound keeps going for `RESUME_DELAY` s.
  Use `AUD.fighting` for anything that should only happen while the fight is on; `AUD.armed` for "combat mode".

## Missions (`js/missions.js`)
Missions fly beyond the screen edge while there is no music. `dispatchFlight` (`main.js`) only chooses the flight
(assembled flights first, a four-ship may go as a pair); everything else is in `missions.js`.
- **`Mission`** = one dispatched flight. `start()` gives every aircraft a context `a.mission = { m, slot, role:
  'lead' | 'wing', far, legs, i, … }`, enters its first leg and sends the radio order (whole flight → lead; a pair →
  each callsign) and the acknowledgement. `update(a, dt)` runs the current leg; after the last one `finish(a)`
  (back to `orbit`). `Aircraft.missionFlow` just forwards to it; `onMission` = `!!this.mission`.
- **`Leg`** = one step for one aircraft: static `state` (the `aircraft.state` while in it), `enter(a, c)`,
  `update(a, c, dt)` → `true` when done. Register with `registerLeg(L, label, cls)` — that adds the panel `STATUS`.
  Generic legs: `Depart` (`mission_out`; wingmen wait for `m.leadOut`, then trail), `Away` (`mission`, hidden;
  a carried load is delivered here; the lead reports `m.done` when it ends), `Return` (`mission_back`; to a new
  orbit from the far point or from wherever the aircraft is).
- **Types**: `registerMission(C)`; `pickMission(lead)` picks by `static weight` among types that are
  `eligible(lead)` — all non-`optIn` types, or exactly the keys in `spec.missions` (allow-list).
  `Mission` (`patrol`, generic), `CodMission` (`cod`, optIn — CMV-22B: farther, longer, lands after),
  `SlingMission` (`sling`, unarmed helicopters with a host that has lifts: 50/50 `out` = hook a container from
  elevator one and fly it out, `in` = bring one back and set it down on elevator one; wingmen fly plain legs),
  and the **scene missions** (MH-60s only), built on `SceneMission` (not registered itself): something lies in the
  sea ahead of the fleet (`this.vessel = VESSELS.spawn(kind, damaged, color)`), lead `[ToVessel, OnScene, Return]`,
  wingman `[ToVessel, Overwatch, Return]`; it drifts past at ≥ 1.2/s, the legs end when the scene is off-screen behind
  the fleet, so the helicopters come back from the rear. A subclass sets `work()` (`'hoist'` = the people waiting
  come up one by one, `'board'` = a team goes down), `rider()` (figure colour), `arrive(a)` / `hoisted(a, n)` (radio).
  - `ShipMission` (`ship`): `VESSEL_KINDS` feeder / trawler / corvette / destroyer (the escort model minus its
    searchlight; builders in `models.js`) — damaged → rescue (survivors up the hoist), intact → inspect (team down).
  - `PilotMission` (`pilot`): `WRECK_KINDS` — a crashed jet (`buildWreck(builder)` in `airframes.js`: any airframe,
    gear / lights / glow stripped, half sunk, life raft beside it) of ours or an enemy's (a prisoner then); known from
    the order (`pilot.friendly` / `pilot.enemy`) or `pilot.unknown` and revealed on arrival (`LINES.pilot.reveal`,
    AWACS `ack`, the done text follows). The off-screen pilot pick-up stays among the patrol texts.
  - A kind: `{ key, name, build, len, deckY, spot, fire, crew, crewAt, ropeDz, roll, sink, bob, smoke }` (see the
    comment above `VESSEL_KINDS`) — a new scene object is a new kind, not new code.
- **New mission type**: subclass `Mission` (or a type), override what differs — `legs(role)`, `static eligible`,
  `static weight` / `optIn`, `textKey()` (key into `MISSIONS`, dots for nesting: `'sling.out'`), `copyKey()`
  (acknowledgement pool), `textVars()` (extra placeholders, e.g. `{V}`), `dist` / `away` in the constructor,
  `finish(a)` — then `registerMission()`. Texts go into
  `MISSIONS` (order / done pairs, `{S} {B} {G} {P} {W}` placeholders) and line pools into `LINES` (radio.js).
- **Mission-world objects** (things that live in the scene for a mission) `registerMissionWorld({ update(dt), reset() })`;
  `main.js` calls `missionWorldUpdate(dt)` every step and `missionWorldReset()` in `buildAirWing`.
  - `CARGO`: pool of container models (built on demand, reused, never disposed); modes `lift` (rides the elevator
    platform; a delivered one is pooled at the bottom, then the lift goes up and is freed) and `heli` (hangs on a line
    under the helicopter, hidden with it). A lift is reserved by `L.busy = <mission context>`; aircraft using
    elevators already wait on `L.busy`.
  - `VESSELS`: ships / wrecks of the scene missions — clones of one template per kind, stopped at a random heading, drifting past, fire / smoke on time
    accumulators, crew figures as children (shared geometry); removed off-screen once their mission is over
    (`reset` lets them sail off).
  - `ROPES`: pooled hoist cable / fast rope with one riding figure (`set(rope, top, bottom, u)`).

## Refuelling passes (`js/tanker.js`)
`TANKER` is registered with `registerMissionWorld` (updated every step after the aircraft, reset in `buildAirWing`).
- **Peace only.** Trigger: the first 3–5 min after a start / rebuild, then every 5–9 min (4–7 min timer + gathering);
  while `combatOn()` the timer is frozen and `start()` refuses. A fight starting while the event still gathers
  (`!ev.P`) aborts it; a pass already on screen is flown to the end. If nobody is ready it looks again every
  8–15 s for ~90 s, then waits for the next one (so the tanker can be recovered). With auto flight ops a down tanker is launched ~90 s before a pass is due (`launchTanker`; `autoLaunch` never
  launches it, nor does `scrambleSupport` — AWACS only), and
  `autoRecover` keeps a tanker up for `TANKER_STATION` (300 s) and never recovers it while a pass is due (`TANKER.timer < 120`). Needs a tanker in `orbit` (`airT > 20`) plus armed
  fixed-wing jets of one flight in `orbit` (`airT ≥ 10`, part of a flight is fine). Up to 4 receivers. `TANKER.start()` forces one when possible.
- **Flow:** participants get `a.tank = ev`; `FixedWing.updateState` hands them to `TANKER.fly` first. `tank_out` (to
  `AIRWAR.offscreenFrom`) → `tank_wait` (hidden) → once all wait, one `AIRWAR.screenPass` → `tank_pass` → `tank_back`
  (to an orbit via `Aircraft.edgeToOrbit`, shared with `cbt_rtb`). `Aircraft.aloft` (airborne / mission / combat /
  refuelling) is the "up" predicate for landing requests and F-14 sweep; auto-recovery skips flights with `a.tank`.
  Abort after 45 s if someone never arrives. Receivers get `airT = 0` at the end.
- **Formation:** slots `[gap behind along the path, side offset, height]` (`TANK_BASKET`, `tankWing`). One receiver
  (`ev.cur`, random, fixed for the pass) is in the basket; those before it in `recv` fly on the left wing (done),
  those after it on the right (still to go) — no swaps on screen. Receivers fly their own `ps` plus a capped
  correction toward `tanker.ps − gap`; `ev.n` / `ev.tkN` tell whether the tanker already moved this step (the update
  order in `AIRCRAFT` is arbitrary). `followPath` takes `pathOff` (side) and `pathDy` (height).
- New airborne states are in `AIR_STATES` (persist restores them into orbit; the event is dropped).

## Radio lines & threat tiers (`js/radio.js`)
- **Every radio line goes through `radioLine(pool, vars)`** — never `pick()` a line pool directly, never build
  lines with `.replace('{X}', …)`. `opsLine(key, a)` (flight-deck calls, `a` = the aircraft, `{c}` = its callsign) is a thin wrapper returning
  `[text, hot]`. Pool: `OPS_VOICE[spec.voice][key]` (the AWACS's / tanker's own; in peace only if it has `peace`), then in combat
  `OPS_UNARMED[key]` for an unarmed one (helicopters, combat tiers only), else `OPS[key]` (its combat tiers are the armed ones).
- **Pools** live in `radio.js`: `OPS` (deck routine; its combat tiers are for armed aircraft) / `OPS_VOICE` (per-type voices) / `OPS_UNARMED` (combat deck calls of unarmed helicopters), `TANKER_LINES` (refuelling passes), `COMBAT` (fleet/combat chatter), `AIRWAR_LINES` (combat passes),
  `ENEMY_LINES` (intercepted enemy traffic), `LINES` (alerts, mission acknowledgements), `MISSIONS` (order/done pairs). A pool is either
  - an array — the same lines at any time, or
  - an object keyed by threat tier (`calm`, `tense`, `panic`, …) plus optional `peace` (used outside combat).
- **Tiers** are defined once in `THREAT_TIERS` (calmest first, `upTo` = upper bound of `STRESS.level`).
  To add a tier, add an entry there and lines under its key where wanted; nothing else changes.
- **Resolution:**
  - outside combat (`!AUD.armed`): `peace` if present, otherwise the current tier;
  - in combat: the current tier, but `MIX_CALMER` (30 %) of the time one tier calmer, repeatable down the tiers;
  - a missing tier key falls back to the next calmer tier, then to any tier present.
  So a pool may define only some tiers (e.g. `{ calm, panic }`). The same line never comes twice in a row from one
  list (`LAST_LINE`).
- **Placeholders** `{name}` are filled from `vars` (`radioLine(pool, { C: callsign, T: type })`); unknown ones stay as
  they are. In use: `{c}` deck-call callsign, `{C}` callsign, `{T}` enemy type, `{B}` bearing words, `{D}` compass
  direction, `{N}` bandit count, `{Q}` enemy squadron, `{K}` enemy callsign just lost; missions also use `{S}` sector,
  `{G}` grid, `{P}` passengers, `{W}` pounds; refuelling passes `{F}` the flight, `{A}` the tanker.
- **Enemy lines** go through `enemySay(who, pool, vars, o)` (`combat.js`): role `enemy` (red), one at most every
  4–8 s (shorter as stress builds). Speakers are enemy callsigns: `e.cs` on every bandit / boat (a wave shares its
  squadron `e.sq`: `YELLOW 1`, `YELLOW 2`…), `ENEMY_NAMES.hq` for their command.
- **New line set:** add the pool (tiered when it is said in combat) and call `radioLine`. Combat lines are sent with
  `cat: 'combat'`; the queue drops stale ones (prio < 3 after 4 s), so speak them when the event is on screen.
  Among combat lines a role (`pilot`, `ship`, `enemy`, …) silent for `VARIETY_T` s gets +0.5 when the next line is
  picked (`RADIO.onAir`), so no side drowns out the others; enemy event lines are prio 2, their chatter prio 1.

## Performance & memory invariants (the wallpaper never restarts — leaks accumulate for days)
- **Never create geometry per spawn and drop it.** Enemies are clones of one template (`enemyMesh()`
  in `combat.js`), fly-by jets are pooled (`FLYBY_MODELS`), air-wing rebuilds call `disposeTree`.
  Anything removed from the scene for good must be disposed.
- `disposeTree` skips materials with `userData.shared` (everything from `M()` and `DECK_MARK_MATS`)
  and sprite geometry (three.js shares one geometry across all Sprites). New cached materials must set
  `userData.shared = true`.
- **Static meshes are merged per material** via `mergeStatic(root, dynamicNodes)` at the end of each
  builder (ships, airframes, enemies). Every node that moves, rotates or toggles `visible` at runtime
  (mount yaw/pitch groups, radars, lifts, JBDs, wing pivots, gear, rotors, blades, props, searchlight
  holders) **must be listed as dynamic**, or it gets baked into the static mesh. Code must not keep
  references to static meshes after the builder returns.
- `shade()` sets `castShadow`/`receiveShadow` per mesh; don't blanket-enable shadows with `traverse`
  (it made invisible rotor discs cast shadows).
- Shared scratch vectors (`_v`, `_p`, `_d`, `_al`…) must not be passed into a function that also
  writes them; give the callee its own scratch.
- Pools are ring buffers (`SpriteFX`, `Tracers`, `Foam`): spawn rates must not scale with FPS
  (use time accumulators, see missile glow in `updateFlybys`).
- `SpriteFX` (flash / smoke) is one instanced mesh per pool with its own billboard shader that
  reproduces `SpriteMaterial` (color × texture, opacity, scene fog). Normal-blended pools sort live
  particles back to front on the CPU each update (needs the camera: `FX.smoke.update(dt, tint, camera)`);
  the whole pool shares one `renderOrder`, so don't rely on interleaving with other transparent objects.
- The sun's shadow camera is fitted to the visible sea every frame (`fitShadow`, `main.js`; one 2048² map):
  don't set fixed shadow bounds, they cut off shadows of aircraft far out.
- Searchlight `SpotLight`s are hidden by day (`updateLights`): every visible light costs every lit
  fragment even at zero intensity.
- Main loop (`frame`): FPS limit keeps cadence via `frameDue`; simulation runs in ≤50 ms sub-steps
  (stalls capped at 0.25 s). `onBeat` does nothing while `paused`.

## Running & testing
- WE: "Open from File" → `project.json` (audio listener + properties come from WE).
- Browser preview: serve the folder, e.g. `python -m http.server 8765`, open `http://localhost:8765/`.
  The ⚙ SETTINGS drawer mirrors all WE properties (stored in `localStorage`); URL params `?hour=22`,
  `?zoom=150`, `?demo=1`, `?ts=N` (time scale).
- **Automated tests** (`tests/`, Playwright Test in headless Chromium + SwiftShader WebGL): run them in Docker —
  `powershell -ExecutionPolicy Bypass -File tools/test.ps1 [file / -g pattern]` (no local Node; `$env:SEED = N` for
  another seed); CI runs the same image on every push / PR (`.github/workflows/tests.yml`). Run them after a change.
  - The harness (`tests/support/harness.js`) boots the page deterministically: seeded `Math.random` (`SEED`), fixed
    date in UTC, no `requestAnimationFrame` (time only advances through `__t.sim(sec)` = `step(0.05)` per tick),
    `RT()` on simulated time, Wallpaper Engine mode (audio fed by `__t.sim(sec, { audio: true/false })`).
  - `tests/support/inpage.js` (`window.__t`): `sim` runs `checkInvariants()` after every step (deck resources:
    catapults, landing area, spots, lifts, helo pad; known states; NaN; mission / tanker consistency; bounded
    pools) and the stuck detector (`STATE_LIMITS`); `forceFight` / `fightOff`; `sample` (pixels); `geometries`
    (leak check: geometries dropped without `dispose`).
  - **When adding a state, a deck resource, a line pool, a placeholder or a cache**, update the harness: aircraft
    states come from `STATUS` (so `registerLeg` / `Object.assign(STATUS, …)` is enough), but mission / tanker / lift /
    runway / catapult state sets, `STATE_LIMITS`, the placeholder list in `radio-pools.spec.js` and `GEO_CACHES` are
    listed by hand.
  - `repo.spec.js` checks the cache-buster (all tags equal, matches "Current: `v=N`" here), the load order line above,
    and that `js/properties.js` is regenerated.
- Console checks by hand: all globals are reachable; set `paused = true` and drive the sim with `step(0.05)` +
  `renderer.render(scene, camera)`; check `renderer.info.render.calls` (main-pass draw calls, shadow pass excluded)
  and `renderer.info.memory.geometries`. To force a fight: `AUD.combat` alone gives `armed` but not `fighting` (no
  waves / passes / beats); use `Object.defineProperty(AUD, 'active', { get: () => true }); AUD.soundStart = RT() - 10;
  AUD.combat = true;` (what `__t.forceFight()` does), then `onBeat('low', 2)`.
- Baseline after the 2026-10 optimisation pass: ~400 GL draw calls/frame (was ~950), geometries
  plateau ≈ 900 under sustained combat.
