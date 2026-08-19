const path = require('node:path');
const fs = require('node:fs');
const {
  app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, nativeTheme, powerMonitor, screen, shell
} = require('electron');
const { ConfigStore } = require('./config-store');
const { executePlugin, findPython } = require('./plugin-runner');
const { CodexLoginManager, findCodexCommand } = require('./codex-login');
const { ClaudeLoginManager, findClaudeCommand, hasClaudeCredentials } = require('./claude-login');

app.setName('Pulse');
app.disableHardwareAcceleration();
nativeTheme.themeSource = process.argv.includes('--capture-dark') ? 'dark' : 'system';

const customUserData = process.argv.find((argument) => argument.startsWith('--usageboard-user-data='))?.split('=').slice(1).join('=');
app.setPath('userData', customUserData
  ? path.resolve(customUserData)
  : path.join(app.getPath('appData'), 'UsageBoard'));
const capturePath = process.argv.find((argument) => argument.startsWith('--capture-ui='))?.split('=').slice(1).join('=');
const captureView = process.argv.includes('--capture-settings') ? 'settings' : 'dashboard';
const capturePluginName = process.argv.find((argument) => argument.startsWith('--capture-plugin='))?.split('=').slice(1).join('=');

let mainWindow;
let tray;
let store;
let configuration;
let isQuitting = false;
let codexLogin;
let claudeLogin;
const snapshots = {};
const dueAt = new Map();
const running = new Map();

const developmentRoot = path.resolve(__dirname, '../..');
const resourcesPath = app.isPackaged ? process.resourcesPath : null;
const bundledPluginsPath = app.isPackaged
  ? path.join(process.resourcesPath, 'BundledPlugins')
  : path.resolve(__dirname, '../../../Resources/BundledPlugins');
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.png')
  : path.resolve(__dirname, '../../../Resources/icon.png');
const bundledCodexPath = app.isPackaged
  ? path.join(process.resourcesPath, 'codex', 'codex.exe')
  : path.resolve(__dirname, '../../node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const bundledClaudePath = app.isPackaged
  ? path.join(process.resourcesPath, 'claude', 'claude.exe')
  : path.resolve(__dirname, '../../node_modules/@anthropic-ai/claude-code/bin/claude.exe');

function statePayload() {
  return {
    configuration,
    snapshots,
    appVersion: app.getVersion(),
    pluginsPath: store?.pluginsPath || '',
    platform: process.platform
  };
}

function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('state:changed', statePayload());
}

function initializeSnapshots() {
  for (const plugin of configuration.plugins) {
    const cached = store.loadState(plugin.stateID);
    snapshots[plugin.stateID] = cached
      ? { state: 'ready', output: cached, cached: true, nextRefreshAt: null, error: null }
      : { state: 'idle', output: null, cached: false, nextRefreshAt: null, error: null };
    dueAt.set(plugin.stateID, Date.now());
  }
}

function missingRequiredParameter(plugin) {
  return (plugin.metadata?.parameters || []).find((parameter) => {
    if (!parameter.required) return false;
    const value = plugin.parameterValues?.[parameter.name] ?? parameter.defaultValue ?? '';
    return String(value).trim() === '';
  });
}

async function refreshPlugin(stateID) {
  const plugin = configuration.plugins.find((entry) => entry.stateID === stateID);
  if (!plugin || !plugin.enabled) return { ok: false };
  if (running.has(stateID)) return running.get(stateID);
  const task = (async () => {
    const previous = snapshots[stateID] || {};
    snapshots[stateID] = { ...previous, state: 'loading', error: null };
    broadcast();
    try {
      const output = await executePlugin(plugin, configuration.language, {
        resourcesPath, developmentRoot, timeoutMs: 60000
      });
      const nextRefreshAt = Date.now() + plugin.refreshIntervalSeconds * 1000;
      snapshots[stateID] = { state: 'ready', output, cached: false, error: null, nextRefreshAt };
      dueAt.set(stateID, nextRefreshAt);
      store.saveState(stateID, output);
      return { ok: true };
    } catch (error) {
      const nextRefreshAt = Date.now() + plugin.refreshIntervalSeconds * 1000;
      snapshots[stateID] = {
        ...previous,
        state: 'failed',
        error: error.message || String(error),
        nextRefreshAt
      };
      dueAt.set(stateID, nextRefreshAt);
      return { ok: false, error: snapshots[stateID].error };
    } finally {
      running.delete(stateID);
      broadcast();
    }
  })();
  running.set(stateID, task);
  return task;
}

