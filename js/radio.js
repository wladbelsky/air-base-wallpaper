'use strict';
/* ===== Radio chatter subtitles (Ace Combat style) ===== */
const CALLSIGNS = {
  // Squadron names from Ace Combat 2 / 04 / 5 / Zero / X / 6 / Infinity / 7 / 8 — groups of 4 for jets, 2 for helicopters
  f15: ['GALM', 'WARDOG', 'CROW', 'SWORDSMAN'],
  f16: ['MAGE', 'SPARE', 'JOKER', 'QUEEN', 'STRIDER'],
  f22: ['MOBIUS', 'SCARFACE', 'GRYPHUS'],
  f35: ['GARUDA', 'OGRE', 'SABER', 'ANTARES'],
  a10: ['WARWOLF', 'BASILISK', 'TUSK'],
  e3: ['SKYEYE', 'THUNDERHEAD', 'EAGLE EYE', 'LONG CASTER', 'BANDOG', 'SKY KEEPER', 'DEALER', 'GHOST EYE'],
  kc46: ['BARREL', 'PIPELINE', 'GUSHER', 'DERRICK'],     // tankers: oil / fuel words
  kc130: ['CANTEEN', 'WELLHEAD', 'PETROL'],
  c130: ['HERCULES', 'SHEPHERD', 'PELICAN', 'NOMAD'],
  ac130: ['SPECTRE', 'GHOSTRIDER', 'SPOOKY'],            // the gunships' own nicknames
  c17: ['REACH', 'ATLAS', 'MOOSE'],
  mq9: ['HUNTER', 'WATCHDOG', 'OVERSEER'],
  uh60: ['DUSTOFF', 'PEDRO', 'HALO', 'OSPREY'],
  ah64: ['VIPER', 'COBRA', 'SWEEPER', 'BLACKJACK'],
  uh1: ['GUNSLINGER', 'SHOTGUN', 'BANSHEE'],
  flyby: ['AVALANCHE', 'SOHEI', 'RAVEN']   // allied Strangereal aces (AC Infinity / 6)
};
/* the base talks as its tower; the air-defence battery, the tank platoon and the C-RAM crews have their own names */
const RADIO_NAMES = { get tower() { return `${CFG.baseName || 'BASE'} TOWER`; }, get base() { return CFG.baseName || 'BASE'; }, patriot: 'LANCER', armor: 'IRONSIDE', cram: 'BLADE', defense: ['LANCER', 'IRONSIDE', 'BLADE'] };
const ROLE_COLOR = { pilot: '#8fd3ff', awacs: '#9dffb0', tower: '#ffd27a', ground: '#ffb87a', heli: '#b8e0ff', ace: '#ff9a7a', enemy: '#ff5a50' };
// intercepted enemy traffic (ENEMY_LINES): attack waves are squadrons, numbered per aircraft; armour columns; their command.
// Enemy aces of Ace Combat 04 / 5 / 6 / Zero / 7; the columns are named after the serpents under Yggdrasil like
// Grabacr and Ofnir; the command after the Belkan flying fortress.
const ENEMY_NAMES = { hq: 'HRESVELGR', squadrons: ['YELLOW', 'SOL', 'GRABACR', 'OFNIR', 'SCHNEE', 'GELB', 'STRIGON', 'ROT', 'GRÜN', 'SILBER', 'ESPADA', 'SORCERER'],
  armor: ['SVAFNIR', 'GOIN', 'MOIN', 'GRAFVITNIR'] };

const VARIETY_T = 6;
const RADIO = {
  q: [], cur: null, t: 0, gap: 0, onAir: {},   // onAir: role -> T its last line ended
  say(who, text, o) {
    o = o || {};
    if (!CFG.subtitles) return;
    const prio = o.prio != null ? o.prio : 1;
    if (this.q.length >= 8) {                     // drop the least important pending line
      const tmp = { prio, cat: o.cat || 'ops', hot: !!o.hot };
      let wi = -1, wp = 1e9; this.q.forEach((m, i) => { const e = this.eff(m); if (e < wp) { wp = e; wi = i; } });
      if (wp > this.eff(tmp)) return; this.q.splice(wi, 1);
    }
    this.q.push({ who, text, prio, cat: o.cat || 'ops', hot: !!o.hot, role: o.role || 'pilot', at: T + (o.delay || 0), born: T });
  },
  /* During combat, combat traffic outranks routine tower traffic. */
  eff(m) {
    const armed = AUD.armed;
    if (m.cat === 'combat') return armed ? 10 + m.prio : m.prio;
    if (m.cat === 'ops') return armed ? (m.hot ? 5 + m.prio : m.prio - 5) : 5 + m.prio;
    return 5 + m.prio;
  },
  update(dt) {
    const box = this.box || (this.box = document.getElementById('subs')); if (!box) return;
    if (!CFG.subtitles) {                         // switched off: drop the backlog instead of playing it out
      if (this.cur || this.q.length) { this.q.length = 0; this.cur = null; box.classList.remove('on'); }
      return;
    }
    if (this.cur) {
      this.t += dt;
      // urgent calls (prio >= 3: contacts, combat start, incoming missiles, hits) cut a less important line;
      // with a backlog waiting, the current line is shortened
      let waiting = false, urgent = false;
      for (const m of this.q) if (m.at <= T) { waiting = true; if (m.prio >= 3 && this.eff(m) > this.eff(this.cur)) urgent = true; }
      const end = urgent ? 0.4 : waiting ? Math.max(1.4, this.cur.dur * 0.7) : this.cur.dur;
      if (this.t > end) { this.onAir[this.cur.role] = T; box.classList.remove('on'); this.cur = null; this.gap = urgent ? 0.05 : 0.2; }
      return;
    }
    if (this.gap > 0) { this.gap -= dt; return; }
    // stale lines are dropped: combat calls after 4 s, routine calls during combat after 5 s
    this.q = this.q.filter(m => !((m.cat === 'combat' && m.prio < 3 && T - m.born > 4) || (AUD.armed && m.cat === 'ops' && !m.hot && T - m.born > 5) || (m.prio <= 0 && T - m.born > 6)));
    let i = -1, best = -1e9;
    // variety: in combat a role silent for VARIETY_T s gets half a step up, so one side (the base calling every kill
    // and hit) can't drown out the others, the enemy included; half, so it never ties the next priority
    this.q.forEach((m, k) => { if (m.at <= T) { const e = this.eff(m) + (m.cat === 'combat' && T - (this.onAir[m.role] ?? -99) > VARIETY_T ? 0.5 : 0); if (e > best) { best = e; i = k; } } });
    if (i < 0) return;
    const m = this.q.splice(i, 1)[0];
    m.dur = clamp(1.0 + m.text.length * 0.042, 1.6, 4.6); this.cur = m; this.t = 0;
    box.querySelector('.who').textContent = m.who;
    box.querySelector('.who').style.color = ROLE_COLOR[m.role] || ROLE_COLOR.pilot;
    box.querySelector('.txt').textContent = `« ${m.text} »`;
    box.classList.add('on');
  }
};

/* Untiered radio lines (tiered pools are in OPS / OPS_UNARMED and COMBAT below) */
const LINES = {};

