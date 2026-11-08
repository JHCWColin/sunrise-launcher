import api from './api.js';
import { ICON, fileVisual } from './icons.js';
import {
  $, applyAccent, applyBackground, applyBgDim, applyGlass, applyGlow, applyMotion, applyTheme,
  confirmDialog, copyText, debounce, escapeHtml, openModal, setIcon, toast,
} from './ui.js';
import { mergeConfig, state } from './state.js';
import { refreshHome, updateThemeIcon } from './home.js';
import { setClockConfig } from './clock.js';

const TYPE_LABELS = {
  video: '视频',
  presentation: '演示文稿',
  document: 'Word 文档',
  sheet: '表格',
  pdf: 'PDF',
  image: '图片',
  courseware: '希沃课件',
  audio: '音频',
  other: '其他文件',
};

let hooks = {};
let dom = {};
let open = false;
let syncing = false;

const saveGlass = debounce(async (value) => {
  const res = await api.updateConfig({ glass: value });
  if (res && res.ok) mergeConfig(res.config);
}, 260);

const saveGlow = debounce(async (value) => {
  const res = await api.updateConfig({ glow: value });
  if (res && res.ok) mergeConfig(res.config);
}, 260);

const saveBgDim = debounce(async (value) => {
  const res = await api.updateConfig({ bgDim: value });
  if (res && res.ok) mergeConfig(res.config);
}, 260);

function fileNameOf(filePath) {
  const parts = String(filePath || '').split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

function paintRange(range, value, min, max) {
  if (!range) return;
  const pct = ((value - min) / (max - min)) * 100;
  range.style.background = `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${pct}%, rgba(255,255,255,.12) ${pct}%)`;
}

function cacheDom() {
  dom.drawer = $('#settings-drawer');
  dom.scrim = $('#scrim');
  dom.scroll = $('#settings-scroll');
  dom.close = $('#settings-close');
  dom.themeSeg = $('#theme-segmented');
  dom.swatches = $('#accent-swatches');
  dom.glassRange = $('#glass-range');
  dom.glassValue = $('#glass-value');
  dom.glowRange = $('#glow-range');
  dom.glowValue = $('#glow-value');
  dom.bgDimRange = $('#bg-dim-range');
  dom.bgDimValue = $('#bg-dim-value');
  dom.backgroundName = $('#background-name');
  dom.backgroundChange = $('#background-change');
  dom.backgroundReset = $('#background-reset');
  dom.reduceMotion = $('#reduce-motion');
  dom.clock24h = $('#clock-24h');
  dom.clockSeconds = $('#clock-seconds');
  dom.nasHost = $('#nas-host');
  dom.nasPort = $('#nas-port');
  dom.nasHttps = $('#nas-https');
  dom.nasSelfSigned = $('#nas-self-signed');
  dom.nasDefaultPath = $('#nas-default-path');
  dom.nasStatus = $('#settings-nas-status');
  dom.nasTest = $('#nas-test');
  dom.downloadsPath = $('#downloads-path');
  dom.downloadsOpen = $('#downloads-open');
  dom.downloadsChange = $('#downloads-change');
  dom.autoOpen = $('#auto-open');
  dom.typeGrid = $('#auto-open-types');
  dom.videoPlayer = $('#video-player');
  dom.autoStart = $('#auto-start');
  dom.preventSleep = $('#prevent-sleep');
  dom.skipIntro = $('#skip-intro');
  dom.showRecent = $('#show-recent');
  dom.aboutMark = $('#about-mark');
  dom.aboutVersion = $('#about-version');
  dom.versionFoot = $('#foot-version');
  dom.github = $('#open-github');
  dom.logs = $('#open-logs');
  dom.config = $('#open-config');
  dom.diagnostics = $('#show-diagnostics');
  dom.reset = $('#reset-config');
  dom.quit = $('#quit-app');
}

function buildTypeGrid() {
  if (!dom.typeGrid) return;
  dom.typeGrid.innerHTML = Object.entries(TYPE_LABELS).map(([key, label]) => `
    <label class="type-toggle">
      <input type="checkbox" data-type="${key}">
      <span class="tick">${ICON.check}</span>
      <span>${label}</span>
    </label>
  `).join('');
}

function syncThemeSegmented() {
  if (!dom.themeSeg) return;
  const theme = state.config ? state.config.theme : 'dark';
  dom.themeSeg.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.themeValue === theme);
  });
}

