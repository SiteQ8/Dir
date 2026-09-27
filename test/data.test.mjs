import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBundle } from './helpers.mjs';

const b = loadBundle();

test('schema and project identity', () => {
  assert.equal(b.schema, 'dir/1');
  assert.equal(b.project.repo, 'Dir');
  assert.equal(b.project.slug, 'dir');
  assert.equal(b.project.domain, 'dir.3li.info');
  assert.equal(b.project.owner, 'SiteQ8');
  assert.equal(b.project.author, 'Ali AlEnezi');
});

test('the collections have the expected sizes', () => {
  assert.equal(b.plant.units.length, 6);
  assert.equal(b.controls.controls.length, 15);
  assert.equal(b.scenarios.scenarios.length, 4);
  assert.equal(b.glossary.terms.length, 22);
  assert.equal(b.zones.purdue.length, 6);
  assert.equal(b.zones.foundational.length, 7);
});

test('ids are unique across each collection', () => {
  const uniq = (arr, key) => {
    const ids = arr.map((x) => x[key]);
    assert.equal(new Set(ids).size, ids.length, `duplicate ${key}`);
  };
  uniq(b.plant.units, 'id');
  uniq(b.controls.controls, 'id');
  uniq(b.scenarios.scenarios, 'id');
  uniq(b.glossary.terms, 'id');
  uniq(b.zones.purdue, 'id');
  uniq(b.ir.phases, 'id');
  uniq(b.sources.sources, 'id');
  uniq(b.otcc.domains, 'id');
  uniq(b.otcc.subdomains, 'id');
  uniq(b.otcc.controls, 'id');
});

test('the OTCC reference matches the published structure', () => {
  assert.equal(b.otcc.domains.length, 4);
  assert.equal(b.otcc.subdomains.length, 23);
  assert.equal(b.otcc.controls.length, 47);
  const domains = new Set(b.otcc.domains.map((d) => d.id));
  const subs = new Set(b.otcc.subdomains.map((s) => s.id));
  for (const s of b.otcc.subdomains) assert.ok(domains.has(s.domain), `subdomain ${s.id} bad domain ${s.domain}`);
  for (const c of b.otcc.controls) assert.ok(subs.has(c.subdomain), `control ${c.id} bad subdomain ${c.subdomain}`);
});

test('every defense maps to real OTCC controls', () => {
  const otcc = new Set(b.otcc.controls.map((c) => c.id));
  let mapped = 0;
  for (const c of b.controls.controls) {
    assert.ok(Array.isArray(c.otcc) && c.otcc.length >= 1, `control ${c.id} has no OTCC mapping`);
    for (const id of c.otcc) { assert.ok(otcc.has(id), `control ${c.id} references missing OTCC control ${id}`); mapped += 1; }
  }
  assert.ok(mapped >= 15, 'too few OTCC mappings');
});

test('the budget forces real tradeoffs', () => {
  const total = b.controls.controls.reduce((a, c) => a + c.cost, 0);
  assert.ok(b.controls.budget > 0, 'no budget');
  assert.ok(total > b.controls.budget, `budget ${b.controls.budget} should be below the total cost ${total}`);
});

test('every control references real steps, levels and requirements', () => {
  const steps = new Set();
  for (const s of b.scenarios.scenarios) for (const st of s.steps) steps.add(st.id);
  for (const c of b.controls.controls) {
    for (const id of [...c.blocks, ...c.detects]) assert.ok(steps.has(id), `control ${c.id} references missing step ${id}`);
    assert.ok(b.zones.purdue.some((z) => z.id === c.level), `control ${c.id} bad level ${c.level}`);
    assert.ok(b.zones.foundational.some((f) => f.id === c.fr), `control ${c.id} bad fr ${c.fr}`);
  }
});

test('every scenario is well formed', () => {
  const controls = new Set(b.controls.controls.map((c) => c.id));
  for (const s of b.scenarios.scenarios) {
    const ids = s.steps.map((x) => x.id);
    assert.ok(s.critical_step && ids.includes(s.critical_step), `${s.id} missing critical step`);
    if (s.safety_step) assert.ok(ids.includes(s.safety_step), `${s.id} missing safety step`);
    if (s.target_var) assert.ok(b.plant.units.some((u) => u.vars.some((v) => v.key === s.target_var)), `${s.id} bad target var`);
    for (const st of s.steps) {
      assert.ok(st.technique && /^T\d{4}$/.test(st.technique.id), `${st.id} bad technique id`);
      for (const id of [...(st.blocked_by || []), ...(st.detected_by || [])]) assert.ok(controls.has(id), `${st.id} references missing control ${id}`);
    }
    for (const ph of b.ir.phases) assert.ok(s.playbook[ph.id], `${s.id} playbook missing ${ph.id}`);
  }
});

test('the safety system guards variables that exist', () => {
  for (const key of b.plant.sis.guards) {
    assert.ok(b.plant.units.some((u) => u.vars.some((v) => v.key === key)), `sis guards missing var ${key}`);
  }
});

test('variable bands are ordered', () => {
  for (const u of b.plant.units) {
    for (const v of u.vars) {
      assert.ok(v.min <= v.normal, `${v.key} min above normal`);
      assert.ok(v.normal < v.warn, `${v.key} normal above warn`);
      assert.ok(v.warn < v.trip, `${v.key} warn above trip`);
      assert.ok(v.trip < v.limit, `${v.key} trip above limit`);
    }
  }
});

test('at least one scenario can end in a release and at least one cannot', () => {
  const withSafety = b.scenarios.scenarios.filter((s) => s.safety_step);
  assert.ok(withSafety.length >= 1, 'no safety-targeting scenario');
  const withoutTarget = b.scenarios.scenarios.filter((s) => s.target_var === null);
  assert.ok(withoutTarget.length >= 1, 'no non-process scenario');
});
