'use strict';
/* ===== Radio chatter subtitles (Ace Combat style) ===== */
const CALLSIGNS = {
  // Squadron names from Ace Combat 2 / 04 / 5 / Zero / X / 6 / Infinity / 7 / 8 — groups of 4 for jets, 2 for helicopters
  fa18: ['JOKER', 'QUEEN', 'MAGE', 'SPARE', 'STRIDER'],    // Joker / Queen: carrier-based (AC8)
  f14: ['WARDOG', 'SWORDSMAN', 'CROW'],                    // Wardog / Swordsman: flew from the carrier Kestrel (AC5)
  f35: ['GARUDA', 'SCARFACE', 'GRYPHUS', 'OGRE', 'SABER'],
  e2d: ['SKYEYE', 'THUNDERHEAD', 'EAGLE EYE', 'LONG CASTER', 'BANDOG', 'SKY KEEPER', 'DEALER'],
  mq25: ['BARREL', 'PIPELINE', 'GUSHER', 'DERRICK'],     // tankers: oil / fuel words
  mh60: ['SEA GOBLIN', 'OSPREY', 'HALO'],
  ch53: ['ATLAS', 'HERCULES', 'TITAN'],
  ah1: ['VIPER', 'COBRA', 'SWEEPER'],
  cmv22: ['SUNHAWK', 'GREYHOUND', 'PELICAN'],
  flyby: ['REAPER', 'AVALANCHE', 'SOHEI'],   // allied Strangereal aces (AC Infinity / 6)
  ddheli: ['SEAHORSE', 'PETREL']      // one per destroyer, each with its own callsign
};
const RADIO_NAMES = { carrier: 'KESTREL', lso: 'PADDLES', escorts: ['BUCCANEER', 'CUTLASS'] };
const ROLE_COLOR = { pilot: '#8fd3ff', awacs: '#9dffb0', ship: '#ffd27a', heli: '#b8e0ff', ace: '#ff9a7a', enemy: '#ff5a50' };
// intercepted enemy traffic (ENEMY_LINES): attack waves are squadrons, numbered per aircraft; boats; their command.
// Enemy aces of Ace Combat 04 / 5 / 6 / Zero / 7; boats are named after the serpents under Yggdrasil like Grabacr
// and Ofnir; the command after the Belkan flying fortress.
const ENEMY_NAMES = { hq: 'HRESVELGR', squadrons: ['YELLOW', 'SOL', 'GRABACR', 'OFNIR', 'SCHNEE', 'GELB', 'STRIGON', 'ROT', 'GRÜN', 'SILBER', 'ESPADA', 'SORCERER'],
  boats: ['SVAFNIR', 'GOIN', 'MOIN'] };

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
  /* During combat, combat traffic outranks routine flight-deck traffic. */
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
      // urgent calls (prio >= 3: contacts, combat start, vampires, hits) cut a less important line;
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
    // variety: in combat a role silent for VARIETY_T s gets half a step up, so one side (the ships calling every kill
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
    ['unidentified contacts bearing {B}. Intercept and identify.', 'Contacts identified — civilian airliner. Returning.'],
    ['escort the tanker to the northern corridor.', 'Tanker escorted. Coming home.'],
    ['strike package: coastal radar site, grid {G}. Weapons free.', 'Radar site destroyed. RTB.'],
    ['recon run over the island chain, grid {G}.', 'Recon photos in the can. Returning.'],
    ['cover the supply convoy heading {B}.', 'Convoy is safe. Heading home.'],
    ['a bogey was reported near the oil platform, sector {S}. Check it out.', 'Nothing but seagulls out there. RTB.'],
    ['patrol the border line along bearing {B}. Don\'t cross it.', 'Border patrol complete. Returning to the fleet.']
  ],
  awacs: [
    ['relocate on bearing {B} to extend radar coverage.', 'Coverage extended. Back on station.'],
    ['move to sector {S} and relay comms for the strike group.', 'Relay complete. Returning to orbit.'],
    ['shift your track toward bearing {B}. The strike package needs eyes over the coast.', 'Strike package is home safe. Back on my orbit.'],
    ["run a radar sweep of sector {S}. Something keeps popping up on our scope.", 'Sector is clean, just sea clutter. Back on station.']
  ],
  heli_transport: [
    ['resupply run to the frigate at grid {G}.', 'Cargo delivered. Heading back.'],
    ['pilot down at grid {G}. Search and rescue, go!', 'Pilot recovered, alive and well. RTB.'],
    ['ferry personnel to the island outpost.', 'Passengers dropped off. Returning.'],
    ['medevac from the supply ship, bearing {B}.', 'Casualty aboard. Coming home.'],
    ['possible submarine in sector {S}. Start a sonar search.', 'Sector clear, no contacts. RTB.']
  ],
  // ShipMission (missions.js): a ship ahead of the fleet — {V} = 'a container feeder' / 'a fishing trawler' / 'a foreign corvette'
  ship: {
    rescue: [
      ['{V} ahead of the fleet is on fire and dead in the water. Rescue the crew.', 'All crew recovered, {P} souls aboard. Returning to Mother.'],
      ['mayday from {V} dead ahead — fire on board. Get her crew off.', 'Survivors aboard, nobody left behind. Heading home.']
    ],
    inspect: [
      ['{V} ahead of the fleet is not answering the radio. Board and inspect her.', 'Inspection complete, papers in order. Team recovered, RTB.'],
      ['{V} is lying stopped ahead of the fleet. Put a team on her deck and check her out.', 'All clear on board. Team is back with us. Returning.']
    ]
  },
  // PilotMission (missions.js): a crashed jet ahead of the fleet — {T} = 'Hornet' / 'Su-33 Flanker' …; unknown = identified on scene
  pilot: {
    friendly: [
      ['a {T} went down ahead of the fleet. The pilot punched out and is in the water. Go get him.', 'Pilot recovered, cold but in one piece. Returning to Mother.'],
      ['we lost a {T} dead ahead. Beacon in the water, pick up the pilot.', 'Got our pilot. He owes us a drink. RTB.'],
      ['{T} pilot ejected ahead of the fleet. Swimmer up, go!', 'Pilot aboard and talking. Heading home.']
    ],
    enemy: [
      ['an enemy {T} went down ahead of the fleet. The pilot is in a raft. Pick him up, he is a prisoner now.', 'Enemy pilot aboard and under guard. Returning.'],
      ['enemy pilot in the water dead ahead, from a {T}. Fish him out before he drowns.', 'Prisoner aboard. He is not saying much. RTB.'],
      ['a {T} pilot ejected ahead of us. Bring him in, and keep him covered.', 'Enemy pilot secured in the back. Coming home.']
    ],
    unknown: [
      ['unidentified aircraft down ahead of the fleet. Beacon in the water. Find the pilot.', ''],
      ['something went into the sea ahead of us. Possible pilot in the water, go take a look.', ''],
      ['a contact dropped off the scope ahead of the fleet. Check the crash site for survivors.', '']
    ]
  },
  // SlingMission (missions.js): out = take a load from elevator one, in = bring one back to it
  sling: {
    out: [
      ['sling-load the spare parts from elevator one out to the destroyer group, grid {G}.', 'Load delivered. Returning.'],
      ['take the ammunition pallet on elevator one out to the supply ship, bearing {B}.', 'Pallet delivered. Coming home.']
    ],
    in: [
      ['pick up a sling load from the supply ship, bearing {B}, and bring it to elevator one.', 'Inbound with the load for elevator one.'],
      ['the frigate at grid {G} has a container of spares for us. Sling it back to elevator one.', 'Container on the hook. Inbound for elevator one.']
    ]
  },
  heli_attack: [
    ['small boats spotted near the coast, sector {S}. Go take a look.', 'Just fishermen. Returning.'],
    ['escort the transports to the landing zone.', 'Transports delivered safely. Coming home.'],
    ['sweep the coastline, grid {G}.', 'Coastline is clear. RTB.'],
    ['a patrol boat is shadowing the fleet, bearing {B}. Shoo it away.', 'Patrol boat turned back. Returning.']
  ],
  cod: [   // CMV-22B: long carrier-onboard-delivery runs that end with a landing on the carrier
    ['COD run to the shore base: mail, parts and passengers.', 'Inbound from the beach with {P} passengers and {W} pounds of mail and parts.'],
    ['pick up the replacement F135 engine module at the airfield, grid {G}.', 'Engine module in the back, strapped down. Heading home.'],
    ['fly the inspection team over to the supply ship, bearing {B}.', 'Team delivered. Returning to Mother.'],
    ['medevac run to the hospital ship, bearing {B}.', 'Patient handed over. RTB.'],
    ['bring the spare radar module out from the shore base.', 'Got the parts. On our way back.'],
    ['pick up the VIP party at the island airstrip, grid {G}.', 'VIPs aboard. Coming home, smooth ride guaranteed.'],
    ['fresh produce is waiting at the logistics hub, grid {G}. Go get it.', 'Inbound with {W} pounds of groceries. Tell the galley.'],
    ['ferry {P} replacement aircrew out from the naval air station.', 'New aircrew aboard. Coming home.'],
    ['rush the ordnance techs and missile spares to the destroyer group, bearing {B}.', 'Techs and spares delivered. Returning.'],
    ['long-range logistics run to the forward base, grid {G}.', 'Inbound with {W} pounds of cargo for the air wing.'],
    ['collect the mail at the amphibious group, bearing {B}.', 'Mail bags aboard. Morale is inbound.'],
    ['the tanker at grid {G} has parts for our catapult. Go pick them up.', 'Catapult parts aboard. Deck crew, stand by.']
  ]
};
/* replies to a mission order: common lines plus a few per kind; never the same line twice in a row */
/* sling-load hand-over on elevator one (missions.js): deck crew and helicopter; {c} = helicopter callsign */
LINES.sling = {
  liftReady: ['{c}, your load is up on elevator one. Cleared to hook up.', '{c}, load is on the elevator, come and get it.'],
  hooked: ['Load hooked. Lifting.', 'Got the load. Taking it out.', 'Hook-up complete, climbing.'],
  dropClear: ['{c}, elevator one is clear. Set it down.', '{c}, cleared to lower the load onto elevator one.'],
  released: ['Load released. Clear of the deck.', 'Load is down. Pulling away.', 'Released. Thanks, deck.']
};
/* pilot rescue (missions.js): {T} = aircraft type, {C} = the helicopter */
LINES.pilot = {
  arrive: {     // the side was known from the start
    friendly: ["On scene. I see him in the raft, he's waving. Hoist going down.", 'Pilot in the raft, looks okay. Lowering the hoist.', 'Over the {T} wreck now. Swimmer going down.'],
    enemy: ['On scene. Enemy pilot in the raft, hands up. Hoist going down.', 'Got eyes on him. Crew chief, keep him covered.', "Over the {T} wreck. He's not resisting."]
  },
  reveal: {     // unidentified until the helicopter sees the wreck
    friendly: ["On scene. It's a {T}! One of ours! He's waving.", "Visual on the wreck: that's our {T}. Friendly pilot in the raft!", "Good news, it's one of ours. Hoist going down."],
    enemy: ["On scene. That's a {T}! Enemy pilot in the water.", "It's an enemy pilot! Hands up in the raft. Crew chief, weapon ready.", 'Wreck is a {T}. Hostile. Picking him up anyway.']
  },
  ack: {
    friendly: ['{C}, copy. Bring our boy home.', '{C}, good news. Medical will meet you on deck.'],
    enemy: ['{C}, copy. Treat him as a prisoner of war.', '{C}, understood. Security team will meet you on deck.']
  },
  hoisted: {
    friendly: ['Pilot aboard! Welcome back, sir.', "Got him. He's shivering but okay."],
    enemy: ['Enemy pilot aboard. Restrained and secured.', 'Prisoner on board, no weapons on him.']
  }
};
/* ship missions (missions.js): the lead on arrival, and when the first survivor is up */
LINES.ship = {
  onScene: {
    rescue: ["On scene. Swimmer's going down.", 'On scene, survivors on deck. Lowering the hoist.', 'Over the ship now. Starting the hoist.'],
    inspect: ['On scene. Fast-roping the team down.', 'Over her deck now. Team going down the rope.', 'In position. Boarding team, go, go.']
  },
  hoist: ['First survivor up. Going back for the next one.', 'One aboard. Hoist going down again.', 'Got the first one. Keep them coming.']
};
LINES.missionCopy = {
  any: ['Copy, en route.', 'Roger that, on our way.', 'Copy. Heading out now.', 'Understood.', 'Wilco.', "Copy that. We're on it.",
    'Roger. Leaving the pattern.', 'Acknowledged. Moving out.', 'Copy, will report on arrival.', 'On our way. Keep the coffee warm.',
    'Roger, breaking off now.', 'Affirmative, heading out.', 'Copy all. En route.', "Understood. We'll take it from here."],
  fighter: ['Copy, going to burner. On our way.', 'Roger, climbing to angels two-five.', 'Copy. Weapons check complete, heading out.',
    "Flight, on me. Let's go.", 'Copy, fence in. Vectoring now.', 'Roger. Tanker on the way back, right?'],
  awacs: ['Copy, moving the orbit. Picture stays up.', 'Roger, repositioning. Datalink stays live the whole way.', 'Understood. Shifting my track, back on station shortly.'],
  cod: ['Copy, converting to airplane mode. En route.', 'Roger, nacelles forward, on our way.', 'Copy. Loadmaster, secure the ramp.', 'Understood. Mail call in about an hour.',
    'Roger. Long haul, crew, get comfortable.', "Copy. We'll bring back the good coffee this time."],
  heli: ['Copy, nose down, en route.', 'Roger, heading out low and fast.', "Understood, we're on our way. Crew, strap in.", 'Copy. ETA about ten minutes.']
};
let lastMissionCopy = '';
function missionCopy(kind) {
  const pool = LINES.missionCopy.any.concat(LINES.missionCopy[kind.startsWith('heli') ? 'heli' : kind] || []);
  let line; do line = radioLine(pool); while (line === lastMissionCopy);
  return lastMissionCopy = line;
}
/* order / done texts for a MISSIONS key; nested keys use a dot ('sling.out'); extra = more placeholders ({V} …) */
function makeMission(kind, extra) {
  const [order, done] = pick(kind.split('.').reduce((o, k) => o[k], MISSIONS));
  const sectors = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Kilo', 'Sierra'];
  const bearing = bearingWords(rand(0, TAU));
  const vars = Object.assign({ S: pick(sectors), B: bearing, G: `${randi(1, 9)}-${randi(1, 9)}`, P: randi(4, 24), W: (randi(4, 24) * 500).toLocaleString('en-US') }, extra);
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

/* ===== Routine flight-deck calls — peace versions + combat versions by tier (used while music plays).
   The combat versions are for armed aircraft; the AWACS and the tanker have their own voices (OPS_VOICE), unarmed helicopters OPS_UNARMED. ===== */
const OPS = {
  launchClear: {
    peace: ["{c}, you're cleared for launch.", '{c}, catapult is ready. Good luck.', '{c}, wind is on the nose. Cleared to go.',
      '{c}, weight board checked, tension up. Cleared to launch.', '{c}, deck is clear ahead. Launch when ready.', '{c}, the shooter has you. Stand by.',
      '{c}, the cat is yours. Have a good flight.', '{c}, all checks complete. Off you go.', '{c}, good to go. See you on recovery.',
      '{c}, final checks good. Launch at your discretion.'],
    calm: ['{c}, hot deck! Launch, launch, launch!', '{c}, bandits inbound — get airborne now!', "{c}, cat's ready, go! We need you up there!", '{c}, scramble! Scramble!',
      "{c}, tension's up. Go get them!", '{c}, skip the checks, launch now!', "{c}, the fight's waiting. Cleared hot!"],
    panic: ["{c}, launch NOW! They're right on top of us!", "{c}, go, go, go! Deck's under fire!", "{c}, get off this deck before it's too late!",
      "{c}, launch! We can't hold the cat any longer!", '{c}, go now, before the next hit!', '{c}, shoot! Shoot! Get airborne!']
  },
  launchReady: {
    peace: ['Ready.', 'Roger, launching.', "Let's go.", 'Copy. Full power.', 'Controls checked. Ready on the cat.', 'All green. Saluting the shooter.',
      'Ready. Hang on to your coffee.', 'Copy. Military power, ready.'],
    calm: ['Going hot!', 'Copy, launching hot!', 'Master arm on. Go!', 'Roger, scrambling!', 'Ready! Shoot me off!', "Weapons hot. Let's get them!"],
    panic: ['Launching! Get me out there!', 'Going, going!', 'Hang on, here we go!', 'Just fire the cat!', 'Ready, ready, go!']
  },
  airborne: {
    peace: ['airborne.', 'is off the deck.', 'airborne, climbing to angels one-five.', 'wheels up.', 'airborne, climbing out.', 'off the cat. Good shot.',
      'clean and climbing.', 'airborne, switching to departure.'],
    calm: ['airborne, weapons hot!', 'off the deck, heading for the fight!', 'airborne, looking for trade.', 'up and armed. Point me at them.',
      'airborne, burner on, going to the fight!'],
    panic: ['airborne! Engaging immediately!', "I'm up! Where do you need me?!", 'airborne — they are everywhere!', 'off the deck! That was close!']
  },
  approach: {
    peace: ['commencing approach.', 'RTB, requesting landing.', 'low on fuel, coming home.'],
    calm: ['winchester, RTB to rearm.', 'bingo fuel, coming in hot.', 'out of missiles, requesting recovery.', 'need to rearm, coming in.'],
    panic: ["I'm hit, coming in! Clear the deck!", 'winchester and bingo, coming home under fire!', 'battle damage, I need that deck now!']
  },
  callBall: {
    peace: ['{c}, call the ball.'],
    calm: ['{c}, call the ball. Make it quick!', '{c}, call the ball, bandits on your six!'],
    panic: ['{c}, just get it down! Call the ball!', '{c}, ball! Now, now!']
  },
  trap: {
    peace: ['Three-wire. Nice trap.', 'Good pass. Welcome home.', 'Two-wire, fair pass.', 'Four-wire. Try harder next time.', 'OK pass, three-wire.'],
    calm: ['Trapped! Rearm and refuel, fast!', 'Good trap. Ordnance crews, move!', 'On deck. Get that bird turned around!'],
    panic: ['Trapped! Get it below, now!', 'On deck! Hurry, more bandits inbound!', 'Caught a wire! Clear the landing area!']
  },
  heliUp: {
    peace: ['lifting off.', 'airborne, heading out.', 'wheels up.', 'off the deck, departing the pattern.', 'lifting off, nose over.', 'airborne. Thanks, deck.'],
    calm: ['lifting off, guns hot!', 'airborne, rockets armed, moving in!', 'up and armed. Point me at the boats.', 'lifting off, weapons hot, staying low!'],
    panic: ['lifting off under fire! Weapons hot!', "airborne! Rolling in on whatever's closest!"]
  },
  heliCleared: {
    peace: ['{c}, cleared to land.', '{c}, deck is green. Cleared to land.', '{c}, spot is clear, cleared to land.', '{c}, winds are good. Cleared to land.'],
    calm: ['{c}, cleared to land, make it fast!', '{c}, deck is clear, get down quick!'],
    panic: ["{c}, land now, we're under attack!", '{c}, get down, get down!']
  },
  heliDown: {
    peace: ['on deck.', 'touchdown. Shutting down.', 'safe on deck.', 'down and safe. Chocks and chains, please.', 'on deck. Thanks for the spot.'],
    calm: ['on deck, rearm us quick!', 'down. Refuel and we go again.'],
    panic: ['down! That was too close!', 'on deck — we took some hits!']
  }
};
/* per-type deck voices (spec.voice): taken first by opsLine — in peace only where a pool has `peace` */
const OPS_VOICE = {
  awacs: {
    airborne: {
      peace: ['airborne. Radar is up, picture clean.', 'on station. Datalink is up, all flights check in.',
        "airborne and climbing. I'll call the picture from up here.", "on station. Scope is quiet. Let's keep it that way."],
      calm: ['airborne. Picture is hot, multiple groups inbound.', 'on station. Bandits on the scope, stand by for vectors.', 'up and radiating. Hostiles in the air. Weapons free.'],
      panic: ['airborne. Scope is saturated, too many tracks to count!', 'on station. Hostiles everywhere. All flights, engage at will!']
    },
    launchClear: {
      calm: ["{c}, get the radar up there, we're blind without you!", '{c}, cleared to launch. Stay clear of the furball.',
        '{c}, cat is yours. Get on station, fleet needs the picture.', '{c}, launch, then hold well back from the fight.'],
      panic: ['{c}, launch now, we need eyes up there!', "{c}, go! We can't fight blind!", '{c}, get off this deck before the next hit!']
    },
    launchReady: {
      calm: ["Ready. Get us up, radar's warm.", "Copy, launching. We'll stay well back.", 'Ready. Datalink is up, shoot us off.'],
      panic: ['Just shoot us off, the fleet needs the picture!', 'Going! Get us out of here!']
    },
    approach: {
      calm: ['bingo fuel, handing the picture to the ship. RTB.', 'off station, coming in. Ship has the picture.',
        'low on fuel, coming home. Relaunch us fast.', 'fuel state low, recovering. Picture passed to the escorts.'],
      panic: ['coming in with the radar still hot, clear the deck!', "bingo fuel and bandits everywhere, I'm coming in!",
        'coming home, we took some hits! Clear the deck!']
    },
    trap: {
      calm: ['{c} is down. Fuel it and get it back up!', "On deck. Hot refuel, they're blind out there.", 'Good trap. Turn it around, fast!'],
      panic: ['On deck! Refuel and relaunch, we need that radar!', 'Caught a wire! Get it fuelled, now!']
    }
  },
  tanker: {
    airborne: {
      peace: ['airborne. Twelve thousand pounds to give.', 'on station, tanker track established. Basket available.',
        'airborne and climbing. Gas station opens in five.', 'on station. Fighters, check your fuel and come see me.'],
      calm: ['airborne. Gas on station for the fighters.', 'on station. Fuel available, fighters top off and get back in it.',
        'up and on track. Hold well clear, the basket is open.'],
      panic: ['airborne! Fighters, take what you need, fast!', "on station, holding as close as I dare. Come get your gas!"]
    },
    launchClear: {
      calm: ['{c}, get the tanker up, the fighters are running dry!', '{c}, cleared to launch. Keep that track clear of the fight.'],
      panic: ["{c}, launch now! Half the wing is on fumes!", '{c}, go! They need the gas up there!']
    },
    launchReady: {
      calm: ['Ready. Tanks full, send us.', 'Copy, launching. Basket is armed.'],
      panic: ['Shoot us off, the fighters are bingo!', 'Ready, go! Every pound counts!']
    },
    approach: {
      peace: ['give-away fuel spent, RTB.', 'tanks dry, coming home to reload.', 'bingo, recovering.'],
      calm: ['give-away spent, coming in. Turn me around fast.', 'tanks dry, RTB. Fighters, you are on your own for a bit.'],
      panic: ['empty and coming in! Refuel me and launch me again!', 'tanks dry, coming in hot! Clear the deck!']
    },
    trap: {
      calm: ['{c} is down. Fill it up and get it back out!', 'On deck. Hot refuel the tanker, fighters are waiting.'],
      panic: ['Tanker on deck! Fuel it, now!', 'Caught a wire! Fill it and shoot it off again!']
    }
  }
};
/* combat deck calls of unarmed helicopters (only the keys and tiers that differ; peace lines are shared from OPS) */
const OPS_UNARMED = {
  heliUp: {
    calm: ['lifting off, staying low and clear.', 'airborne, keeping out of the fight.', 'up and moving, watch the flak!',
      'airborne, holding outside the threat ring.'],
    panic: ['lifting off under fire, staying low!', 'airborne — that was close!', 'off the deck! Keeping clear!']
  },
  heliDown: {
    calm: ['on deck. Refuel us, we go again.', 'down. Unloading, then back out.', 'on deck. Hot refuel, please.'],
    panic: ['on deck! Get the wounded off!', 'down — that was too close!', 'on deck — we took some hits!']
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
    calm: ['All units, bandits inbound! Weapons free!', 'Multiple bogeys closing on the fleet. Engage!', 'Enemy aircraft approaching. All units, intercept!'],
    tense: ['Here they come again! All units, engage!', 'Another wave inbound! Weapons free!', 'Hostiles back on the scope. Everybody up, weapons free!'],
    panic: ['They just keep coming! Every gun, open fire!', 'Massive enemy wave! Defend the carrier at all costs!', "Scope's full of hostiles! All units, engage, engage!",
      'This is the big one! Everything they have is coming at us!', 'All hands, general quarters! Enemy attack in force!']
  },
  end: {
    calm: ['Airspace is clear. Good work, everyone.', 'No more contacts on radar. Stand down.', 'Enemy has withdrawn. Nice work out there.'],
    tense: ['Contacts gone. That was too close. Stand down.', "They've pulled out. Check your fuel and damage.", 'Scope is clear. Stand down, but stay ready.'],
    panic: ["It's over. They're gone. All stations, report damage.", "Airspace clear. I don't believe it. We held.", 'No more contacts. We made it. Count your people.',
      "They're gone... Stand down. Damage control, keep at it."]
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
    calm: ['New group, four ships, closing on the fleet. Commit.', 'Good kill. Next group is right behind it.', 'Picture update: enemy formation is breaking up. Keep the pressure on.',
      'Hostiles turning toward the carrier. Cut them off.', 'Nice shooting. Stay on your targets.'],
    tense: ['Multiple groups inbound. All flights, weapons free.', 'More hostiles joining the fight. Hold your ground.', 'Vampires in the air! Escorts, stand by.',
      'Leakers getting through. Tighten up around the fleet.'],
    panic: ['Scope is full of hostiles! Hold the line!', 'All flights, defend the carrier. Nothing gets through!', "I've lost count of the tracks. Just keep shooting!",
      'Another wave behind this one! Do not let up!', 'Hostiles from every direction! Pick a target and shoot!', 'They are throwing everything at the carrier. Stop them!',
      "Enemy squadrons regrouping for another run. Don't give them the chance!"]
  },
  ship: {
    calm: ['CIWS engaging!', 'Shells away!', 'Air contact inbound, guns tracking.', 'Splash! Target down.'],
    tense: ['Vampires inbound, brace!', 'CIWS reloading, cover us!', 'Taking fire, returning fire!'],
    panic: ['We are taking heavy fire!', 'Damage control parties to the flight deck!', 'Fires on deck three!', "We can't take much more of this!",
      'All guns, independent fire! Shoot anything that moves!', 'Magazines running low! Make every round count!']
  },
  splash: {
    calm: ['Splash one!', 'Target destroyed.', 'Good kill!', 'Bandit down.', 'Splash, splash!'],
    tense: ["Splash! Who's next?", "Got him! That's another one!", 'Bandit down! More inbound!'],
    panic: ["Splash! But there's more coming!", 'Got one! Still too many!', 'Down! Next one, quick!', "Splash! That one won't hurt the carrier!", 'Got him! Who else wants some?!']
  },
  vampireDown: {
    calm: ['Vampire splashed!', 'Missile intercepted!', 'CIWS kill!', 'Got the vampire!'],
    tense: ['Vampire down! Watch for the next one!', 'Intercepted! That was close.', 'Missile splashed short of the ship!'],
    panic: ['Got it! Got it! Next one!', 'Vampire splashed, another one right behind it!', "Missile down! We can't keep this up!", 'Killed it! Close enough to feel the heat!']
  },
  shipHit: {
    calm: ["We've been hit! Damage control!", 'Missile impact! Fires on deck!', 'Hit, starboard side! Still fighting!'],
    tense: ['Hit amidships! Damage control, go!', "Impact! We're still in the fight!", 'Took a hit aft! Fire teams responding!'],
    panic: ["We're hit again! Fires spreading!", 'Massive damage! Flooding below decks!', "Another hit! We can't take much more!", 'Hull breach! All hands, damage control!',
      "Direct hit! We're still afloat, keep firing!"]
  },
  newBandits: {
    calm: ['New contacts, bearing {B}, {N}! Identified as {T}.', 'Bogeys inbound from the {D}, {N}! Type: {T}.', '{T}, bearing {B}, closing fast!', '{T}s inbound from the {D}, {N}!'],
    tense: ['More bandits, bearing {B}, {N}! Type: {T}.', 'Another group from the {D}, {N}. Identified as {T}.', 'Fresh contacts, bearing {B}, {N}. They keep sending them.'],
    panic: ['New group from the {D}, {N}, and more behind them! Type: {T}!', 'New contacts, bearing {B}, {N}! Will this ever end?!',
      'Bearing {B}, {N}! {T}! Where are they all coming from?!', 'Inbound from the {D}, {N}! Type: {T}! Somebody get on them!',
      'More hostiles, bearing {B}, {N}! The scope is full of them!']
  },
  vampires: {
    calm: ['Vampire, vampire! Bearing {B}!', 'Inbound anti-ship missiles, bearing {B}!', 'Missile launch detected! Vampires inbound!'],
    tense: ['Vampires, bearing {B}! CIWS, stand by!', 'Missile salvo inbound from the {D}! Brace!'],
    panic: ['Multiple vampires, bearing {B}! All ships, brace for impact!', 'Vampires! Vampires! Too many to track!', 'Missile wave from the {D}! Shoot them down!',
      'Salvo inbound, bearing {B}! Everything into the air!']
  },
  vampLaunch: {
    calm: ['Vampire launch! Bandit fired on us!', 'Missile off the rail, inbound!'],
    tense: ['Bandit released a missile! Tracking!', 'Missile launch, close in!'],
    panic: ["He fired! It's coming straight at us!", 'Vampire off the rail, short range!', 'Launch! Launch! Point defense, now!']
  },
  vls: ['Birds away!', 'Standard missile away!', 'Launching SM-2!'],
  flybyIn: { calm: ['Engaging!', 'Beginning attack run.', 'Rolling in, cover me.'], tense: ['Coming in hot!', 'Rolling in, hold on, fleet!'], panic: ['Coming in hot! Hang on down there!'] }
};

/* ---- air combat passes (js/airwar.js): each line matches what is on screen at that moment ----
   {T} enemy type, {C} callsign, {B} bearing, {D} compass direction */
const AIRWAR_LINES = {
  engage: {
    calm: ['Breaking off to intercept!', 'Flight, follow me in. Weapons free!', "Leaving the orbit. Let's go hunting."],
    tense: ['Engaging! Stay on my wing.', 'Pushing out to intercept, buster!', 'More of them coming. Flight, with me!'],
    panic: ['Everyone with me, now! Engage!', "No time, they're on top of the fleet! Engaging!", 'Break off and fight! Go, go!']
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
    calm: ['Sweeping through. Eyes open.', 'Passing over the fleet, no tally.'],
    tense: ['Low and fast over the ships, looking for leakers.', 'Sweeping the sector, stay sharp.'],
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
    calm: ['Moving out to hunt surface contacts, bearing {B}.', "Going low. We'll take the boats."],
    tense: ['Heading out, hunting small boats to the {D}.', "Rolling out to cover the fleet's flank."],
    panic: ['Boats all over the {D}! Moving out!', 'Going low and fast, bearing {B}. Wish us luck!']
  },
  heliAway: {
    calm: ['Engaging small boats to the {D}, rockets away!', 'Hellfire hit, target destroyed. {D} sector clear.'],
    tense: ['Two boats burning to the {D}. Looking for more.', 'Gun run on a patrol craft, {D} of the fleet.'],
    panic: ['Taking fire from the boats to the {D}, still in the fight!', "There's dozens of boats to the {D}! Rockets away!"]
  },
  boatContact: {
    calm: ["Surface contacts, fast attack craft bearing {B}. Gunships, they're yours.", 'Patrol boats inbound, bearing {B}.'],
    tense: ['Small boats closing from the {D}! Gunships, engage!', 'More boats, bearing {B}! Gunships, intercept!'],
    panic: ['Boat swarm from the {D}! Stop them before they reach the ships!', 'Fast attack craft everywhere, bearing {B}!']
  },
  boatsIntro: {
    calm: ['Tally the boats. Engaging.', "Boats at twelve o'clock, going hot."],
    tense: ['Small boats below, rolling in!', 'Fast attack craft, I see them! Rockets!'],
    panic: ['Boats right under us! Firing!', "They're heading for the ships! Engaging!"]
  },
  boatFire: {
    calm: ['Taking fire from the boats.', 'Small arms from the boats, jinking.'],
    tense: ["Tracers! They're shooting at us!", "Boat's got a gun on us, jinking!"],
    panic: ["We're taking hits from the boats!", 'Heavy fire from below! Hang on!']
  },
  boatKill: {
    calm: ['Boat destroyed.', 'Scratch one boat.'],
    tense: ['Target burning!', "Good hit, boat's going down!"],
    panic: ["Boat's down! Next one!", 'Got one! More boats coming!']
  },
  cover: {
    calm: ['Covering the fleet, eyes open.', 'Watching for vampires over the fleet.'],
    tense: ['Low pass over the ships, hunting leakers.', 'Staying close to the fleet, weapons hot.'],
    panic: ['Staying over the ships! Nothing gets through!', 'Covering the carrier, whatever it takes!']
  },
  sidewinder: {
    calm: ['Sidewinder away!', 'Taking the shot, Fox 2.'],
    tense: ['Fox 2! Sidewinder away!', 'Fox 2 from the helo!'],
    panic: ['Sidewinder away! Get off our fleet!', 'Fox 2! Take that!']
  },
  vampGun: {
    calm: ['Gun on the vampire.', 'Firing on the vampire.'],
    tense: ['Gun on the vampire!', 'Shooting at the missile!'],
    panic: ['Vampire! Shoot it down, shoot it down!', 'Gun on the missile! Come on!']
  },
  hellfire: { calm: ['Hellfire away.'], tense: ['Hellfire away!', 'Hellfire, rifle!'], panic: ['Hellfire away! Sink it!'] },
  rockets: { calm: ['Rockets away.', 'Firing rockets.'], tense: ['Rockets away!', 'Rippling rockets!'], panic: ['Rockets! Everything we have!'] }
};

/* ---- intercepted enemy transmissions (enemySay in combat.js; red subtitles, ENEMY_NAMES callsigns) ----
   {Q} squadron, {K} the callsign of the one just shot down. The higher the threat, the more desperate they get. */
const ENEMY_LINES = {
  attack: {      // a new wave commits on the fleet (its lead)
    calm: ['{Q} flight, target in sight. Begin the attack run.', 'Carrier group dead ahead. Weapons free, {Q}.', "They haven't seen us yet. {Q}, go in low.",
      '{Q} lead to all: the carrier is the priority.'],
    tense: ['{Q}, push through their fighters. The carrier, nothing else!', 'They are waiting for us. Spread out and go in!', 'Second attack, {Q}. Do not turn back this time.'],
    panic: ['All squadrons, everything we have! Sink that carrier!', '{Q}, full afterburner! Break through at any cost!', 'Command wants that carrier gone tonight. No one turns back!',
      'They cannot stop all of us. Attack, attack!', '{Q}, this is our moment. Follow me in!', 'Last reserves committed. {Q}, make it count!']
  },
  missile: {     // a bandit looses an anti-ship missile
    calm: ['Missile away. Target: the carrier.', 'Launch! Anti-ship missile on its way.', 'Weapon released. Breaking off.'],
    tense: ['Missile away! Pray it gets through!', 'Fire! Then get out of here!', "Launch complete. Their guns won't stop this one."],
    panic: ['All missiles away! Overwhelm their defenses!', 'Launching everything! One of them will get through!', 'Missile away! For the homeland!', 'Ripple fire! Saturate their guns!']
  },
  salvo: {       // their command, with a vampire salvo from beyond the horizon
    calm: ['Shore battery, fire the salvo.', 'Missile boats, launch on the carrier.'],
    tense: ['All batteries, fire! Saturate their defenses!', 'Launch the second salvo. Do not let them breathe.'],
    panic: ['Fire everything! Every launcher, now!', 'Empty the magazines! Sink that carrier!', 'All launchers, ripple fire! No holding back!']
  },
  damaged: {
    calm: ["I'm hit! Still flying.", 'Damage to my left wing. Continuing.'],
    tense: ["I'm hit! Losing fuel!", 'Hydraulics gone! I can barely hold her!'],
    panic: ["I'm burning! I'm burning!", 'Engine fire! I can still make my run!', "Hit! I won't make it home... going for the carrier!"]
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
    tense: ['Hold still, American... almost.', "He's good, but I'm better."],
    panic: ['I have him! I have him!', "You won't escape this time!", "You're mine! Nobody's coming to save you!"]
  },
  chased: {      // a dogfight bandit with ours on its tail
    calm: ['Bandit on my six. Evading.', 'Hostile behind me, breaking.'],
    tense: ["I can't shake him!", 'Get him off me! Anyone!'],
    panic: ["He's right behind me! Help!", "I can't lose him! I can't...", 'Somebody, anybody, get him off me!']
  },
  escape: ['Disengaging. You were lucky, American.', 'Low on fuel, breaking off. Next time.', "I'm clear. Returning to base."],
  boats: {       // fast attack craft running in during a gunship pass
    calm: ['Boats, full speed. Close on the fleet.', 'Patrol boats in position. Begin the run.'],
    tense: ['Helicopters overhead! Guns, fire at will!', 'Keep going, use the waves for cover!'],
    panic: ['Ram them if you have to! Full speed!', 'Every boat, charge! Ignore the helicopters!', 'Full ahead! Nobody stops!']
  },
  boatLost: ['{K} is burning!', 'We lost {K}! Keep going!', '{K} is sinking! Scatter!'],
  shipHit: {
    calm: ['Direct hit on the carrier!', 'Impact confirmed. Their ship is burning.'],
    tense: ['Hit! We hit them! Keep up the pressure!', 'The carrier is burning! Again!'],
    panic: ['Another hit! They are breaking!', "We've got them now! Finish the carrier!", 'Their deck is on fire! Send everything!']
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
      'Everything in the air, now! This is our last chance!', "I've lost my wingman. I'm alone out here!", 'Their carrier is still afloat! How?!',
      'Jamming is useless! They see everything!', "Don't look at the fires. Fly!"]
  }
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
   Passes start only in peace; the combat tiers are for a pass that was already on screen when a fight started. */
const TANKER_LINES = {
  join: {   // tanker, as the pass comes on screen — {C} is the jet in the basket (one per pass, the rest off-screen)
    peace: ['{F} flight, {A} on station. {C}, cleared to the basket.', '{F} flight, tanker track is steady. {C}, you are up.',
      '{F} flight, {A}. Basket is out, plenty to give. {C}, cleared contact.', '{C}, {A}. Stabilized, cleared to the basket.'],
    calm: ['{F} flight, gas on station, make it quick. {C}, plug in.', '{C}, {A}. Basket is out, take it and get back in the fight.',
      '{F} flight, keep it tight, bandits in the area. {C}, cleared contact.'],
    panic: ['{C}, get in here and take your gas, fast!', "{F} flight, I can't stay out here long! {C}, plug in now!"]
  },
  contact: {   // receiver, in the basket
    peace: ['{C}, contact. Taking fuel.', '{C} in the basket. Good flow.', '{C}, contact. Fuel flowing.'],
    calm: ['{C}, contact! Taking fuel.', '{C} plugged. Fill me up, quick.', '{C}, contact. Hurry it up.'],
    panic: ['{C}, contact! Come on, come on!', "{C}'s in! Give me everything you can!"]
  },
  full: {   // receiver, done
    peace: ['{C}, topped off. Disconnecting.', '{C} full. Clear of the basket.', '{C}, disconnect. Thanks for the gas.'],
    calm: ['{C}, topped off. Disconnecting.', '{C} full, breaking away.'],
    panic: ['{C}, enough! Disconnecting!', '{C} has enough, breaking off!']
  },
  done: {   // tanker, leaving the screen — the whole flight is full
    peace: ['{F} flight, all topped off. {A} returning to station.', 'All receivers clear. {A} back to the track.', '{F} flight, you are clear. Have a good one.'],
    calm: ['{F} flight, all topped off. Go get them.', '{F} flight, clear of the basket. Back to the fight.'],
    panic: ['{F} flight, that is all I can give, get back in there!', '{F} flight, go! {A} is pulling out!']
  },
  doneMore: {   // tanker, leaving the screen — some of the flight still to go (they refuel off-screen)
    peace: ['{F} flight, {A} continuing on the track. Next receiver, stand by.', 'Basket clear. {A} holding the track for the rest of you.',
      '{F} flight, stay with me until everyone is full.'],
    calm: ['{F} flight, keep it moving. Next one in, quick.', 'Basket clear. Next receiver, plug in and get back in the fight.'],
    panic: ['Next one, get in here, fast!', "{F} flight, hurry up, I can't hold this track forever!"]
  },
  thanks: {   // the lead receiver, at the end
    peace: ['Thanks for the gas, {A}.', 'Appreciate it, {A}. See you next round.', 'Good tanking, {A}.'],
    calm: ['Thanks, {A}. Back to work.', 'Thanks for the gas, {A}. Going back in.'],
    panic: ['Thanks, {A}! Now get clear!', 'Owe you one, {A}!']
  }
};
