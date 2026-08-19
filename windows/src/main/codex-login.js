const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { execFileSync, spawn } = require('node:child_process');

function stripANSI(value) {
  return String(value).replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');
}

function extractOfficialURL(value) {
  const urls = String(value).match(/https:\/\/[^\s<>"']+/g) || [];
  return urls.map((url) => url.replace(/[),.;]+$/, '')).find((url) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'openai.com' || host.endsWith('.openai.com') || host === 'chatgpt.com' || host.endsWith('.chatgpt.com');
    } catch {
      return false;
    }
  }) || null;
}

function findCodexCommand(options = {}) {
  const exists = options.existsSync || fs.existsSync;
  const environment = options.env || process.env;
  const candidates = [
    environment.CODEX_PATH,
    environment.APPDATA && path.join(environment.APPDATA, 'npm', 'codex.cmd'),
    environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Programs', 'codex', 'codex.exe')
  ].filter(Boolean);
  for (const candidate of candidates) if (exists(candidate)) return candidate;

  try {
    const output = (options.where || execFileSync)('where.exe', ['codex'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    const paths = String(output).split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => entry && exists(entry));
    const discovered = paths.find((entry) => ['.exe', '.cmd', '.bat'].includes(path.extname(entry).toLowerCase())) || paths[0];
    if (discovered) return discovered;
  } catch {
    // Continue to the application-bundled CLI when system discovery fails.
  }
  return (options.fallbacks || []).find((candidate) => candidate && exists(candidate)) || null;
}

class CodexLoginManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.spawn = options.spawn || spawn;
    this.findCommand = options.findCommand || findCodexCommand;
    this.openExternal = options.openExternal || (() => {});
    this.authPath = options.authPath || path.join(os.homedir(), '.codex', 'auth.json');
    this.child = null;
    this.openedURL = null;
    this.state = { status: 'idle', output: '', error: null, loggedIn: fs.existsSync(this.authPath) };
  }

  publicState() {
    return { ...this.state, running: Boolean(this.child) };
  }

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
    const command = this.findCommand();
    if (!command) {
      const error = language === 'en'
        ? 'Codex CLI was not found. Install Codex CLI and try again.'
        : '未找到 Codex CLI，请先安装 Codex CLI 后重试。';
      this.update({ status: 'failed', output: '', error, loggedIn: fs.existsSync(this.authPath) });
      return this.publicState();
    }

    this.openedURL = null;
    this.update({
      status: 'running',
      output: language === 'en' ? 'Starting official Codex device login...\n' : '正在启动 Codex 官方设备登录…\n',
      error: null
    });
    const useShell = ['.cmd', '.bat'].includes(path.extname(command).toLowerCase());
    const child = this.spawn(command, ['login', '--device-auth'], {
      windowsHide: true,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: process.env.HOME || os.homedir(),
        CODEX_MANAGED_PACKAGE_ROOT: path.dirname(command),
        CODEX_MANAGED_BY_NPM: '1',
        NO_COLOR: '1',
        TERM: 'dumb'
      }
    });
    this.child = child;
    child.stdout?.on('data', (chunk) => this.append(chunk));
    child.stderr?.on('data', (chunk) => this.append(chunk));
    child.on('error', (error) => {
      this.child = null;
      this.update({ status: 'failed', error: error.message || String(error), loggedIn: fs.existsSync(this.authPath) });
    });
    child.on('close', (code) => {
      if (this.child !== child) return;
      this.child = null;
      const loggedIn = fs.existsSync(this.authPath);
      if (code === 0 && loggedIn) {
        this.update({
          status: 'success', loggedIn: true, error: null,
          output: `${this.state.output}${language === 'en' ? '\nCodex login completed.' : '\nCodex 登录完成。'}`
        });
      } else {
        this.update({
          status: 'failed', loggedIn,
          error: language === 'en' ? `Codex login exited with code ${code}.` : `Codex 登录进程已退出，代码 ${code}。`
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
        status: 'cancelled',
        error: null,
        output: `${this.state.output}${language === 'en' ? '\nLogin cancelled.' : '\n已取消登录。'}`
      });
    }
    return this.publicState();
  }
}

module.exports = { CodexLoginManager, extractOfficialURL, findCodexCommand, stripANSI };
