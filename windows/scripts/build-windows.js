const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const targets = process.argv.slice(2);
const pythonExecutable = path.join(projectRoot, 'vendor', 'python', 'python.exe');
const codexExecutable = path.join(
  projectRoot, 'node_modules', '@openai', 'codex-win32-x64',
  'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'
);
const claudeExecutable = path.join(
  projectRoot, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'
);
if (!require('node:fs').existsSync(pythonExecutable)) {
  console.error('Bundled Python is missing. Run `npm run python:prepare` first.');
  process.exit(1);
}
if (!require('node:fs').existsSync(codexExecutable)) {
  console.error('Bundled Codex CLI is missing. Run `npm install` first.');
  process.exit(1);
}
if (!require('node:fs').existsSync(claudeExecutable)) {
  console.error('Bundled Claude CLI is missing. Run `npm install` first.');
  process.exit(1);
}
const result = spawnSync(process.execPath, [
  require.resolve('electron-builder/out/cli/cli.js'),
  '--win',
  ...(targets.length ? targets : ['nsis', 'portable'])
], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ELECTRON_BUILDER_CACHE: path.join(projectRoot, '.cache', 'electron-builder')
  },
  stdio: 'inherit'
});

process.exit(result.status ?? 1);
