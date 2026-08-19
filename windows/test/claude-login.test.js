const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  ClaudeLoginManager, checkClaudeLogin, extractOfficialURL, findClaudeCommand, hasClaudeCredentials, supportsOfficialLogin
} = require('../src/main/claude-login');

test('accepts only official Claude and Anthropic login URLs', () => {
  assert.equal(extractOfficialURL('Open https://claude.ai/oauth/authorize.'), 'https://claude.ai/oauth/authorize');
  assert.equal(extractOfficialURL('Open https://auth.anthropic.com/login'), 'https://auth.anthropic.com/login');
  assert.equal(extractOfficialURL('Open https://example.com/phishing'), null);
});

test('recognizes Claude CLI versions with auth login support', () => {
  assert.equal(supportsOfficialLogin('claude.exe', () => '2.1.235 (Claude Code)'), true);
  assert.equal(supportsOfficialLogin('claude.exe', () => '2.0.64 (Claude Code)'), false);
});

test('falls back when the installed Claude CLI is too old', () => {
  const fallback = 'C:\\Pulse\\resources\\claude\\claude.exe';
  const command = findClaudeCommand({
    env: { APPDATA: 'C:\\Users\\Test\\AppData\\Roaming' },
    existsSync: () => true,
    where: () => '',
    fallbacks: [fallback],
    runner: (candidate) => candidate === fallback ? '2.1.235' : '2.0.64'
  });
  assert.equal(command, fallback);
});

test('ignores extensionless launchers returned by where.exe', () => {
  const fallback = 'C:\\Pulse\\resources\\claude\\claude.exe';
  const command = findClaudeCommand({
    env: {},
    existsSync: () => true,
    where: () => 'C:\\tools\\claude\r\nC:\\tools\\claude.cmd\r\n',
    fallbacks: [fallback],
    runner: (candidate) => candidate === fallback ? '2.1.235' : '2.0.64'
  });
  assert.equal(command, fallback);
});

test('parses Claude auth status without exposing credentials', () => {
  assert.equal(checkClaudeLogin('claude.exe', () => '{"loggedIn":true,"authMethod":"oauth_token"}'), true);
  assert.equal(checkClaudeLogin('claude.exe', () => '{"loggedIn":false}'), false);
});

test('credential status prefers official environment or credential file', () => {
  assert.equal(hasClaudeCredentials({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'set' }, existsSync: () => false }), true);
  assert.equal(hasClaudeCredentials({ env: {}, existsSync: () => true }), true);
  assert.equal(hasClaudeCredentials({ env: {}, existsSync: () => false, platform: 'linux' }), false);
});

test('streams Claude login and opens its official URL', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  let openedURL;
  const manager = new ClaudeLoginManager({
    findCommand: () => 'claude.exe',
    checkLogin: () => false,
    spawn: () => child,
    openExternal: (url) => { openedURL = url; }
  });
  manager.start('en');
  child.stdout.emit('data', Buffer.from('Open https://claude.ai/oauth/authorize\n'));
  await Promise.resolve();
  assert.equal(openedURL, 'https://claude.ai/oauth/authorize');
  manager.cancel('en');
  assert.equal(manager.publicState().status, 'cancelled');
});