/* ---- mission orders (only when there is no music) ---- */
const MISSIONS = {
  fighter: [
    ['proceed to sector {S} and set up a combat air patrol.', 'CAP complete, returning to station.'],
    ['unidentified contacts bearing {B}. Intercept and identify.', 'Contacts identified — a lost airliner. Escorted it clear. Returning.'],
    ['escort the tanker to the northern track.', 'Tanker escorted. Coming home.'],
    ['SEAD package: radar site at grid {G}. Weapons free.', 'Radar site is off the air. RTB.'],
    ['recon run over the river crossings, grid {G}.', 'Recon pictures in the can. Returning.'],
    ['cover the supply convoy heading {B}.', 'Convoy reached the FOB. Heading home.'],
    ['a bogey was reported near the pipeline, sector {S}. Check it out.', 'Nothing but a weather balloon. RTB.'],
    ['patrol the border along bearing {B}. Do not cross it.', 'Border patrol complete. Returning to base.'],
    ['close air support for the outpost at grid {G}. Troops in contact.', 'Outpost reports the pressure is off. RTB.'],
    ['strike the fuel depot at grid {G}.', 'Depot is burning. Coming home.']
  ],
  awacs: [
    ['relocate on bearing {B} to extend radar coverage.', 'Coverage extended. Back on station.'],
    ['move to sector {S} and relay comms for the strike package.', 'Relay complete. Returning to orbit.'],
    ['shift your track toward bearing {B}. The strike package needs eyes over the border.', 'Strike package is home safe. Back on my orbit.'],
    ['run a radar sweep of sector {S}. Something keeps popping up on our scope.', 'Sector is clean, just ground clutter. Back on station.']
  ],
  heli_transport: [
    ['resupply run to the forward outpost at grid {G}.', 'Supplies delivered. Heading back.'],
    ['pilot down at grid {G}. Combat search and rescue, go!', 'Pilot recovered, alive and well. RTB.'],
    ['ferry the quick reaction force to the checkpoint, bearing {B}.', 'Troops on the ground. Returning.'],
    ['medevac from the outpost, bearing {B}. Two urgent.', 'Casualties aboard, the doc is on them. Coming home.'],
    ['fly the engineers out to the bridge at grid {G}.', 'Engineers dropped off. RTB.'],
    ['VIP transfer from the city airport, sector {S}.', 'VIPs aboard and smiling. Returning.']
  ],
  heli_attack: [
    ['armed recon along the main supply route, sector {S}.', 'Route is clear. Returning.'],
    ['escort the transports to the landing zone.', 'Transports delivered safely. Coming home.'],
    ['technicals reported near the village, grid {G}. Go take a look.', 'Just farmers on pickups. RTB.'],
    ['cover the convoy at the river crossing, bearing {B}.', 'Convoy is across. Returning.']
  ],
  gunship: [   // AC-130 / MQ-9: armed overwatch and surveillance
    ['armed overwatch for the convoy at grid {G}.', 'Convoy reached the outpost without a shot. Returning.'],
    ['orbit the outpost at grid {G} and watch the tree line.', 'Quiet night. Handing over to the next shift. RTB.'],
    ['ISR orbit over the border crossing, bearing {B}.', 'Imagery downlinked. Coming home.'],
    ['support the special forces raid in sector {S}.', 'Raid complete, team exfiltrated. RTB.']
  ],
  paradrop: {  // C-130 / C-17: low across the field next to the base, on screen
    troops: [
      ['paradrop training over the drop zone next to the base. Low pass, then back on station.', 'All jumpers out, good canopies. Back on station.'],
      ['the airborne company is ready. Drop them on the field by the base, then climb out.', 'Stick is on the ground, all chutes open. Returning.'],
      ['jump run over the drop zone outside the fence. Watch the wind.', 'Jumpers away, everybody landed in the zone. Back to the orbit.']
    ],
    cargo: [
      ['airdrop the supply bundles on the drop zone next to the base.', 'Bundles on the ground. Returning.'],
      ['container delivery drill: drop the load on the field outside the fence.', 'Load on the drop zone, chutes good. Back on station.']
    ]
  },
  airlift: [   // C-130 / C-17: long logistics runs that end with a landing at the base
    ['airlift run to the logistics hub: ammunition and spares.', 'Inbound from the hub with {P} passengers and {W} pounds of cargo.'],
    ['pick up the replacement F110 engines at the depot, grid {G}.', 'Engines in the back, strapped down. Heading home.'],
    ['fly the medical team to the field hospital, bearing {B}.', 'Team delivered. Returning to base.'],
    ['aeromedical evacuation to the rear hospital, bearing {B}.', 'Patients handed over. RTB.'],
    ['bring the spare radar modules from the depot.', 'Got the parts. On our way back.'],
    ['pick up {P} replacement crews at the rear airfield, grid {G}.', 'Fresh crews aboard. Coming home.'],
    ['food and fuel bladders for the outpost, airdrop at grid {G}.', 'Load on the drop zone. Returning empty and happy.'],
    ['long-range logistics run to the forward base, grid {G}.', 'Inbound with {W} pounds of cargo for the wing.'],
    ['collect the mail at the rear base, bearing {B}.', 'Mail bags aboard. Morale is inbound.'],
    ['the depot at grid {G} has the bulldozer for the runway repair team. Go get it.', 'Bulldozer chained down in the back. Engineers, stand by.']
  ]
};
LINES.missionCopy = {
  any: ['Copy, en route.', 'Roger that, on our way.', 'Copy. Heading out now.', 'Understood.', 'Wilco.', "Copy that. We're on it.",
    'Roger. Leaving the pattern.', 'Acknowledged. Moving out.', 'Copy, will report on arrival.', 'On our way. Keep the coffee warm.',
    'Roger, breaking off now.', 'Affirmative, heading out.', 'Copy all. En route.', "Understood. We'll take it from here."],
  fighter: ['Copy, going to burner. On our way.', 'Roger, climbing to angels two-five.', 'Copy. Weapons check complete, heading out.',
    "Flight, on me. Let's go.", 'Copy, fence in. Vectoring now.', 'Roger. Tanker on the way back, right?'],
  awacs: ['Copy, moving the orbit. Picture stays up.', 'Roger, repositioning. Datalink stays live the whole way.', 'Understood. Shifting my track, back on station shortly.'],
  airlift: ['Copy. Loadmaster, secure the ramp.', 'Roger, long haul. Crew, get comfortable.', 'Understood. Mail call in about two hours.',
    "Copy. We'll bring back the good coffee this time.", 'Roger, heavy and slow, on our way.'],
  gunship: ['Copy, heading out. Sensors up.', 'Roger, guns cold until we get there.', 'Understood. Setting up the orbit on arrival.'],
  heli: ['Copy, nose down, en route.', 'Roger, heading out low and fast.', "Understood, we're on our way. Crew, strap in.", 'Copy. ETA about ten minutes.']
};
let lastMissionCopy = '';
function missionCopy(kind) {
  const pool = LINES.missionCopy.any.concat(LINES.missionCopy[kind.startsWith('heli') ? 'heli' : kind] || []);
  let line; do line = radioLine(pool); while (line === lastMissionCopy);
  return lastMissionCopy = line;
}
/* order / done texts for a MISSIONS key; nested keys use a dot; extra = more placeholders ({V} …) */
function makeMission(kind, extra) {
  const [order, done] = pick(kind.split('.').reduce((o, k) => o[k], MISSIONS));
  const sectors = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Kilo', 'Sierra'];
  const bearing = bearingWords(rand(0, TAU));
  const vars = Object.assign({ S: pick(sectors), B: bearing, G: `${randi(1, 9)}-${randi(1, 9)}`, P: randi(4, 24), W: (randi(4, 40) * 500).toLocaleString('en-US') }, extra);
  return { order: fillLine(order, vars), done: fillLine(done, vars) };
}

/* ===== Stress: builds up over ~10 minutes of continuous combat music, eases off in silence ===== */
const STRESS = {
  level: 0,
  update(dt) { this.level = clamp(this.level + (AUD.fighting ? dt / 600 : -dt / 180), 0, 1); },
  bump(v) { this.level = clamp(this.level + v, 0, 1); },
  get tierIndex() { const i = THREAT_TIERS.findIndex(t => this.level < t.upTo); return i < 0 ? THREAT_TIERS.length - 1 : i; },
  get tier() { return THREAT_TIERS[this.tierIndex].key; },
  get label() { return ['LOW', 'ELEVATED', 'HIGH', 'CRITICAL'][Math.min(3, Math.floor(this.level * 4))]; }
};

/* ===== Radio line pools and threat tiers =====
   THREAT_TIERS maps STRESS.level to a tier, calmest first — add a tier by adding an entry (and lines under its key).
   A line pool is either
     - an array: the same lines at any time, or
     - an object keyed by tier ({ calm, tense, panic, … }) plus an optional `peace` (outside combat).
   Keys may be left out: a missing tier falls back to the next calmer one (and from there to any tier present).
   radioLine(pool, vars):
     - outside combat: `peace` if the pool has it, otherwise the current tier;
     - in combat: the current tier, but MIX_CALMER of the time one tier calmer (variety, repeatable down the tiers);
     - fills {name} placeholders from vars ({c}, {C}, {T}, {B}, {D}, {N}, …); unknown ones are left untouched;
     - never gives the same line of a list twice in a row.                                                        */
