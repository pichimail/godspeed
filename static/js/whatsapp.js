/**
 * WhatsApp Assistants UI — Godspeed
 * Full dynamic per-user, per-contact configuration (name, behaviour, permissions, mode).
 * Each contact gets its own persistent Godspeed session for history.
 *
 * Requires admin to have configured the bridge first (Admin → WhatsApp or /api/whatsapp/admin/bridge).
 */

(function () {
  const WA = window.WA = window.WA || {};

  let currentInstanceId = null;
  let contactsCache = [];
  let configsCache = [];

  function el(id) { return document.getElementById(id); }

  function showToast(msg, kind = "info") {
    if (window.showToast) return window.showToast(msg, kind);
    console.log("[WA]", kind, msg);
  }

  async function api(path, opts = {}) {
    const res = await fetch(`/api/whatsapp${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(txt || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ---------- Main render ----------
  WA.render = async function renderWhatsApp(root) {
    root.innerHTML = `
      <div class="wa-container" style="padding:12px 16px 40px;max-width:1100px;margin:0 auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div>
            <h2 style="margin:0 0 4px">WhatsApp Assistants</h2>
            <div style="color:#888;font-size:13px">Connect your number, customize global + per-contact behaviour, name and permissions. Fully dynamic.</div>
          </div>
          <div>
            <button id="wa-add-btn" class="btn primary">+ Add WhatsApp</button>
            <button id="wa-admin-bridge-btn" class="btn" style="margin-left:8px">Bridge Settings</button>
          </div>
        </div>

        <div id="wa-instances"></div>

        <div id="wa-detail" style="display:none;margin-top:24px;border-top:1px solid #2a2a32;padding-top:16px">
          <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
            <div id="wa-detail-title" style="font-weight:600;font-size:15px"></div>
            <div style="flex:1"></div>
            <button id="wa-refresh-qr" class="btn small">Refresh QR</button>
            <button id="wa-delete" class="btn small danger">Disconnect</button>
            <button id="wa-refresh-contacts" class="btn small">Refresh Contacts</button>
          </div>

          <!-- Global config -->
          <div class="wa-section" style="margin-bottom:18px">
            <div style="font-weight:600;margin-bottom:6px">Global behaviour for this number</div>
            <div id="wa-global-editor"></div>
          </div>

          <!-- Contacts -->
          <div class="wa-section">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <div style="font-weight:600">Contacts &amp; per-contact overrides</div>
              <div style="color:#777;font-size:12px">(each contact gets its own persistent Godspeed session &amp; history)</div>
            </div>
            <div id="wa-contacts-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px"></div>
          </div>
        </div>
      </div>
    `;

    el("wa-add-btn").onclick = () => startPairing();
    el("wa-admin-bridge-btn").onclick = () => showBridgeAdmin();

    await loadInstances();
  };

  async function loadInstances() {
    const container = el("wa-instances");
    container.innerHTML = `<div style="color:#777">Loading...</div>`;
    try {
      const data = await api("/instances");
      const insts = data.instances || [];
      if (!insts.length) {
        container.innerHTML = `<div style="padding:20px;border:1px dashed #444;border-radius:10px;color:#888">No WhatsApp numbers connected yet. Click “+ Add WhatsApp” to pair your phone.</div>`;
        el("wa-detail").style.display = "none";
        return;
      }

      let html = `<div style="display:flex;gap:10px;flex-wrap:wrap">`;
      for (const i of insts) {
        const statusColor = i.status === "connected" ? "#4ade80" : (i.status === "qr_pending" ? "#facc15" : "#888");
        html += `
          <div class="wa-card" data-id="${i.id}" style="min-width:260px;border:1px solid #2a2a32;border-radius:10px;padding:12px 14px;cursor:pointer;background:#1f1f25">
            <div style="display:flex;justify-content:space-between">
              <div>
                <div style="font-weight:600">${i.phone_number || "Unknown number"}</div>
                <div style="font-size:12px;color:#777">${i.bridge_instance_id}</div>
              </div>
              <div style="text-align:right">
                <span style="font-size:11px;padding:1px 7px;border-radius:999px;background:${statusColor}22;color:${statusColor}">${i.status}</span>
              </div>
            </div>
            <div style="margin-top:8px;font-size:12px;color:#888">Last msg: ${i.last_message_at ? new Date(i.last_message_at).toLocaleString() : "—"}</div>
          </div>`;
      }
      html += `</div>`;
      container.innerHTML = html;

      container.querySelectorAll(".wa-card").forEach(card => {
        card.onclick = () => openInstance(card.dataset.id);
      });
    } catch (e) {
      container.innerHTML = `<div style="color:#f66">Failed to load instances: ${e.message}</div>`;
    }
  }

  async function openInstance(id) {
    currentInstanceId = id;
    const detail = el("wa-detail");
    detail.style.display = "block";

    try {
      const inst = await api(`/instances/${id}`);
      el("wa-detail-title").textContent = `${inst.phone_number || inst.bridge_instance_id} — ${inst.status}`;

      el("wa-refresh-qr").onclick = async () => {
        const r = await api(`/instances/${id}/refresh-qr`, { method: "POST" });
        if (r.qr_code) showQRModal(r.qr_code);
      };
      el("wa-delete").onclick = async () => {
        if (!confirm("Disconnect this WhatsApp number?")) return;
        await api(`/instances/${id}`, { method: "DELETE" });
        detail.style.display = "none";
        await loadInstances();
      };
      el("wa-refresh-contacts").onclick = () => loadContacts(id);

      // Render global editor
      await renderConfigEditor(id, "*");

      // Load contacts + their configs
      await loadContacts(id);
    } catch (e) {
      showToast("Failed to open instance: " + e.message, "error");
    }
  }

  async function loadContacts(instanceId) {
    const list = el("wa-contacts-list");
    list.innerHTML = `<div style="padding:12px;color:#777">Loading contacts from WhatsApp...</div>`;
    try {
      const [cdata, cfgs] = await Promise.all([
        api(`/instances/${instanceId}/contacts`),
        api(`/configs?instance_id=${instanceId}`)
      ]);
      contactsCache = cdata.contacts || [];
      configsCache = cfgs.configs || [];

      if (!contactsCache.length) {
        list.innerHTML = `<div style="padding:12px;color:#777">No contacts returned by the bridge yet. Send yourself a message on WhatsApp or tap “Refresh Contacts” after the session is connected.</div>`;
        return;
      }

      let html = "";
      for (const c of contactsCache) {
        const cfg = configsCache.find(x => x.jid === c.jid) || {};
        const hasOverride = !!(cfg.display_name || cfg.personality || (cfg.permissions && Object.keys(cfg.permissions).length));
        html += `
          <div class="wa-contact" data-jid="${c.jid}" style="border:1px solid #2a2a32;border-radius:10px;padding:10px 12px;background:#1a1a20;cursor:pointer">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-weight:600">${c.name || c.jid}</div>
                <div style="font-size:11px;color:#666">${c.jid}</div>
              </div>
              <div style="font-size:11px">${hasOverride ? '<span style="color:#a3e635">custom</span>' : '<span style="color:#555">global</span>'}</div>
            </div>
            <div style="margin-top:6px;font-size:12px;color:#777">Tap to customize behaviour &amp; permissions for this contact</div>
          </div>`;
      }
      list.innerHTML = html;

      list.querySelectorAll(".wa-contact").forEach(card => {
        card.onclick = () => editContactConfig(instanceId, card.dataset.jid, card);
      });
    } catch (e) {
      list.innerHTML = `<div style="color:#f66">Failed to load contacts: ${e.message}</div>`;
    }
  }

  async function renderConfigEditor(instanceId, jid) {
    const container = (jid === "*") ? el("wa-global-editor") : null;
    if (!container) return;

    const eff = await api(`/configs/effective?instance_id=${instanceId}&jid=${encodeURIComponent(jid)}`);
    const cfg = eff.effective || {};

    const perms = cfg.permissions || {};
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label style="font-size:12px;color:#888">Assistant name for ${jid === "*" ? "everyone" : "this contact"}</label>
          <input id="wa-dn" class="input" value="${cfg.display_name || "Godspeed"}" style="width:100%;margin-top:4px">
        </div>
        <div>
          <label style="font-size:12px;color:#888">Mode</label>
          <select id="wa-mode" class="input" style="width:100%;margin-top:4px">
            <option value="conversational" ${cfg.mode === "conversational" ? "selected" : ""}>Conversational (fast, limited tools — recommended)</option>
            <option value="agent" ${cfg.mode === "agent" ? "selected" : ""}>Full Agent (can use tools when permitted)</option>
          </select>
        </div>
      </div>

      <div style="margin-top:10px">
        <label style="font-size:12px;color:#888">Behaviour / Personality (system prompt)</label>
        <textarea id="wa-personality" class="input" style="width:100%;height:120px;margin-top:4px;font-family:monospace;font-size:12px" placeholder="You are a friendly, concise assistant...">${cfg.personality || ""}</textarea>
      </div>

      <div style="margin-top:10px">
        <div style="font-size:12px;color:#888;margin-bottom:4px">Permissions &amp; limits (changes are live on next message)</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px 16px;font-size:13px">
          <label><input type="checkbox" id="wa-full-agent" ${perms.full_agent ? "checked" : ""}> Allow full agent + tools</label>
          <label><input type="checkbox" id="wa-allow-search" ${perms.allow_search !== false ? "checked" : ""}> Allow web search</label>
          <label><input type="checkbox" id="wa-allow-memory" ${perms.allow_memory !== false ? "checked" : ""}> Allow memory</label>
          <label><input type="checkbox" id="wa-groups" ${perms.respond_to_groups ? "checked" : ""}> Respond in groups</label>
          <label><input type="checkbox" id="wa-addressed" ${perms.only_when_addressed !== false ? "checked" : ""}> Only when addressed (groups)</label>
        </div>
        <div style="margin-top:6px">
          <label style="font-size:12px">Max reply length (chars): <input id="wa-maxlen" type="number" class="input" value="${perms.max_reply_length || 1800}" style="width:90px"></label>
        </div>
      </div>

      <div style="margin-top:10px;display:flex;gap:8px">
        <button id="wa-save-cfg" class="btn primary small">Save &amp; Apply (live)</button>
        <button id="wa-reset-cfg" class="btn small">Reset to defaults</button>
        <span id="wa-cfg-status" style="font-size:12px;color:#4ade80;align-self:center"></span>
      </div>
    `;

    const saveBtn = container.querySelector("#wa-save-cfg");
    saveBtn.onclick = async () => {
      const payload = {
        instance_id: instanceId,
        jid,
        display_name: container.querySelector("#wa-dn").value.trim(),
        personality: container.querySelector("#wa-personality").value.trim(),
        mode: container.querySelector("#wa-mode").value,
        permissions: {
          full_agent: container.querySelector("#wa-full-agent").checked,
          allow_search: container.querySelector("#wa-allow-search").checked,
          allow_memory: container.querySelector("#wa-allow-memory").checked,
          respond_to_groups: container.querySelector("#wa-groups").checked,
          only_when_addressed: container.querySelector("#wa-addressed").checked,
          max_reply_length: parseInt(container.querySelector("#wa-maxlen").value || "1800", 10),
        }
      };
      try {
        await api("/configs", { method: "POST", body: JSON.stringify(payload) });
        container.querySelector("#wa-cfg-status").textContent = "Saved — will be used on next message";
        setTimeout(() => container.querySelector("#wa-cfg-status").textContent = "", 2200);
      } catch (e) {
        showToast("Save failed: " + e.message, "error");
      }
    };

    container.querySelector("#wa-reset-cfg").onclick = async () => {
      if (!confirm("Reset this config to global defaults?")) return;
      try {
        await api("/configs", { method: "POST", body: JSON.stringify({
          instance_id: instanceId, jid, display_name: null, personality: null, mode: "conversational",
          permissions: {}, enabled: true
        })});
        await renderConfigEditor(instanceId, jid);
      } catch (e) { showToast(e.message, "error"); }
    };
  }

  async function editContactConfig(instanceId, jid, cardEl) {
    // Open a nice modal with the editor for this specific jid
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-content" style="max-width:720px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-weight:600">Customize for ${jid}</div>
          <button class="btn small" id="wa-close-modal">Close</button>
        </div>
        <div id="wa-contact-editor"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const editorRoot = modal.querySelector("#wa-contact-editor");
    // Reuse the same editor renderer by temporarily mounting
    const tmp = document.createElement("div");
    editorRoot.appendChild(tmp);

    // Load effective + render controls directly
    const eff = await api(`/configs/effective?instance_id=${instanceId}&jid=${encodeURIComponent(jid)}`).catch(() => ({}));
    const cfg = eff.effective || {};

    tmp.innerHTML = `
      <div>
        <label style="font-size:12px;color:#888">Display name (how the assistant introduces itself to this contact)</label>
        <input id="wa-dn2" class="input" value="${cfg.display_name || ""}" style="width:100%">
      </div>
      <div style="margin-top:10px">
        <label style="font-size:12px;color:#888">Behaviour / Personality override (leave empty to inherit global)</label>
        <textarea id="wa-per2" class="input" style="width:100%;height:110px;font-family:monospace;font-size:12px">${cfg.personality || ""}</textarea>
      </div>
      <div style="margin-top:10px">
        <label style="font-size:12px;color:#888">Mode</label>
        <select id="wa-mode2" class="input" style="width:100%">
          <option value="conversational" ${cfg.mode === "conversational" ? "selected" : ""}>Conversational (recommended for most contacts)</option>
          <option value="agent" ${cfg.mode === "agent" ? "selected" : ""}>Full Agent (powerful, uses tools when allowed)</option>
        </select>
      </div>
      <div style="margin-top:10px;font-size:13px">
        <div style="margin-bottom:4px;color:#888">Permissions for this contact</div>
        <label><input type="checkbox" id="wa-fa2" ${ (cfg.permissions||{}).full_agent ? "checked" : "" }> Full agent mode allowed</label><br>
        <label><input type="checkbox" id="wa-s2" ${ (cfg.permissions||{}).allow_search !== false ? "checked" : "" }> Allow search</label>
        <label style="margin-left:12px"><input type="checkbox" id="wa-m2" ${ (cfg.permissions||{}).allow_memory !== false ? "checked" : "" }> Allow memory</label><br>
        <label><input type="checkbox" id="wa-g2" ${ (cfg.permissions||{}).respond_to_groups ? "checked" : "" }> Reply in this group chat</label>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button id="wa-save-contact" class="btn primary">Save for this contact (live)</button>
        <button id="wa-clear-contact" class="btn">Clear override (use global)</button>
      </div>
    `;

    modal.querySelector("#wa-close-modal").onclick = () => modal.remove();

    modal.querySelector("#wa-save-contact").onclick = async () => {
      const payload = {
        instance_id: instanceId,
        jid,
        display_name: tmp.querySelector("#wa-dn2").value.trim() || null,
        personality: tmp.querySelector("#wa-per2").value.trim() || null,
        mode: tmp.querySelector("#wa-mode2").value,
        permissions: {
          full_agent: tmp.querySelector("#wa-fa2").checked,
          allow_search: tmp.querySelector("#wa-s2").checked,
          allow_memory: tmp.querySelector("#wa-m2").checked,
          respond_to_groups: tmp.querySelector("#wa-g2").checked,
        }
      };
      try {
        await api("/configs", { method: "POST", body: JSON.stringify(payload) });
        showToast("Saved — next message from this contact will use the new behaviour", "success");
        modal.remove();
        // refresh the contacts list so "custom" badge updates
        if (currentInstanceId) await loadContacts(currentInstanceId);
      } catch (e) {
        showToast("Save failed: " + e.message, "error");
      }
    };

    modal.querySelector("#wa-clear-contact").onclick = async () => {
      try {
        await api("/configs", { method: "POST", body: JSON.stringify({ instance_id: instanceId, jid, display_name: null, personality: null, permissions: null }) });
        modal.remove();
        if (currentInstanceId) await loadContacts(currentInstanceId);
      } catch (e) { showToast(e.message, "error"); }
    };
  }

  async function startPairing() {
    const phone = prompt("Enter your WhatsApp phone number with country code (e.g. +15551234567). You can also leave empty and scan the QR with any linked device.", "");
    try {
      const res = await api("/instances", {
        method: "POST",
        body: JSON.stringify({ phone_number: phone || null })
      });
      await loadInstances();
      if (res.qr_code) {
        showQRModal(res.qr_code);
      } else {
        // Try to fetch QR immediately
        setTimeout(async () => {
          const insts = (await api("/instances")).instances || [];
          const newest = insts[0];
          if (newest && newest.qr_code) showQRModal(newest.qr_code);
          else showToast("Instance created. Open it and tap Refresh QR if no code appears.", "info");
        }, 800);
      }
    } catch (e) {
      showToast("Pairing failed: " + e.message, "error");
    }
  }

  function showQRModal(qr) {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `
      <div class="modal-content" style="max-width:420px;text-align:center">
        <h3>Scan this QR with WhatsApp</h3>
        <div style="margin:16px 0">
          ${qr && qr.startsWith("data:") ? `<img src="${qr}" style="max-width:280px;border-radius:8px;border:1px solid #333">` : `<pre style="font-size:11px;word-break:break-all;background:#111;padding:8px;border-radius:6px">${qr || "QR not ready yet — try Refresh QR in the instance card"}</pre>`}
        </div>
        <div style="color:#888;font-size:12px">Open WhatsApp on your phone → Linked Devices → Link a Device</div>
        <button class="btn" style="margin-top:14px" onclick="this.closest('.modal').remove()">Close</button>
      </div>
    `;
    document.body.appendChild(m);
  }

  async function showBridgeAdmin() {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `
      <div class="modal-content" style="max-width:520px">
        <h3>WhatsApp Bridge (Admin only)</h3>
        <div style="font-size:13px;color:#888;margin-bottom:10px">Configure once for all users. Point your Evolution API or Waha instance here. The bridge must be able to reach Godspeed on the webhook URL.</div>

        <div>
          <label>Type</label>
          <select id="wa-btype" class="input" style="width:100%">
            <option value="evolution">Evolution API (recommended)</option>
            <option value="waha">Waha</option>
          </select>
        </div>
        <div style="margin-top:8px">
          <label>Bridge URL (e.g. http://localhost:8080 or http://evolution:8080)</label>
          <input id="wa-burl" class="input" style="width:100%" placeholder="http://127.0.0.1:8080">
        </div>
        <div style="margin-top:8px">
          <label>API Key (if required by the bridge)</label>
          <input id="wa-bkey" class="input" style="width:100%" type="password">
        </div>
        <div style="margin-top:8px">
          <label>Webhook Secret (auto-generated if left blank)</label>
          <input id="wa-bsec" class="input" style="width:100%">
        </div>

        <div style="margin-top:14px;display:flex;gap:8px">
          <button id="wa-save-bridge" class="btn primary">Save Bridge Config</button>
          <button onclick="this.closest('.modal').remove()" class="btn">Cancel</button>
        </div>
        <div id="wa-bridge-hint" style="margin-top:10px;font-size:12px;color:#4ade80"></div>
      </div>
    `;
    document.body.appendChild(m);

    // load current
    try {
      const cur = await api("/admin/bridge");
      m.querySelector("#wa-btype").value = cur.bridge_type || "evolution";
      m.querySelector("#wa-burl").value = cur.bridge_url || "";
      m.querySelector("#wa-bkey").value = cur.has_api_key ? "********" : "";
      m.querySelector("#wa-bsec").value = cur.has_webhook_secret ? "********" : "";
    } catch (e) {}

    m.querySelector("#wa-save-bridge").onclick = async () => {
      const payload = {
        bridge_type: m.querySelector("#wa-btype").value,
        bridge_url: m.querySelector("#wa-burl").value.trim(),
        api_key: m.querySelector("#wa-bkey").value || null,
        webhook_secret: m.querySelector("#wa-bsec").value || null,
      };
      try {
        const r = await api("/admin/bridge", { method: "POST", body: JSON.stringify(payload) });
        m.querySelector("#wa-bridge-hint").textContent = "Saved. Webhook URL hint: " + (r.webhook_url_hint || "");
        showToast("Bridge configuration saved. Tell your bridge to post to the webhook URL.", "success");
      } catch (e) {
        showToast("Save failed: " + e.message, "error");
      }
    };
  }

  // Auto-init hook (called from main app if present)
  WA.init = function () {
    // If the main app has a sidebar registration, it will call render when user clicks the nav item.
    console.log("[Godspeed WA] whatsapp.js loaded");
  };

  // If someone opens directly via hash or something
  if (location.hash.includes("whatsapp")) {
    setTimeout(() => {
      const root = document.querySelector("#main-content") || document.body;
      if (root) WA.render(root);
    }, 300);
  }
})();