function syncAccent() {
  if (!dom.swatches) return;
  const accent = state.config ? state.config.accent : 'sunrise';
  dom.swatches.querySelectorAll('.swatch').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.accentValue === accent);
  });
}

function syncGlass() {
  const value = state.config ? Number(state.config.glass) || 1 : 1;
  const percent = Math.round(value * 100);
  if (dom.glassRange) {
    dom.glassRange.value = String(percent);
    paintRange(dom.glassRange, percent, 35, 160);
  }
  if (dom.glassValue) dom.glassValue.textContent = `${percent}%`;
}

function syncGlow() {
  const raw = state.config ? Number(state.config.glow) : 0.3;
  const value = Number.isFinite(raw) ? raw : 0.3;
  const percent = Math.round(value * 100);
  if (dom.glowRange) {
    dom.glowRange.value = String(percent);
    paintRange(dom.glowRange, percent, 0, 150);
  }
  if (dom.glowValue) dom.glowValue.textContent = `${percent}%`;
}

function syncBgDim() {
  const raw = state.config ? Number(state.config.bgDim) : 0.55;
  const value = Number.isFinite(raw) ? raw : 0.55;
  const percent = Math.round(value * 100);
  if (dom.bgDimRange) {
    dom.bgDimRange.value = String(percent);
    paintRange(dom.bgDimRange, percent, 0, 90);
  }
  if (dom.bgDimValue) dom.bgDimValue.textContent = `${percent}%`;
}

function syncBackground() {
  if (!dom.backgroundName) return;
  const filePath = state.config ? state.config.background : '';
  dom.backgroundName.textContent = filePath ? fileNameOf(filePath) : '默认壁纸';
  dom.backgroundName.title = filePath || '内置 Golden Gate 壁纸';
  if (dom.backgroundReset) dom.backgroundReset.disabled = !filePath;
}

function syncNasStatus(status = state.nasStatus) {
  if (!dom.nasStatus) return;
  const dot = dom.nasStatus.querySelector('.status-dot');
  const b = dom.nasStatus.querySelector('b');
  const span = dom.nasStatus.querySelector('span:last-child');
  if (dot) {
    dot.classList.toggle('offline', status.state === 'offline');
    dot.classList.toggle('checking', status.state === 'checking' || status.state === 'idle');
  }
  if (b) {
    if (status.state === 'online') b.textContent = `已连接${status.latency ? ` · ${status.latency}ms` : ''}`;
    else if (status.state === 'checking') b.textContent = '正在连接…';
    else if (status.state === 'offline') b.textContent = '未连接';
    else b.textContent = '尚未连接';
  }
  if (span) span.textContent = status.message || '打开课件库时会自动连接';
}

function syncAll() {
  if (!state.config) return;
  syncing = true;
  const config = state.config;
  syncThemeSegmented();
  syncAccent();
  syncGlass();
  syncGlow();
  syncBgDim();
  syncBackground();
  if (dom.reduceMotion) dom.reduceMotion.checked = Boolean(config.reduceMotion);
  if (dom.clock24h) dom.clock24h.checked = config.clock24h !== false;
  if (dom.clockSeconds) dom.clockSeconds.checked = Boolean(config.showSeconds);
  if (dom.nasHost) dom.nasHost.value = config.nas.host || '';
  if (dom.nasPort) dom.nasPort.value = String(config.nas.port || 5001);
  if (dom.nasHttps) dom.nasHttps.checked = Boolean(config.nas.https);
  if (dom.nasSelfSigned) dom.nasSelfSigned.checked = config.nas.allowSelfSigned !== false;
  if (dom.nasDefaultPath) dom.nasDefaultPath.value = config.nas.defaultPath || '/高三/语文';
  if (dom.downloadsPath) dom.downloadsPath.textContent = config.downloadsDir || '—';
  if (dom.autoOpen) dom.autoOpen.checked = Boolean(config.autoOpen);
  if (dom.typeGrid) {
    dom.typeGrid.querySelectorAll('input[data-type]').forEach((input) => {
      input.checked = config.autoOpenTypes[input.dataset.type] !== false;
    });
  }
  if (dom.videoPlayer) dom.videoPlayer.value = config.videoPlayer || 'auto';
  if (dom.autoStart) dom.autoStart.checked = Boolean(config.autoStart);
  if (dom.preventSleep) dom.preventSleep.checked = config.preventSleep !== false;
  if (dom.skipIntro) dom.skipIntro.checked = Boolean(config.skipIntro);
  if (dom.showRecent) dom.showRecent.checked = config.showRecent !== false;
  const version = state.app ? state.app.version : '1.1.0';
  if (dom.aboutVersion) dom.aboutVersion.textContent = `v${version}`;
  if (dom.versionFoot) dom.versionFoot.textContent = version;
  syncNasStatus();
  syncing = false;
}