const THREAT_TIERS = [
  { key: 'calm', upTo: 0.33 },
  { key: 'tense', upTo: 0.66 },
  { key: 'panic', upTo: Infinity }
];
const MIX_CALMER = 0.3;
const LAST_LINE = new WeakMap();   // line list -> the line last taken from it: never the same one twice in a row
const fillLine = (t, vars) => vars ? t.replace(/\{(\w+)\}/g, (m, k) => vars[k] != null ? vars[k] : m) : t;
function radioLine(pool, vars) {
  let list = Array.isArray(pool) ? pool : !AUD.armed && pool.peace;
  if (!list) {
    let i = STRESS.tierIndex;
    while (i > 0 && (!pool[THREAT_TIERS[i].key] || Math.random() < MIX_CALMER)) i--;
    list = pool[THREAT_TIERS[i].key] || THREAT_TIERS.map(t => pool[t.key]).find(Boolean) || pool.peace;
  }
  let line = pick(list);
  if (line === LAST_LINE.get(list) && list.length > 1) line = pick(list.filter(l => l !== line));
  LAST_LINE.set(list, line);
  return fillLine(line, vars);
}

/* ===== Routine tower / ground calls — peace versions + combat versions by tier (used while music plays).
   Who says it: the tower (taxiClear, takeoffClear…, heliCleared, landClear, goAround) or the aircraft (the rest).
   The combat versions are for armed aircraft; the AWACS and the tankers have their own voices (OPS_VOICE), unarmed ones OPS_UNARMED. ===== */
const OPS = {
  taxiReq: {
    peace: ['Ground, request taxi.', 'Ready to taxi.', 'Pushback complete, ready to taxi.', 'Request taxi to the active.', 'Chocks out, ready to taxi.'],
    calm: ['Request immediate taxi!', 'Ready to roll, give me the runway!', 'Taxiing now, armed and ready.'],
    panic: ["Taxiing now, don't stop me!", "We're moving, clear the way!"]
  },
  taxiClear: {
    peace: ['{c}, taxi to runway zero-niner via Alpha, hold short.', '{c}, taxi via the parallel, hold short of zero-niner.', '{c}, follow the traffic ahead, hold short runway zero-niner.',
      '{c}, cleared to taxi. Altimeter two-niner-niner-two.', '{c}, taxi Alpha to the holding point, report ready.'],
    calm: ['{c}, taxi immediately, hold short zero-niner!', '{c}, expedite taxi, they need you up there!', '{c}, taxi now, no delay!'],
    panic: ['{c}, just go, take any taxiway!', "{c}, move it, we're under attack!", '{c}, taxi, taxi, get off the apron!']
  },
  takeoffClear: {
    peace: ['{c}, wind calm, runway zero-niner, cleared for takeoff.', '{c}, runway zero-niner, cleared for takeoff. Good flight.', '{c}, line up and take off. Have a good one.',
      '{c}, cleared for takeoff, turn as required.', '{c}, the runway is yours. Cleared for takeoff.', '{c}, wind two-seven-zero at five, cleared for takeoff.'],
    calm: ['{c}, scramble! Cleared for takeoff!', '{c}, runway is clear, go get them!', '{c}, cleared for immediate takeoff!', "{c}, bandits inbound. Cleared, go!"],
    panic: ["{c}, take off NOW! They're right on top of us!", "{c}, go, go, go! The base is under fire!", '{c}, get airborne before the next strike!', "{c}, don't wait for clearance, GO!"]
  },
  takeoffClearPair: {
    peace: ['{c}, flight of two, runway zero-niner, cleared for formation takeoff.', '{c} and wingman, cleared for takeoff together. Nice and tight.'],
    calm: ['{c}, flight of two, scramble! Cleared for takeoff!', '{c}, both of you, go now!'],
    panic: ['{c}, both of you, GO! Get off the ground!']
  },
  takeoffReady: {
    peace: ['Cleared for takeoff.', 'Rolling.', 'Roger, rolling now.', 'Brakes off, rolling.', 'Copy, full power.', 'Thanks, tower. Rolling.'],
    calm: ['Rolling, weapons hot!', 'Copy, scrambling!', 'Master arm on. Rolling!', "Let's get them!"],
    panic: ['Rolling! Get me out of here!', 'Going, going!', 'Hang on, here we go!']
  },
  airborne: {
    peace: ['Airborne.', 'Wheels up.', 'Airborne, climbing to angels one-five.', 'Off the ground, switching to departure.', 'Clean and climbing.', 'Airborne, turning out.'],
    calm: ['Airborne, weapons hot!', 'Wheels up, heading for the fight!', 'Airborne, looking for trade.', 'Up and armed. Point me at them.', 'Airborne, burner on!'],
    panic: ['Airborne! Engaging immediately!', "I'm up! Where do you need me?!", 'Airborne — they are everywhere!', 'Off the ground! That was close!']
  },
  approach: {
    peace: ['Tower, ten miles west, inbound for a full stop.', 'Request landing, full stop.', 'Low on fuel, coming home.', 'Inbound for landing.', 'Mission complete, request recovery.'],
    calm: ['Winchester, RTB to rearm.', 'Bingo fuel, coming in.', 'Out of missiles, request landing.', 'Need to rearm, coming in hot.'],
    panic: ["I'm hit, coming in! Clear the runway!", 'Winchester and bingo, coming home under fire!', 'Battle damage, I need that runway now!']
  },
  landClear: {
    peace: ['{c}, runway zero-niner, wind calm, cleared to land.', '{c}, cleared to land, number one.', '{c}, check gear down, cleared to land.', '{c}, runway zero-niner, cleared to land. Welcome home.'],
    calm: ['{c}, cleared to land, make it quick!', '{c}, runway is yours, get down fast!', '{c}, cleared to land, bandits in the area!'],
    panic: ['{c}, just get it down!', "{c}, land now, we're taking fire!", '{c}, cleared, cleared, get on the ground!']
  },
  touchdown: {
    peace: ['Down and rolling.', 'On the ground. Thanks, tower.', 'Touchdown. Taxiing to parking.', 'Down safe. Good to be home.'],
    calm: ['Down! Rearm and refuel, fast!', 'On the ground. Ordnance crews, move!', 'Touchdown. Get this bird turned around!'],
    panic: ['Down! Get me to the shelter!', 'On the ground — more bandits inbound!', "Down! That was too close!"]
  },
  goAround: {
    peace: ['{c}, go around, runway occupied.', '{c}, go around, traffic on the runway.', '{c}, go around. Re-enter the pattern.'],
    calm: ['{c}, go around, the runway is blocked!', '{c}, pull up, go around!'],
    panic: ['{c}, go around, go around! Runway blocked!']
  },
  goingAround: {
    peace: ['Going around.', 'Copy, going around.', 'Roger, back into the pattern.'],
    calm: ['Going around!', 'Pulling up, going around.'],
    panic: ['Going around! Come on!']
  },
  heliUp: {
    peace: ['Lifting off.', 'Airborne, heading out.', 'Wheels up.', 'Off the pad, departing the pattern.', 'Lifting off, nose over.', 'Airborne. Thanks, tower.'],
    calm: ['Lifting off, guns hot!', 'Airborne, rockets armed, moving in!', 'Up and armed. Point me at the armour.', 'Lifting off, weapons hot, staying low!'],
    panic: ['Lifting off under fire! Weapons hot!', "Airborne! Rolling in on whatever's closest!"]
  },
  heliCleared: {
    peace: ['{c}, cleared to land, pad one.', '{c}, pad is clear. Cleared to land.', '{c}, winds are good. Cleared to land.', '{c}, land at your spot, cleared.'],
    calm: ['{c}, cleared to land, make it fast!', '{c}, pad is clear, get down quick!'],
    panic: ["{c}, land now, we're under attack!", '{c}, get down, get down!']
  },
  heliDown: {
    peace: ['On the pad.', 'Touchdown. Shutting down.', 'Down safe.', 'On the ground. Thanks, tower.'],
    calm: ['On the pad, rearm us quick!', 'Down. Refuel and we go again.'],
    panic: ['Down! That was too close!', 'On the ground — we took some hits!']
  }
};
/* per-type voices (spec.voice): taken first by opsLine — in peace only where a pool has `peace` */
const OPS_VOICE = {
  awacs: {
    airborne: {
      peace: ['Airborne. Radar is up, picture clean.', 'On station. Datalink is up, all flights check in.',
        "Airborne and climbing. I'll call the picture from up here.", "On station. Scope is quiet. Let's keep it that way."],
      calm: ['Airborne. Picture is hot, multiple groups inbound.', 'On station. Bandits on the scope, stand by for vectors.', 'Up and radiating. Hostiles in the air. Weapons free.'],
      panic: ['Airborne. Scope is saturated, too many tracks to count!', 'On station. Hostiles everywhere. All flights, engage at will!']
    },
    takeoffClear: {
      calm: ["{c}, get the radar up there, we're blind without you!", '{c}, cleared for takeoff. Stay clear of the furball.', '{c}, cleared, get on station, the base needs the picture.'],
      panic: ['{c}, take off now, we need eyes up there!', "{c}, go! We can't fight blind!"]
    },
    takeoffReady: {
      calm: ["Rolling. Radar's warm.", "Copy, rolling. We'll stay well back.", 'Rolling. Datalink is up.'],
      panic: ['Rolling, the base needs the picture!', 'Going! Get us out of here!']
    },
    approach: {
      calm: ['Bingo fuel, handing the picture to the tower. RTB.', 'Off station, coming in. Ground radar has the picture.', 'Low on fuel, coming home. Turn us around fast.'],
      panic: ['Coming in with the radar still hot, clear the runway!', "Bingo fuel and bandits everywhere, I'm coming in!"]
    },
    touchdown: {
      calm: ['Down. Fuel it and get it back up!', "On the ground. Hot refuel, they're blind out there."],
      panic: ['Down! Refuel and relaunch, we need that radar!']
    }
  },
  tanker: {
    airborne: {
      peace: ['Airborne. Plenty of gas to give.', 'On station, tanker track established.', 'Airborne and climbing. Gas station opens in five.', 'On station. Receivers, check your fuel and come see me.'],
      calm: ['Airborne. Gas on station for the fighters.', 'On station. Fuel available, top off and get back in it.', 'Up and on track. Holding well clear.'],
      panic: ['Airborne! Take what you need, fast!', 'On station, holding as close as I dare. Come get your gas!']
    },
    takeoffClear: {
      calm: ['{c}, get the tanker up, the fighters are running dry!', '{c}, cleared for takeoff. Keep that track clear of the fight.'],
      panic: ['{c}, take off now! Half the wing is on fumes!', '{c}, go! They need the gas up there!']
    },
    takeoffReady: {
      calm: ['Rolling. Tanks full.', 'Copy, rolling heavy.'],
      panic: ['Rolling, the fighters are bingo!', 'Rolling! Every pound counts!']
    },
    approach: {
      peace: ['Give-away fuel spent, RTB.', 'Tanks dry, coming home to reload.', 'Bingo, recovering.'],
      calm: ['Give-away spent, coming in. Turn me around fast.', 'Tanks dry, RTB. Fighters, you are on your own for a bit.'],
      panic: ['Empty and coming in! Refuel me and send me up again!', 'Tanks dry, coming in hot! Clear the runway!']
    },
    touchdown: {
      calm: ['Down. Fill it up and send it back out!', 'On the ground. Hot refuel the tanker, fighters are waiting.'],
      panic: ['Tanker on the ground! Fuel it, now!']
    }
  }
};
/* combat calls of unarmed aircraft (transports, helicopters): only the keys and tiers that differ; peace lines are shared from OPS */
const OPS_UNARMED = {
  takeoffReady: { calm: ['Rolling, heavy. Keep them off us.', 'Rolling. Getting the heavies out of harm\'s way.'], panic: ['Rolling! Get us out before they hit the ramp!'] },
  airborne: { calm: ['Airborne, keeping clear of the fight.', 'Up and heading for the safe orbit.', 'Airborne, staying well back.'], panic: ['Airborne! Getting clear!', 'Off the ground — that was close!'] },
  approach: { calm: ['Coming in. Keep the runway open for us.', 'Inbound heavy, request landing.'], panic: ['Coming in under fire, clear the runway!'] },
  heliUp: {
    calm: ['Lifting off, staying low and clear.', 'Airborne, keeping out of the fight.', 'Up and moving, watch the flak!', 'Airborne, holding outside the threat ring.'],
    panic: ['Lifting off under fire, staying low!', 'Airborne — that was close!', 'Off the pad! Keeping clear!']
  },
  heliDown: {
    calm: ['On the pad. Refuel us, we go again.', 'Down. Unloading, then back out.', 'On the ground. Hot refuel, please.'],
    panic: ['On the pad! Get the wounded off!', 'Down — that was too close!', 'On the ground — we took some hits!']
  }
};
/* returns [text, hot]: hot lines keep their priority during combat; a = the aircraft ({c} = its callsign).
   Pool: its voice (OPS_VOICE[spec.voice], in peace only with a `peace` list), unarmed ones OPS_UNARMED in combat, else OPS. */
