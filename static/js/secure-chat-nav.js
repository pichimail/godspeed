// Secure Chat Navigation Handler
// Opens the secure chat window when the sidebar button is clicked

document.addEventListener('DOMContentLoaded', () => {
  const secureChatBtn = document.getElementById('tool-secure-chat-btn');

  if (secureChatBtn) {
    secureChatBtn.addEventListener('click', () => {
      // Open secure chat in a new window
      const width = 1200;
      const height = 800;
      const left = (screen.width - width) / 2;
      const top = (screen.height - height) / 2;

      window.open(
        '/static/secure-chat.html',
        'SecureChat',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
      );
    });
  }
});
