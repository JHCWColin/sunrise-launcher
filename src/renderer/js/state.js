export const state = {
  app: null,
  config: null,
  apps: null,
  nasStatus: { connected: false, state: 'idle', message: '尚未连接' },
  paths: null,
  autoStartEnabled: false,
  display: null,
  recent: [],
  page: 'home',
  downloadItems: new Map(),
  startedAt: 0,
};

export function setStateFromPayload(payload) {
  if (!payload) return state;
  state.app = payload.app;
  state.config = payload.config;
  state.apps = payload.apps;
  state.nasStatus = payload.nasStatus || state.nasStatus;
  state.paths = payload.paths;
  state.autoStartEnabled = Boolean(payload.autoStartEnabled);
  state.display = payload.display;
  state.recent = Array.isArray(payload.config && payload.config.recent) ? payload.config.recent : [];
  state.startedAt = payload.startedAt || Date.now();
  return state;
}

export function mergeConfig(next) {
  if (!next) return state.config;
  state.config = next;
  state.recent = Array.isArray(next.recent) ? next.recent : state.recent;
  return state.config;
}