async function refreshAll() {
  await Promise.all(configuration.plugins.filter((plugin) => plugin.enabled).map((plugin) => refreshPlugin(plugin.stateID)));
  return { ok: true };
}

function saveConfiguration() {
  store.save(configuration);
  app.setLoginItemSettings({ openAtLogin: Boolean(configuration.launchAtLogin), openAsHidden: true });
  broadcast();
}

function setView(view) {
  if (!mainWindow) return;
  if (view === 'settings') {
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(760, 560);
    mainWindow.setSize(940, 700, true);
    mainWindow.center();
  } else {
    mainWindow.setMinimumSize(420, 560);
    mainWindow.setSize(460, 760, true);
    positionWindowNearTray();
  }
  mainWindow.webContents.send('view:changed', view);
  mainWindow.show();
  mainWindow.focus();
}

function positionWindowNearTray() {
  if (!mainWindow || !tray) return;
  const trayBounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const area = display.workArea;
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  let y = trayBounds.y > area.y + area.height / 2
    ? trayBounds.y - windowBounds.height - 8
    : trayBounds.y + trayBounds.height + 8;
  x = Math.max(area.x + 8, Math.min(x, area.x + area.width - windowBounds.width - 8));
  y = Math.max(area.y + 8, Math.min(y, area.y + area.height - windowBounds.height - 8));
  mainWindow.setPosition(x, y, false);
}

function toggleWindow() {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    positionWindowNearTray();
    mainWindow.show();
    mainWindow.focus();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 760,
    minWidth: 420,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#00000000',
    transparent: true,
    roundedCorners: true,
    hasShadow: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.resolve(__dirname, '../renderer/index.html'));
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 });
  tray = new Tray(image);
  tray.setToolTip('Pulse');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Pulse', click: () => { setView('dashboard'); } },
    { label: '设置', click: () => { setView('settings'); } },
    { type: 'separator' },
    { label: '刷新全部', click: refreshAll },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', toggleWindow);
}

function registerIPC() {
  ipcMain.handle('state:get', () => statePayload());
  ipcMain.handle('refresh:all', refreshAll);
  ipcMain.handle('refresh:plugin', (_event, stateID) => refreshPlugin(stateID));
  ipcMain.handle('config:patch', (_event, patch) => {
    const allowed = ['language', 'overviewDisplayMode', 'chartMode', 'launchAtLogin'];
    for (const key of allowed) if (Object.hasOwn(patch || {}, key)) configuration[key] = patch[key];
    saveConfiguration();
    return statePayload();
  });
  ipcMain.handle('plugin:update', (_event, stateID, patch) => {
    const plugin = configuration.plugins.find((entry) => entry.stateID === stateID);
    if (!plugin) return { ok: false, error: 'Plugin not found' };
    const allowed = ['enabled', 'refreshIntervalSeconds', 'parameterValues'];
    for (const key of allowed) if (Object.hasOwn(patch || {}, key)) plugin[key] = patch[key];
    plugin.refreshIntervalSeconds = Math.max(30, Number(plugin.refreshIntervalSeconds) || 300);
    if (plugin.enabled) {
      const missing = missingRequiredParameter(plugin);
      if (missing) {
        plugin.enabled = false;
        return { ok: false, error: `${missing.label || missing.name} 为必填项` };
      }
    }
    saveConfiguration();
    if (plugin.enabled) {
      dueAt.set(plugin.stateID, Date.now());
      refreshPlugin(plugin.stateID);
    }
    return { ok: true, state: statePayload() };
  });
  ipcMain.handle('python:info', async () => {
    const candidate = await findPython(resourcesPath, developmentRoot);
    return candidate ? { available: true, command: candidate.command } : { available: false };
  });
  ipcMain.handle('codex:login', () => codexLogin.start(configuration.language));
  ipcMain.handle('codex:cancel-login', () => codexLogin.cancel(configuration.language));
  ipcMain.handle('codex:login-status', () => codexLogin.publicState());
  ipcMain.handle('claude:login', () => claudeLogin.start(configuration.language));
  ipcMain.handle('claude:cancel-login', () => claudeLogin.cancel(configuration.language));
  ipcMain.handle('claude:login-status', () => claudeLogin.publicState());
  ipcMain.handle('view:set', (_event, view) => { setView(view); return true; });
  ipcMain.handle('window:hide', () => mainWindow.hide());
  ipcMain.handle('app:quit', () => { isQuitting = true; app.quit(); });
}