function opsLine(key, a) {
  const v = OPS_VOICE[a.spec.voice] && OPS_VOICE[a.spec.voice][key], armed = AUD.armed;
  const pool = (v && (armed || v.peace) && v) || (armed && !a.spec.armed && OPS_UNARMED[key]) || OPS[key];
  return [radioLine(pool, { c: a.callsign }), armed];
}

/* ===== Combat chatter by stress tier ===== */
const COMBAT = {
  start: {
    calm: ['All units, bandits inbound! Weapons free!', 'Multiple bogeys closing on the base. Engage!', 'Enemy aircraft approaching. All units, intercept!', 'Air raid warning! All stations, weapons free!'],
    tense: ['Here they come again! All units, engage!', 'Another wave inbound! Weapons free!', 'Hostiles back on the scope. Everybody up, weapons free!'],
    panic: ['They just keep coming! Every gun, open fire!', 'Massive enemy attack! Defend the base at all costs!', "Scope's full of hostiles! All units, engage, engage!",
      'This is the big one! Everything they have is coming at us!', 'All personnel to the shelters! Enemy attack in force!']
  },
  end: {
    calm: ['Airspace is clear. Good work, everyone.', 'No more contacts on radar. Stand down.', 'Enemy has withdrawn. Nice work out there.'],
    tense: ['Contacts gone. That was too close. Stand down.', "They've pulled out. Check your fuel and damage.", 'Scope is clear. Stand down, but stay ready.'],
    panic: ["It's over. They're gone. All stations, report damage.", "Airspace clear. I don't believe it. We held.", 'No more contacts. We made it. Count your people.',
      "They're gone... Stand down. Fire crews, keep at it."]
  },
  // the music stopped: hold DISARM_DELAY s, then `end` — or `resume` if it starts again
  lull: {
    calm: ['No more contacts on the scope. Stand by.', "Scope's clearing. Hold your fire, stay sharp.", "Last bandit's off the scope. Holding."],
    tense: ["Contacts fading... Don't relax yet.", 'Scope is going quiet. Keep your eyes open.'],
    panic: ["They've pulled back... Is that all of them?", 'No contacts... Everybody hold, they could be regrouping.']
  },
  resume: {
    calm: ['New contacts! Here they come again!', 'Scratch that, more bandits inbound. Weapons free!'],
    tense: ["They're back! All units, re-engage!", 'Contacts reappearing! Weapons free!'],
    panic: ["It was a feint! They're coming back in force!", 'More of them! Back to your guns!']
  },
  awacs: {
    calm: ['New group, four ships, closing on the base. Commit.', 'Good kill. Next group is right behind it.', 'Picture update: enemy formation is breaking up. Keep the pressure on.',
      'Hostiles turning toward the base. Cut them off.', 'Nice shooting. Stay on your targets.'],
    tense: ['Multiple groups inbound. All flights, weapons free.', 'More hostiles joining the fight. Hold your ground.', 'Cruise missiles in the air! Point defence, stand by.',
      'Leakers getting through. Tighten up around the base.'],
    panic: ['Scope is full of hostiles! Hold the line!', 'All flights, defend the base. Nothing gets through!', "I've lost count of the tracks. Just keep shooting!",
      'Another wave behind this one! Do not let up!', 'Hostiles from every direction! Pick a target and shoot!', 'They are throwing everything at the base. Stop them!',
      "Enemy squadrons regrouping for another run. Don't give them the chance!"]
  },
  // the base's own defences (air defence battery, tanks, C-RAM crews)
  base: {
    calm: ['C-RAM engaging!', 'Guns tracking, air contact inbound.', 'Splash! Target down.', 'Battery up and radiating.', 'Tanks have the tree line covered.'],
    tense: ['Missiles inbound, take cover!', 'C-RAM reloading, cover us!', 'Taking fire on the east perimeter!', 'Armour moving on the south road!'],
    panic: ['We are taking heavy fire!', 'Fire crews to the flight line!', 'Fires on the ramp!', "We can't take much more of this!",
      'All guns, independent fire! Shoot anything that moves!', 'Running low on ammo! Make every round count!']
  },
  splash: {
    calm: ['Splash one!', 'Target destroyed.', 'Good kill!', 'Bandit down.', 'Splash, splash!'],
    tense: ["Splash! Who's next?", "Got him! That's another one!", 'Bandit down! More inbound!'],
    panic: ["Splash! But there's more coming!", 'Got one! Still too many!', 'Down! Next one, quick!', "Splash! That one won't hit the base!", 'Got him! Who else wants some?!']
  },
  missileDown: {
    calm: ['Cruise missile splashed!', 'Missile intercepted!', 'C-RAM kill!', 'Got the missile!'],
    tense: ['Missile down! Watch for the next one!', 'Intercepted! That was close.', 'Missile splashed short of the hangars!'],
    panic: ['Got it! Got it! Next one!', 'Missile down, another one right behind it!', "Intercepted! We can't keep this up!", 'Killed it! Close enough to feel the heat!']
  },
  ballisticDown: {
    calm: ['Ballistic missile intercepted!', 'Patriot kill! TBM destroyed.', 'Intercept confirmed. Debris falling clear.'],
    tense: ['Intercept! That one was headed for the runway!', 'Ballistic missile down! Watch for the next salvo!'],
    panic: ['Got it! Got the ballistic!', 'Intercept! Keep the launchers loaded, more coming!']
  },
  baseHit: {
    calm: ["We've been hit! Fire crews!", 'Impact on the ramp! Fires burning!', 'Hit near the hangars! Still operational!'],
    tense: ['Direct hit on the flight line! Fire crews, go!', "Impact! We're still in the fight!", 'Took a hit by the shelters! Fire teams responding!'],
    panic: ["We're hit again! Fires spreading!", 'Massive damage on the ramp!', "Another hit! We can't take much more!", 'The fuel farm is burning!',
      "Direct hit! We're still operational, keep firing!"]
  },
  newBandits: {
    calm: ['New contacts, bearing {B}, {N}! Identified as {T}.', 'Bogeys inbound from the {D}, {N}! Type: {T}.', '{T}, bearing {B}, closing fast!', '{T}s inbound from the {D}, {N}!'],
    tense: ['More bandits, bearing {B}, {N}! Type: {T}.', 'Another group from the {D}, {N}. Identified as {T}.', 'Fresh contacts, bearing {B}, {N}. They keep sending them.'],
    panic: ['New group from the {D}, {N}, and more behind them! Type: {T}!', 'New contacts, bearing {B}, {N}! Will this ever end?!',
      'Bearing {B}, {N}! {T}! Where are they all coming from?!', 'Inbound from the {D}, {N}! Type: {T}! Somebody get on them!',
      'More hostiles, bearing {B}, {N}! The scope is full of them!']
  },
  bombers: {
    calm: ['Bombers! {T}, bearing {B}, heading for the base!', 'Heavy contacts from the {D}: {T}. Intercept before they release!'],
    tense: ['{T} bombers inbound from the {D}! Stop them before the release point!', 'Bomber group, bearing {B}! Fighters, go!'],
    panic: ['Bombers right overhead! Take cover!', '{T}s on a bomb run, bearing {B}! Shoot them down!']
  },
  cruise: {
    calm: ['Cruise missiles, bearing {B}!', 'Inbound missiles, low level, bearing {B}!', 'Missile launch detected! Cruise missiles inbound!'],
    tense: ['Cruise missiles, bearing {B}! C-RAM, stand by!', 'Missile salvo inbound from the {D}! Take cover!'],
    panic: ['Multiple missiles, bearing {B}! Everybody into the shelters!', 'Missiles! Missiles! Too many to track!', 'Missile wave from the {D}! Shoot them down!']
  },
  ballistic: {
    calm: ['Ballistic missile launch! Impact in sixty seconds!', 'TBM inbound, high angle. Patriot, engage!'],
    tense: ['Ballistic launch detected, bearing {B}! Take cover!', 'Incoming ballistic missiles! Battery, weapons free!'],
    panic: ['Multiple ballistic launches! Everybody down!', 'TBMs inbound! Get in the bunkers!']
  },
  missileLaunch: {
    calm: ['Missile launch! Bandit fired on us!', 'Missile off the rail, inbound!'],
    tense: ['Bandit released a missile! Tracking!', 'Missile launch, close in!'],
    panic: ["He fired! It's coming straight at us!", 'Missile off the rail, short range!', 'Launch! Launch! Point defence, now!']
  },
  armor: {
    calm: ['Armoured column, bearing {B}! Tanks, engage!', 'Enemy vehicles on the road to the {D}. Ironside, you have them.', 'Ground contacts approaching the perimeter, bearing {B}.'],
    tense: ['Tanks closing on the wire from the {D}! All units, engage!', 'More armour coming up the road, bearing {B}!'],
    panic: ['They are at the fence! Stop those tanks!', 'Armour everywhere to the {D}! Hold the perimeter!']
  },
  patriot: ['Patriot away!', 'Missile away!', 'Battery engaging!', 'Launch, launch!'],
  tank: { calm: ['Target, tank! On the way!', 'Gunner, sabot, tank! Fire!', 'Hit! Target burning.'], tense: ['On the way! Next target!', 'Fire! Reload sabot!'], panic: ['Fire, fire! They are everywhere!', 'Keep shooting! Hold the line!'] },
  flybyIn: { calm: ['Engaging!', 'Beginning attack run.', 'Rolling in, cover me.'], tense: ['Coming in hot!', 'Rolling in, hold on, base!'], panic: ['Coming in hot! Hang on down there!'] }
};

