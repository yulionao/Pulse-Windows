const root = document.getElementById('app');
const toast = document.getElementById('toast');
const modalRoot = document.getElementById('modal-root');
const settingsButton = document.getElementById('toggle-settings');
const refreshButton = document.getElementById('refresh-all');

let state = null;
let currentView = 'dashboard';
let settingsPage = 'general';
let selectedPluginID = null;
let selectedTabID = null;
let codexLoginState = null;
let claudeLoginState = null;
let activeLoginProvider = null;
let toastTimer;
const expandedCharts = new Set();
window.lucide?.createIcons();

const strings = {
  'zh-Hans': {
    overview: '用量概览', noPlugins: '尚未启用插件', noPluginsHint: '前往设置填写所需参数并启用数据源。', openSettings: '打开设置',
    waiting: '等待刷新', noData: '暂无用量数据', cached: '上次数据', general: '通用', plugins: '插件', about: '关于',
    generalSubtitle: '调整界面、刷新显示和启动行为', pluginsSubtitle: '管理数据源、认证信息和刷新频率', aboutSubtitle: '版本与运行环境',
    language: '界面语言', display: '概览布局', displayHint: '切换插件的组织方式', grouped: '分组', tabs: '标签页', chart: '图表样式', line: '折线图', bar: '堆叠柱图',
    launchAtLogin: '开机自动启动', launchHint: '登录 Windows 后在托盘中运行', enabled: '已启用',
    basic: '刷新设置', interval: '刷新间隔', seconds: '秒', parameters: '账户与显示',
    noMetadata: '该数据源无需额外配置', runtime: 'Python 运行环境', available: '可用', unavailable: '不可用',
    source: '基于开源项目 marsmay/UsageBoard 的 Windows 实现', quit: '退出 Pulse', today: '今天', tomorrow: '明天', hidden: '窗口已隐藏至系统托盘', codexLogin: '登录 Codex', codexRelogin: '重新登录', codexLoginTitle: 'Codex 官方登录', cancel: '取消', close: '关闭',
    claudeLogin: '登录 Claude', claudeRelogin: '重新登录', claudeLoginTitle: 'Claude 官方登录', saved: '已保存', appName: 'Pulse',
    todaySpend: '今日消费', requests: '请求', tokens: 'Token', quotaUsage: '配额用量', disabled: '已停用', reset: '重置'
  },
  en: {
    overview: 'Usage overview', noPlugins: 'No plugins enabled', noPluginsHint: 'Open settings, enter the required values, and enable a data source.', openSettings: 'Open settings',
    waiting: 'Waiting to refresh', noData: 'No usage data', cached: 'Last result', general: 'General', plugins: 'Plugins', about: 'About',
    generalSubtitle: 'Configure appearance, charts, and startup behavior', pluginsSubtitle: 'Manage data sources, credentials, and refresh timing', aboutSubtitle: 'Version and runtime',
    language: 'Language', display: 'Overview layout', displayHint: 'Choose how plugins are organized', grouped: 'Grouped', tabs: 'Tabs', chart: 'Chart style', line: 'Line', bar: 'Stacked bars',
    launchAtLogin: 'Launch at sign-in', launchHint: 'Run in the tray after signing in to Windows', enabled: 'Enabled',
    basic: 'Refresh', interval: 'Refresh interval', seconds: 'seconds', parameters: 'Account and display',
    noMetadata: 'This data source needs no additional setup.', runtime: 'Python runtime', available: 'Available', unavailable: 'Unavailable',
    source: 'Windows implementation based on marsmay/UsageBoard', quit: 'Quit Pulse', today: 'Today', tomorrow: 'Tomorrow', hidden: 'Window hidden to the system tray', codexLogin: 'Sign in to Codex', codexRelogin: 'Sign in again', codexLoginTitle: 'Official Codex sign-in', cancel: 'Cancel', close: 'Close',
    claudeLogin: 'Sign in to Claude', claudeRelogin: 'Sign in again', claudeLoginTitle: 'Official Claude sign-in', saved: 'Saved', appName: 'Pulse',
    todaySpend: 'Today', requests: 'Requests', tokens: 'Tokens', quotaUsage: 'Quota usage', disabled: 'Disabled', reset: 'reset'
  }
};

