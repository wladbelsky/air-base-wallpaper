'use strict';
/* ===== Aerial refuelling passes (MQ-25 tanker) =====
   Now and then an airborne tanker and a fighter flight leave the screen and then cross it together: the tanker leads
   with its hose out and one receiver in the basket for the whole pass (picked at random); the rest of the flight flies
   along — the ones already topped off on its left wing, the ones still to go on its right (refuelled off-screen). Afterwards the
   flight's time in the air is reset and it goes back to its orbit; the tanker returns to its orbit.
   Peace only: no passes start in combat, and a fight starting while the flight still gathers off-screen calls it off
   (a pass already on screen is flown to the end). The tanker isn't scrambled for a fight; one already up stays up.
   States: tank_out (flying off-screen) → tank_wait (hidden until everyone is there) → tank_pass → tank_back (to the orbit).
   FixedWing.updateState hands an aircraft with a.tank = <event> to TANKER.fly.                                        */
Object.assign(STATUS, { tank_out: ['TANKER ▶', 'air'], tank_wait: ['TANKING', 'air'], tank_pass: ['REFUELING', 'air'], tank_back: ['RETURN', 'air'] });
// slots as [gap behind the tanker along the path, side offset (+ = right), height]: the basket hangs off the left-wing pod;
// receivers still to go hold on the right wing, the ones done on the left
const TANK_BASKET = [3.2, -0.53, -0.24];
const tankWaiting = a => a.state === 'tank_wait';   // off-screen, ready for the pass
const tankWing = (k, side) => [1.5 + 0.7 * k, side * (2.9 + 2.4 * k), 0.1 + 0.1 * k];

