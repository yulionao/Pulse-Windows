const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { expandHome, validateOutput, pythonCandidates } = require('../src/main/plugin-runner');

test('expands Unix-style home paths on Windows', () => {
  assert.equal(expandHome('~/data/auth.json'), require('node:path').join(os.homedir(), 'data/auth.json'));
  assert.equal(expandHome('C:\\data\\auth.json'), 'C:\\data\\auth.json');
});

test('normalizes valid plugin output', () => {
  const output = validateOutput({ items: [{ id: 'quota' }] });
  assert.equal(output.items.length, 1);
  assert.ok(output.updatedAt);
});

test('surfaces plugin-declared failures', () => {
  assert.throws(() => validateOutput({ error: 'bad token' }), /bad token/);
});

test('prefers the embedded runtime before system interpreters', () => {
  const candidates = pythonCandidates('C:\\resources', 'C:\\repo\\windows');
  assert.match(candidates[0].command, /resources.*python.*python\.exe/i);
  assert.equal(candidates[2].command, 'py');
  assert.deepEqual(candidates[2].prefix, ['-3']);
});
