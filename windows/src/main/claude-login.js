const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { execFileSync, spawn } = require('node:child_process');
const { stripANSI } = require('./codex-login');

function extractOfficialURL(value) {
  const urls = String(value).match(/https:\/\/[^\s<>"']+/g) || [];
  return urls.map((url) => url.replace(/[),.;]+$/, '')).find((url) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return ['claude.ai', 'anthropic.com', 'claude.com'].some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  }) || null;
}

function readClaudeVersion(command, runner = execFileSync) {
  try {
    const output = runner(command, ['--version'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      shell: ['.cmd', '.bat'].includes(path.extname(command).toLowerCase()),
      timeout: 5000
    });
    const match = String(output).match(/(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
  } catch {
    return null;
  }
}

function supportsOfficialLogin(command, runner = execFileSync) {
  const version = readClaudeVersion(command, runner);
  return Boolean(version && (version[0] > 2 || (version[0] === 2 && version[1] >= 1)));
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function findClaudeCommand(options = {}) {
  const exists = options.existsSync || fs.existsSync;
  const environment = options.env || process.env;
  const runner = options.runner || execFileSync;
  const candidates = [
    environment.CLAUDE_PATH,
    environment.APPDATA && path.join(environment.APPDATA, 'npm', 'claude.cmd'),
    environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe')
  ].filter(Boolean);
  try {
    const output = (options.where || execFileSync)('where.exe', ['claude'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    candidates.push(...String(output).split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => {
      return ['.exe', '.cmd', '.bat'].includes(path.extname(entry).toLowerCase());
    }));
  } catch {
    // Continue with known locations and the application-bundled CLI.
  }
  candidates.push(...(options.fallbacks || []));
  const seen = new Set();
  let selected = null;
  let selectedVersion = null;
  for (const candidate of candidates) {
    const normalized = path.resolve(candidate).toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (!exists(candidate)) continue;
    const version = readClaudeVersion(candidate, runner);
    if (!version || !(version[0] > 2 || (version[0] === 2 && version[1] >= 1))) continue;
    if (!selectedVersion || compareVersions(version, selectedVersion) > 0) {
      selected = candidate;
      selectedVersion = version;
    }
  }
  return selected;
}

function checkClaudeLogin(command, runner = execFileSync) {
  if (!command) return false;
  try {
    const output = runner(command, ['auth', 'status', '--json'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      shell: ['.cmd', '.bat'].includes(path.extname(command).toLowerCase()),
      timeout: 8000
    });
    return JSON.parse(String(output)).loggedIn === true;
  } catch {
    return false;
  }
}

function hasClaudeCredentials(options = {}) {
  const exists = options.existsSync || fs.existsSync;
  const environment = options.env || process.env;
  if (String(environment.CLAUDE_CODE_OAUTH_TOKEN || '').trim()) return true;
  const credentialsPath = options.credentialsPath || path.join(require('node:os').homedir(), '.claude', '.credentials.json');
  if (exists(credentialsPath)) return true;
  if ((options.platform || process.platform) !== 'win32') return false;
  try {
    const scriptPath = options.scriptPath || path.join(__dirname, 'claude-credential-status.ps1');
    const output = (options.runner || execFileSync)('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
    ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    return String(output).trim() === 'true';
  } catch {
    return false;
  }
}

class ClaudeLoginManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.spawn = options.spawn || spawn;
    this.findCommand = options.findCommand || findClaudeCommand;
    this.checkLogin = options.checkLogin || checkClaudeLogin;
    this.openExternal = options.openExternal || (() => {});
    this.child = null;
    this.command = this.findCommand();
    this.openedURL = null;
    this.state = { status: 'idle', output: '', error: null, loggedIn: this.checkLogin(this.command) };
  }

  publicState() { return { ...this.state, running: Boolean(this.child) }; }

  update(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('update', this.publicState());
  }

  append(chunk) {
    const text = stripANSI(chunk).replace(/\r/g, '');
    if (!text) return;
    const output = `${this.state.output}${text}`.slice(-12000);
    this.update({ output });
    const url = extractOfficialURL(output);
    if (url && url !== this.openedURL) {
      this.openedURL = url;
      Promise.resolve(this.openExternal(url)).catch(() => {});
    }
  }

  start(language = 'zh-Hans') {
    if (this.child) return this.publicState();
    this.command = this.findCommand();
    if (!this.command) {
      this.update({
        status: 'failed', output: '', loggedIn: false,
        error: language === 'en' ? 'A compatible Claude CLI was not found.' : '未找到支持官方登录的 Claude CLI。'
      });
      return this.publicState();
    }
    this.openedURL = null;
    this.update({
      status: 'running', error: null,
      output: language === 'en' ? 'Starting official Claude sign-in...\n' : '正在启动 Claude 官方登录…\n'
    });
    const child = this.spawn(this.command, ['auth', 'login', '--claudeai'], {
      windowsHide: true,
      shell: ['.cmd', '.bat'].includes(path.extname(this.command).toLowerCase()),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' }
    });
    this.child = child;
    child.stdout?.on('data', (chunk) => this.append(chunk));
    child.stderr?.on('data', (chunk) => this.append(chunk));
    child.on('error', (error) => {
      this.child = null;
      this.update({ status: 'failed', error: error.message || String(error), loggedIn: this.checkLogin(this.command) });
    });
    child.on('close', (code) => {
      if (this.child !== child) return;
      this.child = null;
      const loggedIn = this.checkLogin(this.command);
      if (code === 0 && loggedIn) {
        this.update({
          status: 'success', loggedIn: true, error: null,
          output: `${this.state.output}${language === 'en' ? '\nClaude sign-in completed.' : '\nClaude 登录完成。'}`
        });
      } else {
        this.update({
          status: 'failed', loggedIn,
          error: language === 'en' ? `Claude sign-in exited with code ${code}.` : `Claude 登录进程已退出，代码 ${code}。`
        });
      }
    });
    this.emit('update', this.publicState());
    return this.publicState();
  }

  cancel(language = 'zh-Hans') {
    if (this.child) {
      const child = this.child;
      this.child = null;
      child.kill();
      this.update({
        status: 'cancelled', error: null,
        output: `${this.state.output}${language === 'en' ? '\nSign-in cancelled.' : '\n已取消登录。'}`
      });
    }
    return this.publicState();
  }
}

module.exports = {
  ClaudeLoginManager, checkClaudeLogin, extractOfficialURL, findClaudeCommand, hasClaudeCredentials, supportsOfficialLogin
};
