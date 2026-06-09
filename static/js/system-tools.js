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
        // Open system tools in new window/tab
        window.open('/static/system-tools.html', '_blank', 'width=1200,height=800');
      });
    }
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
    // Called when loading the full system-tools.html page
    this.loadSystemHealth();
    this.loadDiskUsage();
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
