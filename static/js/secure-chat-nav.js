// Secure Chat Navigation Handler
// Opens secure chat INSIDE the main dashboard (standard modal) instead of a new tab/window.
// Re-uses the exact existing secure-chat.html + its CSS/JS. Outer frame matches all other dashboard tools (Tasks, Notes, etc.).
// Fixes blank page / different-UI / new-tab problems.

document.addEventListener('DOMContentLoaded', () => {
  const secureChatBtn = document.getElementById('tool-secure-chat-btn');

  if (secureChatBtn) {
    secureChatBtn.addEventListener('click', () => {
      const modalId = 'secure-chat-modal';
      let modal = document.getElementById(modalId);
      if (!modal) {
        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'modal';
        modal.innerHTML = `
          <div class="modal-content" style="width: 96vw; max-width: 1320px; height: 90vh; display:flex; flex-direction:column;">
            <div class="modal-header">
              <div class="modal-title">Secure Chat (end-to-end + calls)</div>
              <div class="modal-controls">
                <button class="modal-min-btn" title="Minimize">_</button>
                <button class="modal-close-btn" title="Close">✕</button>
              </div>
            </div>
            <div class="modal-body" style="flex:1 1 auto; padding:0; overflow:hidden; background:#111;">
              <iframe src="/static/secure-chat.html" style="width:100%; height:100%; border:none; background:#0f0f0f;"></iframe>
            </div>
          </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('.modal-close-btn')?.addEventListener('click', () => {
          modal.classList.add('hidden');
          // Optional: the iframe can keep state; on re-open it will reload or keep if cache allows.
        });
        modal.querySelector('.modal-min-btn')?.addEventListener('click', () => {
          modal.classList.toggle('modal-minimized');
        });
      }
      modal.classList.remove('hidden', 'modal-minimized');
    });
  }
});
