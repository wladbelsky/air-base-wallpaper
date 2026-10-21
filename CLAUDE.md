# Forward Air Base — Wallpaper Engine web wallpaper

Isometric three.js scene of a forward air base (runway, shelters, hangars, tower, air defence, tanks) with a
configurable air wing that taxis, takes off and lands, enemies, and the seasons. Reacts to system audio.
The sequel to Carrier Strike Group (same engine: flight paths, orbits, missions, combat passes, radio, persistence).
Runs 24/7 inside Wallpaper Engine (CEF/Chromium); also previewable in a normal browser.
User-facing docs: `README.md` (keep it in sync when behaviour or properties change).

## Stack & layout
- Plain JS, no build step, no npm. `'use strict'` classic scripts sharing **global** scope
  (no modules). three.js **r149** is vendored as `js/three.min.js` — never edit it.
- `index.html` loads scripts in dependency order (later files use globals of earlier ones):
  `core → flightpath → models → base → terrain → airframes → effects → radio → airfield → aircraft → missions → persist → combat → airwar → tanker → groundops → main → properties → settings`,
  then an inline script registers the WE audio listener (or starts the browser demo beat).
  `main.js` calls `init()` at its end, so anything `init()` needs must be defined before `main.js`.

| File | Contents |
|---|---|
| `js/core.js` | utils (`V3`, `rand`, `clamp`, `lerp`, `smoothstep`, `pick`…), `CFG` defaults, `WIND` (smoke / dust drift), `groundH` (flat ground), `SEASONS` + `seasonNow()`, sun position, sky palette, canvas textures `TEX` |
| `js/flightpath.js` | `FlightPath`: Dubins CSC curves (turn-radius-limited flight) + lines |
| `js/models.js` | mesh helpers (`M`, `box`, `cyl`, `taper`, `prism`, `strut`, `deckLine`…), `mergeStatic`, `disposeTree`, nav lights, searchlights, seasonal shared materials `ROOF_MAT` / `ARCH_MAT`, mounts: `buildCIWS` / `buildGun` and the land ones `buildCRAM`, `buildAAGun`, `buildTank`, `buildSamLauncher` (Patriot / NASAMS), `buildAvenger`, `buildPatriotRadar` |
| `js/base.js` | `BASE_LAYOUT` (runway, taxiway, links, holding point, apron, lane, channels, remote stands, fence, service roads `roads` + `roadDist`) and `PARKING` (stands, shelters, hangars, remote stands, helicopter pads); `buildBase()`: runway / markings, shelters (HAS) and hangars with doors, tower, radar, buildings, fence, guard towers, air defence and tank mounts, runway / approach / taxiway lights, floodlight masts, sky searchlights; `BASE.targets` (what the enemy aims at) |
| `js/terrain.js` | `TERRAIN`: the ground (tiled canvas texture + vertex-colour patches) and the vegetation per season (InstancedMesh per kind: firs and snow drifts / cacti, rocks, shrubs / leafy trees in spring or autumn colours), weather particles (snowfall, falling leaves) |
| `js/airframes.js` | aircraft model builders → `{ group, setFold(f), tick(dt, st) }` (`jetModel`, `propeller`, `heliModel`…; KC-46 boom and KC-130 hoses read `st.hoseOut`); enemy templates (Su-25/35/47/57/34, Tu-22M3, Ka-52, Mi-24 — rotor groups named `rotor*` —, T-90, BMP-3, BTR-82 — turret named `turret`) |
| `js/effects.js` | `Tracers` (InstancedMesh; `onSplash` when one hits the ground), `SpriteFX` (flash/smoke pools), `Scorch` (scorch marks, instanced ring buffer), `FlashLights` |
| `js/radio.js` | callsigns (+ `ENEMY_NAMES`, `RADIO_NAMES` — the tower is `<base name> TOWER`), `RADIO` subtitle queue, mission orders, `STRESS` + `THREAT_TIERS`, `radioLine()`, line pools `OPS` / `OPS_VOICE` / `OPS_UNARMED` / `COMBAT` / `AIRWAR_LINES` / `ENEMY_LINES` / `TANKER_LINES` / `LINES` (see "Radio lines & threat tiers") |
| `js/airfield.js` | `AIRFIELD`: homes (`assignHome` / `release`), taxi routes (`pushback`, `toHold`, `lineUp`, `exitFor`, `homeRoute`), runway use (`rwy`, `arrivals`, `canLineUp`, `canApproach`, `clearToLand`), ground traffic (`blocked`), shelter / hangar doors, stand markings and helicopter pads (`updateMarks`) — see "Airfield" |
| `js/aircraft.js` | `Aircraft` → `FixedWing` / `Helicopter` state machines, types, `Flyby` |
| `js/persist.js` | `PERSIST`: remembers who is in the air / on a mission (`localStorage`, `CFG.saveState`), restores it after a fresh `buildAirWing()` (orbit / `Mission.resume`), radio `LINES.restore` |
| `js/missions.js` | missions: `Leg` steps, `Mission` types (`patrol`, `airlift`), `pickMission` — see "Missions" |
| `js/combat.js` | enemies: `ENEMY_TYPES` (fighters, attack jets, bombers), `HELI_TYPES`, `ARMOR_TYPES`; kinds `bandit`, `cruise`, `ballistic`, `heli`, `armor`; columns (`spawnColumn`), beat-synced hit resolution, `groundHit`, `baseImpact` + `BASE_FIRES` |
| `js/airwar.js` | `AIRWAR`: combat passes — armed aircraft wait off-screen (`cbt_wait`) and cross the screen chasing / chased by a dogfight bandit, on close air support runs (`cas`) or hunting armour (helicopters); gunships circle over the fight (`cbt_orbit`); screen helpers (`ndc`, `onScreen`, `groundAt`), pass weapons on the beat (`AIRWAR.onBeat`), pass radio |
| `js/tanker.js` | `TANKER` (a mission-world object): refuelling passes — KC-46 boom with a fighter flight, KC-130 hoses with a helicopter pair (see "Refuelling passes") |
| `js/groundops.js` | `GROUND_OPS` (a mission-world object): scenes on the ground — emergency landings (crash tenders, tug), unloading a transport (K-loader, pallets), parachutes of the paradrops; pooled vehicle templates `VEH_TEMPLATES` / `VEH_POOL` (see "Ground scenes") |
| `js/main.js` | WE property listener, scene init, audio analysis + `onBeat`, base weapons (tanks, AA guns, flak, Patriot / NASAMS, Stingers, C-RAM), searchlights, missions, chatter, panel UI (aircraft list + base sites), main loop |
| `js/properties.js` | **generated** from `project.json` — do not edit by hand |
| `js/settings.js` | browser-only settings drawer, demo beat, audio-file player (returns early inside WE) |
| `tools/gen_properties.py` | regenerates `js/properties.js` |
| `tools/preview.spec.js` | renders image candidates (`powershell -ExecutionPolicy Bypass -File tools/test.ps1 -c tools/preview.config.js` → `test-results/preview-<seed>.jpg` square 1080², the Workshop preview `preview.jpg` from `project.json`; `test-results/screenshot-<seed>.jpg` 1280x720, `screenshot.jpg` in README.md; copy the best over them) |
| `tests/`, `playwright.config.js`, `package.json` | automated tests (Playwright Test) — see "Running & testing"; `tools/test.ps1` runs them in Docker, `.github/workflows/tests.yml` in CI |

