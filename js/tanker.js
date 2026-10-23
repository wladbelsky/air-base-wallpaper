'use strict';
/* ===== Aerial refuelling passes: KC-46 (boom) with a fighter flight, KC-130 (two hoses) with a helicopter pair =====
   Now and then an airborne tanker and its receivers leave the screen and then cross it together, the tanker leading:
     - boom (KC-46, spec.tankKind): one fighter on the boom for the whole pass (picked at random), the rest of the
       flight along on the wings — the ones already topped off on the left, the ones still to go on the right
       (refuelled off-screen);
     - drogue (KC-130): low and slow, a helicopter pair (spec.refuel 'probe') takes both hoses at once.
   Afterwards the receivers' time in the air is reset and they go back to their orbit; the tanker returns to its orbit.
   Peace only: no passes start in combat, and a fight starting while the flight still gathers off-screen calls it off
   (a pass already on screen is flown to the end). The tankers aren't scrambled for a fight; one already up stays up.
   States: tank_out (flying off-screen) → tank_wait (hidden until everyone is there) → tank_pass → tank_back (to the orbit).
   FixedWing / Helicopter.updateState hand an aircraft with a.tank = <event> to TANKER.fly.                         */
Object.assign(STATUS, { tank_out: ['TANKER ▶', 'air'], tank_wait: ['TANKING', 'air'], tank_pass: ['REFUELING', 'air'], tank_back: ['RETURN', 'air'] });
// slots as [gap behind the tanker along the path, side offset (+ = right), height]:
// boom: the receptacle behind the receiver's cockpit under the boom tip; drogue: the probe in the left / right basket
const TANK_SLOTS = {
  boom: { cur: [[4.2, 0, -0.9]], wing: (k, side) => [2.4 + 0.8 * k, side * (4.3 + 2.4 * k), -0.3 - 0.1 * k] },
  drogue: { cur: [[2.96, -1.85, -0.06], [2.96, 1.55, -0.06]], wing: (k, side) => [3.2 + 1.5 * k, side * (4.6 + 2.6 * k), 0.4] }
};
const tankWaiting = a => a.state === 'tank_wait';   // off-screen, ready for the pass
/* who can take fuel from a tanker kind */
const canReceive = (a, kind) => a.spec.refuel === (kind === 'boom' ? 'boom' : 'probe');

