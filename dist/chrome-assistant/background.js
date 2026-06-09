try {
  importScripts('config.js');
} catch (_) {}

const CONFIG = globalThis.GODSPEED_INSTALL_CONFIG || {};
const DEFAULTS = {
  baseUrl: CONFIG.baseUrl || 'http://127.0.0.1:7860',
  apiToken: CONFIG.apiToken || '',
  sessionId: ''
};

function normalizeBase(url) {
  return String(url || DEFAULTS.baseUrl).trim().replace(/\/+$/, '');
}

async function getState() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

async function api(path, options = {}) {
  const state = await getState();
  const headers = { ...(options.headers || {}) };
  if (state.apiToken) headers.Authorization = 'Bearer ' + state.apiToken;
  const res = await fetch(normalizeBase(state.baseUrl) + path, {
    ...options,
    headers,
    credentials: 'include'
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res;
}

async function ensureSession() {
  const state = await getState();
  if (state.sessionId) return state.sessionId;
  const def = await (await api('/api/default-chat')).json();
  const fd = new FormData();
  fd.append('name', 'Chrome Assistant');
  fd.append('endpoint_url', def.endpoint_url || '');
  fd.append('model', def.model || '');
  fd.append('skip_validation', 'true');
  if (def.endpoint_id) fd.append('endpoint_id', def.endpoint_id);
  const created = await (await api('/api/session', { method: 'POST', body: fd })).json();
  await chrome.storage.local.set({ sessionId: created.id });
  return created.id;
}

async function runPrompt(tabId, prompt, mode = 'chat') {
  const sid = await ensureSession();
  const fd = new FormData();
  fd.append('message', prompt);
  fd.append('session', sid);
  fd.append('mode', mode);
  const res = await api('/api/chat_stream', { method: 'POST', body: fd });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  chrome.tabs.sendMessage(tabId, { type: 'godspeed:stream-start', prompt }).catch(() => {});
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const data = JSON.parse(raw);
        const delta = data.delta || data.response || '';
        if (!delta) continue;
        answer += delta;
        chrome.tabs.sendMessage(tabId, { type: 'godspeed:stream-delta', delta }).catch(() => {});
      } catch (_) {}
    }
  }
  chrome.tabs.sendMessage(tabId, { type: 'godspeed:stream-done', answer }).catch(() => {});
  return answer;
}

function pagePrompt(kind, info) {
  const base = `Title: ${info.title || ''}\nURL: ${info.url || ''}\nSelected text:\n${info.selection || ''}\n\nPage text:\n${info.text || ''}`;
  if (kind === 'summarize') return `Summarize this page with key points and next actions.\n\n${base}`;
  if (kind === 'selection') return `Explain this selected text clearly and practically.\n\n${base}`;
  if (kind === 'tasks') return `Extract tasks, deadlines, blockers, and follow-ups from this page.\n\n${base}`;
  return `Help me with this page.\n\n${base}`;
}

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();
  await chrome.storage.local.set({ ...DEFAULTS, ...state });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'summarize', title: 'Summarize with GodSpeed', contexts: ['page', 'selection'] });
    chrome.contextMenus.create({ id: 'selection', title: 'Explain selection with GodSpeed', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'tasks', title: 'Extract tasks with GodSpeed', contexts: ['page', 'selection'] });
    chrome.contextMenus.create({ id: 'open', title: 'Open GodSpeed', contexts: ['action'] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  if (info.menuItemId === 'open') {
    const state = await getState();
    chrome.tabs.create({ url: normalizeBase(state.baseUrl) });
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'godspeed:collect', kind: info.menuItemId, selection: info.selectionText || '' }).catch(() => {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).then(() => {
      chrome.tabs.sendMessage(tab.id, { type: 'godspeed:collect', kind: info.menuItemId, selection: info.selectionText || '' });
    });
  });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'open-overlay' || !tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'godspeed:open-overlay' }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'godspeed:run') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) return false;
    runPrompt(tabId, message.prompt, message.mode || 'chat')
      .then((answer) => sendResponse({ ok: true, answer }))
      .catch((err) => {
        chrome.tabs.sendMessage(tabId, { type: 'godspeed:stream-error', error: err.message || String(err) }).catch(() => {});
        sendResponse({ ok: false, error: err.message || String(err) });
      });
    return true;
  }
  if (message && message.type === 'godspeed:page-prompt') {
    const prompt = pagePrompt(message.kind, message.info || {});
    sendResponse({ prompt });
  }
  return false;
});
