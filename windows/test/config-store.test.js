const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ConfigStore } = require('../src/main/config-store');

test('installs bundled plugins, creates defaults, and persists cache', (context) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'usageboard-test-'));
  context.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const bundle = path.join(temporaryRoot, 'bundle');
  const userData = path.join(temporaryRoot, 'user');
  fs.mkdirSync(bundle);
  fs.writeFileSync(path.join(bundle, '_common.py'), '# helper', 'utf8');
  fs.writeFileSync(path.join(bundle, 'example-usage-plugin.py'), `# UsageBoardPlugin:
# {"name":"Example","parameters":[{"name":"PERIOD","defaultValue":"7d"}]}
# /UsageBoardPlugin`, 'utf8');

  const store = new ConfigStore(userData, bundle);
  const config = store.load();
  assert.equal(config.plugins.length, 1);
  assert.equal(config.plugins[0].name, 'Example');
  assert.equal(config.plugins[0].enabled, false);
  assert.equal(config.plugins[0].parameterValues.PERIOD, '7d');
  assert.ok(fs.existsSync(path.join(userData, 'plugins', '_common.py')));

  fs.writeFileSync(path.join(bundle, 'example-usage-plugin.py'), `# UsageBoardPlugin:
# {"name":"Example CodePlan","parameters":[{"name":"PERIOD","defaultValue":"7d"}]}
# /UsageBoardPlugin`, 'utf8');
  const upgraded = new ConfigStore(userData, bundle).load();
  assert.equal(upgraded.plugins[0].metadata.name, 'Example CodePlan');
  assert.equal(upgraded.plugins[0].parameterValues.PERIOD, '7d');

  store.saveState(config.plugins[0].stateID, { items: [] });
  assert.deepEqual(store.loadState(config.plugins[0].stateID), { items: [] });
});
