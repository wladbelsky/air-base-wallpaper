// Every radio line pool: well-formed tiers, no empty / duplicate lines, only known placeholders
const { test, expect } = require('./support/harness');

const PLACEHOLDERS = ['c', 'C', 'T', 'B', 'D', 'N', 'Q', 'K', 'S', 'G', 'P', 'W', 'V', 'F', 'A'];

test('all line pools are well formed', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run((allowed) => {
    const problems = [], tierKeys = new Set([...THREAT_TIERS.map(t => t.key), 'peace']);
    let lists = 0, lines = 0;
    const checkList = (list, where) => {
      lists++;
      if (!list.length) problems.push(`${where}: empty list`);
      const seen = new Set();
      for (const s of list) {
        lines++;
        if (typeof s !== 'string' || !s.trim()) { problems.push(`${where}: empty / non-string line`); continue; }
        if (s !== s.trim() || /\s{2,}/.test(s)) problems.push(`${where}: stray whitespace in "${s}"`);
        if (seen.has(s)) problems.push(`${where}: duplicate "${s}"`); seen.add(s);
        for (const m of s.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(m[1])) problems.push(`${where}: unknown placeholder {${m[1]}} in "${s}"`);
        if ((s.match(/\{/g) || []).length !== (s.match(/\}/g) || []).length) problems.push(`${where}: unbalanced braces in "${s}"`);
      }
    };
    const walk = (o, where) => {
      if (Array.isArray(o)) {
        if (o.length && Array.isArray(o[0])) {   // MISSIONS: [order, done] pairs
          lists++;
          // pilot.unknown: the done text comes with the reveal on arrival (LINES.pilot.reveal), so it is empty here
          const emptyDone = where === 'MISSIONS.pilot.unknown';
          for (const [i, p] of o.entries()) {
            if (p.length !== 2) problems.push(`${where}[${i}]: not an order/done pair`);
            checkList(emptyDone && p[1] === '' ? [p[0]] : p, `${where}[${i}]`);
          }
        } else checkList(o, where);
        return;
      }
      if (!o || typeof o !== 'object') { problems.push(`${where}: not a pool`); return; }
      const keys = Object.keys(o);
      const tiered = keys.length && keys.every(k => tierKeys.has(k)) && keys.every(k => Array.isArray(o[k]));
      if (tiered) { if (!keys.some(k => k !== 'peace') && !keys.includes('peace')) problems.push(`${where}: no tiers`); for (const k of keys) checkList(o[k], `${where}.${k}`); return; }
      for (const k of keys) walk(o[k], `${where}.${k}`);
    };
    const pools = { OPS, OPS_UNARMED, OPS_VOICE, COMBAT, AIRWAR_LINES, ENEMY_LINES, TANKER_LINES, LINES, MISSIONS };
    for (const [n, p] of Object.entries(pools)) walk(p, n);
    // deck-call variants only cover keys the routine set has; unarmed variants are combat-only (no peace)
    for (const k of Object.keys(OPS_UNARMED)) { if (!OPS[k]) problems.push(`OPS_UNARMED.${k} has no OPS.${k}`); if (OPS_UNARMED[k].peace) problems.push(`OPS_UNARMED.${k} has peace lines`); }
    for (const [v, set] of Object.entries(OPS_VOICE)) for (const k of Object.keys(set)) if (!OPS[k]) problems.push(`OPS_VOICE.${v}.${k} has no OPS.${k}`);
    return { problems, lists, lines };
  }, PLACEHOLDERS);
  expect(r.problems).toEqual([]);
  expect(r.lists).toBeGreaterThan(80);
  expect(r.lines).toBeGreaterThan(600);
});

test('every deck call resolves in peace and in each combat tier, for armed and unarmed aircraft', async ({ wp }) => {
  await wp.boot();
  const bad = await wp.run(() => {
    const out = [], armed = AIRCRAFT.find(a => a.spec.armed), unarmed = AIRCRAFT.find(a => !a.spec.armed && !a.spec.tanker), tanker = AIRCRAFT.find(a => a.spec.tanker);
    for (const combat of [false, true]) for (const lvl of [0.1, 0.5, 0.9]) {
      AUD.combat = combat; STRESS.level = lvl;
      for (const k of Object.keys(OPS)) for (const a of [armed, unarmed, tanker]) {
        const [text] = opsLine(k, a);
        if (typeof text !== 'string' || !text || /\{\w+\}/.test(text.replace('{c}', ''))) out.push(`${k} ${a.callsign} combat=${combat} lvl=${lvl}: ${text}`);
      }
    }
    AUD.combat = false;
    return out;
  });
  expect(bad).toEqual([]);
});
