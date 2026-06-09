(function () {
  if (window.__godspeedContentLoaded) return;
  window.__godspeedContentLoaded = true;

  let root;
  let promptBox;
  let outputBox;

  function collectPage(extra) {
    const selection = String(extra && extra.selection || window.getSelection && window.getSelection() || '').trim();
    const article = document.querySelector('article, main, [role="main"]') || document.body;
    return {
      title: document.title,
      url: location.href,
      selection,
      text: (article && article.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 12000)
    };
  }

  function ensureOverlay() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'godspeed-page-assistant';
    root.innerHTML = `
      <style>
        #godspeed-page-assistant {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 2147483647;
          width: min(420px, calc(100vw - 24px));
          color: #edf7f5;
          font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        #godspeed-page-assistant .gs-panel {
          display: none;
          overflow: hidden;
          border: 1px solid #2a3b49;
          border-radius: 10px;
          background: #090d12;
          box-shadow: 0 22px 70px rgba(0,0,0,.42);
        }
        #godspeed-page-assistant.open .gs-panel { display: block; }
        #godspeed-page-assistant .gs-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid #2a3b49;
          font-weight: 800;
        }
        #godspeed-page-assistant textarea {
          width: calc(100% - 20px);
          min-height: 92px;
          margin: 10px;
          padding: 10px;
          border: 1px solid #2a3b49;
          border-radius: 8px;
          background: #0f1720;
          color: #edf7f5;
          font: inherit;
          outline: none;
        }
        #godspeed-page-assistant pre {
          min-height: 120px;
          max-height: 260px;
          margin: 0 10px 10px;
          overflow: auto;
          white-space: pre-wrap;
          word-break: break-word;
          color: #dff8f3;
        }
        #godspeed-page-assistant .gs-actions {
          display: flex;
          gap: 8px;
          padding: 0 10px 10px;
        }
        #godspeed-page-assistant button {
          border: 1px solid #2a3b49;
          border-radius: 8px;
          background: #172331;
          color: #edf7f5;
          cursor: pointer;
          font: inherit;
          font-weight: 750;
          min-height: 34px;
          padding: 8px 10px;
        }
        #godspeed-page-assistant .gs-send {
          flex: 1;
          border: 0;
          color: #04110f;
          background: linear-gradient(135deg, #49e3c2, #53a8ff);
        }
        #godspeed-page-assistant .gs-fab {
          float: right;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 1px solid #49e3c2;
          background: #081119;
          color: #49e3c2;
          font-size: 18px;
          box-shadow: 0 16px 46px rgba(0,0,0,.36);
        }
      </style>
      <div class="gs-panel" role="dialog" aria-label="GodSpeed page assistant">
        <div class="gs-head"><span>GodSpeed</span><button class="gs-close" title="Close">x</button></div>
        <textarea class="gs-prompt" placeholder="Ask about this page or selected text."></textarea>
        <div class="gs-actions">
          <button class="gs-send">Send</button>
          <button class="gs-page">Use Page</button>
          <button class="gs-clear">Clear</button>
        </div>
        <pre class="gs-output"></pre>
      </div>
      <button class="gs-fab" title="GodSpeed">G</button>
    `;
    document.documentElement.appendChild(root);
    promptBox = root.querySelector('.gs-prompt');
    outputBox = root.querySelector('.gs-output');
    root.querySelector('.gs-fab').addEventListener('click', () => root.classList.toggle('open'));
    root.querySelector('.gs-close').addEventListener('click', () => root.classList.remove('open'));
    root.querySelector('.gs-clear').addEventListener('click', () => { outputBox.textContent = ''; promptBox.value = ''; });
    root.querySelector('.gs-page').addEventListener('click', () => {
      const info = collectPage();
      promptBox.value = `Help me with this page.\n\nTitle: ${info.title}\nURL: ${info.url}\nSelected text: ${info.selection}`;
      promptBox.focus();
    });
    root.querySelector('.gs-send').addEventListener('click', sendPrompt);
    return root;
  }

  function openWithPrompt(prompt) {
    ensureOverlay();
    root.classList.add('open');
    if (prompt) promptBox.value = prompt;
    promptBox.focus();
  }

  function sendPrompt() {
    const prompt = promptBox.value.trim();
    if (!prompt) return;
    outputBox.textContent = '';
    chrome.runtime.sendMessage({ type: 'godspeed:run', prompt });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;
    if (message.type === 'godspeed:open-overlay') {
      openWithPrompt('');
      return;
    }
    if (message.type === 'godspeed:collect') {
      const info = collectPage({ selection: message.selection });
      chrome.runtime.sendMessage({ type: 'godspeed:page-prompt', kind: message.kind, info }, (res) => {
        openWithPrompt(res && res.prompt || '');
        sendPrompt();
      });
      return;
    }
    if (message.type === 'godspeed:stream-start') {
      openWithPrompt(message.prompt || '');
      outputBox.textContent = '';
      return;
    }
    if (message.type === 'godspeed:stream-delta') {
      ensureOverlay();
      outputBox.textContent += message.delta || '';
      outputBox.scrollTop = outputBox.scrollHeight;
      return;
    }
    if (message.type === 'godspeed:stream-error') {
      ensureOverlay();
      outputBox.textContent += `\n[GodSpeed] ${message.error || 'Request failed'}`;
    }
  });

  ensureOverlay();
})();
