(function () {
  const cfg = globalThis.GODSPEED_INSTALL_CONFIG || {};
  const defaults = {
    baseUrl: cfg.baseUrl || 'http://127.0.0.1:7860',
    apiToken: cfg.apiToken || '',
    sessionId: '',
    autoContext: true
  };
  const els = {};
  let state = { ...defaults };
  let abortController = null;

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text, ok) {
    els.status.textContent = text;
    els.status.style.color = ok ? 'var(--accent)' : 'var(--muted)';
  }

  function normalizeBase(url) {
    return String(url || defaults.baseUrl).trim().replace(/\/+$/, '');
  }

  async function loadState() {
    const stored = await chrome.storage.local.get(Object.keys(defaults));
    state = { ...defaults, ...stored };
    els.baseUrl.value = state.baseUrl;
    els.apiToken.value = state.apiToken;
    els.autoContext.checked = !!state.autoContext;
  }

  async function saveState() {
    state.baseUrl = normalizeBase(els.baseUrl.value);
    state.apiToken = els.apiToken.value.trim();
    state.autoContext = !!els.autoContext.checked;
    await chrome.storage.local.set(state);
  }

  function headers(extra) {
    const h = extra ? { ...extra } : {};
    if (state.apiToken) h.Authorization = 'Bearer ' + state.apiToken;
    return h;
  }

  async function api(path, opts) {
    const options = opts || {};
    const res = await fetch(normalizeBase(state.baseUrl) + path, {
      ...options,
      headers: headers(options.headers || {}),
      credentials: 'include'
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).detail || ''; } catch (_) { detail = await res.text(); }
      throw new Error(detail || `HTTP ${res.status}`);
    }
    return res;
  }

  async function checkConnection() {
    try {
      const version = await (await api('/api/version')).json();
      setStatus(`Connected to GodSpeed ${version.version || ''}`.trim(), true);
      await loadSessions();
    } catch (err) {
      setStatus('Disconnected. Start GodSpeed or set the token.', false);
    }
  }

  async function getDefaultChat() {
    return (await api('/api/default-chat')).json();
  }

  async function ensureSession() {
    if (state.sessionId) return state.sessionId;
    const def = await getDefaultChat();
    const fd = new FormData();
    fd.append('name', 'Chrome Assistant');
    fd.append('endpoint_url', def.endpoint_url || '');
    fd.append('model', def.model || '');
    if (def.endpoint_id) fd.append('endpoint_id', def.endpoint_id);
    fd.append('skip_validation', 'true');
    const created = await (await api('/api/session', { method: 'POST', body: fd })).json();
    state.sessionId = created.id;
    await chrome.storage.local.set({ sessionId: state.sessionId });
    return state.sessionId;
  }

  async function getPageContext() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || /^chrome:|^edge:|^about:/.test(tab.url || '')) {
      return { title: '', url: tab ? tab.url : '', selection: '', text: '' };
    }
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selection = String(window.getSelection && window.getSelection() || '').trim();
        const meta = document.querySelector('meta[name="description"]')?.content || '';
        const article = document.querySelector('article, main, [role="main"]') || document.body;
        const text = (article?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 10000);
        return { title: document.title, url: location.href, selection, meta, text };
      }
    });
    return result.result || {};
  }

  function promptFor(action, ctx, typed) {
    const page = `Title: ${ctx.title || ''}\nURL: ${ctx.url || ''}\nDescription: ${ctx.meta || ''}`;
    const selection = ctx.selection ? `\nSelected text:\n${ctx.selection}` : '';
    const text = ctx.text ? `\nPage text:\n${ctx.text}` : '';
    const custom = typed ? `\nUser request:\n${typed}` : '';
    if (action === 'summarize') return `Summarize this page with key points, risks, and next actions.\n\n${page}${selection}${text}`;
    if (action === 'selection') return `Explain the selected text clearly and give practical implications.\n\n${page}${selection || text}`;
    if (action === 'tasks') return `Extract actionable tasks, owners if visible, deadlines, and blockers from this page.\n\n${page}${selection}${text}`;
    if (action === 'reply') return `Draft a concise, useful reply based on this page or selected text. Keep it ready to send.\n\n${page}${selection}${text}`;
    if (action === 'security') return `Review this page content for security, privacy, phishing, and data-exposure risks. Be concrete.\n\n${page}${selection}${text}`;
    if (action === 'rewrite') return `Rewrite the selected text to be clearer, sharper, and more professional.\n\n${selection || text}`;
    return `${typed || 'Help me with this page.'}\n\n${state.autoContext ? `${page}${selection}${text}` : ''}${custom}`;
  }

  function appendAnswer(text, reset) {
    if (reset) els.answer.textContent = '';
    els.answer.textContent += text;
    els.answer.scrollTop = els.answer.scrollHeight;
  }

  async function send(action) {
    await saveState();
    const ctx = await getPageContext();
    const typed = els.prompt.value.trim();
    const message = promptFor(action || 'custom', ctx, typed);
    if (!message.trim()) return;
    abortController = new AbortController();
    els.stop.disabled = false;
    appendAnswer('', true);
    try {
      const sid = await ensureSession();
      const fd = new FormData();
      fd.append('message', message);
      fd.append('session', sid);
      fd.append('mode', els.mode.value);
      fd.append('use_web', action === 'security' ? 'true' : 'false');
      const res = await api('/api/chat_stream', { method: 'POST', body: fd, signal: abortController.signal });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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
            if (data.delta) appendAnswer(data.delta);
            else if (data.response) appendAnswer(data.response);
            else if (data.type === 'done') appendAnswer('\n');
          } catch (_) {}
        }
      }
      await loadSessions();
    } catch (err) {
      appendAnswer(`\n[GodSpeed] ${err.message || err}`);
    } finally {
      abortController = null;
      els.stop.disabled = true;
    }
  }

  async function loadSessions() {
    try {
      const list = await (await api('/api/sessions')).json();
      els.sessions.innerHTML = '';
      (Array.isArray(list) ? list : []).slice(0, 5).forEach((s) => {
        const row = document.createElement('div');
        row.className = 'session' + (s.id === state.sessionId ? ' active' : '');
        row.innerHTML = `<span>${escapeHtml(s.name || 'Untitled')}</span><span>${escapeHtml(s.model || '')}</span>`;
        row.addEventListener('click', async () => {
          state.sessionId = s.id;
          await chrome.storage.local.set({ sessionId: s.id });
          await loadSessions();
        });
        els.sessions.appendChild(row);
      });
    } catch (_) {}
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  document.addEventListener('DOMContentLoaded', async () => {
    ['status', 'prompt', 'answer', 'send', 'stop', 'mode', 'openApp', 'baseUrl', 'apiToken', 'autoContext', 'saveSettings', 'copyAnswer', 'refreshSessions'].forEach((id) => { els[id] = $(id); });
    els.sessions = $('sessions');
    await loadState();
    await checkConnection();
    els.send.addEventListener('click', () => send('custom'));
    els.stop.addEventListener('click', () => abortController && abortController.abort());
    els.saveSettings.addEventListener('click', async () => { await saveState(); await checkConnection(); });
    els.openApp.addEventListener('click', () => chrome.tabs.create({ url: normalizeBase(state.baseUrl) }));
    els.copyAnswer.addEventListener('click', () => navigator.clipboard.writeText(els.answer.textContent || ''));
    els.refreshSessions.addEventListener('click', loadSessions);
    document.querySelectorAll('[data-action]').forEach((btn) => btn.addEventListener('click', () => send(btn.dataset.action)));
  });
})();