async function savePatch(patch) {
  try {
    const res = await api.updateConfig(patch);
    if (!res || !res.ok) {
      toast({ type: 'error', message: (res && res.message) || '设置保存失败' });
      syncAll();
      return null;
    }
    mergeConfig(res.config);
    if (res.apps) state.apps = res.apps;
    refreshHome();
    updateThemeIcon();
    return res.config;
  } catch (err) {
    toast({ type: 'error', message: `设置保存失败：${err.message}` });
    syncAll();
    return null;
  }
}

function saveNasFields({ test = false } = {}) {
  if (!state.config) return;
  let host = (dom.nasHost ? dom.nasHost.value : '').trim();
  host = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!host) {
    toast({ type: 'warning', message: 'NAS 地址不能为空。' });
    if (dom.nasHost) dom.nasHost.value = state.config.nas.host;
    return;
  }
  const port = Math.max(1, Math.min(65535, Number(dom.nasPort ? dom.nasPort.value : 5001) || 5001));
  let defaultPath = (dom.nasDefaultPath ? dom.nasDefaultPath.value : '/高三/语文').trim() || '/高三/语文';
  if (!defaultPath.startsWith('/')) defaultPath = `/${defaultPath}`;
  defaultPath = defaultPath.replace(/\/+$/, '') || '/';
  const patch = {
    nas: {
      host,
      port,
      https: dom.nasHttps ? dom.nasHttps.checked : true,
      allowSelfSigned: dom.nasSelfSigned ? dom.nasSelfSigned.checked : true,
      defaultPath,
    },
  };
  if (dom.nasHost) dom.nasHost.value = host;
  if (dom.nasPort) dom.nasPort.value = String(port);
  if (dom.nasDefaultPath) dom.nasDefaultPath.value = defaultPath;
  savePatch(patch).then((config) => {
    if (config && test) runNasTest();
  });
}

let testing = false;
async function runNasTest() {
  if (testing) return;
  testing = true;
  if (dom.nasTest) {
    dom.nasTest.disabled = true;
    dom.nasTest.textContent = '正在测试连接…';
  }
  syncNasStatus({ state: 'checking', message: '正在测试连接…' });
  try {
    const result = await api.nasTest();
    if (result && result.ok) {
      state.nasStatus = { connected: true, state: 'online', message: '课件库已连接', latency: result.latency };
      syncNasStatus(state.nasStatus);
      refreshHome();
      toast({
        type: 'success',
        message: `连接成功 · ${result.latency}ms · ${result.shares.length} 个共享文件夹`,
        duration: 4200,
      });
    } else {
      state.nasStatus = { connected: false, state: 'offline', message: (result && result.message) || '连接失败' };
      syncNasStatus(state.nasStatus);
      toast({ type: 'error', message: (result && result.message) || '无法连接 NAS', duration: 6000 });
    }
  } catch (err) {
    state.nasStatus = { connected: false, state: 'offline', message: err.message };
    syncNasStatus(state.nasStatus);
    toast({ type: 'error', message: `测试连接失败：${err.message}`, duration: 6000 });
  } finally {
    testing = false;
    if (dom.nasTest) {
      dom.nasTest.disabled = false;
      dom.nasTest.textContent = '测试连接';
    }
  }
}