## Rules / conventions
- **After changing any JS/CSS file, bump the cache-buster** `?v=N` on all `<script>`/`<link>` tags in
  `index.html` (WE's CEF caches aggressively). Current: `v=2`.
- **New WE property**: add it to `project.json`, read it in `applyUserProperties` (`main.js`) into `CFG`,
  then run `python tools/gen_properties.py`. Property `order` decides the browser-drawer group
  (0–9 camera/time, 10–19 audio/combat, 20–29 terrain & season, 30–39 panel, 40–49 air wing, 50–59 base).
  `<key>count` sliders are picked up automatically for every key in `AIRCRAFT_TYPES`.
- **New aircraft type**: builder in `airframes.js`, subclass with static `spec` + `buildModel()` in
  `aircraft.js` (start from `fighter({…})` / `heavy({…})` or `Helicopter.spec`), register in `AIRCRAFT_TYPES` and
  `FIXED_ORDER`/`HELI_ORDER`, callsign pool in `radio.js`, `<key>count` slider in `project.json`, `CFG.counts` default.
  `spec` keys: ground — `park` (home kind: `'f'` fighter shelter / stand, `'h'` heavy hangar / stand, `'d'` drone
  hangar, `'heli'` pad), `big` (only the big hangar fits it), `len` / `span` (footprint for taxi spacing), `taxiV`,
  `rollAcc`, `vR` (rotation speed), `decel`, `approachV`, `climbOut`; air — `speed`, `turnR`, `orbitR`, `alt`,
  `farOrbit` (orbit range for unarmed types during combat; `armed` types fly combat passes instead), `bankMax`;
  roles — `armed`, `cas` (close air support passes), `gunship` (circles over the fight, `cbt_orbit`), `awacs`,
  `tanker` + `tankKind` (`'boom'` / `'drogue'`), `refuel` (`'boom'` / `'probe'`: which tanker it can take fuel from),
  `transport`, `missions` (allow-list of mission type keys, e.g. `['airlift']`; `[]` = never sent on missions),
  `voice` (key into `OPS_VOICE`), `callsignGroup`, `drone`; helicopters — `blades` (stop-index snap), `noseDown`, `doorGuns`.
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
  weapons on the beat or chatter, and inbound missiles are intercepted / the armour and helicopters turn back. Radio
  `COMBAT.lull`, then `COMBAT.end` on stand-down, or `COMBAT.resume` if sound keeps going for `RESUME_DELAY` s.
  Use `AUD.fighting` for anything that should only happen while the fight is on; `AUD.armed` for "combat mode".

## World & seasons
- World axes: +X east (the runway heading — every takeoff and landing goes east), +Y up, +Z south; 1 unit ≈ 10 m,
  aircraft models ×`spec.scale` (1.25 jets, 1.05 heavies). The camera looks from the south-west (azimuth 135°): north
  is the top-left corner of the screen, the runway runs from the bottom-left to the top-right corner. Orbits are
  flown around `ORBIT_C` (the airfield's centre). The ground is flat (`groundH` = 0).
- `BASE_LAYOUT` / `PARKING` (`base.js`) are the one source of positions: the models and the ground traffic both read them.
- Seasons (`SEASONS` in `core.js`): `CFG.season` `auto` (from the PC date, northern hemisphere) or fixed. `TERRAIN.build`
  (re)builds the ground texture, the vegetation and recolours `ROOF_MAT` / `ARCH_MAT` (white in winter); the hemisphere
  light's ground colour follows `SEASONS[s].hg`; dust (`ENV.dustTint`) takes the ground's colour. `updateEnvironment`
  (every 2 s) rebuilds when `seasonNow()` changes. Weather (`CFG.weather`): snowfall in winter, leaves in autumn.

## Airfield (`js/airfield.js`, `js/aircraft.js`)
- **Homes**: every aircraft gets a `PARKING` slot when it is built (`AIRFIELD.assignHome`) and keeps it while it flies;
  `release` on dispose. Fighters: a shelter (HAS), else a front-row stand, else a remote stand; heavies: a hangar (the
  big one for `big` types), else a heavy stand; the MQ-9 a small hangar; helicopters a pad. Stand markings are
  instanced and drawn only for stands in use (`updateMarks`, after every build / count change / retire); the helicopter
  pads are all drawn, always.
- **One-way traffic**: the parallel taxiway runs west to the holding point (`BASE_LAYOUT.hold`) of the departure link;
  the apron lane runs east (entered by the west / centre channel, left by the east channel onto the taxiway — east
  of the last runway link, so nobody ever meets head-on). Front-row stands open onto the taxiway, shelters / hangars /
  the back remote row onto the lane. Parking is nose in; leaving starts with a pushback (`startDeckPath(pts, speed,
  true)`: tail first).
- **Ground movement**: `startDeckPath` / `followDeck` (Catmull-Rom through `AIRFIELD.round`ed corners — `round` never
  emits a doubled point, that made the curve loop) with car-following (`AIRFIELD.blocked`: stop behind whoever is in
  the way or close in front, and short of where a pushback ends). Nobody ever drives on through the one in front:
  aircraft blocking each other round a cycle (`knot`, fresh `blockBy` links only) → the pushback goes, else the first in
  `AIRCRAFT`. A pushback starts only with nobody near its path or taxiing toward its end (`pushbackClear`); one that
  has waited 20 s (`wantsOut`) makes the traffic stop a gap short of its end (`yielding`). `onGround` = `GROUND_STATES`
  (helicopters never). The harness flags two taxiing aircraft closer than 0.3 × their lengths (ground collision).
- **FixedWing states**: `parked` → `ready` (engines, waits for the door and `pushbackClear`) → `pushback` →
  `taxi_out` → `hold_short` → `lineup` → `takeoff_roll` (brakes, roll, rotate at `vR`) → `climb` → `orbit` →
  `approach` → `final` → `rollout` → `taxi_in` → `parked`; `go_around` (→ `orbit`, `landReq` kept); an emergency:
  `rollout` → `emergency` (stopped on the runway) → `towed` → `parked` (groundops.js).
  A pair of one flight lines up side by side (`rdz` ±1) and rolls a second apart.
- **Runway**: `AIRFIELD.rwy` = aircraft on it (lineup … until clear of it); `arrivals` = on approach / final.
  `canLineUp`: runway empty, no arrival on final or within 32 s. `canApproach`: one arrival at a time (the next once the
  one ahead is on final), none while a departure has waited > 25 s at the hold. `clearToLand` at the start of the final
  (a landing roll far ahead or a fast departure is fine) and close in (strict) — else `goAround()`.
- **Helicopters**: `parked` → `spinup` → `lift` → `depart` → `orbit` → `ret` → `hover` → `descend` → `spindown` → `parked`, on their own pad.
- **Doors**: shelters and hangars open while their aircraft moves in or out (`doorWanted`), an aircraft parked
  behind a closed door is hidden.

## Missions (`js/missions.js`)
Missions fly beyond the screen edge while there is no music. `dispatchFlight` (`main.js`) only chooses the flight
(assembled flights first, a four-ship may go as a pair); everything else is in `missions.js`.
- **`Mission`** = one dispatched flight. `start()` gives every aircraft a context `a.mission = { m, slot, role:
  'lead' | 'wing', far, legs, i }`, enters its first leg and sends the radio order (whole flight → lead; a pair →
  each callsign) and the acknowledgement. `update(a, dt)` runs the current leg; after the last one `finish(a)`
  (back to `orbit`). `Aircraft.missionFlow` just forwards to it; `onMission` = `!!this.mission`.
- **`Leg`** = one step for one aircraft: static `state` (the `aircraft.state` while in it), `enter(a, c)`,
  `update(a, c, dt)` → `true` when done. Register with `registerLeg(L, label, cls)` — that adds the panel `STATUS`.
  Generic legs: `Depart` (`mission_out`; wingmen wait for `m.leadOut`, then trail), `Away` (`mission`, hidden;
  the lead reports `m.done` when it ends), `Return` (`mission_back`; to a new orbit from the far point).
- **Types**: `registerMission(C)`; `pickMission(lead)` picks by `static weight` among types that are
  `eligible(lead)` — all non-`optIn` types, or exactly the keys in `spec.missions` (allow-list).
  `Mission` (`patrol`, generic: CAP, strikes, CSAR, medevac, overwatch… — text by `textKey()`: `fighter`, `awacs`,
  `gunship`, `heli_attack`, `heli_transport`), `AirliftMission` (`airlift`, optIn — C-130 / C-17: farther, longer, lands
  after with cargo: `a.cargo`, unloaded on its stand), `ParadropMission` (`paradrop`, optIn — C-130 / C-17: legs
  `[Depart, Away, DropPass, Return]`; `DropPass` (`drop_pass`) flies low across the screen over `dropZone()` and drops
  `GROUND_OPS.dropChute` jumpers or cargo).
- **New mission type**: subclass `Mission` (or a type), override what differs — `legs(role)`, `static eligible`,
  `static weight` / `optIn`, `textKey()` (key into `MISSIONS`, dots for nesting), `copyKey()` (acknowledgement pool),
  `textVars()` (extra placeholders), `dist` / `away` in the constructor, `finish(a)` — then `registerMission()`.
  Texts go into `MISSIONS` (order / done pairs, `{S} {B} {G} {P} {W}` placeholders) and line pools into `LINES` (radio.js).
- **Mission-world objects** (things that live in the scene for a mission) `registerMissionWorld({ update(dt), reset() })`;
  `main.js` calls `missionWorldUpdate(dt)` every step and `missionWorldReset()` in `buildAirWing`. `TANKER` is one.

## Ground scenes (`js/groundops.js`)
`GROUND_OPS` is a mission-world object (peace-time scenes, reset in `buildAirWing`). Vehicles, pallets and parachutes are
clones of one template each (`VEH_BUILD` → `VEH_TEMPLATES`), taken from / returned to `VEH_POOL` (`takeVehicle` /
`dropVehicle`, never disposed); `Drive` moves one along a smooth path. Scenes are objects with `update(dt)`, `done`, `end()`.
- **Emergency landing**: every 8–15 min in peace (`emTimer`) a jet in orbit declares one (`a.emerg`, smoke `trail`);
  `canApproach` gives it priority, `canLineUp` is closed while `GROUND_OPS.emerg`; it stops on the runway
  (`emergency`), `EmergencyScene`: two crash tenders from the fire station foam it, a tug tows it home (`towed`, via
  `AIRFIELD.homeRoute`), the runway opens as soon as it is towed off it (`GROUND_OPS.emerg` cleared: the tow may
  queue behind departures).
- **Unloading** (`UnloadScene`): a transport parked with `a.cargo` on a stand (not in a hangar): `a.rampT` opens the
  ramp (C-130 / C-17 models), a K-loader comes from the cargo yard along the service road, three pallets slide onto it,
  it drives away; `a.groundBusy` holds the aircraft's departure in `ready` meanwhile.
- **Parachutes** (`dropChute`, `updateChutes`): open, drift with `WIND`, land, the canopy collapses, gone after ~16 s.

## Combat (`js/combat.js`, `js/airwar.js`, `js/main.js`)
- Enemy kinds: `bandit` (waves from `ENEMY_TYPES`; bombers / attack jets drop a stick on a `BASE.targets` structure,
  others may loose a cruise missile), `cruise` (low, at a structure; C-RAM / NASAMS / Stingers), `ballistic` (from
  high above; Patriot), `heli` (Ka-52 / Mi-24: with the armour, hover off the fence, rockets), `armor` (columns from
  `spawnColumn`, `AIRWAR.meetColumn`: drive to a stop line outside the fence on their own side (`fenceRadius(u)` + 8),
  fire at the perimeter — cosmetic; the harness flags armour inside the fence). Dogfight bandits (`duel`)
  fly a pass path and are left to the fighters.
- Anything that gets through: `baseImpact` (explosion, scorch, `BASE_FIRES` entry named after the structure — the panel
  site rows show DAMAGED). Ground hits: `groundHit` (dust in `ENV.dustTint`, scorch for the big ones). Bombs are
  tracers with gravity (`dropBombStick`, `FixedWing.dropBombs`), resolved in `FX.tracers.onSplash`.
- Base weapons on the beat (`onBeat`): tanks (`fireTank`: at armour in range, else far out past the wire), AA guns
  (`fireAA`, `fireFlak`), C-RAM bursts (`startCIWS`), Patriot / NASAMS (`launchSAM`; always at an incoming ballistic
  missile), Avenger Stingers (`launchStinger`); mounts track in `updateMounts`. Hits resolve on the next beat (`queueHit`).
- Air: jets fly passes (`chase` / `chased` / `sweep`, `cas` for the A-10 and now and then an F-15E with bombs),
  helicopters `armor` / `cover` passes (columns meet them: `AIRWAR.meetColumn`), gunships (`spec.gunship`: AC-130 guns
  out of the left side, MQ-9 Hellfires) circle over the fight (`AIRWAR.toGunOrbit` / `gunOrbitStep`, `cbt_orbit`).

## Refuelling passes (`js/tanker.js`)
`TANKER` is registered with `registerMissionWorld` (updated every step after the aircraft, reset in `buildAirWing`).
- **Peace only.** Trigger: the first 3–5 min after a start / rebuild, then every 5–9 min (4–7 min timer + gathering);
  while `combatOn()` the timer is frozen and `start()` refuses. A fight starting while the event still gathers
  (`!ev.P`) aborts it; a pass already on screen is flown to the end. If nobody is ready it looks again every
  8–15 s for ~90 s, then waits for the next one. `nextKind()` picks the kind of the next pass (a tanker of that kind
  and receivers exist); with auto flight ops that tanker is launched ~90 s before a pass is due (`launchTanker`;
  `autoLaunch` never launches tankers, nor does `scrambleSupport` — AWACS only), and `autoRecover` keeps a tanker up
  for `TANKER_STATION` (300 s) and never recovers it while a pass is due (`TANKER.timer < 120`).
- **Kinds** (`spec.tankKind` / receivers' `spec.refuel`): `boom` (KC-46 with up to 4 jets of one flight: one on the
  boom, the ones done on the left wing, the ones to go on the right — no swaps on screen) and `drogue` (KC-130 with a
  helicopter pair, both on the hoses, low and slow). Slots `TANK_SLOTS[kind]` `[gap behind, side, height]`.
- **Flow:** participants get `a.tank = ev`; `updateState` hands them to `TANKER.fly` first. `tank_out` (to
  `AIRWAR.offscreenFrom`) → `tank_wait` (hidden) → once all wait, one `AIRWAR.screenPass` → `tank_pass` → `tank_back`
  (to an orbit via `Aircraft.edgeToOrbit`). Abort after 45 s if someone never arrives. Receivers get `airT = 0` at the end.
  Receivers fly their own `ps` plus a capped correction toward `tanker.ps − gap`; `ev.n` / `ev.tkN` tell whether the
  tanker already moved this step (the update order in `AIRCRAFT` is arbitrary). `followPath` takes `pathOff` (side) and `pathDy` (height).

## Radio lines & threat tiers (`js/radio.js`)
- **Every radio line goes through `radioLine(pool, vars)`** — never `pick()` a line pool directly, never build
  lines with `.replace('{X}', …)`. `opsLine(key, a)` (tower / ground calls, `a` = the aircraft, `{c}` = its callsign) is a thin wrapper returning
  `[text, hot]`; `a.tower(key)` says it as the tower, `a.call(key)` as the aircraft. Pool: `OPS_VOICE[spec.voice][key]`
  (the AWACS's / tankers' own; in peace only if it has `peace`), then in combat `OPS_UNARMED[key]` for an unarmed one, else `OPS[key]`.
- **Pools** live in `radio.js`: `OPS` (tower routine; its combat tiers are for armed aircraft) / `OPS_VOICE` (per-type voices) / `OPS_UNARMED`,
  `TANKER_LINES` (`boom` / `drogue`), `COMBAT` (base / combat chatter), `AIRWAR_LINES` (combat passes, gunships),
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
  they are. In use: `{c}` tower-call callsign, `{C}` callsign, `{T}` enemy type, `{B}` bearing words, `{D}` compass
  direction, `{N}` bandit count, `{Q}` enemy squadron, `{K}` enemy callsign just lost; missions also use `{S}` sector,
  `{G}` grid, `{P}` passengers, `{W}` pounds; refuelling passes `{F}` the flight, `{A}` the tanker.
- **Roles** (`ROLE_COLOR`): `pilot`, `awacs`, `tower`, `ground` (air defence, tanks, C-RAM: `RADIO_NAMES.patriot` /
  `armor` / `cram`), `heli`, `ace`, `enemy`.
- **Enemy lines** go through `enemySay(who, pool, vars, o)` (`combat.js`): role `enemy` (red), one at most every
  4–8 s (shorter as stress builds). Speakers are enemy callsigns: `e.cs` on every bandit / helicopter / vehicle
  (a wave or column shares its squadron `e.sq`), `ENEMY_NAMES.hq` for their command.
- **New line set:** add the pool (tiered when it is said in combat) and call `radioLine`. Combat lines are sent with
  `cat: 'combat'`; the queue drops stale ones (prio < 3 after 4 s), so speak them when the event is on screen.
  Among combat lines a role silent for `VARIETY_T` s gets +0.5 when the next line is picked (`RADIO.onAir`).

## Performance & memory invariants (the wallpaper never restarts — leaks accumulate for days)
- **Never create geometry per spawn and drop it.** Enemies are clones of one template (`enemyMesh()`
  in `combat.js`), fly-by jets are pooled (`FLYBY_MODELS`), air-wing rebuilds call `disposeTree`, the vegetation
  is rebuilt (and disposed) only when the season changes. Anything removed from the scene for good must be disposed.
- `disposeTree` skips materials with `userData.shared` (everything from `M()`, `sharedMat()` and `DECK_MARK_MATS`)
  and sprite geometry (three.js shares one geometry across all Sprites). New cached materials must set
  `userData.shared = true`.
- **Static meshes are merged per material** via `mergeStatic(root, dynamicNodes)` at the end of each
  builder (the base, airframes, enemies). Every node that moves, rotates or toggles `visible` at runtime
  (mount yaw/pitch/barrel groups, radars, door leaves / panels, gear, rotors, blades, props, boom / hoses, searchlight
  holders, enemy rotors / turrets) **must be listed as dynamic**, or it gets baked into the static mesh. Code must not keep
  references to static meshes after the builder returns.
- Many repeated objects are one `InstancedMesh` (vegetation, fence posts, stand marks, helicopter pads, scorch marks, tracers).
- `shade()` sets `castShadow`/`receiveShadow` per mesh; don't blanket-enable shadows with `traverse`.
- Shared scratch vectors (`_v`, `_p`, `_d`, `_al`…) must not be passed into a function that also
  writes them; give the callee its own scratch. Top-level names are global across all files: no duplicates.
- Pools are ring buffers (`SpriteFX`, `Tracers`, `Scorch`, weather): spawn rates must not scale with FPS
  (use time accumulators, see missile glow in `updateFlybys`).
- `SpriteFX` (flash / smoke) is one instanced mesh per pool with its own billboard shader that
  reproduces `SpriteMaterial` (color × texture, opacity, scene fog). Normal-blended pools sort live
  particles back to front on the CPU each update (needs the camera: `FX.smoke.update(dt, tint, camera)`).
- The sun's shadow camera is fitted to the visible ground every frame (`fitShadow`, `main.js`; one 2048² map):
  don't set fixed shadow bounds.
- Searchlight `SpotLight`s are hidden by day (`updateLights`): every visible light costs every lit
  fragment even at zero intensity. Only two apron floodlights and the first four helicopters have a real light; the
  guard-tower and sky searchlights are beams (`noLight`).
- Main loop (`frame`): FPS limit keeps cadence via `frameDue`; simulation runs in ≤50 ms sub-steps
  (stalls capped at 0.25 s). `onBeat` does nothing while `paused`.

## Running & testing
- WE: "Open from File" → `project.json` (audio listener + properties come from WE).
- Browser preview: serve the folder, e.g. `python -m http.server 8765`, open `http://localhost:8765/`.
  The ⚙ SETTINGS drawer mirrors all WE properties (stored in `localStorage`); URL params `?hour=22`,
  `?zoom=150`, `?season=winter`, `?demo=1`, `?ts=N` (time scale).
- **Automated tests** (`tests/`, Playwright Test in headless Chromium + SwiftShader WebGL): run them in Docker —
  `powershell -ExecutionPolicy Bypass -File tools/test.ps1 [file / -g pattern]` (no local Node; `$env:SEED = N` for
  another seed); CI runs the same image on every push / PR (`.github/workflows/tests.yml`). Run them after a change.
  - The harness (`tests/support/harness.js`) boots the page deterministically: seeded `Math.random` (`SEED`), fixed
    date in UTC, no `requestAnimationFrame` (time only advances through `__t.sim(sec)` = `step(0.05)` per tick),
    `RT()` on simulated time, Wallpaper Engine mode (audio fed by `__t.sim(sec, { audio: true/false })`).
  - `tests/support/inpage.js` (`window.__t`): `sim` runs `checkInvariants()` after every step (runway / arrivals,
    homes and their markings, known states; NaN; under ground; mission / tanker consistency; bounded pools) and the
    stuck detector (`STATE_LIMITS`); `forceFight` / `fightOff`; `sample` (pixels); `geometries` (leak check: geometries
    dropped without `dispose`).
  - **When adding a state, an airfield resource, a line pool, a placeholder or a cache**, update the harness: aircraft
    states come from `STATUS` (so `registerLeg` / `Object.assign(STATUS, …)` is enough), but mission / tanker / runway /
    arrival state sets, `STATE_LIMITS`, the placeholder list in `radio-pools.spec.js` and `GEO_CACHES` are listed by hand.
  - `repo.spec.js` checks the cache-buster (all tags equal, matches "Current: `v=N`" here), the load order line above,
    and that `js/properties.js` is regenerated.
- Console checks by hand: all globals are reachable; set `paused = true` and drive the sim with `step(0.05)` +
  `renderer.render(scene, camera)`; check `renderer.info.render.calls` (main-pass draw calls, shadow pass excluded)
  and `renderer.info.memory.geometries`. To force a fight: `AUD.combat` alone gives `armed` but not `fighting` (no
  waves / passes / beats); use `Object.defineProperty(AUD, 'active', { get: () => true }); AUD.soundStart = RT() - 10;
  AUD.combat = true;` (what `__t.forceFight()` does), then `onBeat('low', 2)`.