function startScheduler() {
  setInterval(() => {
    const now = Date.now();
    for (const plugin of configuration.plugins) {
      if (plugin.enabled && !running.has(plugin.stateID) && now >= (dueAt.get(plugin.stateID) || 0)) {
        refreshPlugin(plugin.stateID);
      }
    }
  }, 1000).unref();
  powerMonitor.on('resume', () => {
    for (const plugin of configuration.plugins) if (plugin.enabled) dueAt.set(plugin.stateID, Date.now());
  });
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    store = new ConfigStore(app.getPath('userData'), bundledPluginsPath);
    configuration = store.load();
    initializeSnapshots();
    codexLogin = new CodexLoginManager({
      findCommand: () => findCodexCommand({ fallbacks: [bundledCodexPath] }),
      openExternal: (url) => shell.openExternal(url)
    });
    codexLogin.on('update', (loginState) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('codex:login-changed', loginState);
      if (loginState.status === 'success') {
        const plugin = configuration.plugins.find((entry) => /codex-usage-plugin\.py$/i.test(entry.executablePath));
        if (plugin?.enabled) refreshPlugin(plugin.stateID);
      }
    });
    claudeLogin = new ClaudeLoginManager({
      findCommand: () => findClaudeCommand({ fallbacks: [bundledClaudePath] }),
      checkLogin: () => hasClaudeCredentials(),
      openExternal: (url) => shell.openExternal(url)
    });
    claudeLogin.on('update', (loginState) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('claude:login-changed', loginState);
      if (loginState.status === 'success') {
        const plugin = configuration.plugins.find((entry) => /claude-usage-plugin\.py$/i.test(entry.executablePath));
        if (plugin?.enabled) refreshPlugin(plugin.stateID);
      }
    });
    registerIPC();
    createWindow();
    createTray();
    startScheduler();
    mainWindow.once('ready-to-show', () => {
      positionWindowNearTray();
      mainWindow.show();
      refreshAll();
      if (capturePath) {
        setView(captureView);
        if (capturePluginName) {
          setTimeout(() => mainWindow.webContents.executeJavaScript(`
            document.querySelector('[data-page="plugins"]')?.click();
            setTimeout(() => [...document.querySelectorAll('[data-action="select-plugin"]')]
              .find((element) => element.textContent.toLowerCase().includes(${JSON.stringify(capturePluginName.toLowerCase())}))?.click(), 120);
          `), 250);
        }
        setTimeout(async () => {
          const image = await mainWindow.capturePage();
          fs.writeFileSync(path.resolve(capturePath), image.toPNG());
          isQuitting = true;
          app.quit();
        }, 1200);
      }
    });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  codexLogin?.cancel(configuration?.language);
  claudeLogin?.cancel(configuration?.language);
});
app.on('window-all-closed', () => {});
