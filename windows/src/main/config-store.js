const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseMetadataFile } = require('./metadata');

const CONFIG_VERSION = 1;

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function defaultParameterValues(metadata) {
  return Object.fromEntries((metadata?.parameters || [])
    .filter((parameter) => parameter.defaultValue !== undefined)
    .map((parameter) => [parameter.name, String(parameter.defaultValue)]));
}

function pluginName(filePath, metadata) {
  return metadata?.name || path.basename(filePath, path.extname(filePath))
    .replace(/-usage-plugin$/i, '')
    .replace(/(^|[-_])([a-z])/g, (_, space, letter) => `${space ? ' ' : ''}${letter.toUpperCase()}`);
}

class ConfigStore {
  constructor(userDataPath, bundledPluginsPath) {
    this.rootPath = userDataPath;
    this.pluginsPath = path.join(userDataPath, 'plugins');
    this.statesPath = path.join(userDataPath, 'states');
    this.configPath = path.join(userDataPath, 'config.json');
    this.bundledPluginsPath = bundledPluginsPath;
  }

  prepare() {
    fs.mkdirSync(this.pluginsPath, { recursive: true });
    fs.mkdirSync(this.statesPath, { recursive: true });
    this.installBundledPlugins();
  }

  installBundledPlugins() {
    if (!fs.existsSync(this.bundledPluginsPath)) return;
    for (const entry of fs.readdirSync(this.bundledPluginsPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.py')) continue;
      const source = path.join(this.bundledPluginsPath, entry.name);
      const destination = path.join(this.pluginsPath, entry.name);
      if (!fs.existsSync(destination) || fs.readFileSync(source).compare(fs.readFileSync(destination)) !== 0) {
        fs.copyFileSync(source, destination);
      }
    }
  }

  discoverPlugins() {
    return fs.readdirSync(this.pluginsPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('_') && entry.name.endsWith('.py'))
      .map((entry) => {
        const executablePath = path.join(this.pluginsPath, entry.name);
        const metadata = parseMetadataFile(executablePath);
        return {
          stateID: `bundled-${entry.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
          name: pluginName(executablePath, metadata),
          enabled: false,
          executablePath,
          refreshIntervalSeconds: 300,
          metadata,
          parameterValues: defaultParameterValues(metadata)
        };
      });
  }

  load() {
    this.prepare();
    let config;
    try {
      config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch {
      config = null;
    }
    const defaults = {
      schemaVersion: CONFIG_VERSION,
      language: 'zh-Hans',
      overviewDisplayMode: 'grouped',
      chartMode: 'line',
      launchAtLogin: false,
      plugins: []
    };
    config = { ...defaults, ...(config || {}) };
    config.plugins = Array.isArray(config.plugins) ? config.plugins : [];

    const knownPaths = new Set(config.plugins
      .filter((plugin) => typeof plugin?.executablePath === 'string' && plugin.executablePath)
      .map((plugin) => path.resolve(plugin.executablePath).toLowerCase()));
    for (const discovered of this.discoverPlugins()) {
      if (!knownPaths.has(path.resolve(discovered.executablePath).toLowerCase())) config.plugins.push(discovered);
    }
    config.plugins = config.plugins.map((plugin) => ({
      stateID: plugin.stateID || crypto.randomUUID(),
      name: plugin.name || 'Untitled',
      enabled: Boolean(plugin.enabled),
      executablePath: plugin.executablePath || '',
      refreshIntervalSeconds: Math.max(30, Number(plugin.refreshIntervalSeconds) || 300),
      metadata: parseMetadataFile(plugin.executablePath) || plugin.metadata,
      parameterValues: plugin.parameterValues && typeof plugin.parameterValues === 'object' ? plugin.parameterValues : {}
    }));
    this.save(config);
    return config;
  }

  save(config) {
    atomicWrite(this.configPath, config);
  }

  stateFile(stateID) {
    return path.join(this.statesPath, `${stateID.replace(/[^a-z0-9_-]/gi, '_')}.json`);
  }

  loadState(stateID) {
    try {
      return JSON.parse(fs.readFileSync(this.stateFile(stateID), 'utf8'));
    } catch {
      return null;
    }
  }

  saveState(stateID, output) {
    atomicWrite(this.stateFile(stateID), output);
  }
}

module.exports = { ConfigStore, atomicWrite, defaultParameterValues, pluginName };
