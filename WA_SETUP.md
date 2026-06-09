# WhatsApp Assistants — Admin Setup & End-to-End Guide

This turns Godspeed into a **multi-user WhatsApp AI assistant platform** with:

- Per-user WhatsApp number linking (QR flow)
- **Global** + **per-individual-contact** configuration:
  - Name edit (how the assistant presents itself)
  - Behaviour / personality edit (full system prompt)
  - Mode: conversational (fast) or full agent
  - Permissions (full_agent, search, memory, groups, max length, etc.)
- **Each contact gets its own persistent Godspeed session** → excellent long-term memory & context per relationship.
- Fully dynamic: change anything → next incoming WhatsApp message uses the new rules immediately.
- Bridge support for **Evolution API** (recommended) and **Waha**.

## 1. Admin one-time backend setup (you)

### A. Deploy a multi-user WhatsApp bridge
Recommended:
- **Evolution API** (best for many users): https://github.com/EvolutionAPI/evolution-api
  - Docker: `docker run -d --name evolution -p 8080:8080 ...`
- Waha is also supported.

Important: the bridge must be able to **POST webhooks back to Godspeed**.

### B. Configure the bridge inside Godspeed (Admin only)
1. Log in as admin.
2. Go to the new **WhatsApp** section in the sidebar (or call the APIs).
3. Click **Bridge Settings**.
4. Fill:
   - Type: `evolution` (or `waha`)
   - Bridge URL: `http://your-bridge-host:8080`
   - API Key (if your bridge requires one)
   - Webhook Secret (leave blank → auto generated)
5. Save.

Godspeed will tell you the webhook URL you must give the bridge, e.g.:
`/api/whatsapp/webhook?secret=xxx`

In your Evolution/Waha instance settings, set the webhook URL to your full public/LAN/Tailscale Godspeed URL + that path.

### C. (Optional but recommended) Environment variables (Docker / prod)
```env
WA_BRIDGE_URL=http://evolution:8080
WA_BRIDGE_TYPE=evolution
WA_BRIDGE_API_KEY=...
WA_WEBHOOK_SECRET=...
PUBLIC_URL=https://your-public-godspeed.example.com
```

## 2. User experience (self-serve)

1. User clicks **WhatsApp** in sidebar.
2. **+ Add WhatsApp** → enters phone number (optional) → Godspeed asks the bridge to create a session → shows QR code.
3. User scans the QR with their real WhatsApp app (Linked Devices).
4. Once connected, the instance appears with status.
5. Click the instance → configure:
   - **Global** row: name, behaviour, mode, permissions (applies to everyone).
   - **Contacts** list (fetched from the bridge): click any contact → per-contact override (name, behaviour, permissions, agent on/off).
6. Toggle enabled per contact or globally.
7. Done. Incoming messages from that contact are answered automatically according to the latest rules.

Every contact has its own hidden Godspeed chat session (`wa-...`) so context is perfect and isolated.

## 3. Permissions & modes (what the user can control)

In the editor:

- `full_agent` → when true the assistant can use the full Godspeed agent loop + tools (search, memory, calendar...) filtered by the other flags.
- `allow_search`, `allow_memory` etc.
- `respond_to_groups`, `only_when_addressed`
- `max_reply_length`

Default mode is **conversational + light tools** (smart replies, respects memory when permitted). Full agent is opt-in per contact/global for power users.

## 4. Architecture highlights (strict & dynamic)

- `WhatsappInstance` + `WhatsappContactConfig` tables (owner-scoped).
- Global row uses `jid = "*"`.
- On every webhook: live `_load_effective_config` merge → per-contact persistent session → `process_incoming_message` (llm_call or stream_agent_loop with owner + filtered tools) → bridge.send().
- All LLM/agent calls go through the normal owner-scoped paths (memory, RAG, rate limits, endpoints the user is allowed to use).
- Changes in the UI are read on the next message — zero restart required.

## 5. Security notes

- Webhook is protected by secret (or left open only during initial testing).
- Every action is owner-scoped.
- Bridge should never be exposed publicly without auth.
- Running unofficial WhatsApp bridges on personal numbers has ToS/ban risk — document this to your users.

## 6. Troubleshooting

- "Bridge not configured" → admin must save the bridge settings first.
- No QR → click "Refresh QR" on the instance card, or check bridge logs.
- Messages arrive but no reply → check Godspeed logs for the processor, verify the bridge can reach the webhook URL, and that the instance is enabled.
- Want to nuke everything for a user: delete the instance from the UI (it cascades configs + sessions can be cleaned manually).

Enjoy the 1200% integrated WhatsApp Godspeed experience.