function t(key) {
  const language = state?.configuration?.language === 'en' ? 'en' : 'zh-Hans';
  return strings[language][key] || key;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function localized(object, field) {
  const language = state.configuration.language;
  return object?.[`${field}@${language}`] || object?.[field] || '';
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function pluginDisplayName(plugin) {
  return localized(plugin.metadata, 'name') || plugin.name;
}

function isCodexPlugin(plugin) {
  return /codex-usage-plugin\.py$/i.test(plugin.executablePath || '') || pluginDisplayName(plugin).toLowerCase() === 'codex';
}

function isClaudePlugin(plugin) {
  return /claude-usage-plugin\.py$/i.test(plugin.executablePath || '') || pluginDisplayName(plugin).toLowerCase() === 'claude';
}

function iconMarkup(plugin, className = '') {
  const icon = plugin.metadata?.icon;
  if (typeof icon === 'string' && /^https:\/\//i.test(icon)) {
    const fallback = escapeHTML(pluginDisplayName(plugin).slice(0, 1).toUpperCase());
    return `<span class="plugin-icon icon-fallback ${className}">${fallback}<img class="plugin-icon-image" src="${escapeHTML(icon)}" alt=""></span>`;
  }
  return `<span class="plugin-icon icon-fallback ${className}">${escapeHTML(pluginDisplayName(plugin).slice(0, 1).toUpperCase())}</span>`;
}

function formatNumber(value) {
  const numeric = Number(value) || 0;
  return Number.isInteger(numeric) ? String(numeric) : numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function displayValue(item) {
  const ratio = Number(item.limit) > 0 ? Math.max(0, Math.min(1, Number(item.used) / Number(item.limit))) : 0;
  return item.displayStyle === 'percent' ? `${Math.round(ratio * 100)}%` : `${formatNumber(item.used)} / ${formatNumber(item.limit)}`;
}

function formatReset(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date <= new Date()) return '--';
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const dayAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `${t('today')} ${time}`;
  if (date >= tomorrow && date < dayAfter) return `${t('tomorrow')} ${time}`;
  return `${date.toLocaleDateString([], { month: 'numeric', day: 'numeric' })} ${time}`;
}

function usageRow(item) {
  const progress = Number(item.limit) > 0 ? Math.max(0, Math.min(100, Number(item.used) / Number(item.limit) * 100)) : 0;
  const color = ['yellow', 'orange', 'red', 'green'].includes(item.color) ? item.color : '';
  return `<div class="usage-row">
    <div class="usage-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</div>
    <div class="progress"><div class="progress-fill ${color}" style="width:${progress}%"></div><div class="progress-value">${escapeHTML(displayValue(item))}</div></div>
    <div class="reset-time">${escapeHTML(formatReset(item.resetAt))}</div>
  </div>`;
}

function formatMoney(value) {
  return `$${(Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

function formatCount(value) {
  const number = Math.max(0, Number(value) || 0);
  return number > 0 ? Math.round(number).toLocaleString() : '-';
}

function formatTokens(value) {
  const number = Math.max(0, Number(value) || 0);
  if (!number) return '-';
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return Math.round(number).toLocaleString();
}

function formatQuotaReset(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time} ${t('reset')}`;
}

function platformQuota(quota) {
  const used = Math.max(0, Number(quota.used) || 0);
  const limit = Math.max(0, Number(quota.limit) || 0);
  const progress = limit > 0 ? Math.max(0, Math.min(100, used / limit * 100)) : 100;
  const color = ['yellow', 'orange', 'red', 'green'].includes(quota.color) ? quota.color : '';
  const value = quota.disabled ? t('disabled') : `${formatMoney(used)} / ${formatMoney(limit)}`;
  const reset = formatQuotaReset(quota.resetAt);
  return `<div class="platform-quota">
    <div class="platform-quota-head"><span>${escapeHTML(quota.label || quota.id)}</span><strong>${escapeHTML(value)}</strong></div>
    <div class="platform-quota-track"><span class="${color}" style="width:${progress}%"></span></div>
    ${reset ? `<div class="platform-quota-reset">${escapeHTML(reset)}</div>` : ''}
  </div>`;
}

function platformUsageCard(card) {
  const quotas = Array.isArray(card.quotas) ? card.quotas : [];
  return `<section class="platform-usage-card">
    <header><strong>${escapeHTML(card.name || card.id)}</strong><span>${escapeHTML(formatMoney(card.totalActualCost))}</span></header>
    <div class="platform-stat"><span>${t('todaySpend')}</span><strong>${escapeHTML(formatMoney(card.todayActualCost))}</strong></div>
    <div class="platform-stat"><span>${t('requests')}</span><strong>${escapeHTML(formatCount(card.totalRequests))}</strong></div>
    <div class="platform-stat"><span>${t('tokens')}</span><strong>${escapeHTML(formatTokens(card.totalTokens))}</strong></div>
    ${quotas.length ? `<div class="platform-quota-section"><div class="platform-quota-title">${t('quotaUsage')}</div>${quotas.map(platformQuota).join('')}</div>` : ''}
  </section>`;
}

function pluginCard(plugin) {
  const snapshot = state.snapshots[plugin.stateID] || { state: 'idle' };
  const output = snapshot.output;
  const badgeColor = ['red', 'green', 'gray', 'orange', 'indigo', 'blue'].includes(output?.badgeColor) ? output.badgeColor : '';
  const badge = output?.badge ? `<span class="badge ${badgeColor}">${escapeHTML(output.badge)}</span>` : '';
  let body = '';
  if (snapshot.error) body += `<div class="error-box">${escapeHTML(snapshot.error)}</div>`;
  if (output?.platformCards?.length) body += `<div class="platform-usage-grid">${output.platformCards.map(platformUsageCard).join('')}</div>`;
  else if (output?.items?.length) body += output.items.map(usageRow).join('');
  if (!snapshot.error && !output?.items?.length && !output?.platformCards?.length && snapshot.state !== 'loading') body += `<div class="empty-card">${t('noData')}</div>`;
  if (snapshot.state === 'loading' && !output) body += `<div class="empty-card">${t('waiting')}</div>`;
  const chart = output?.chart;
  const isExpanded = expandedCharts.has(plugin.stateID);
  const chartBlock = chart ? `<button class="chart-toggle" data-action="toggle-chart" data-id="${escapeHTML(plugin.stateID)}" title="${isExpanded ? 'Collapse' : 'Expand'}">${isExpanded ? '⌃' : '⌄'}</button>
    ${isExpanded ? `<div class="chart-area">${chart.message ? `<div class="chart-message">${escapeHTML(chart.message)}</div>` : `<canvas data-chart="${escapeHTML(plugin.stateID)}"></canvas>`}</div>` : ''}` : '';
  return `<article class="plugin-card">
    <header class="plugin-header">${iconMarkup(plugin)}<div class="plugin-title">${escapeHTML(pluginDisplayName(plugin))}</div>${badge}<div class="header-spacer"></div>
      ${snapshot.cached ? `<span class="countdown">${t('cached')}</span>` : `<span class="countdown" data-countdown="${snapshot.nextRefreshAt || ''}">${countdown(snapshot.nextRefreshAt)}</span>`}
      <button class="icon-button refresh-one ${snapshot.state === 'loading' ? 'loading' : ''}" data-action="refresh-plugin" data-id="${escapeHTML(plugin.stateID)}" title="Refresh">↻</button>
    </header>
    <div class="plugin-body">${body}</div>${chartBlock}
  </article>`;
}

function countdown(timestamp) {
  if (!timestamp) return '00:00';
  const seconds = Math.max(0, Math.ceil((Number(timestamp) - Date.now()) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderDashboard() {
  const plugins = state.configuration.plugins.filter((plugin) => plugin.enabled);
  if (!selectedTabID || !plugins.some((plugin) => plugin.stateID === selectedTabID)) selectedTabID = plugins[0]?.stateID;
  let content;
  if (!plugins.length) {
    content = `<div class="plugin-card empty-card"><strong>${t('noPlugins')}</strong>${t('noPluginsHint')}<br><button class="primary-button" data-action="open-settings">${t('openSettings')}</button></div>`;
  } else if (state.configuration.overviewDisplayMode === 'tabs') {
    const active = plugins.find((plugin) => plugin.stateID === selectedTabID) || plugins[0];
    content = `<div class="tab-strip">${plugins.map((plugin) => `<button class="${plugin.stateID === active.stateID ? 'active' : ''}" data-action="select-tab" data-id="${escapeHTML(plugin.stateID)}">${escapeHTML(pluginDisplayName(plugin))}</button>`).join('')}</div>${pluginCard(active)}`;
  } else {
    content = `<div class="plugin-stack">${plugins.map(pluginCard).join('')}</div>`;
  }
  root.innerHTML = `<section class="dashboard"><div class="dashboard-head"><span class="eyebrow">${t('overview')}</span><span class="last-updated">${plugins.length} ${t('plugins').toLowerCase()}</span></div>${content}</section>`;
  requestAnimationFrame(drawCharts);
}

function settingsNav() {
  return `<aside class="settings-nav"><h2>${t('appName')}</h2>
    ${['general', 'plugins', 'about'].map((page) => `<button class="nav-button ${settingsPage === page ? 'active' : ''}" data-action="settings-page" data-page="${page}">${t(page)}</button>`).join('')}
    <div class="version">v${escapeHTML(state.appVersion)}</div></aside>`;
}

function segmented(key, values) {
  return `<div class="segmented">${values.map(([value, label]) => `<button class="${state.configuration[key] === value ? 'active' : ''}" data-action="config-choice" data-key="${key}" data-value="${value}">${label}</button>`).join('')}</div>`;
}

function generalSettings() {
  return `<div class="settings-content"><header class="settings-page-header"><h1>${t('general')}</h1><p>${t('generalSubtitle')}</p></header>
    <section class="settings-section"><h3>${t('general')}</h3>
      <div class="setting-row"><div class="setting-label">${t('language')}</div>${segmented('language', [['zh-Hans', '简体中文'], ['en', 'English']])}</div>
      <div class="setting-row"><div class="setting-label">${t('display')}<span>${t('displayHint')}</span></div>${segmented('overviewDisplayMode', [['grouped', t('grouped')], ['tabs', t('tabs')]])}</div>
      <div class="setting-row"><div class="setting-label">${t('chart')}</div>${segmented('chartMode', [['line', t('line')], ['bar', t('bar')]])}</div>
      <div class="setting-row"><div class="setting-label">${t('launchAtLogin')}<span>${t('launchHint')}</span></div><button class="switch ${state.configuration.launchAtLogin ? 'on' : ''}" data-action="toggle-login" role="switch" aria-checked="${state.configuration.launchAtLogin}"></button></div>
    </section></div>`;
}

function pluginListItem(plugin) {
  return `<button class="plugin-list-item ${selectedPluginID === plugin.stateID ? 'active' : ''}" data-action="select-plugin" data-id="${escapeHTML(plugin.stateID)}">${iconMarkup(plugin)}<span>${escapeHTML(pluginDisplayName(plugin))}</span><span class="status-dot ${plugin.enabled ? 'on' : ''}"></span></button>`;
}

function parameterInput(plugin, parameter) {
  const value = plugin.parameterValues?.[parameter.name] ?? parameter.defaultValue ?? '';
  const placeholder = localized(parameter, 'placeholder');
  const common = `data-field="parameter" data-id="${escapeHTML(plugin.stateID)}" data-key="${escapeHTML(parameter.name)}"`;
  if (parameter.type === 'boolean') {
    const on = ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
    return `<button class="switch ${on ? 'on' : ''}" data-action="toggle-parameter" data-id="${escapeHTML(plugin.stateID)}" data-key="${escapeHTML(parameter.name)}" data-value="${on}"></button>`;
  }
  if (parameter.type === 'choice') {
    return `<select ${common}>${(parameter.options || []).map((option) => `<option value="${escapeHTML(option.value)}" ${String(value) === String(option.value) ? 'selected' : ''}>${escapeHTML(localized(option, 'label'))}</option>`).join('')}</select>`;
  }
  const inputType = parameter.type === 'secret' ? 'password' : parameter.type === 'integer' ? 'number' : 'text';
  const input = `<input type="${inputType}" value="${escapeHTML(value)}" placeholder="${escapeHTML(placeholder)}" ${common}>`;
  return input;
}

function pluginEditor(plugin) {
  if (!plugin) return `<div class="plugin-editor empty-card">${t('noPlugins')}</div>`;
  const parameters = plugin.metadata?.parameters || [];
  return `<div class="plugin-editor">
    <header class="editor-head">${iconMarkup(plugin)}<div class="editor-copy"><h2>${escapeHTML(pluginDisplayName(plugin))}</h2><p>${escapeHTML(localized(plugin.metadata, 'description'))}</p></div>
      ${isCodexPlugin(plugin) ? `<button class="primary-button provider-login-button" data-action="codex-login">↗ ${t(codexLoginState?.loggedIn ? 'codexRelogin' : 'codexLogin')}</button>` : ''}
      ${isClaudePlugin(plugin) ? `<button class="primary-button provider-login-button" data-action="claude-login">↗ ${t(claudeLoginState?.loggedIn ? 'claudeRelogin' : 'claudeLogin')}</button>` : ''}
      <button class="switch ${plugin.enabled ? 'on' : ''}" data-action="toggle-plugin" data-id="${escapeHTML(plugin.stateID)}" role="switch" aria-label="${t('enabled')}"></button>
    </header>
    <section class="form-section"><h3>${t('basic')}</h3>
      <div class="field-row"><label>${t('interval')}</label><div class="path-input"><input type="number" min="30" value="${escapeHTML(plugin.refreshIntervalSeconds)}" data-field="plugin" data-key="refreshIntervalSeconds" data-id="${escapeHTML(plugin.stateID)}"><button class="small-button" disabled>${t('seconds')}</button></div></div>
    </section>
    <section class="form-section"><h3>${t('parameters')}</h3>
      ${parameters.length ? parameters.map((parameter) => `<div class="field-row"><label>${escapeHTML(localized(parameter, 'label') || parameter.name)}${parameter.required ? '<span class="required"> *</span>' : ''}</label>${parameterInput(plugin, parameter)}</div>`).join('') : `<p class="eyebrow">${t('noMetadata')}</p>`}
    </section>
  </div>`;
}

function pluginsSettings() {
  const plugins = state.configuration.plugins;
  if (!selectedPluginID || !plugins.some((plugin) => plugin.stateID === selectedPluginID)) selectedPluginID = plugins[0]?.stateID;
  const plugin = plugins.find((entry) => entry.stateID === selectedPluginID);
  return `<div class="settings-content"><header class="settings-page-header"><h1>${t('plugins')}</h1><p>${t('pluginsSubtitle')}</p></header>
    <div class="plugins-layout"><aside class="plugin-list-pane"><div class="plugin-list">${plugins.map(pluginListItem).join('')}</div></aside>${pluginEditor(plugin)}</div></div>`;
}

function aboutSettings() {
  return `<div class="settings-content"><header class="settings-page-header"><h1>${t('about')}</h1><p>${t('aboutSubtitle')}</p></header>
    <section class="settings-section"><div class="about-logo"><img src="icon.png" alt=""><div><h2>Pulse</h2><p>Windows · v${escapeHTML(state.appVersion)}</p></div></div>
      <div class="setting-row"><div class="setting-label">${t('runtime')}</div><span id="python-status" class="runtime-state">${t('runtime')}…</span></div>
      <div class="setting-row"><div class="setting-label">Open source</div><span class="eyebrow">MIT License</span></div>
      <p class="eyebrow">${t('source')}</p><button class="danger-button" data-action="quit">${t('quit')}</button>
    </section></div>`;
}

function renderSettings() {
  const page = settingsPage === 'plugins' ? pluginsSettings() : settingsPage === 'about' ? aboutSettings() : generalSettings();
  root.innerHTML = `<section class="settings-shell">${settingsNav()}${page}</section>`;
  if (settingsPage === 'about') loadPythonStatus();
}

function render() {
  if (!state) return;
  document.documentElement.lang = state.configuration.language === 'en' ? 'en' : 'zh-CN';
  settingsButton.innerHTML = currentView === 'settings' ? '<i data-lucide="chevron-left"></i>' : '<i data-lucide="settings-2"></i>';
  window.lucide?.createIcons();
  settingsButton.title = currentView === 'settings' ? t('overview') : t('openSettings');
  refreshButton.style.display = currentView === 'dashboard' ? '' : 'none';
  currentView === 'settings' ? renderSettings() : renderDashboard();
  renderLoginModal();
}

function renderLoginModal() {
  const loginState = activeLoginProvider === 'claude' ? claudeLoginState : codexLoginState;
  if (!activeLoginProvider || !loginState || loginState.status === 'idle' || loginState.dismissed) {
    modalRoot.innerHTML = '';
    return;
  }
  const running = loginState.status === 'running';
  const title = activeLoginProvider === 'claude' ? t('claudeLoginTitle') : t('codexLoginTitle');
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="login-modal" role="dialog" aria-modal="true" aria-labelledby="provider-login-title">
    <header><span class="login-status-dot ${escapeHTML(loginState.status)}"></span><h2 id="provider-login-title">${title}</h2></header>
    <pre class="login-output">${escapeHTML(loginState.output || '')}</pre>
    ${loginState.error ? `<p class="login-error">${escapeHTML(loginState.error)}</p>` : ''}
    <footer><button class="${running ? 'danger-button' : 'primary-button'}" data-modal-action="${running ? 'cancel' : 'close'}">${t(running ? 'cancel' : 'close')}</button></footer>
  </section></div>`;
  const output = modalRoot.querySelector('.login-output');
  if (output) output.scrollTop = output.scrollHeight;
}

async function loadPythonStatus() {
  const info = await window.usageBoard.getPythonInfo();
  const element = document.getElementById('python-status');
  if (!element) return;
  element.classList.toggle('available', info.available);
  element.textContent = info.available ? `${t('available')} · ${info.command}` : t('unavailable');
}

async function updatePlugin(stateID, patch) {
  const result = await window.usageBoard.updatePlugin(stateID, patch);
  if (!result.ok) showToast(result.error || 'Error');
  if (result.state) state = result.state;
  render();
}

root.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id, key, value, page, kind } = target.dataset;
  if (action === 'open-settings') { settingsPage = 'plugins'; await window.usageBoard.setView('settings'); }
  if (action === 'settings-page') { settingsPage = page; render(); }
  if (action === 'select-plugin') { selectedPluginID = id; render(); }
  if (action === 'select-tab') { selectedTabID = id; render(); }
  if (action === 'refresh-plugin') await window.usageBoard.refreshPlugin(id);
  if (action === 'toggle-chart') { expandedCharts.has(id) ? expandedCharts.delete(id) : expandedCharts.add(id); render(); }
  if (action === 'config-choice') { state = await window.usageBoard.patchConfig({ [key]: value }); showToast(t('saved')); render(); }
  if (action === 'toggle-login') { state = await window.usageBoard.patchConfig({ launchAtLogin: !state.configuration.launchAtLogin }); render(); }
  if (action === 'toggle-plugin') {
    const plugin = state.configuration.plugins.find((entry) => entry.stateID === id);
    await updatePlugin(id, { enabled: !plugin.enabled });
  }
  if (action === 'toggle-parameter') {
    const plugin = state.configuration.plugins.find((entry) => entry.stateID === id);
    await updatePlugin(id, { parameterValues: { ...plugin.parameterValues, [key]: value === 'true' ? 'false' : 'true' } });
  }
  if (action === 'codex-login') {
    activeLoginProvider = 'codex';
    codexLoginState = await window.usageBoard.startCodexLogin();
    renderLoginModal();
  }
  if (action === 'claude-login') {
    activeLoginProvider = 'claude';
    claudeLoginState = await window.usageBoard.startClaudeLogin();
    renderLoginModal();
  }
  if (action === 'quit') await window.usageBoard.quit();
});

modalRoot.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-modal-action]');
  if (!target) return;
  if (target.dataset.modalAction === 'cancel') {
    if (activeLoginProvider === 'claude') claudeLoginState = await window.usageBoard.cancelClaudeLogin();
    else codexLoginState = await window.usageBoard.cancelCodexLogin();
  }
  if (activeLoginProvider === 'claude') claudeLoginState = { ...(claudeLoginState || {}), dismissed: true };
  else codexLoginState = { ...(codexLoginState || {}), dismissed: true };
  activeLoginProvider = null;
  renderLoginModal();
});

root.addEventListener('change', async (event) => {
  const input = event.target.closest('[data-field]');
  if (!input) return;
  const plugin = state.configuration.plugins.find((entry) => entry.stateID === input.dataset.id);
  if (!plugin) return;
  if (input.dataset.field === 'parameter') {
    await updatePlugin(plugin.stateID, { parameterValues: { ...plugin.parameterValues, [input.dataset.key]: input.value } });
  } else {
    const value = input.dataset.key === 'refreshIntervalSeconds' ? Number(input.value) : input.value;
    await updatePlugin(plugin.stateID, { [input.dataset.key]: value });
  }
  showToast(t('saved'));
});

root.addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.classList.contains('plugin-icon-image')) return;
  image.remove();
}, true);

root.addEventListener('load', (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.classList.contains('plugin-icon-image')) image.classList.add('loaded');
}, true);

refreshButton.addEventListener('click', async () => { refreshButton.classList.add('loading'); await window.usageBoard.refreshAll(); refreshButton.classList.remove('loading'); });
settingsButton.addEventListener('click', async () => { await window.usageBoard.setView(currentView === 'settings' ? 'dashboard' : 'settings'); });
document.getElementById('hide-window').addEventListener('click', () => window.usageBoard.hide());

window.usageBoard.onState((nextState) => { state = nextState; render(); });
window.usageBoard.onNavigate((view) => { currentView = view; render(); });
window.usageBoard.onCodexLogin((loginState) => { codexLoginState = loginState; if (activeLoginProvider === 'codex') renderLoginModal(); });
window.usageBoard.onClaudeLogin((loginState) => { claudeLoginState = loginState; if (activeLoginProvider === 'claude') renderLoginModal(); });

setInterval(() => {
  document.querySelectorAll('[data-countdown]').forEach((element) => { element.textContent = countdown(element.dataset.countdown); });
}, 1000);

function chartModels(chart) {
  const totals = new Map();
  for (const bucket of chart.buckets || []) for (const segment of bucket.segments || []) totals.set(segment.model, (totals.get(segment.model) || 0) + Math.max(0, Number(segment.tokens) || 0));
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([model]) => model);
}

function drawCharts() {
  document.querySelectorAll('canvas[data-chart]').forEach((canvas) => {
    const snapshot = state.snapshots[canvas.dataset.chart];
    const chart = snapshot?.output?.chart;
    if (!chart?.buckets?.length) return;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const context = canvas.getContext('2d');
    context.scale(scale, scale);
    drawChart(context, rect.width, rect.height, chart, state.configuration.chartMode);
  });
}

function drawChart(context, width, height, chart, mode) {
  const colors = ['#0a84ff', '#ff375f', '#30d158', '#ff9f0a', '#5e5ce6', '#64d2ff', '#bf5af2'];
  const models = chartModels(chart);
  const buckets = chart.buckets || [];
  const totals = buckets.map((bucket) => (bucket.segments || []).reduce((sum, segment) => sum + Math.max(0, Number(segment.tokens) || 0), 0));
  const maximum = Math.max(...totals, 1);
  const left = 8, top = 8, right = 8, bottom = 24;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border');
  context.lineWidth = 1;
  for (let line = 0; line <= 3; line += 1) {
    const y = top + plotHeight * line / 3;
    context.beginPath(); context.moveTo(left, y); context.lineTo(width - right, y); context.stroke();
  }
  if (mode === 'bar') {
    const gap = 3;
    const barWidth = Math.max(2, plotWidth / buckets.length - gap);
    buckets.forEach((bucket, index) => {
      let bottomY = top + plotHeight;
      models.forEach((model, modelIndex) => {
        const segment = (bucket.segments || []).find((entry) => entry.model === model);
        const segmentHeight = (Math.max(0, Number(segment?.tokens) || 0) / maximum) * plotHeight;
        context.fillStyle = colors[modelIndex % colors.length];
        context.fillRect(left + index * plotWidth / buckets.length + gap / 2, bottomY - segmentHeight, barWidth, segmentHeight);
        bottomY -= segmentHeight;
      });
    });
  } else {
    models.forEach((model, modelIndex) => {
      context.beginPath(); context.strokeStyle = colors[modelIndex % colors.length]; context.lineWidth = 2;
      buckets.forEach((bucket, index) => {
        const segment = (bucket.segments || []).find((entry) => entry.model === model);
        const value = Math.max(0, Number(segment?.tokens) || 0);
        const x = left + (buckets.length === 1 ? plotWidth / 2 : index * plotWidth / (buckets.length - 1));
        const y = top + plotHeight - value / maximum * plotHeight;
        index === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
      });
      context.stroke();
    });
  }
  context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--faint');
  context.font = '10px "SF Pro Text", "Segoe UI Variable", "Segoe UI"'; context.textAlign = 'center';
  const labelIndexes = [...new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])];
  labelIndexes.forEach((index) => {
    const x = left + (buckets.length === 1 ? plotWidth / 2 : index * plotWidth / (buckets.length - 1));
    context.fillText(buckets[index]?.label || '', x, height - 5);
  });
}

window.addEventListener('resize', () => requestAnimationFrame(drawCharts));
Promise.all([
  window.usageBoard.getState(), window.usageBoard.getCodexLoginStatus(), window.usageBoard.getClaudeLoginStatus()
]).then(([initialState, codexState, claudeState]) => {
  state = initialState;
  codexLoginState = codexState;
  claudeLoginState = claudeState;
  render();
});