/* ---- air combat passes (js/airwar.js): each line matches what is on screen at that moment ----
   {T} enemy type, {C} callsign, {B} bearing, {D} compass direction */
const AIRWAR_LINES = {
  engage: {
    calm: ['Breaking off to intercept!', 'Flight, follow me in. Weapons free!', "Leaving the orbit. Let's go hunting."],
    tense: ['Engaging! Stay on my wing.', 'Pushing out to intercept, buster!', 'More of them coming. Flight, with me!'],
    panic: ['Everyone with me, now! Engage!', "No time, they're on top of the base! Engaging!", 'Break off and fight! Go, go!']
  },
  rtb: {
    calm: ['Bandits cleared. Rejoining the orbit.', "Fight's over. Heading back to station.", 'Returning to the orbit. Good hunting, everyone.',
      'Area clear. Back to the CAP.', 'Weapons safe. Rejoining station overhead.', 'All bandits accounted for. Taking up the orbit again.',
      'Clean sweep. Back on station.', 'Resuming the patrol. Nice work, flight.', 'Scope is quiet. Flight, rejoin on me, back to station.'],
    tense: ['Winchester on missiles. Coming back to station.', 'That was close. Rejoining the orbit.', 'Fuel is getting low. Rejoining the orbit.',
      'Checking for battle damage on the way back to station.', 'Weapons safe, back to the orbit. Keep your eyes open.',
      'Rejoining. They might come back, stay sharp.', "Back to station. That was a tough one.", 'Flight, rejoin. Count your missiles and check in.'],
    panic: ['We made it. Barely. Returning to station.', 'Low on everything. Heading back to the orbit.', 'Is it really over? Rejoining.',
      'Holes in my wings, but still flying. Rejoining.', "Rejoining the orbit. I'm not sure how we're still alive.", 'Running on fumes. Heading back to the orbit.',
      "It's quiet... too quiet. Rejoining.", "Back to station. I'm not landing until I stop shaking.", 'Flight, check in... Everybody made it? Rejoining.']
  },
  chaseIntro: {
    calm: ["{T} at my twelve, I'm on him!", 'Tally one {T}, engaging!', 'Got him in my sights!', "On his six. He's not getting away."],
    tense: ['{T} dead ahead, going for the kill!', "I'm on his tail! Stay with me!", "He's trying to shake me. No chance!"],
    panic: ["I'm on him, I'm on him!", 'Got one in front of me! Going for it!']
  },
  chaseEscape: {
    calm: ["He's bugging out. Let him go.", 'Lost him. He ran for it.'],
    tense: ["Missed him! He's out of range.", 'He slipped away. Damn it!'],
    panic: ["He got away! He'll be back!", "Can't chase him, too many others!"]
  },
  chasedIntro: {
    calm: ['{T} on my six! Shaking him off.', 'Bandit on my tail, defending.', "He's behind me, breaking left!"],
    tense: ["Bandit on my six! Can't shake him!", 'Break right, break right!', "He's all over me!", "I'm taking fire!"],
    panic: ["I can't shake him!", 'Someone get this guy off me!', "He's right behind me! Help!"]
  },
  saveIntro: {
    calm: ["Hang on, {C}, I'm on him!", 'Moving in, {C}! Keep him busy!'],
    tense: ["I've got him, {C}! Break left!", '{C}, hold on, coming in hot!'],
    panic: ["{C}, hold on! I'm coming!", 'Hang in there, {C}! Almost on him!']
  },
  sixWarning: {
    calm: ['{C}, bandit on your six.', '{C}, check six.'],
    tense: ['{C}, check six! Check six!', "{C}, you've got one on your tail!"],
    panic: ['{C}, BREAK! Bandit on your six!', "{C}, he's right behind you! Break now!"]
  },
  thanks: {
    calm: ['Thanks, I owe you one!', "Good shooting! I'm clear."],
    tense: ["He's off me. Thanks!", 'Close one. Thanks for the save.'],
    panic: ['Thank God! I thought I was done!', 'You saved my life out there!']
  },
  sweep: {
    calm: ['Sweeping through. Eyes open.', 'Passing over the base, no tally.'],
    tense: ['Low and fast over the field, looking for leakers.', 'Sweeping the sector, stay sharp.'],
    panic: ["Sweeping again, there's got to be more!", 'Keep looking! They could be anywhere!']
  },
  fox: {
    calm: ['Fox 2!', 'Fox 3!', 'Missile away!'],
    tense: ['Fox 2, Fox 2!', 'Fox 3! Another one away!'],
    panic: ['Fox 2! Just go down!', 'Missile away! Come on, hit!']
  },
  guns: {
    calm: ['Guns!', 'Guns, guns, guns!'],
    tense: ['Hosing him down!', 'Guns! Eat this!'],
    panic: ["Guns! I'm out of missiles!", 'Shooting everything I have!']
  },
  flares: {
    calm: ['Flares, defending.', 'Popping flares.'],
    tense: ['Missile lock! Countermeasures!', 'Defending, popping flares!'],
    panic: ["Flares, flares! He's got me locked!", 'Missile on me! Dumping everything!']
  },
  heliOut: {
    calm: ['Moving out to hunt ground contacts, bearing {B}.', "Going low. We'll take the armour."],
    tense: ['Heading out, hunting armour to the {D}.', "Rolling out to cover the base's flank."],
    panic: ['Tanks all over the {D}! Moving out!', 'Going low and fast, bearing {B}. Wish us luck!']
  },
  heliAway: {
    calm: ['Engaging a column to the {D}, rockets away!', 'Hellfire hit, target destroyed. {D} sector clear.'],
    tense: ['Two vehicles burning to the {D}. Looking for more.', 'Gun run on a column, {D} of the base.'],
    panic: ['Taking fire from the armour to the {D}, still in the fight!', "There's a whole battalion to the {D}! Rockets away!"]
  },
  armorContact: {
    calm: ['Ground contacts, armour bearing {B}. Gunships, they are yours.', 'Enemy column inbound, bearing {B}.'],
    tense: ['Armour closing from the {D}! Gunships, engage!', 'More vehicles, bearing {B}! Intercept!'],
    panic: ['Tank column from the {D}! Stop them before they reach the wire!', 'Armour everywhere, bearing {B}!']
  },
  armorIntro: {
    calm: ['Tally the column. Engaging.', "Vehicles at twelve o'clock, going hot."],
    tense: ['Armour below, rolling in!', 'Tanks, I see them! Rockets!'],
    panic: ['Tanks right under us! Firing!', "They're heading for the base! Engaging!"]
  },
  armorFire: {
    calm: ['Taking fire from the column.', 'Small arms from the vehicles, jinking.'],
    tense: ["Tracers! They're shooting at us!", 'Triple-A on that column, jinking!'],
    panic: ["We're taking hits from the ground!", 'Heavy fire from below! Hang on!']
  },
  armorKill: {
    calm: ['Vehicle destroyed.', 'Scratch one tank.', 'Target burning.'],
    tense: ['Target burning!', "Good hit, that tank's done!"],
    panic: ["Tank's down! Next one!", 'Got one! More armour coming!']
  },
  cover: {
    calm: ['Covering the base, eyes open.', 'Watching for missiles over the field.'],
    tense: ['Low pass over the field, hunting leakers.', 'Staying close to the base, weapons hot.'],
    panic: ['Staying over the base! Nothing gets through!', 'Covering the flight line, whatever it takes!']
  },
  stinger: {
    calm: ['Stinger away!', 'Taking the shot, Fox 2.'],
    tense: ['Fox 2! Stinger away!', 'Missile away from the helo!'],
    panic: ['Stinger away! Get out of our sky!', 'Fox 2! Take that!']
  },
  missileGun: {
    calm: ['Gun on the missile.', 'Firing on the cruise missile.'],
    tense: ['Gun on the missile!', 'Shooting at the missile!'],
    panic: ['Missile! Shoot it down, shoot it down!', 'Gun on the missile! Come on!']
  },
  hellfire: { calm: ['Hellfire away.', 'Rifle, Hellfire.'], tense: ['Hellfire away!', 'Hellfire, rifle!'], panic: ['Hellfire away! Kill it!'] },
  rockets: { calm: ['Rockets away.', 'Firing rockets.'], tense: ['Rockets away!', 'Rippling rockets!'], panic: ['Rockets! Everything we have!'] },
  doorGuns: { calm: ['Door gunners, engage!', 'Hosing them down from the door.'], tense: ['Door guns, open up!'], panic: ['Shoot, shoot! Door guns!'] },
  casIntro: {
    calm: ['Tally the column. Rolling in, guns.', 'Warthog in hot. Cleared hot on the armour.', 'In from the {D}, guns guns guns.'],
    tense: ['Rolling in on the tanks! Stand by for the gun!', 'Pressing the attack, BRRRT incoming!'],
    panic: ['Rolling in, danger close! Keep your heads down!', 'Going in low, hold on down there!']
  },
  brrt: { calm: ['BRRRRT.', 'Guns!', 'Off safe, firing.'], tense: ['Eat this! BRRRRT!', 'Guns, guns!'], panic: ['BRRRRRT! Burn!', "Gun's hot! Taking them all!"] },
  bombs: { calm: ['Bombs away.', 'Pickle, pickle. Bombs gone.'], tense: ['Bombs away! Off target.'], panic: ['Bombs away! Pulling off!'] },
  gunshipIn: {
    calm: ['On station overhead. Sensors have the column.', 'Setting up a left-hand orbit. Guns ready.', 'Overhead the base. Ground, call your targets.'],
    tense: ['On station, guns hot. We see them.', 'Orbit established. Clearing the perimeter.'],
    panic: ['Overhead! Danger close, keep your heads down!', 'On station! Firing everything we have!']
  },
  gunshipFire: {
    calm: ['Rifle, one-oh-five.', 'Forty mike-mike, on the way.', 'Twenty-five, shot.', 'Splash, target destroyed.'],
    tense: ['One-oh-five on the way!', 'Walking the forty into them!', 'Shot, shot! Next target!'],
    panic: ['Everything on the column! Fire, fire!', 'Danger close! One-oh-five, shot!']
  },
  droneStrike: {
    calm: ['Missile off the rail. Ten seconds.', 'Hellfire away. Impact in five.', 'Target lased. Weapon away.'],
    tense: ['Rifle, rifle. Hellfire away!', 'Weapon away on the lead vehicle!'],
    panic: ['Last Hellfire away!', 'Weapon away, danger close!']
  }
};

