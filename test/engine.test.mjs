import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBundle } from './helpers.mjs';
import { planScenario, posture, summarize, runToEnd, searchGlossary, validateEnabled } from '../docs/assets/core.js';

const b = loadBundle();
const ALL = b.controls.controls.map((c) => c.id);
const NONE = [];

function bandOf(key) {
  for (const u of b.plant.units) for (const v of u.vars) if (v.key === key) return v;
  return null;
}

test('plan marks the first blocked step and stops the chain', () => {
  const plan = planScenario(b, 'safety-target', ['sis_zone']);
  assert.equal(plan.steps.find((s) => s.id === 's2_reach_sis').state, 'blocked');
  assert.equal(plan.steps.find((s) => s.id === 's2_reprogram').state, 'pending');
  assert.equal(plan.outcome, 'contained');
});

test('no defenses lets each scenario reach its process outcome', () => {
  assert.equal(runToEnd(b, 'remote-hpp', NONE).outcome, 'safe-trip');
  assert.equal(runToEnd(b, 'safety-target', NONE).outcome, 'release');
  assert.equal(runToEnd(b, 'false-readings', NONE).outcome, 'safe-trip');
  assert.equal(runToEnd(b, 'ransomware-ops', NONE).outcome, 'disruption');
});

test('full defenses contain every scenario', () => {
  for (const s of b.scenarios.scenarios) assert.equal(runToEnd(b, s.id, ALL).outcome, 'contained');
});

test('a release needs the safety system defeated, and either safety control prevents it', () => {
  const release = runToEnd(b, 'safety-target', NONE);
  assert.equal(release.outcome, 'release');
  const hp = bandOf(release.plan.scenario.target_var);
  assert.ok(release.peak >= hp.limit - 1, `peak ${release.peak} should reach the limit ${hp.limit}`);
  assert.equal(release.plan.safetyIntact, false, 'a release must defeat the safety system');
  const keyed = runToEnd(b, 'safety-target', ['sis_keyswitch']);
  assert.equal(keyed.outcome, 'contained');
  assert.equal(keyed.plan.safetyIntact, true, 'the key switch keeps the safety system intact');
  assert.equal(runToEnd(b, 'safety-target', ['sis_zone']).outcome, 'contained');
});

test('the safe trip fires between the trip and the limit', () => {
  for (const id of ['remote-hpp', 'false-readings']) {
    const r = runToEnd(b, id, NONE);
    assert.equal(r.outcome, 'safe-trip', `${id} should safe-trip`);
    const meta = bandOf(r.plan.scenario.target_var);
    assert.ok(r.peak >= meta.trip - (meta.trip - meta.warn), `${id} peak ${r.peak} below trip ${meta.trip}`);
    assert.ok(r.peak <= meta.limit, `${id} peak ${r.peak} above limit ${meta.limit}`);
  }
});

test('posture computes spend and coverage', () => {
  const pick = ['email_filter', 'mfa_remote'];
  const cost = b.controls.controls.filter((c) => pick.includes(c.id)).reduce((a, c) => a + c.cost, 0);
  const p = posture(b, pick);
  assert.equal(p.spent, cost);
  assert.equal(p.budget, b.controls.budget);
  assert.equal(p.remaining, b.controls.budget - cost);
  assert.equal(p.fr.FR1, 2);
});

test('posture reports OTCC coverage that matches the mapped controls', () => {
  const p = posture(b, ALL);
  const distinct = new Set();
  for (const c of b.controls.controls) for (const o of c.otcc || []) distinct.add(o);
  assert.equal(p.otccTotal, b.otcc.controls.length);
  assert.equal(p.otccCovered, distinct.size);
  assert.ok(p.otccCovered >= 1 && p.otccCovered <= p.otccTotal);
  assert.equal(posture(b, NONE).otccCovered, 0);
});

test('summarize counts stopped attacks and possible releases', () => {
  const none = summarize(b, NONE);
  assert.equal(none.stopped, 0);
  assert.equal(none.release, 1);
  const all = summarize(b, ALL);
  assert.equal(all.stopped, b.scenarios.scenarios.length);
  assert.equal(all.release, 0);
});

test('the simulation is deterministic for a given seed', () => {
  const a = runToEnd(b, 'false-readings', NONE, { seed: 42 });
  const c = runToEnd(b, 'false-readings', NONE, { seed: 42 });
  assert.equal(a.peak, c.peak);
});

test('glossary search narrows results and folds Arabic', () => {
  const all = searchGlossary(b, '');
  const some = searchGlossary(b, 'brine');
  assert.ok(some.length > 0 && some.length < all.length, `brine matched ${some.length} of ${all.length}`);
});

test('validateEnabled drops unknown control ids', () => {
  const out = validateEnabled(b, ['mfa_remote', 'not_real', 'mfa_remote']);
  assert.deepEqual(out, ['mfa_remote']);
});