function bind() {
  if (dom.close) dom.close.addEventListener('click', () => closeSettings());
  if (dom.scrim) dom.scrim.addEventListener('click', () => closeSettings());

  if (dom.themeSeg) {
    dom.themeSeg.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-theme-value]');
      if (!button || syncing) return;
      const theme = button.dataset.themeValue;
      if (state.config && state.config.theme === theme) return;
      if (state.config) state.config.theme = theme;
      applyTheme(theme);
      syncThemeSegmented();
      updateThemeIcon();
      await savePatch({ theme });
    });
  }

  if (dom.swatches) {
    dom.swatches.addEventListener('click', async (event) => {
      const button = event.target.closest('.swatch[data-accent-value]');
      if (!button || syncing) return;
      const accent = button.dataset.accentValue;
      if (state.config) state.config.accent = accent;
      applyAccent(accent);
      syncAccent();
      await savePatch({ accent });
    });
  }

  if (dom.glassRange) {
    dom.glassRange.addEventListener('input', () => {
      const percent = Number(dom.glassRange.value) || 100;
      if (dom.glassValue) dom.glassValue.textContent = `${percent}%`;
      paintRange(dom.glassRange, percent, 35, 160);
      applyGlass(percent / 100);
      if (state.config) state.config.glass = percent / 100;
      saveGlass(percent / 100);
    });
  }

  if (dom.glowRange) {
    dom.glowRange.addEventListener('input', () => {
      const percent = Number(dom.glowRange.value) || 0;
      if (dom.glowValue) dom.glowValue.textContent = `${percent}%`;
      paintRange(dom.glowRange, percent, 0, 150);
      applyGlow(percent / 100);
      if (state.config) state.config.glow = percent / 100;
      saveGlow(percent / 100);
    });
  }

  if (dom.bgDimRange) {
    dom.bgDimRange.addEventListener('input', () => {
      const percent = Number(dom.bgDimRange.value) || 0;
      if (dom.bgDimValue) dom.bgDimValue.textContent = `${percent}%`;
      paintRange(dom.bgDimRange, percent, 0, 90);
      applyBgDim(percent / 100);
      if (state.config) state.config.bgDim = percent / 100;
      saveBgDim(percent / 100);
    });
  }

  if (dom.backgroundChange) {
    dom.backgroundChange.addEventListener('click', async () => {
      const result = await api.chooseBackground();
      if (!result || result.canceled) return;
      if (!result.ok) {
        toast({ type: 'error', message: result.message || '无法设置背景图片' });
        return;
      }
      mergeConfig(result.config);
      applyBackground(result.config.background);
      syncBackground();
      toast({ type: 'success', message: '背景图片已更新。', duration: 2800 });
    });
  }

  if (dom.backgroundReset) {
    dom.backgroundReset.addEventListener('click', async () => {
      if (!state.config || !state.config.background) return;
      const result = await api.updateConfig({ background: '' });
      if (!result || !result.ok) {
        toast({ type: 'error', message: (result && result.message) || '无法恢复默认背景' });
        return;
      }
      mergeConfig(result.config);
      applyBackground('');
      syncBackground();
      toast({ type: 'success', message: '已恢复默认壁纸。', duration: 2600 });
    });
  }

  if (dom.reduceMotion) {
    dom.reduceMotion.addEventListener('change', async () => {
      const value = dom.reduceMotion.checked;
      applyMotion(value);
      if (state.config) state.config.reduceMotion = value;
      await savePatch({ reduceMotion: value });
    });
  }

  if (dom.clock24h) {
    dom.clock24h.addEventListener('change', async () => {
      const value = dom.clock24h.checked;
      if (state.config) state.config.clock24h = value;
      setClockConfig({ clock24h: value, showSeconds: state.config.showSeconds });
      await savePatch({ clock24h: value });
    });
  }
  if (dom.clockSeconds) {
    dom.clockSeconds.addEventListener('change', async () => {
      const value = dom.clockSeconds.checked;
      if (state.config) state.config.showSeconds = value;
      setClockConfig({ clock24h: state.config.clock24h, showSeconds: value });
      await savePatch({ showSeconds: value });
    });
  }

  [dom.nasHost, dom.nasPort, dom.nasDefaultPath].forEach((input) => {
    if (!input) return;
    input.addEventListener('change', () => saveNasFields({ test: false }));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
        saveNasFields({ test: false });
      }
    });
  });
  [dom.nasHttps, dom.nasSelfSigned].forEach((input) => {
    if (!input) return;
    input.addEventListener('change', () => saveNasFields({ test: false }));
  });
  if (dom.nasTest) dom.nasTest.addEventListener('click', () => saveNasFields({ test: true }));

  if (dom.downloadsOpen) {
    dom.downloadsOpen.addEventListener('click', async () => {
      const result = await api.openDownloadsFolder();
      if (result && result.ok === false) toast({ type: 'error', message: result.message || '无法打开文件夹' });
    });
  }
  if (dom.downloadsChange) {
    dom.downloadsChange.addEventListener('click', async () => {
      const result = await api.chooseDownloadsFolder();
      if (result && result.ok) {
        mergeConfig(result.config);
        if (dom.downloadsPath) dom.downloadsPath.textContent = result.config.downloadsDir;
        toast({ type: 'success', message: '下载文件夹已更新。', duration: 3000 });
      } else if (result && result.message) {
        toast({ type: 'error', message: result.message });
      }
    });
  }

  if (dom.autoOpen) {
    dom.autoOpen.addEventListener('change', async () => {
      const value = dom.autoOpen.checked;
      if (state.config) state.config.autoOpen = value;
      await savePatch({ autoOpen: value });
    });
  }

  if (dom.typeGrid) {
    dom.typeGrid.addEventListener('change', async (event) => {
      const input = event.target.closest('input[data-type]');
      if (!input) return;
      const type = input.dataset.type;
      const value = input.checked;
      if (state.config) {
        state.config.autoOpenTypes = { ...state.config.autoOpenTypes, [type]: value };
      }
      await savePatch({ autoOpenTypes: { [type]: value } });
    });
  }

  if (dom.videoPlayer) {
    dom.videoPlayer.addEventListener('change', async () => {
      const value = dom.videoPlayer.value;
      if (state.config) state.config.videoPlayer = value;
      await savePatch({ videoPlayer: value });
    });
  }

  if (dom.autoStart) {
    dom.autoStart.addEventListener('change', async () => {
      const value = dom.autoStart.checked;
      const result = await api.setAutoStart(value);
      if (result && result.ok) {
        mergeConfig(result.config);
        state.autoStartEnabled = value;
        if (value && state.app && !state.app.packaged) {
          toast({ type: 'warning', message: '便携版的开机自启可能不可用，建议使用安装版。', duration: 5200 });
        } else {
          toast({ type: 'success', message: value ? '已开启开机自动启动。' : '已关闭开机自动启动。', duration: 2600 });
        }
      } else {
        dom.autoStart.checked = !value;
        toast({ type: 'error', message: (result && result.message) || '设置开机自启失败' });
      }
    });
  }
  if (dom.preventSleep) {
    dom.preventSleep.addEventListener('change', async () => {
      const value = dom.preventSleep.checked;
      if (state.config) state.config.preventSleep = value;
      await savePatch({ preventSleep: value });
    });
  }
  if (dom.skipIntro) {
    dom.skipIntro.addEventListener('change', async () => {
      const value = dom.skipIntro.checked;
      if (state.config) state.config.skipIntro = value;
      await savePatch({ skipIntro: value });
    });
  }
  if (dom.showRecent) {
    dom.showRecent.addEventListener('change', async () => {
      const value = dom.showRecent.checked;
      if (state.config) state.config.showRecent = value;
      await savePatch({ showRecent: value });
      refreshHome();
    });
  }

  if (dom.github) {
    dom.github.addEventListener('click', async () => {
      const url = (state.app && state.app.github) || 'https://github.com/JHCWColin/sunrise-launcher';
      const result = await api.openExternal(url);
      if (result && result.ok === false) toast({ type: 'error', message: result.message || '无法打开链接' });
    });
  }
  if (dom.logs) {
    dom.logs.addEventListener('click', async () => {
      const result = await api.openLogs();
      if (result && result.ok === false) toast({ type: 'error', message: result.message || '无法打开日志目录' });
    });
  }
  if (dom.config) {
    dom.config.addEventListener('click', async () => {
      const result = await api.openConfigFolder();
      if (result && result.ok === false) toast({ type: 'error', message: result.message || '无法打开配置目录' });
    });
  }
  if (dom.diagnostics) {
    dom.diagnostics.addEventListener('click', async () => {
      const result = await api.diagnostics();
      if (!result || !result.ok) {
        toast({ type: 'error', message: '无法读取诊断信息' });
        return;
      }
      const choice = await openModal({
        title: '诊断信息',
        message: '把这段信息发给维护老师，可以快速定位问题。',
        icon: 'info',
        content: `<pre>${escapeHtml(result.text)}</pre>`,
        actions: [
          { label: '关闭', value: null },
          { label: '复制全部', value: 'copy', style: 'primary' },
        ],
      });
      if (choice === 'copy') {
        await copyText(result.text);
        toast({ type: 'success', message: '诊断信息已复制。', duration: 2400 });
      }
    });
  }

  if (dom.reset) {
    dom.reset.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '恢复默认设置？',
        message: '主题、背景、光晕、时钟、NAS 地址、下载与自动打开设置都会恢复为默认。已下载的课件不会被删除。',
        confirmLabel: '恢复默认',
        danger: false,
        icon: 'refresh',
      });
      if (!ok) return;
      const result = await api.resetConfig();
      if (result && result.ok) {
        mergeConfig(result.config);
        if (result.apps) state.apps = result.apps;
        applyTheme(result.config.theme);
        applyAccent(result.config.accent);
        applyGlass(result.config.glass);
        applyGlow(result.config.glow);
        applyBgDim(result.config.bgDim);
        applyBackground(result.config.background);
        applyMotion(result.config.reduceMotion);
        setClockConfig(result.config);
        syncAll();
        refreshHome();
        updateThemeIcon();
        toast({ type: 'success', message: '已恢复默认设置。', duration: 2800 });
      } else {
        toast({ type: 'error', message: (result && result.message) || '恢复默认设置失败' });
      }
    });
  }

  if (dom.quit) {
    dom.quit.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '退出旭日东升？',
        message: '退出后将恢复 Windows 任务栏并回到桌面。\n\n软件没有其他关闭方式，下次可以从桌面快捷方式重新打开。',
        confirmLabel: '退出软件',
        cancelLabel: '取消',
        danger: true,
        icon: 'quit',
      });
      if (!ok) return;
      document.documentElement.classList.add('is-quitting');
      setTimeout(() => { api.quit(); }, 460);
    });
  }
}