/* ---- intercepted enemy transmissions (enemySay in combat.js; red subtitles, ENEMY_NAMES callsigns) ----
   {Q} squadron, {K} the callsign of the one just shot down. The higher the threat, the more desperate they get. */
const ENEMY_LINES = {
  attack: {      // a new wave commits on the base (its lead)
    calm: ['{Q} flight, target in sight. Begin the attack run.', 'Enemy airfield dead ahead. Weapons free, {Q}.', "They haven't seen us yet. {Q}, go in low.",
      '{Q} lead to all: the runway is the priority.'],
    tense: ['{Q}, push through their fighters. The airfield, nothing else!', 'They are waiting for us. Spread out and go in!', 'Second attack, {Q}. Do not turn back this time.'],
    panic: ['All squadrons, everything we have! Destroy that base!', '{Q}, full afterburner! Break through at any cost!', 'Command wants that runway gone tonight. No one turns back!',
      'They cannot stop all of us. Attack, attack!', '{Q}, this is our moment. Follow me in!', 'Last reserves committed. {Q}, make it count!']
  },
  missile: {     // a bandit looses a cruise missile at the base
    calm: ['Missile away. Target: the hangars.', 'Launch! Cruise missile on its way.', 'Weapon released. Breaking off.'],
    tense: ['Missile away! Pray it gets through!', 'Fire! Then get out of here!', "Launch complete. Their guns won't stop this one."],
    panic: ['All missiles away! Overwhelm their defences!', 'Launching everything! One of them will get through!', 'Missile away! For the homeland!', 'Ripple fire! Saturate their guns!']
  },
  salvo: {       // their command, with a missile salvo from beyond the horizon
    calm: ['Launch battery, fire the salvo.', 'Missile brigade, launch on the airfield.'],
    tense: ['All batteries, fire! Saturate their defences!', 'Launch the second salvo. Do not let them breathe.'],
    panic: ['Fire everything! Every launcher, now!', 'Empty the magazines! Flatten that base!', 'All launchers, ripple fire! No holding back!']
  },
  bombRun: {     // a bomber on its run in
    calm: ['Bomb run commencing. Doors open.', 'On the bombing line. Steady... steady.'],
    tense: ['Release point in thirty seconds! Hold course!', 'Their fighters are on us! Keep the course!'],
    panic: ['Drop everything and turn for home!', 'Bombs away! Get us out of here!']
  },
  damaged: {
    calm: ["I'm hit! Still flying.", 'Damage to my left wing. Continuing.'],
    tense: ["I'm hit! Losing fuel!", 'Hydraulics gone! I can barely hold her!'],
    panic: ["I'm burning! I'm burning!", 'Engine fire! I can still make my run!', "Hit! I won't make it home... going for the runway!"]
  },
  lost: {        // a wingman of the one just shot down
    calm: ['{K} is down! Watch their fighters!', 'We lost {K}. Stay in formation.'],
    tense: ['{K}! No! Damn them!', '{K} is gone. Who are these pilots?', "Another one down! They're too good!"],
    panic: ['{K} is down! That is half the squadron!', "We're being slaughtered out here!", "{K}! ...Keep going, don't look back!", "They're cutting us to pieces!"]
  },
  eject: {       // the one shot down, when nobody of his flight is left to say it
    calm: ['Ejecting!', "I'm going down! Ejecting!"],
    tense: ['Mayday, mayday! Ejecting!', "Controls gone! I'm out!"],
    panic: ["I can't get out! I can't...", 'Mayday! Mayday! Tell my family...', 'Eject! Eject! Eject!']
  },
  chasing: {     // a dogfight bandit on one of ours
    calm: ['I have one on my nose. Closing.', 'Target locked. You are mine.'],
    tense: ['Hold still... almost.', "He's good, but I'm better."],
    panic: ['I have him! I have him!', "You won't escape this time!", "You're mine! Nobody's coming to save you!"]
  },
  chased: {      // a dogfight bandit with ours on its tail
    calm: ['Bandit on my six. Evading.', 'Hostile behind me, breaking.'],
    tense: ["I can't shake him!", 'Get him off me! Anyone!'],
    panic: ["He's right behind me! Help!", "I can't lose him! I can't...", 'Somebody, anybody, get him off me!']
  },
  escape: ['Disengaging. You were lucky.', 'Low on fuel, breaking off. Next time.', "I'm clear. Returning to base."],
  armor: {       // an armoured column on the move
    calm: ['Column, advance to the release line.', 'Tanks in position. Begin the assault.', 'Battalion, move up. The airfield is ahead.'],
    tense: ['Helicopters overhead! Gunners, fire at will!', 'Keep moving, use the tree line!', 'Push on to the wire!'],
    panic: ['Ram the fence if you have to! Full speed!', 'Every tank, charge! Ignore the helicopters!', 'Forward! Nobody stops!']
  },
  armorLost: ['{K} is burning!', 'We lost {K}! Keep moving!', '{K} is hit! Crew out!', 'Another tank gone!'],
  heli: {        // enemy attack helicopters
    calm: ['Gunships, stay low. Follow the armour in.', 'Rotary group, engaging the perimeter.'],
    tense: ['Their gunships are up! Break, break!', 'Taking fire! Pop flares!'],
    panic: ['We are being shot to pieces! Stay low!', 'Missile! Missile! Evade!']
  },
  baseHit: {
    calm: ['Direct hit on the airfield!', 'Impact confirmed. Their hangars are burning.'],
    tense: ['Hit! We hit them! Keep up the pressure!', 'Their base is burning! Again!'],
    panic: ['Another hit! They are breaking!', "We've got them now! Finish the runway!", 'Their ramp is on fire! Send everything!']
  },
  withdraw: {    // the music stopped: their command calls the attack off
    calm: ['All units, break off. Regroup at the rally point.', 'Abort the attack. Return to base.'],
    tense: ['Pull back! Too many losses!', 'Withdraw! Regroup and wait for orders.'],
    panic: ['Retreat! Retreat! Get out of there!', 'Break off, all units! We cannot take any more!', 'Fall back! They are slaughtering us!']
  },
  again: {       // ... and it starts again
    calm: ['Second wave, begin your attack.', 'Turn around. We go again.'],
    tense: ['Reinforcements arriving. Attack again!', "Don't let them rest. Go back in!"],
    panic: ['Everyone back in! This ends now!', 'No retreat! Turn around and fight!', 'It was a feint. Now hit them with everything!']
  },
  chatter: {     // background traffic during the fight
    calm: ['Formation, tighten up. Stay below their radar.', 'Their AWACS is watching. Stay low.', 'Fuel check, all flights.', 'Their air cover is thinner than we were told.'],
    tense: ["Their fighters are everywhere. Where's our escort?", 'This was supposed to be easy...', 'Command, we need more aircraft out here!', 'They knew we were coming!'],
    panic: ['Command, we are losing too many! Request permission to withdraw!', 'Command says hold. Hold?! We are being slaughtered!', 'Who are these people? Demons?',
      'Everything in the air, now! This is our last chance!', "I've lost my wingman. I'm alone out here!", 'Their runway is still open! How?!',
      'Jamming is useless! They see everything!', "Don't look at the fires. Fly!"]
  }
};

