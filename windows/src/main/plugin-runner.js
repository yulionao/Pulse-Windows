const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function expandHome(value) {
  if (typeof value !== 'string') return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function pythonCandidates(resourcesPath, developmentRoot) {
  const embedded = resourcesPath && path.join(resourcesPath, 'python', 'python.exe');
  const development = developmentRoot && path.join(developmentRoot, 'vendor', 'python', 'python.exe');
  return [embedded, development, 'py', 'python3', 'python']
    .filter(Boolean)
    .map((command) => ({ command, prefix: command === 'py' ? ['-3'] : [] }));
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error('PLUGIN_TIMEOUT'));
      }
    }, options.timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        resolve({ code, stdout, stderr });
      }
    });
  });
}

async function findPython(resourcesPath, developmentRoot) {
  for (const candidate of pythonCandidates(resourcesPath, developmentRoot)) {
    if (path.isAbsolute(candidate.command) && !fs.existsSync(candidate.command)) continue;
    try {
      const result = await runProcess(candidate.command, [...candidate.prefix, '--version'], {
        cwd: process.cwd(), timeoutMs: 5000
      });
      if (result.code === 0) return candidate;
    } catch {
      // Try the next interpreter.
    }
  }
  return null;
}

function validateOutput(value) {
  if (!value || typeof value !== 'object') throw new Error('INVALID_OUTPUT');
  if (typeof value.error === 'string' && value.error.trim()) throw new Error(value.error.trim());
  if (!Array.isArray(value.items)) value.items = [];
  if (!value.updatedAt) value.updatedAt = new Date().toISOString();
  return value;
}

async function executePlugin(plugin, language, runtime) {
  const interpreter = await findPython(runtime.resourcesPath, runtime.developmentRoot);
  if (!interpreter) throw new Error(language === 'en'
    ? 'Python runtime is unavailable. Reinstall Pulse or install Python 3.'
    : 'Python 运行环境不可用，请重新安装 Pulse 或安装 Python 3。');

  const scriptPath = expandHome(plugin.executablePath);
  if (!fs.existsSync(scriptPath)) throw new Error(language === 'en' ? 'Plugin script does not exist.' : '插件脚本不存在。');
  const parameterArgs = [];
  for (const [key, rawValue] of Object.entries(plugin.parameterValues || {})) {
    parameterArgs.push('--usageboard-param', `${key}=${expandHome(String(rawValue))}`);
  }
  parameterArgs.push('--usageboard-param', `USAGEBOARD_LANGUAGE=${language}`);
  const result = await runProcess(interpreter.command, [...interpreter.prefix, scriptPath, ...parameterArgs], {
    cwd: path.dirname(scriptPath), timeoutMs: runtime.timeoutMs || 60000
  });
  if (result.code !== 0) {
    const detail = result.stderr.trim().split(/\r?\n/).slice(-3).join('\n');
    throw new Error(detail || `${language === 'en' ? 'Plugin exited with code' : '插件异常退出，代码'} ${result.code}`);
  }
  try {
    return validateOutput(JSON.parse(result.stdout.trim()));
  } catch (error) {
    if (error.message !== 'INVALID_OUTPUT' && error instanceof SyntaxError === false) throw error;
    throw new Error(language === 'en' ? 'Plugin returned invalid JSON.' : '插件返回了无效 JSON。');
  }
}

module.exports = { executePlugin, expandHome, findPython, validateOutput, pythonCandidates };
