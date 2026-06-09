# GodSpeed Chrome Assistant

This is an unpacked Chrome extension for the local GodSpeed workspace.

Features:

- Popup chat against your local GodSpeed instance.
- Page summarization, selected-text explanation, task extraction, reply drafts, and security review prompts.
- Context menu actions on pages and selections.
- Floating in-page assistant opened with the `G` button or `Command/Ctrl+Shift+G`.
- Session reuse so browser work lands in normal GodSpeed chat history.

Install or update GodSpeed on the user's device with one command:

```bash
curl -fsSL -H "Cache-Control: no-cache" https://raw.githubusercontent.com/pewdiepie-archdaemon/odysseus/dev/scripts/install-godspeed.sh | bash
```

Then load the Chrome assistant once:

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `~/.godspeed/app/dist/chrome-assistant`.

The installer writes `config.js` with the local GodSpeed URL and a chat-scoped API token. You can also edit those values in the extension popup.