const TANKER = registerMissionWorld({
  // first pass 3-5 min after a start / rebuild: the tanker is launched ~90 s before it, not with the first flights
  ev: null, timer: rand(180, 300), miss: 0,
  reset() { this.ev = null; this.timer = rand(180, 300); this.miss = 0; },
  update(dt) {
    if (this.ev) { this.tick(this.ev, dt); return; }
    if (combatOn()) return;                                      // peace only: the timer waits out the fight
    if ((this.timer -= dt) > 0) { if (this.timer < 90 && CFG.auto) this.launchTanker(); return; }   // up in time for the pass
    if (this.start() || ++this.miss > 8) { this.miss = 0; this.timer = rand(240, 420); return; }   // + gathering: every 5-9 min
    this.timer = rand(8, 15);   // nobody ready: look again soon (a down tanker is launched above); after ~90 s give up until the next one, so it can be recovered
  },
  /* a pass is due and no tanker is up: send one (auto flight ops; runs every step, so no allocations) */
  launchTanker() {
    let tk = null;
    for (const a of AIRCRAFT) if (a.spec.tanker) { if (!isDown(a)) return; if (!tk && !a.retiring) tk = a; }   // one is up, launching or landing
    if (tk && flightGroups().get(flightOf(tk)).every(settled)) tk.requestLaunch();
  },

  /* a tanker on station and armed jets of one flight in orbit (peace only) */
  start() {
    if (combatOn()) return false;
    const tankers = AIRCRAFT.filter(a => a.spec.tanker && a.state === 'orbit' && !a.landReq && !a.retiring && !a.tank && a.airT > 20);
    if (!tankers.length) return false;
    const flights = [];
    for (const all of flightGroups().values()) {
      const l = all.filter(a => a.state === 'orbit' && a.airT >= 10 && a.spec.armed && a instanceof FixedWing && !a.landReq && !a.retiring);
      if (l.length) flights.push(l);
    }
    if (!flights.length) return false;
    const recv = wpick(flights.map(l => ({ l, w: 1 + Math.min(...l.map(a => a.airT)) / 60 }))).l.sort((a, b) => csNum(a) - csNum(b)).slice(0, 4);
    // one jet in the basket for the whole pass, picked at random: those before it are done (left wing), those after it wait (right)
    const tanker = pick(tankers), ev = this.ev = { tanker, recv, all: [tanker, ...recv], t: 0, P: null, cur: randi(0, recv.length - 1), intro: false, outro: false,
      F: flightOf(recv[0]) };   // radio: the flight's name
    for (const a of ev.all) { a.tank = ev; a.passDone = false; this.out(a); }
    return true;
  },
  out(a) {
    const far = AIRWAR.offscreenFrom(a.mesh.position, a.orbit.alt);
    a.fly(new FlightPath().addDubins(a.mesh.position, headingOf(a.fwd), far.p, far.h, a.spec.turnR), a.v || a.orbit.v, a.spec.speed * 1.2);
    a.state = 'tank_out'; a.t = 0;
  },
  /* everyone is off-screen: one pass edge to edge, the tanker leading */
  board(ev) {
    const n = ev.recv.length, lead = 12 + n * 2.5, P = ev.P = AIRWAR.screenPass(rand(14, 18), 34, lead);
    ev.v = ev.tanker.spec.speed * 0.85;
    const put = (a, ps, state) => {
      a.fly(P, ev.v, ev.v); a.ps = ps; a.state = state; a.t = 0; a.mesh.visible = true; a.bank = 0;
      a.fwd.copy(P.sample(ps).dir).setY(0).normalize();
    };
    put(ev.tanker, lead, 'tank_pass');
    for (const a of ev.recv) { const s = a.slot = this.slot(ev, a); put(a, lead - s[0], 'tank_pass'); a.pathOff = s[1]; a.pathDy = s[2]; }
  },
  slot(ev, a) { const i = ev.recv.indexOf(a); return i === ev.cur ? TANK_BASKET : i > ev.cur ? tankWing(i - ev.cur - 1, 1) : tankWing(ev.cur - 1 - i, -1); },

  /* per aircraft, from FixedWing.updateState */
  fly(a, dt) {
    const ev = a.tank;
    switch (a.state) {
      case 'tank_out': a.glow = 0.4; if (a.followPath(dt)) { a.state = 'tank_wait'; a.t = 0; a.mesh.visible = false; } break;
      case 'tank_wait': break;
      case 'tank_pass': this.passStep(a, ev, dt); break;
      case 'tank_back': a.glow = 0.3; if (a.followPath(dt)) { a.state = 'orbit'; a.t = 0; a.tank = null; } break;
      default: a.tank = null;
    }
  },
  passStep(a, ev, dt) {
    const tk = ev.tanker;
    a.glow = 0.45;
    if (a === tk) ev.tkN = ev.n;                             // the tanker has moved this step
    else {
      // receivers hold their slot (fixed for the pass, set in board): their own speed plus a capped correction keeps the gap
      // target: the gap behind where the tanker is after this step (it may update before or after us)
      if (tk.tank === ev && tk.state === 'tank_pass') a.ps += clamp(tk.ps + (ev.tkN === ev.n ? 0 : ev.v * dt) - a.slot[0] - ev.v * dt - a.ps, -2.5 * dt, 2.5 * dt);
    }
    if (a.followPath(dt)) this.finish(a, ev);
  },
  finish(a, ev) {
    a.passDone = true; a.pathOff = a.pathDy = 0;
    if (a === ev.tanker) { this.back(a); return; }
    a.airT = 0;                                              // topped off: a full sortie ahead again
    this.back(a);
  },
  back(a) { a.edgeToOrbit(a.spec.speed * 1.1); a.state = 'tank_back'; a.t = 0; },   // from beyond the edge back to an orbit
  /* called off on the way out (often still on screen): turn back to an orbit from where it is, along its heading */
  turnBack(a) {
    const P = new FlightPath(); a.pickOrbit(true); a.pathToOrbit(P, a.mesh.position.clone(), headingOf(a.fwd), 0.5);
    a.fly(P, a.v || a.orbit.v, a.orbit.v); a.state = 'tank_back'; a.t = 0;
  },
  say(ev, a, pool, C, delay) { a.say(radioLine(pool, { F: ev.F, A: ev.tanker.callsign, C: C || a.callsign }), { delay: delay || 0, prio: 1, cat: AUD.armed ? 'combat' : 'ops' }); },   // a pass caught by a fight talks as combat traffic
  /* someone never got there: everyone goes back */
  abort(ev) {
    for (const a of ev.all) {
      if (a.tank !== ev) continue;
      a.passDone = true;
      if (a.state === 'tank_out') this.turnBack(a); else if (a.state === 'tank_wait') this.back(a);
    }
    this.ev = null;
  },

  /* the event: start the pass once everyone waits off-screen, radio */
  tick(ev, dt) {                                             // after all aircraft have moved this step
    ev.t += dt; ev.n = (ev.n || 0) + 1;
    if (!ev.P) {
      if (combatOn()) this.abort(ev);                       // a fight started while the flight gathered: call it off
      else if (ev.all.every(tankWaiting)) this.board(ev);
      else if (ev.t > 45) this.abort(ev);
      return;
    }
    const tk = ev.tanker, rc = ev.recv[ev.cur], L = TANKER_LINES;
    if (!ev.intro && tk.state === 'tank_pass' && AIRWAR.onScreen(tk.mesh.position, -0.1)) {
      ev.intro = true; this.say(ev, tk, L.join, rc.callsign); this.say(ev, rc, L.contact, null, 2.5);
    }
    if (ev.intro && !ev.outro && tk.state === 'tank_pass' && !AIRWAR.onScreen(tk.mesh.position, 0.05)) {
      const more = ev.cur < ev.recv.length - 1;            // some of the flight still to go (off-screen)
      ev.outro = true; this.say(ev, rc, L.full); this.say(ev, tk, more ? L.doneMore : L.done, null, 1.2); if (!more && Math.random() < 0.5) this.say(ev, ev.recv[0], L.thanks, null, 2.5);
    }
    for (const a of ev.all) if (a.tank === ev && !a.passDone) return;
    this.ev = null;
  }
});