/* ---- scenes on the ground (js/groundops.js): emergency landings, unloading, paradrops ---- */
LINES.emergency = {
  mayday: ['Mayday, mayday! Engine fire, request immediate landing!', 'Pan-pan, pan-pan, hydraulic failure, request priority landing.', 'Mayday! Fire light on the left engine, coming straight in!',
    'Emergency! Losing oil pressure, landing now.', 'Mayday, mayday! Bird strike, engine damaged, coming home.'],
  tower: ['{C}, runway zero-niner is yours, all traffic hold. Crash crews rolling.', '{C}, copy your mayday. Straight in, cleared to land.', '{C}, emergency vehicles standing by. Cleared to land, any runway exit.'],
  rolling: ['Crash crews, runway zero-niner, go, go!', 'Fire trucks rolling. Runway closed.', 'All traffic, runway closed for an emergency.'],
  foam: ['Foam on the aircraft. Fire is out.', 'Pilot is out and okay. Fire suppressed.', 'Engine fire out. Hot brakes cooling.'],
  tow: ['{C}, tug is hooked up. Runway reopens shortly.', 'Towing {C} clear of the runway.', 'Runway will be open in two minutes. Tug has {C}.']
};
LINES.unload = ['Ramp down. Unloading.', 'Cargo is off. Thanks, ground.', 'Loadmaster says all pallets are clear.', 'Pallets off, ramp coming up.'];
LINES.paradrop = {
  jump: ['Green light! Go, go, go!', 'Jumpers away!', 'Green light, everybody out!', 'Stick away, good canopies.'],
  cargo: ['Load clear of the ramp!', 'Cargo away, chutes open!', 'Drop complete, ramp closing.']
};

