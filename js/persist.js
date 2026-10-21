'use strict';
/* ===== Air wing state between sessions (browser reloads, Wallpaper Engine restarts) =====
   Remembers who is in the air and who is away on a mission — not positions — and the threat level (STRESS). On the next start buildAirWing()
   calls PERSIST.restore(): aircraft that were up go straight into an orbit, mission flights are put back out of
   sight already away (Mission.resume). localStorage (WE keeps it per wallpaper); off with CFG.saveState.
   A new airborne aircraft state must be added to AIR_STATES (or start with cbt_) to be remembered. */
const AIR_STATES = new Set(['orbit', 'climb', 'depart', 'approach', 'final', 'ret', 'tank_out', 'tank_wait', 'tank_pass', 'tank_back']);
const PERSIST = {
  KEY: 'fab.airwing.v1', timer: 10, announced: false, stressBack: false, last: null,   // last: the JSON last written
  state(a) { return a.mission ? 'mission' : AIR_STATES.has(a.state) || a.inCombat ? 'air' : null; },
  save() {
    if (!CFG.saveState || !ready) return;
    const air = [];
    for (const a of AIRCRAFT) { const s = this.state(a); if (s && !a.retiring) air.push({ key: a.spec.key, cs: a.callsign, host: SHIPS.indexOf(a.host), mission: s === 'mission' }); }
    // stress in 0.05 steps: a change is written about every 10-30 s while it builds or eases, then not at all
    const json = JSON.stringify({ v: 1, air, stress: Math.round(STRESS.level * 20) / 20 }); if (json === this.last) return;   // only when something changed
    try { localStorage.setItem(this.KEY, json); this.last = json; } catch (e) {}
  },
  clear() { this.last = null; try { localStorage.removeItem(this.KEY); } catch (e) {} },
  update(dt) { if ((this.timer -= dt) <= 0) { this.timer = 10; this.save(); } },
  load() {
    try { const d = JSON.parse(localStorage.getItem(this.KEY) || 'null'); return d && d.v === 1 && Array.isArray(d.air) ? d : null; } catch (e) { return null; }
  },
  /* after a fresh build: put back the aircraft that were up / away; true if any was */
  restore() {
    const d = CFG.saveState && this.load(); if (!d) return false;
    if (!this.stressBack && typeof d.stress === 'number') { this.stressBack = true; STRESS.level = clamp(d.stress, 0, 1); }   // once per page load
    const find = e => AIRCRAFT.find(a => a.spec.key === e.key && a.callsign === e.cs && SHIPS.indexOf(a.host) === e.host);
    const air = [], away = new Map();
    for (const e of d.air) {
      const a = find(e); if (!a) continue;                   // counts changed since: no such aircraft any more
      if (e.mission) { const f = flightOf(a) + '|' + e.host; (away.get(f) || away.set(f, []).get(f)).push(a); }
      else air.push(a);
    }
    for (const a of air) this.toOrbit(a);
    for (const flight of away.values()) {
      flight.sort((a, b) => csNum(a) - csNum(b));
      const lead = flight[0], T0 = lead.spec.missions ? MISSION_TYPES[lead.spec.missions[0]] || Mission : Mission;
      const size = AIRCRAFT.filter(a => flightOf(a) === flightOf(lead) && a.host === lead.host).length;
      for (const a of flight) this.leaveDeck(a);
      new T0(flight, size).resume();
    }
    const n = air.length + away.size; if (!n) return false;
    if (!this.announced) {                                   // "comms back after the interference", once per page load
      this.announced = true;
      const [who, role] = hq(), at = Math.max(0.5, 3.8 - T), others = air.filter(a => a.callsign !== who);   // not the HQ itself
      const reply = others.find(a => csNum(a) <= 1) || others[0];
      RADIO.say(who, radioLine(LINES.restore), { role, prio: 2, delay: at });
      if (reply) reply.say(radioLine(LINES.restoreReply, { C: who }), { prio: 1, delay: at + 0.6 });
    }
    return true;
  },
  /* off the deck / out of the hangar: free what it held there and open the folds */
  leaveDeck(a) {
    if (a instanceof FixedWing && a.spot) { if (a.spot.occ === a) a.spot.occ = null; a.spot = null; }   // jets pick a spot on landing
    a.mesh.visible = true; a.fold = 0; a.model.setFold(0); a.t = 0;
    if (a instanceof Helicopter) { a.rotor = 1; a.searchlights[0].enabled = 1; }
  },
  toOrbit(a) {
    this.leaveDeck(a);
    a.pickOrbit(true); a.theta = rand(0, TAU); a.orbitPos(a.theta, a.mesh.position);
    a.state = 'orbit'; a.v = a.orbit.v; a.airT = rand(20, 80); a.orbitStep(0);
  }
};
// save on the way out too (closing / reloading the tab, WE unloading or hiding the wallpaper)
addEventListener('pagehide', () => PERSIST.save());
document.addEventListener('visibilitychange', () => { if (document.hidden) PERSIST.save(); });