export function initSettings(options = {}) {
  hooks = options;
  cacheDom();
  buildTypeGrid();
  bind();
  if (dom.close) setIcon(dom.close, 'close');
  if (dom.aboutMark) dom.aboutMark.innerHTML = ICON.sun;
  if (dom.aboutVersion) dom.aboutVersion.textContent = `v${state.app ? state.app.version : '1.1.0'}`;
  if (dom.versionFoot) dom.versionFoot.textContent = state.app ? state.app.version : '1.1.0';
  api.onNasStatus((status) => {
    state.nasStatus = status;
    syncNasStatus(status);
  });
}

export function openSettings() {
  if (!dom.drawer) return;
  open = true;
  syncAll();
  dom.drawer.classList.add('is-open');
  dom.drawer.setAttribute('aria-hidden', 'false');
  if (dom.scrim) dom.scrim.classList.add('is-open');
  if (dom.scroll) dom.scroll.scrollTop = 0;
  setTimeout(() => {
    if (dom.close) dom.close.focus({ preventScroll: true });
  }, 520);
}

export function closeSettings() {
  if (!dom.drawer) return;
  open = false;
  dom.drawer.classList.remove('is-open');
  dom.drawer.setAttribute('aria-hidden', 'true');
  if (dom.scrim) dom.scrim.classList.remove('is-open');
  if (hooks.onClose) hooks.onClose();
}

export function isSettingsOpen() {
  return open;
}

export async function setThemeAndSave(theme) {
  if (!state.config) return;
  state.config.theme = theme;
  applyTheme(theme);
  syncThemeSegmented();
  updateThemeIcon();
  await savePatch({ theme });
}

export function refreshSettings() {
  if (!open) return;
  // 只刷新连接状态，避免老师正在输入 NAS 地址时被状态事件覆盖。
  syncNasStatus();
}