/* ---- a restored session (js/persist.js): the HQ is back on the air, a lead answers ({C} = HQ callsign) ---- */
LINES.restore = [
  'Comms restored after heavy interference. All flights, report status.',
  "Signal's back. Sorry for the static, all stations. Resuming operations.",
  'Link is back up. That was some jamming. Everyone still with us?',
  'Radio check, radio check. Interference cleared, datalink restored.',
  'All stations, comms are back. Picking up where we left off.',
  "Static's gone, link restored. Stand by for the picture."
];
LINES.restoreReply = ['Loud and clear, {C}. Still on station.', 'Reading you five by five, {C}. Nothing changed up here.',
  'Good to hear you, {C}. All aircraft accounted for.', '{C}, loud and clear. We never left.'];

/* ---- the 5-second check before combat ---- */
LINES.unknownContacts = [
  'Unidentified contacts on radar, bearing {B}. All stations, stand by.',
  'Radar contact, unknown origin, bearing {B}. Attempting to identify.',
  'Bogeys on the scope, bearing {B}. No IFF response. Stand by.',
  'Unknown aircraft closing from bearing {B}. Identify yourselves!',
  'Multiple unknown contacts, bearing {B}. Stand by for confirmation.'
];
LINES.falseAlarm = [
  'Contacts lost. False alarm — stand down.',
  'Disregard, false alarm. Just a flock of birds.',
  'Contact faded off the scope. False alarm, resume normal operations.',
  'Contacts identified as a friendly airliner. Stand down.',
  'Radar glitch. False alarm, everyone relax.'
];

/* ===== Refuelling passes (js/tanker.js) — {F} the flight, {C} a receiver, {A} the tanker =====
   boom: KC-46 and the fighters (one receiver on the boom); drogue: KC-130 and the helicopters (two hoses at once).
   Passes start only in peace; the combat tiers are for a pass that was already on screen when a fight started. */
const TANKER_LINES = {
  boom: {
    join: {   // tanker, as the pass comes on screen — {C} is the receiver on the boom
      peace: ['{F} flight, {A} on station. {C}, cleared to pre-contact.', '{F} flight, tanker track is steady. {C}, you are up.', '{C}, {A}. Boom is down, cleared contact.', '{C}, stabilized. Cleared to the contact position.'],
      calm: ['{F} flight, gas on station, make it quick. {C}, cleared contact.', '{C}, {A}. Boom is down, take it and get back in the fight.'],
      panic: ['{C}, get in here and take your gas, fast!', "{F} flight, I can't stay out here long! {C}, cleared contact now!"]
    },
    contact: {
      peace: ['{C}, contact.', '{C}, in contact, taking fuel.', 'Contact. Good flow, {A}.'],
      calm: ['{C}, contact! Taking fuel.', '{C} in contact. Fill me up, quick.'],
      panic: ['{C}, contact! Come on, come on!']
    },
    full: {
      peace: ['{C}, topped off. Disconnect.', '{C} full, clearing the boom.', '{C}, disconnect. Thanks for the gas.'],
      calm: ['{C}, topped off. Disconnecting.', '{C} full, breaking away.'],
      panic: ['{C}, enough! Disconnecting!']
    },
    done: {
      peace: ['{F} flight, all topped off. {A} returning to the track.', 'All receivers clear. Boom stowed.', '{F} flight, you are clear. Have a good one.'],
      calm: ['{F} flight, all topped off. Go get them.', '{F} flight, clear of the boom. Back to the fight.'],
      panic: ['{F} flight, that is all I can give, get back in there!']
    },
    doneMore: {
      peace: ['{F} flight, {A} continuing on the track. Next receiver, pre-contact.', 'Boom clear. {A} holding the track for the rest of you.'],
      calm: ['{F} flight, keep it moving. Next one in, quick.'],
      panic: ['Next one, get in here, fast!']
    },
    thanks: {
      peace: ['Thanks for the gas, {A}.', 'Appreciate it, {A}. See you next round.', 'Good tanking, {A}.'],
      calm: ['Thanks, {A}. Back to work.'],
      panic: ['Thanks, {A}! Now get clear!']
    }
  },
  drogue: {
    join: {   // {C} is the helicopter on a hose (a pair takes both)
      peace: ['{F}, {A} on station. Hoses trailing, cleared to the baskets.', '{F}, {A}. Slowing to one-one-zero knots. {C}, cleared in.', '{C}, {A}. Left and right hoses out, cleared contact.'],
      calm: ['{F}, gas on station, make it quick. {C}, cleared in.', '{C}, {A}. Hoses out, take it and go.'],
      panic: ['{C}, plug in fast, we are exposed out here!']
    },
    contact: {
      peace: ['{C}, contact. Taking fuel.', '{C} in the basket. Good flow.', 'Contact. Careful with the rotor, {A}.'],
      calm: ['{C}, contact! Taking fuel.'],
      panic: ['{C}, contact! Hurry!']
    },
    full: {
      peace: ['{C}, topped off. Backing out of the basket.', '{C} full. Clear of the hose.'],
      calm: ['{C}, topped off. Clearing.'],
      panic: ['{C}, enough! Backing out!']
    },
    done: {
      peace: ['{F}, all topped off. {A} reeling in the hoses.', 'Receivers clear. Hoses in.', '{F}, you are clear. Fly safe.'],
      calm: ['{F}, all topped off. Back to the fight.'],
      panic: ['{F}, that is all, go!']
    },
    doneMore: {
      peace: ['{F}, {A} staying on the track. Next one, cleared in.', 'Basket clear. Holding the track for the rest of you.'],
      calm: ['Next one in, quick.'],
      panic: ['Next one, get in here!']
    },
    thanks: {
      peace: ['Thanks for the gas, {A}.', 'Good tanking, {A}. Low and slow, the way we like it.'],
      calm: ['Thanks, {A}. Back to work.'],
      panic: ['Thanks, {A}! Get clear!']
    }
  }
};
