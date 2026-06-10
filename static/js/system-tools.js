// static/js/system-tools.js
/**
 * Mac System Tools Module for Odysseus
 * Provides UI for cleanup, storage analysis, duplicate finder, and dev tools
 */

let API_BASE = '';
let currentView = 'overview';
let storageData = {};
let systemHealth = {};

const systemToolsModule = {
  init(apiBase) {
    API_BASE = apiBase || window.location.origin;
    this.setupEventListeners();
    this.setupNavButton();
  },

  setupNavButton() {
    const navBtn = document.getElementById('tool-system-tools-btn');
    if (navBtn) {
      navBtn.addEventListener('click', () => {
        this.openInDashboardModal();
      });
    }
  },

  openInDashboardModal() {
    // Open inside the main dashboard using the standard modal chrome (exact same flow & outer style as Tasks, Notes, Gallery, etc.)
    // The inner content re-uses the exact existing system-tools.html structure + its existing CSS.
    // No new tab, no blank page, no separate window.
    const modalId = 'system-tools-modal';
    let modal = document.getElementById(modalId);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = modalId;
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content" style="width: 94vw; max-width: 1280px; height: 86vh; display: flex; flex-direction: column;">
          <div class="modal-header">
            <div class="modal-title">System Tools</div>
            <div class="modal-controls">
              <button class="modal-min-btn" title="Minimize">_</button>
              <button class="modal-close-btn" title="Close">✕</button>
            </div>
          </div>
          <div class="modal-body" id="system-tools-modal-body" style="flex: 1 1 auto; padding: 0; overflow: auto; background: var(--bg, #fff);">
            <!-- Populated with the exact existing System Tools panel -->
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const closeBtn = modal.querySelector('.modal-close-btn');
      if (closeBtn) closeBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
      });
      const minBtn = modal.querySelector('.modal-min-btn');
      if (minBtn) minBtn.addEventListener('click', () => {
        modal.classList.toggle('modal-minimized');
      });
    }

    modal.classList.remove('hidden', 'modal-minimized');

    // Bring the inner content (exact existing UI) into the modal body
    const bodyHost = modal.querySelector('#system-tools-modal-body');
    if (!bodyHost) return;

    // Ensure the tool's own (existing) stylesheet is present for its internal tabs/sections/buttons
    if (!document.querySelector('link[href*="system-tools.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/static/css/system-tools.css';
      document.head.appendChild(link);
    }

    // Fetch the exact existing panel HTML so we get 100% the current UI structure without duplication
    fetch('/static/system-tools.html')
      .then(r => r.text())
      .then(htmlText => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const srcPanel = doc.getElementById('system-tools-panel');
        if (srcPanel) {
          bodyHost.innerHTML = '';
          const cloned = srcPanel.cloneNode(true);
          bodyHost.appendChild(cloned);

          // Initialize the existing module logic against the newly inserted DOM
          // The module already looks up by id and has setupEventListeners + load* methods
          this.setupEventListeners();
          if (typeof this.initFullPage === 'function') {
            this.initFullPage();
          } else {
            this.loadSystemHealth();
            this.loadDiskUsage();
          }

          // NEW: inject device-aware advanced tools section (uses main dashboard visual language where possible + existing tool styles)
          this.injectDeviceTools(cloned);
        }
      })
      .catch(err => {
        console.error('Failed to load system tools panel', err);
        bodyHost.innerHTML = '<div style="padding:16px">Failed to load System Tools. Try refreshing the dashboard.</div>';
      });
  },

  injectDeviceTools(panelRoot) {
    // POWERED UP for local Mac + Windows (Chinna-go style features on the *user's* machine).
    // Server/host tools (the original tabs) still work for the Godspeed VPS.
    // This section gives real local RAM, storage, caches, duplicates, free-space tools for the detected client device.
    if (!panelRoot || panelRoot.querySelector('#local-device-section')) return;

    const overview = panelRoot.querySelector('[data-content="overview"]') || panelRoot;
    if (!overview) return;

    const ua = navigator.userAgent || '';
    const platformInfo = (navigator.userAgentData && navigator.userAgentData.platform) || '';
    let deviceType = 'Other';
    let osLabel = 'Unknown';
    let isMac = false;
    let isWindows = false;

    if (/Macintosh|Mac OS X|macOS/i.test(ua) || /Mac/i.test(platformInfo)) {
      osLabel = 'macOS';
      deviceType = 'Mac';
      isMac = true;
    } else if (/Windows|Win32|Win64/i.test(ua) || /Windows/i.test(platformInfo)) {
      osLabel = 'Windows';
      deviceType = 'Windows';
      isWindows = true;
    } else if (/Linux/i.test(ua)) {
      osLabel = 'Linux';
      deviceType = 'Linux';
    }

    const section = document.createElement('div');
    section.id = 'local-device-section';
    section.className = 'system-tools-section';
    section.style.border = '1px solid rgba(255,255,255,0.1)';
    section.innerHTML = `
      <h2>
        <span class="section-icon">🖥️</span> 
        Your Local ${osLabel} <span style="font-size:11px;opacity:.6">(client device — not the server)</span>
      </h2>
      <div id="local-device-info" style="margin:8px 0 12px;font-size:13px;line-height:1.35;opacity:.95"></div>

      <div style="margin-bottom:8px">
        <strong>Chinna-style Local Tools</strong> — run on <em>your</em> Mac/Windows to read real RAM, storage hogs, caches, duplicates and free unnecessary space.
      </div>

      <div class="cleanup-actions" id="local-actions" style="flex-wrap:wrap;gap:6px"></div>

      <div id="local-report-area" style="margin-top:12px">
        <div style="font-size:12px;margin-bottom:4px;opacity:.8">Paste output from the scan command below for beautiful local data (RAM, biggest caches, potential free space, etc.)</div>
        <textarea id="local-report-input" rows="4" style="width:100%;font-family:monospace;font-size:12px;background:#111;color:#ddd;border:1px solid #333" placeholder="Paste the report here..."></textarea>
        <button id="parse-local-report-btn" class="cleanup-btn" style="margin-top:6px">Parse &amp; Show Local Mac/Windows Data</button>
        <div id="local-parsed-results" style="margin-top:10px"></div>
      </div>
    `;

    // Insert at very top of overview so it's the first thing the user sees for "their" device
    const firstSection = overview.querySelector('.system-tools-section');
    if (firstSection) {
      firstSection.parentNode.insertBefore(section, firstSection);
    } else {
      overview.prepend(section);
    }

    const infoEl = section.querySelector('#local-device-info');
    const actionsEl = section.querySelector('#local-actions');

    // Rich client fingerprint (always available)
    const mem = navigator.deviceMemory ? `${navigator.deviceMemory} GB (reported)` : 'detailed RAM via Terminal scan';
    const cores = navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} cores` : '';
    infoEl.innerHTML = `
      <strong>Detected:</strong> ${osLabel} &nbsp; <strong>Cores:</strong> ${cores || '—'} &nbsp; <strong>Memory:</strong> ${mem}<br>
      <strong>Browser:</strong> ${navigator.platform || ''} &nbsp;|&nbsp; Online: ${navigator.onLine ? '✓' : '✗'}
    `;

    // === PRIMARY POWERUP BUTTONS (Chinna-go features for the user's real machine) ===

    // 1. Generate the exact local scan command (safe, read-only, Chinna-inspired)
    const scanBtn = document.createElement('button');
    scanBtn.className = 'cleanup-btn';
    scanBtn.textContent = isMac ? ' Generate Local Mac Scan Command (RAM + caches + storage)' : (isWindows ? '🪟 Generate Windows Local Scan Command' : 'Generate Local Scan Command');
    scanBtn.onclick = () => {
      const cmd = this.generateLocalScanCommand(deviceType);
      navigator.clipboard?.writeText(cmd);
      const ta = section.querySelector('#local-report-input');
      if (ta) ta.placeholder = 'Command copied to clipboard. Run it in your Terminal, then paste the full output here.';
      alert('Scan command copied! Run it on your ' + osLabel + ' machine and paste the output into the box below.');
    };
    actionsEl.appendChild(scanBtn);

    // 2. Parse button (already in HTML, wire it)
    const parseBtn = section.querySelector('#parse-local-report-btn');
    if (parseBtn) {
      parseBtn.onclick = () => this.parseAndRenderLocalReport(section);
    }

    // 3. Big "Free Space" actions — copy the real advanced Chinna cleanup commands for the detected OS
    if (isMac) {
      const deepBtn = document.createElement('button');
      deepBtn.className = 'cleanup-btn deep';
      deepBtn.textContent = '🔥 Copy Deep Mac Cleanup (caches, Xcode, brew, logs...)';
      deepBtn.onclick = () => {
        const cmds = this.getMacChinnaCleanupCommands();
        navigator.clipboard?.writeText(cmds);
        alert('Advanced Mac cleanup commands copied. Review them, then paste & run in Terminal. This is the Chinna deep clean logic.');
      };
      actionsEl.appendChild(deepBtn);

      const ramBtn = document.createElement('button');
      ramBtn.className = 'cleanup-btn';
      ramBtn.textContent = '💾 Copy Purge RAM + Free Inactive Memory';
      ramBtn.onclick = () => {
        navigator.clipboard?.writeText('sudo purge\n# or without sudo: purge\nvm_stat | grep -i "Pages free"');
        alert('RAM purge command copied. Run "purge" (or sudo purge) on your Mac.');
      };
      actionsEl.appendChild(ramBtn);
    }

    if (isWindows) {
      const winClean = document.createElement('button');
      winClean.className = 'cleanup-btn deep';
      winClean.textContent = '🪟 Copy Windows Deep Cleanup (temp, caches, disk cleanup)';
      winClean.onclick = () => {
        const cmds = this.getWindowsChinnaCleanupCommands();
        navigator.clipboard?.writeText(cmds);
        alert('Windows cleanup commands copied. Run in admin PowerShell or Command Prompt.');
      };
      actionsEl.appendChild(winClean);
    }

    // 4. Always useful: one-click "biggest usual space wasters on this OS"
    const hogsBtn = document.createElement('button');
    hogsBtn.className = 'cleanup-btn light';
    hogsBtn.textContent = isMac ? '📦 Show Top Mac Space Hogs (Xcode, Caches, iOS sims...)' : '📦 Show Typical Windows Space Hogs';
    hogsBtn.onclick = () => {
      const hogs = isMac ? this.getMacSpaceHogsList() : this.getWindowsSpaceHogsList();
      navigator.clipboard?.writeText(hogs);
      alert('Typical big space consumers + cleanup paths copied. Use with the scan above.');
    };
    actionsEl.appendChild(hogsBtn);

    // 5. AI powerup — turn a local report into smart advice inside the app
    const aiBtn = document.createElement('button');
    aiBtn.className = 'cleanup-btn';
    aiBtn.textContent = '🧠 Analyze my local report with Godspeed AI';
    aiBtn.onclick = () => {
      const input = section.querySelector('#local-report-input');
      const report = (input && input.value.trim()) || 'User has a ' + osLabel + ' machine. Please give prioritized cleanup advice based on common Mac/Windows space wasters.';
      // Best effort: open/focus main chat and give the user a ready prompt they can send
      const prompt = `Here is output from a local system scan on my ${osLabel}:\n\n${report}\n\nUsing Chinna-style analysis, tell me exactly which folders/files are wasting the most space and give me the safest commands (with explanations) to free the maximum GB with lowest risk. Prioritize user caches, dev artifacts, logs, and duplicates.`;
      navigator.clipboard?.writeText(prompt);
      if (window.showToast) window.showToast('Prompt copied — paste into any chat with Godspeed for full AI analysis + exact commands.', 'success');
      else alert('Prompt copied to clipboard. Go to a chat and paste it for deep AI advice on your local machine.');
    };
    actionsEl.appendChild(aiBtn);

    // Battery / extra client info (nice to have)
    if ('getBattery' in navigator) {
      navigator.getBattery().then(b => {
        const bdiv = document.createElement('div');
        bdiv.style.cssText = 'margin-top:8px;font-size:12px;opacity:.85';
        bdiv.textContent = `Battery: ${Math.round(b.level*100)}% ${b.charging ? '⚡ charging' : ''}`;
        infoEl.appendChild(bdiv);
      }).catch(() => {});
    }

    // === LIVE LOCAL AGENT EXTENSION (proper powerup) ===
    // Shows connection status + "Pair Local Agent" that mints a token and gives the exact run command.
    // When agent is connected, the section switches to live data (no more manual paste) and real execution.
    this._enhanceWithLiveLocalAgent(section, deviceType, osLabel, actionsEl);
  },

  async _enhanceWithLiveLocalAgent(section, deviceType, osLabel, actionsEl) {
    // Status line
    const statusLine = document.createElement('div');
    statusLine.id = 'local-agent-status';
    statusLine.style.cssText = 'margin: 10px 0; padding: 6px 10px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 12px;';
    statusLine.textContent = 'Checking local agent status...';
    section.appendChild(statusLine);

    const pairBtn = document.createElement('button');
    pairBtn.className = 'cleanup-btn';
    pairBtn.textContent = '🔗 Pair / Start Local Agent on my ' + osLabel;
    pairBtn.style.marginLeft = '6px';

    async function refreshStatus() {
      try {
        const r = await fetch('/api/system-tools/local/status');
        const j = await r.json();
        const connected = !!j.connected;
        statusLine.innerHTML = connected
          ? `<span style="color:#0f0">● Local agent CONNECTED</span> — live ${osLabel} data &amp; actions available`
          : `<span style="color:#f80">● No local agent</span> — click Pair below to connect your real Mac/Windows`;

        // If connected, upgrade some buttons to live calls
        if (connected) {
          pairBtn.textContent = '✓ Local Agent Running (click to see instructions again)';
          // Replace the parse-heavy flow with live buttons
          const liveHealth = document.createElement('button');
          liveHealth.className = 'cleanup-btn';
          liveHealth.textContent = '🔄 Refresh Live ' + osLabel + ' Health / RAM / Storage';
          liveHealth.onclick = async () => {
            try {
              const [h, d] = await Promise.all([
                fetch('/api/system-tools/local/health').then(r => r.json()),
                fetch('/api/system-tools/local/disk/usage').then(r => r.json())
              ]);
              const info = section.querySelector('#local-device-info') || statusLine;
              info.innerHTML = `<strong>Live from your ${osLabel}:</strong><br>` +
                `CPU: ${h.data?.cpu?.percent || '?'}% &nbsp; RAM: ${h.data?.memory?.percent || '?'}% available ${h.data?.memory?.available_gb || ''}GB<br>` +
                `Disk free: ${d.data?.free_gb || '?'} GB (${d.data?.percent || '?'}% used)`;
              if (window.showToast) window.showToast('Live local data refreshed from your machine', 'success');
            } catch (e) {
              if (window.showToast) window.showToast('Failed to get live data — is the agent still running?', 'error');
            }
          };
          actionsEl.appendChild(liveHealth);

          // Live cleanup buttons
          const liveLight = document.createElement('button');
          liveLight.className = 'cleanup-btn light';
          liveLight.textContent = '🧹 Run Light Cleanup on my ' + osLabel;
          liveLight.onclick = () => this._runLiveLocalAction('light', section);
          actionsEl.appendChild(liveLight);

          const liveDeep = document.createElement('button');
          liveDeep.className = 'cleanup-btn deep';
          liveDeep.textContent = '🔥 Run Deep Chinna Cleanup on my ' + osLabel;
          liveDeep.onclick = () => this._runLiveLocalAction('deep', section);
          actionsEl.appendChild(liveDeep);

          if (deviceType === 'Mac') {
            const livePurge = document.createElement('button');
            livePurge.className = 'cleanup-btn';
            livePurge.textContent = '💾 Purge RAM on my Mac (now live)';
            livePurge.onclick = () => this._runLiveLocalAction('purge', section);
            actionsEl.appendChild(livePurge);
          }
        }
      } catch (e) {
        statusLine.textContent = 'Could not check local agent status (are you logged in?)';
      }
    }

    pairBtn.onclick = async () => {
      try {
        const r = await fetch('/api/system-tools/local/mint-agent-token', { method: 'POST' });
        const j = await r.json();
        if (j.token) {
          const cmd = `python3 -m pip install --upgrade pip psutil websockets\npython3 companion/local_system_tools_agent.py --server https://godspeed.itsmechinna.com --token ${j.token}`;
          navigator.clipboard?.writeText(cmd);
          alert('Agent token minted & command copied!\n\n1. On your Mac or Windows machine run the two lines.\n2. Keep the agent running.\n3. Come back here and refresh System Tools — it will switch to live mode.\n\n' + cmd);
        } else {
          alert('Could not mint token: ' + (j.error || 'unknown'));
        }
      } catch (e) {
        alert('Mint failed — are you logged in as a real user?');
      }
      await refreshStatus();
    };
    actionsEl.appendChild(pairBtn);

    // Initial status check
    await refreshStatus();
    // Re-check every 15s while the panel is open (lightweight)
    const iv = setInterval(refreshStatus, 15000);
    // Clean up interval when section is removed (best effort)
    const observer = new MutationObserver(() => {
      if (!document.body.contains(section)) {
        clearInterval(iv);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  },

  async _runLiveLocalAction(kind, section) {
    const status = section.querySelector('#local-agent-status');
    let endpoint = '';
    let label = '';
    if (kind === 'light') { endpoint = '/api/system-tools/local/cleanup/light'; label = 'Light cleanup'; }
    else if (kind === 'deep') { endpoint = '/api/system-tools/local/cleanup/deep'; label = 'Deep Chinna cleanup'; }
    else if (kind === 'purge') { endpoint = '/api/system-tools/local/purge-ram'; label = 'RAM purge'; }

    if (!endpoint) return;

    if (!confirm(`Really run ${label} on your LOCAL ${section.querySelector('h2')?.textContent || 'machine'}?`)) return;

    try {
      const r = await fetch(endpoint, { method: 'POST' });
      const j = await r.json();
      if (window.showToast) {
        window.showToast(`${label} completed on your machine. Freed ~${j.data?.total_freed_mb || j.data?.freed_mb || '?'} MB`, 'success');
      }
      // Refresh live health after action
      const h = await fetch('/api/system-tools/local/health').then(r => r.json());
      const info = section.querySelector('#local-device-info');
      if (info && h.data) {
        info.innerHTML = `<strong>Live after ${label}:</strong><br>RAM available: ${h.data.memory?.available_gb || '?'} GB (${h.data.memory?.percent || '?'}%)`;
      }
    } catch (e) {
      if (window.showToast) window.showToast('Live local action failed — is your agent still connected?', 'error');
    }
  },

  generateLocalScanCommand(deviceType) {
    if (deviceType === 'Mac') {
      return `# === GODSPED LOCAL macOS CHINNA-STYLE SCAN (safe, read-only) ===
echo "=== GODSPED LOCAL MAC REPORT - $(date) ==="
echo "=== OVERALL DISK ==="
df -h /
echo ""
echo "=== USER HOME DISK USAGE ==="
du -sh ~ 2>/dev/null
echo ""
echo "=== TOP CACHE & DEV SPACE HOGS (Mac Chinna paths) ==="
du -sh ~/Library/Caches/* ~/Library/Logs/* ~/Library/Developer/Xcode/DerivedData ~/Library/Developer/Xcode/Archives 2>/dev/null | sort -h | tail -25
echo ""
echo "=== RAM (vm_stat) ==="
vm_stat | head -15
echo ""
echo "=== LARGEST FILES (>100MB in home) ==="
find ~ -type f -size +100M 2>/dev/null -exec du -sh {} + | sort -h | tail -15
echo ""
echo "=== BREW / NODE / CARGO CACHES (if present) ==="
du -sh ~/.npm ~/.cache ~/.cargo 2>/dev/null || true
echo ""
echo "=== iOS Simulator + other big ones ==="
du -sh ~/Library/Developer/CoreSimulator 2>/dev/null || true
echo "=== END OF REPORT - copy everything above and paste into Godspeed System Tools ==="`;
    } else if (deviceType === 'Windows') {
      return `# === GODSPED LOCAL WINDOWS SCAN (run in PowerShell as normal user) ===
Write-Output "=== GODSPED LOCAL WINDOWS REPORT - $(Get-Date) ==="
Write-Output "=== OVERALL DISK ==="
Get-Volume | Select-Object DriveLetter, SizeRemaining, Size | Format-Table
Write-Output "=== TEMP & CACHE FOLDERS ==="
$paths = @($env:TEMP, $env:LOCALAPPDATA + "\\Temp", $env:LOCALAPPDATA + "\\Microsoft\\Windows\\Explorer", $env:LOCALAPPDATA + "\\Google\\Chrome\\User Data\\Default\\Cache")
foreach ($p in $paths) { if (Test-Path $p) { Write-Output "$p : $((Get-ChildItem $p -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1GB) GB" } }
Write-Output "=== LARGE FILES (>100MB) ==="
Get-ChildItem ~ -Recurse -File -ErrorAction SilentlyContinue | Where-Object Length -gt 100MB | Sort-Object Length -Descending | Select-Object -First 15 FullName, @{N='SizeMB';E={[math]::Round($_.Length/1MB,1)}} | Format-Table
Write-Output "=== END OF REPORT - copy all output and paste back into Godspeed System Tools ==="`;
    }
    return 'echo "Run platform-appropriate du / df / vm_stat / Get-Volume commands and paste output"';
  },

  getMacChinnaCleanupCommands() {
    return `# === ADVANCED macOS CHINNA-STYLE CLEANUP (from the original integration) ===
# Review every line before running. These target the biggest unnecessary space consumers.

# User caches (light + deep)
rm -rf ~/Library/Caches/* ~/Library/Logs/* 2>/dev/null

# Dev / build artifacts (very common space wasters)
rm -rf ~/Library/Developer/Xcode/DerivedData/* ~/Library/Developer/Xcode/Archives/* 2>/dev/null
rm -rf ~/Library/Developer/CoreSimulator/* 2>/dev/null   # iOS simulators

# Package managers
brew cleanup -s 2>/dev/null || true
npm cache clean --force 2>/dev/null || true
yarn cache clean 2>/dev/null || true

# VS Code, cargo, general
rm -rf ~/Library/Caches/com.microsoft.VSCode/* ~/.cargo/registry/cache/* ~/.cache/* 2>/dev/null

# Optional deeper (uncomment if you know what you're doing)
# sudo rm -rf /Library/Caches/* /System/Library/Caches/*   # system-wide, needs care

echo "Done. Check with 'df -h /' and 'du -sh ~/Library/Caches' again."
echo "For RAM: sudo purge   (or just 'purge')"`;
  },

  getWindowsChinnaCleanupCommands() {
    return `# === Windows equivalent (PowerShell - run as Administrator where noted) ===
# Temp & cache cleanup
Remove-Item -Path $env:TEMP\\* -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path $env:LOCALAPPDATA\\Temp\\* -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path $env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer\\* -Recurse -Force -ErrorAction SilentlyContinue

# Run built-in Disk Cleanup (sageset/sagerun for automation)
cleanmgr /sagerun:1

# Optional deeper (browser caches, Windows Update, Prefetch)
# Remove-Item -Path "$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\Default\\Cache\\*" -Recurse -Force -ErrorAction SilentlyContinue
# Remove-Item -Path C:\\Windows\\SoftwareDistribution\\Download\\* -Recurse -Force -ErrorAction SilentlyContinue   # after stopping wuauserv
# Remove-Item -Path C:\\Windows\\Prefetch\\* -Force -ErrorAction SilentlyContinue

Write-Output "Windows cleanup commands executed / copied. Reboot recommended after big cleanups."`;
  },

  getMacSpaceHogsList() {
    return `# Common massive space wasters on macOS (Chinna priorities)
~/Library/Developer/Xcode/DerivedData          # often 10-100+ GB
~/Library/Developer/CoreSimulator             # iOS simulators
~/Library/Caches/com.apple.dt.Xcode           # Xcode caches
~/Library/Caches                              # general user caches
~/Library/Logs
~/.npm / ~/.cache / ~/.cargo
~/Library/Application Support/Code/CachedData # VS Code
MobileBackups (if Time Machine on external)
`;
  },

  getWindowsSpaceHogsList() {
    return `# Common space wasters on Windows
%TEMP% and %LOCALAPPDATA%\\Temp
%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Cache
C:\\Windows\\SoftwareDistribution\\Download
C:\\Windows\\Prefetch
C:\\Windows\\Temp
Recycle Bin + old Windows.old folder
User Downloads + Documents with old builds
`;
  },

  parseAndRenderLocalReport(section) {
    const ta = section.querySelector('#local-report-input');
    const out = section.querySelector('#local-parsed-results');
    if (!ta || !out) return;

    const text = ta.value.trim();
    if (!text) {
      out.innerHTML = '<div style="color:#f66">Paste a report first.</div>';
      return;
    }

    // Very lightweight parser for the kind of output our generated command produces
    let html = '<div class="system-tools-section" style="margin-top:8px"><h3>Parsed Local Report</h3>';

    // Disk / size lines
    const dfMatch = text.match(/=== OVERALL DISK ===([\s\S]*?)(===|$)/i);
    if (dfMatch) {
      html += `<pre style="font-size:11px;background:#111;padding:8px;overflow:auto">${dfMatch[1].trim()}</pre>`;
    }

    // Top hogs
    const hogsMatch = text.match(/=== TOP .*HOGS[\s\S]*?(===|$)/i);
    if (hogsMatch) {
      html += `<h4>Biggest space consumers (from your machine)</h4><pre style="font-size:11px;background:#111;padding:8px">${hogsMatch[0].trim()}</pre>`;
    }

    // RAM
    const ramMatch = text.match(/=== RAM[\s\S]*?(===|$)/i);
    if (ramMatch) {
      html += `<h4>RAM / Memory</h4><pre style="font-size:11px;background:#111;padding:8px">${ramMatch[0].trim()}</pre>`;
    }

    // Any size numbers we can highlight
    const gbLines = text.match(/[\d.]+\s*GB|[\d.]+\s*MB/gi);
    if (gbLines && gbLines.length) {
      html += `<div style="margin:6px 0"><strong>Numbers found:</strong> ${gbLines.slice(0,8).join(' • ')}</div>`;
    }

    html += `<div style="margin-top:8px;font-size:12px;opacity:.8">Use the cleanup command buttons above to free the hogs shown here. Paste more reports anytime.</div></div>`;
    out.innerHTML = html;
  },

  captureClientSnapshot(infoContainer) {
    const data = {
      detectedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory || null,
      onLine: navigator.onLine,
      cookieEnabled: navigator.cookieEnabled,
      screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
    };
    const txt = JSON.stringify(data, null, 2);
    navigator.clipboard?.writeText(txt);
    if (infoContainer) infoContainer.innerHTML += `<br><small style="color:#0a0">Snapshot copied to clipboard. Paste into a Godspeed chat for analysis.</small>`;
    else if (window.showToast) window.showToast('Device snapshot copied — paste it into chat for AI advice', 'success');
  },

  manageLocalStorage() {
    try {
      const keys = Object.keys(localStorage);
      const size = new Blob(Object.values(localStorage)).size;
      const msg = `This site has ${keys.length} localStorage keys (~${Math.round(size/1024)} KB).\nClear Godspeed-related data for this browser?`;
      if (confirm(msg)) {
        keys.filter(k => /odysseus|godspeed|chat|session|memory/i.test(k)).forEach(k => localStorage.removeItem(k));
        if (window.showToast) window.showToast('Local Godspeed data cleared for this browser tab/origin.', 'success');
      }
    } catch (e) {
      alert('Local storage management not available in this context.');
    }
  },

  getPredictiveSuggestion(deviceType, osLabel) {
    const hour = new Date().getHours();
    if (deviceType === 'Mac') {
      if (hour > 20) return 'Evening on macOS — consider a deep cache clean + RAM purge before sleep. Also close heavy Electron apps.';
      return 'Mid-day Mac session — Light cleanup + check node_modules / Docker if you have been coding.';
    }
    if (deviceType === 'Windows') {
      return 'On Windows — run disk cleanup + check Startup apps in Task Manager. Consider browser tab hygiene.';
    }
    return 'Cross-platform tip: Close unused apps, clear browser cache for the current site, and review large Downloads folder.';
  },


  async loadSystemHealth() {
    try {
      const res = await fetch(`${API_BASE}/api/system-tools/system/health`);
      const json = await res.json();
      if (json.success) {
        systemHealth = json.data;
        this.renderSystemHealth();
      }
    } catch (err) {
      console.error('Error loading system health:', err);
    }
  },

  initFullPage() {
    // Called when loading the full system-tools.html page (standalone or direct link)
    this.loadSystemHealth();
    this.loadDiskUsage();
    // Also surface the device tools when someone opens the standalone directly
    setTimeout(() => {
      const panel = document.getElementById('system-tools-panel');
      if (panel) this.injectDeviceTools(panel);
    }, 120);
  },

  async loadDiskUsage() {
    try {
      const res = await fetch(`${API_BASE}/api/system-tools/disk/usage`);
      const json = await res.json();
      if (json.success) {
        this.renderDiskUsage(json.data);
      }
    } catch (err) {
      console.error('Error loading disk usage:', err);
    }
  },

  async analyzeStorage(path = null) {
    try {
      const url = new URL(`${API_BASE}/api/system-tools/storage/analyze`);
      if (path) url.searchParams.set('path', path);
      url.searchParams.set('limit', '50');
      url.searchParams.set('min_size_mb', '10');

      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        storageData = json.data;
        this.renderStorageAnalysis();
      }
    } catch (err) {
      console.error('Error analyzing storage:', err);
    }
  },

  async runCleanup(level) {
    const confirmMsg = {
      light: 'Run light cleanup (clear user caches)?',
      deep: 'Run deep Mac cleanup? This will clear caches, build artifacts, and more.',
      docker: 'Clean Docker images and containers?'
    };

    if (!confirm(confirmMsg[level] || 'Run cleanup?')) return;

    try {
      const res = await fetch(`${API_BASE}/api/system-tools/cleanup/${level}`, {
        method: 'POST'
      });
      const json = await res.json();

      if (json.success) {
        this.showNotification(`Cleanup complete! Freed ${json.data.total_freed_gb || 0} GB`, 'success');
        this.renderCleanupResults(json.data);
      } else {
        this.showNotification('Cleanup failed: ' + json.error, 'error');
      }
    } catch (err) {
      console.error('Cleanup error:', err);
      this.showNotification('Cleanup failed', 'error');
    }
  },

  async scanNodeModules() {
    try {
      const res = await fetch(`${API_BASE}/api/system-tools/cleanup/node-modules/scan`);
      const json = await res.json();

      if (json.success) {
        this.renderNodeModulesResults(json.data);
      }
    } catch (err) {
      console.error('Error scanning node_modules:', err);
    }
  },

  async findDuplicates() {
    this.showNotification('Scanning for duplicates... This may take a while.', 'info');

    try {
      const res = await fetch(`${API_BASE}/api/system-tools/duplicates/find`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          search_path: null,
          min_size_mb: 1,
          extensions: null
        })
      });
      const json = await res.json();

      if (json.success) {
        this.renderDuplicatesResults(json.data);
        this.showNotification(`Found ${json.data.total_groups} duplicate groups`, 'success');
      } else {
        this.showNotification('Duplicate scan failed', 'error');
      }
    } catch (err) {
      console.error('Duplicate scan error:', err);
      this.showNotification('Duplicate scan failed', 'error');
    }
  },

  async purgeRAM() {
    if (!confirm('Purge inactive RAM? This is safe but may temporarily slow down your Mac.')) return;

    try {
      const res = await fetch(`${API_BASE}/api/system-tools/ram/purge`, {
        method: 'POST'
      });
      const json = await res.json();

      if (json.success && json.data.success) {
        this.showNotification(`RAM purged! Freed ${json.data.freed_gb || 0} GB`, 'success');
        this.loadSystemHealth();
      } else {
        this.showNotification('RAM purge failed', 'error');
      }
    } catch (err) {
      console.error('RAM purge error:', err);
      this.showNotification('RAM purge failed', 'error');
    }
  },

  async killPort() {
    const port = prompt('Enter port number to free:');
    if (!port || !/^\d+$/.test(port)) return;

    try {
      const res = await fetch(`${API_BASE}/api/system-tools/dev/kill-port`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ port: parseInt(port) })
      });
      const json = await res.json();

      if (json.success) {
        this.showNotification(json.data.message, 'success');
      } else {
        this.showNotification('Failed to free port', 'error');
      }
    } catch (err) {
      console.error('Kill port error:', err);
      this.showNotification('Failed to free port', 'error');
    }
  },

  async listPorts() {
    try {
      const res = await fetch(`${API_BASE}/api/system-tools/dev/ports`);
      const json = await res.json();

      if (json.success) {
        this.renderPortsList(json.data.ports);
      }
    } catch (err) {
      console.error('Error listing ports:', err);
    }
  },

  // Rendering methods

  renderSystemHealth() {
    const container = document.getElementById('system-health-display');
    if (!container) return;

    const { cpu, memory, disk, battery } = systemHealth;

    container.innerHTML = `
      <div class="health-cards">
        <div class="health-card cpu">
          <div class="health-icon">🖥️</div>
          <div class="health-label">CPU</div>
          <div class="health-value">${cpu?.percent || 0}%</div>
          <div class="health-detail">${cpu?.count || 0} cores</div>
        </div>

        <div class="health-card memory">
          <div class="health-icon">💾</div>
          <div class="health-label">RAM</div>
          <div class="health-value">${memory?.percent || 0}%</div>
          <div class="health-detail">${memory?.available_gb || 0} GB free</div>
        </div>

        <div class="health-card disk">
          <div class="health-icon">💿</div>
          <div class="health-label">Disk</div>
          <div class="health-value">${disk?.percent || 0}%</div>
          <div class="health-detail">${disk?.free_gb || 0} GB free</div>
        </div>

        ${battery ? `
          <div class="health-card battery">
            <div class="health-icon">${battery.plugged_in ? '🔌' : '🔋'}</div>
            <div class="health-label">Battery</div>
            <div class="health-value">${battery.percent}%</div>
            <div class="health-detail">${battery.plugged_in ? 'Charging' : 'On Battery'}</div>
          </div>
        ` : ''}
      </div>
    `;
  },

  renderDiskUsage(data) {
    const container = document.getElementById('disk-usage-display');
    if (!container) return;

    container.innerHTML = `
      <div class="disk-usage-bar">
        <div class="disk-usage-fill" style="width: ${data.percent}%"></div>
      </div>
      <div class="disk-usage-stats">
        <span>${data.used_gb} GB used</span>
        <span>${data.free_gb} GB free</span>
        <span>${data.total_gb} GB total</span>
      </div>
    `;
  },

  renderStorageAnalysis() {
    const container = document.getElementById('storage-analysis-display');
    if (!container) return;

    container.innerHTML = `
      <div class="storage-items">
        ${storageData.items.map(item => `
          <div class="storage-item">
            <div class="storage-item-icon">${item.type === 'directory' ? '📁' : '📄'}</div>
            <div class="storage-item-info">
              <div class="storage-item-name">${item.name}</div>
              <div class="storage-item-path">${item.path}</div>
            </div>
            <div class="storage-item-size">${item.size_gb.toFixed(2)} GB</div>
          </div>
        `).join('')}
      </div>
    `;
  },

  renderCleanupResults(results) {
    const container = document.getElementById('cleanup-results');
    if (!container) return;

    container.innerHTML = `
      <div class="cleanup-summary">
        <h3>✅ Cleanup Complete</h3>
        <p class="cleanup-total">Freed: ${results.total_freed_gb || 0} GB</p>
      </div>
      <div class="cleanup-targets">
        ${results.targets.map(t => `
          <div class="cleanup-target">
            <span class="target-name">${t.name}</span>
            <span class="target-freed">${t.freed_mb || 0} MB</span>
          </div>
        `).join('')}
      </div>
    `;
  },

  renderNodeModulesResults(data) {
    const container = document.getElementById('node-modules-results');
    if (!container) return;

    container.innerHTML = `
      <div class="node-modules-summary">
        <p>Found <strong>${data.count}</strong> node_modules directories</p>
        <p>Total size: <strong>${data.total_size_gb} GB</strong></p>
      </div>
      <div class="node-modules-list">
        ${data.found.map(item => `
          <div class="node-module-item">
            <span class="module-path">${item.path}</span>
            <span class="module-size">${item.size_gb.toFixed(2)} GB</span>
          </div>
        `).join('')}
      </div>
    `;
  },

  renderDuplicatesResults(data) {
    const container = document.getElementById('duplicates-results');
    if (!container) return;

    container.innerHTML = `
      <div class="duplicates-summary">
        <p>Found <strong>${data.total_groups}</strong> duplicate groups</p>
        <p>Potential savings: <strong>${data.potential_savings_gb} GB</strong></p>
      </div>
      <div class="duplicates-list">
        ${data.groups.map(group => `
          <div class="duplicate-group">
            <div class="duplicate-header">
              <span>${group.count} duplicates</span>
              <span>${(group.size / (1024*1024)).toFixed(2)} MB each</span>
            </div>
            <div class="duplicate-files">
              ${group.paths.map(path => `
                <div class="duplicate-file">
                  <input type="checkbox" class="duplicate-checkbox" data-path="${path}">
                  <span class="duplicate-path">${path}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-danger" onclick="systemTools.removeSelectedDuplicates()">
        Remove Selected
      </button>
    `;
  },

  renderPortsList(ports) {
    const container = document.getElementById('ports-list');
    if (!container) return;

    container.innerHTML = `
      <div class="ports-table">
        ${ports.map(port => `
          <div class="port-row">
            <span class="port-number">:${port.port}</span>
            <span class="port-command">${port.command}</span>
            <span class="port-pid">PID: ${port.pid}</span>
            <button class="btn btn-sm btn-danger" onclick="systemTools.killSpecificPort(${port.port})">
              Kill
            </button>
          </div>
        `).join('')}
      </div>
    `;
  },

  async removeSelectedDuplicates() {
    const checkboxes = document.querySelectorAll('.duplicate-checkbox:checked');
    const paths = Array.from(checkboxes).map(cb => cb.dataset.path);

    if (paths.length === 0) {
      this.showNotification('No files selected', 'info');
      return;
    }

    if (!confirm(`Remove ${paths.length} duplicate files?`)) return;

    try {
      const res = await fetch(`${API_BASE}/api/system-tools/duplicates/remove`, {
        method: 'DELETE',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(paths)
      });
      const json = await res.json();

      if (json.success) {
        this.showNotification(`Removed ${json.data.count} files`, 'success');
        this.findDuplicates();  // Refresh
      } else {
        this.showNotification('Failed to remove files', 'error');
      }
    } catch (err) {
      console.error('Error removing duplicates:', err);
      this.showNotification('Failed to remove files', 'error');
    }
  },

  async killSpecificPort(port) {
    try {
      const res = await fetch(`${API_BASE}/api/system-tools/dev/kill-port`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ port })
      });
      const json = await res.json();

      if (json.success) {
        this.showNotification(`Port ${port} freed`, 'success');
        this.listPorts();  // Refresh
      } else {
        this.showNotification('Failed to free port', 'error');
      }
    } catch (err) {
      console.error('Error killing port:', err);
    }
  },

  setupEventListeners() {
    // System tools panel buttons
    document.addEventListener('click', (e) => {
      if (e.target.id === 'cleanup-light-btn') this.runCleanup('light');
      if (e.target.id === 'cleanup-deep-btn') this.runCleanup('deep');
      if (e.target.id === 'cleanup-docker-btn') this.runCleanup('docker');
      if (e.target.id === 'scan-node-modules-btn') this.scanNodeModules();
      if (e.target.id === 'find-duplicates-btn') this.findDuplicates();
      if (e.target.id === 'purge-ram-btn') this.purgeRAM();
      if (e.target.id === 'kill-port-btn') this.killPort();
      if (e.target.id === 'list-ports-btn') this.listPorts();
      if (e.target.id === 'analyze-storage-btn') this.analyzeStorage();
    });
  },

  showNotification(message, type = 'info') {
    // Use Odysseus notification system if available
    if (window.showToast) {
      window.showToast(message, type);
    } else {
      console.log(`[${type}] ${message}`);
    }
  },

  showPanel() {
    const panel = document.getElementById('system-tools-panel');
    if (panel) {
      panel.style.display = 'block';
      this.loadSystemHealth();
      this.loadDiskUsage();
    }
  },

  hidePanel() {
    const panel = document.getElementById('system-tools-panel');
    if (panel) panel.style.display = 'none';
  }
};

// Global export
window.systemTools = systemToolsModule;

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    systemToolsModule.init();
  });
} else {
  systemToolsModule.init();
}

export default systemToolsModule;