const TANKER = registerMissionWorld({
  // first pass 3-5 min after a start / rebuild: the tanker is launched ~90 s before it, not with the first flights
  ev: null, timer: rand(180, 300), miss: 0, next: null,
  reset() { this.ev = null; this.timer = rand(180, 300); this.miss = 0; this.next = null; this.noKindT = 0; },
  update(dt) {
    if (this.ev) { this.tick(this.ev, dt); return; }
    if (combatOn()) return;                                      // peace only: the timer waits out the fight
    if ((this.timer -= dt) > 0) { if (this.timer < 300 && CFG.auto) this.launchTanker(); return; }   // up in time for the pass (tug, taxi and the queue at the hold take a while)
    if (this.start() || ++this.miss > 16) { this.miss = 0; this.timer = rand(240, 420); this.next = null; return; }   // + gathering: every 5-9 min
    this.timer = rand(8, 15);   // nobody ready: look again soon (a down tanker is launched above); after ~3 min give up until the next one, so it can be recovered
  },
  /* the tanker kind of the next pass: one that has a tanker and receivers in the air wing */
  nextKind() {
    if (this.next && AIRCRAFT.some(a => a.spec.tankKind === this.next && !a.retiring)) return this.next;
    if (this.noKindT > T) return null;                            // none in the air wing: looked again every few seconds, not every step
    const kinds = ['boom', 'drogue'].filter(k => AIRCRAFT.some(a => a.spec.tankKind === k && !a.retiring) && AIRCRAFT.some(a => canReceive(a, k) && !a.retiring));
    const up = kinds.length > 1 ? kinds.filter(k => AIRCRAFT.some(a => canReceive(a, k) && a.aloft && !a.retiring)) : kinds;   // rather one whose receivers are up (a drogue pass waits for helicopters)
    if (!kinds.length) this.noKindT = T + 5;
    return this.next = up.length ? pick(up) : kinds.length ? pick(kinds) : null;
  },
  /* a pass is due and no tanker of that kind is up: send one (auto flight ops; runs every step, so no allocations) */
  launchTanker() {
    const kind = this.nextKind(); if (!kind) return;
    let tk = null;
    for (const a of AIRCRAFT) if (a.spec.tankKind === kind) { if (!isDown(a)) return; if (!tk && !a.retiring) tk = a; }   // one is up, launching or landing
    if (tk && flightGroups().get(flightOf(tk)).every(settled)) tk.requestLaunch();
  },

  /* a tanker on station and receivers of one flight in orbit (peace only) */
  start() {
    if (combatOn()) return false;
    const want = this.nextKind(), tankers = AIRCRAFT.filter(a => a.spec.tanker && a.state === 'orbit' && !a.landReq && !a.retiring && !a.tank && a.airT > 20);
    for (const tanker of tankers.sort((a, b) => (b.spec.tankKind === want) - (a.spec.tankKind === want))) {
      const kind = tanker.spec.tankKind, flights = [];
      for (const all of flightGroups().values()) {
        const l = all.filter(a => a.state === 'orbit' && a.airT >= 10 && canReceive(a, kind) && !a.landReq && !a.retiring);
        if (l.length) flights.push(l);
      }
      if (!flights.length) continue;
      const recv = wpick(flights.map(l => ({ l, w: 1 + Math.min(...l.map(a => a.airT)) / 60 }))).l.sort((a, b) => csNum(a) - csNum(b)).slice(0, kind === 'boom' ? 4 : 2);
      // boom: one jet on the boom for the whole pass, picked at random: those before it are done (left wing), those after it wait (right)
      const ev = this.ev = { kind, tanker, recv, all: [tanker, ...recv], t: 0, P: null, cur: kind === 'boom' ? randi(0, recv.length - 1) : 0, intro: false, outro: false,
        F: flightOf(recv[0]) };   // radio: the flight's name
      for (const a of ev.all) { a.tank = ev; a.passDone = false; this.out(a); }
      return true;
    }
    return false;
  },
  out(a) {
    const far = AIRWAR.offscreenFrom(a.mesh.position, a.orbit.alt);
    a.fly(new FlightPath().addDubins(a.mesh.position, headingOf(a.fwd), far.p, far.h, a.spec.turnR), a.v || a.orbit.v, a.spec.speed * 1.2);
    a.state = 'tank_out'; a.t = 0;
  },
  /* everyone is off-screen: one pass edge to edge, the tanker leading */
  board(ev) {
    const n = ev.recv.length, heli = ev.kind === 'drogue', lead = 12 + n * 2.5, P = ev.P = AIRWAR.screenPass(heli ? rand(9, 11) : rand(14, 18), heli ? 26 : 34, lead);
    ev.v = heli ? Math.min(ev.tanker.spec.speed * 0.85, ...ev.recv.map(a => a.spec.speed)) : ev.tanker.spec.speed * 0.85;
    const put = (a, ps, state) => {
      a.fly(P, ev.v, ev.v); a.ps = ps; a.state = state; a.t = 0; a.mesh.visible = true; a.bank = 0;
      a.fwd.copy(P.sample(ps).dir).setY(0).normalize();
    };
    put(ev.tanker, lead, 'tank_pass');
    for (const a of ev.recv) { const s = a.slot = this.slot(ev, a); put(a, lead - s[0], 'tank_pass'); a.pathOff = s[1]; a.pathDy = s[2]; }
  },
  slot(ev, a) {
    const S = TANK_SLOTS[ev.kind], i = ev.recv.indexOf(a);
    if (ev.kind === 'drogue') return S.cur[Math.min(i, 1)];
    return i === ev.cur ? S.cur[0] : i > ev.cur ? S.wing(i - ev.cur - 1, 1) : S.wing(ev.cur - 1 - i, -1);
  },
  inBasket(ev, a) { return ev.kind === 'drogue' || ev.recv.indexOf(a) === ev.cur; },

  /* per aircraft, from updateState */
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
  say(ev, a, key, C, delay) { a.say(radioLine(TANKER_LINES[ev.kind][key], { F: ev.F, A: ev.tanker.callsign, C: C || a.callsign }), { delay: delay || 0, prio: 1, cat: AUD.armed ? 'combat' : 'ops' }); },   // a pass caught by a fight talks as combat traffic
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
    const tk = ev.tanker, rc = ev.recv[ev.cur];
    if (!ev.intro && tk.state === 'tank_pass' && AIRWAR.onScreen(tk.mesh.position, -0.1)) {
      ev.intro = true; this.say(ev, tk, 'join', rc.callsign); this.say(ev, rc, 'contact', null, 2.5);
    }
    if (ev.intro && !ev.outro && tk.state === 'tank_pass' && !AIRWAR.onScreen(tk.mesh.position, 0.05)) {
      const more = ev.kind === 'boom' && ev.cur < ev.recv.length - 1;   // some of the flight still to go (off-screen)
      ev.outro = true; this.say(ev, rc, 'full'); this.say(ev, tk, more ? 'doneMore' : 'done', null, 1.2); if (!more && Math.random() < 0.5) this.say(ev, ev.recv[0], 'thanks', null, 2.5);
    }
    for (const a of ev.all) if (a.tank === ev && !a.passDone) return;
    this.ev = null;
  }
});
