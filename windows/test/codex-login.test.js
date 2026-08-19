const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { CodexLoginManager, extractOfficialURL, findCodexCommand, stripANSI } = require('../src/main/codex-login');

test('extracts only official OpenAI login URLs', () => {
  assert.equal(extractOfficialURL('Open https://auth.openai.com/device.'), 'https://auth.openai.com/device');
  assert.equal(extractOfficialURL('Open https://example.com/phishing'), null);
});

test('strips terminal control sequences', () => {
  assert.equal(stripANSI('\u001b[32mSuccess\u001b[0m'), 'Success');
});

test('discovers the npm Codex command before where.exe', () => {
  const command = findCodexCommand({
    env: { APPDATA: 'C:\\Users\\Test\\AppData\\Roaming' },
    existsSync: (candidate) => candidate.endsWith('codex.cmd'),
    where: () => { throw new Error('should not run'); }
  });
  assert.match(command, /npm[\\/]codex\.cmd$/i);
});

test('prefers a Windows executable returned by where.exe', () => {
  const command = findCodexCommand({
    env: {},
    existsSync: () => true,
    where: () => 'C:\\tools\\codex\r\nC:\\tools\\codex.cmd\r\nC:\\tools\\codex.exe\r\n'
  });
  assert.equal(command, 'C:\\tools\\codex.cmd');
});

test('uses bundled Codex when no system command exists', () => {
  const bundled = 'C:\\UsageBoard\\resources\\codex\\codex.exe';
  const command = findCodexCommand({
    env: {},
    existsSync: (candidate) => candidate === bundled,
    where: () => { throw new Error('not installed'); },
    fallbacks: [bundled]
  });
  assert.equal(command, bundled);
});

test('streams device login output and opens the official URL', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  let openedURL;
  const manager = new CodexLoginManager({
    findCommand: () => 'codex.exe',
    spawn: () => child,
    openExternal: (url) => { openedURL = url; },
    authPath: 'Z:\\missing-auth.json'
  });
  manager.start('en');
  child.stdout.emit('data', Buffer.from('Open https://auth.openai.com/device and enter ABCD-EFGH\n'));
  await Promise.resolve();
  assert.equal(openedURL, 'https://auth.openai.com/device');
  assert.match(manager.publicState().output, /ABCD-EFGH/);
  manager.cancel('en');
  assert.equal(manager.publicState().status, 'cancelled');
});
