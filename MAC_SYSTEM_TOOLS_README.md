# Mac System Tools Integration - Chinna Features

This integration adds comprehensive Mac system optimization tools from Chinna V5 to Odysseus.

## Features Integrated

### 1. **Storage Analysis** 📊
- Disk usage monitoring
- Directory size analysis with filters
- Storage breakdown by path
- Real-time capacity tracking

### 2. **Multi-Level Cleanup** 🧹
- **Light Cleanup**: User caches only (safe, quick)
- **Deep Cleanup**: System-wide cache clearance
  - Xcode DerivedData
  - VS Code cache
  - npm/yarn cache
  - Cargo cache
  - Homebrew cache
  - System caches
- **Docker Cleanup**: Remove unused images and containers
- **Project Cleanup**: Remove build artifacts (dist/, build/, .next/, etc.)
- **node_modules Scanner**: Find and clean node_modules directories

### 3. **Duplicate File Finder** 🔍
- Hash-based duplicate detection using MD5
- Configurable minimum file size
- File extension filtering
- Bulk removal with safety checks
- Calculates potential space savings

### 4. **System Monitoring** 🏥
- Real-time CPU usage
- Memory (RAM) statistics
- Disk space tracking
- Battery status (charging/percent)
- Visual health cards with color coding

### 5. **RAM Management** 💾
- RAM purge for freeing inactive memory
- Before/after statistics
- Safe macOS `purge` command wrapper

### 6. **Godspeed Dev Tools** ⚙️
- **Port Killer**: Free up busy ports by killing processes
- **Port Lister**: View all listening TCP ports with PIDs
- **VS Code Launcher**: Open paths in VS Code from UI
- **Finder Launcher**: Open paths in Finder

## API Endpoints

### Storage & Disk
```
GET  /api/system-tools/disk/usage
GET  /api/system-tools/storage/analyze?path=<path>&limit=50&min_size_mb=10
GET  /api/system-tools/storage/breakdown?path=<path>&limit=20
```

### Cleanup
```
POST /api/system-tools/cleanup/light
POST /api/system-tools/cleanup/deep
GET  /api/system-tools/cleanup/node-modules/scan?search_paths=<paths>
POST /api/system-tools/cleanup/docker
POST /api/system-tools/cleanup/project
     Body: {"path": "/path/to/project"}
```

### Duplicates
```
POST   /api/system-tools/duplicates/find
       Body: {"search_path": null, "min_size_mb": 1, "extensions": null}
DELETE /api/system-tools/duplicates/remove
       Body: ["/path/to/file1", "/path/to/file2"]
```

### System Monitoring
```
GET  /api/system-tools/system/health
POST /api/system-tools/ram/purge
```

### Dev Tools
```
POST /api/system-tools/dev/kill-port
     Body: {"port": 3000}
GET  /api/system-tools/dev/ports
POST /api/system-tools/dev/open-vscode
     Body: {"path": "/path/to/project"}
POST /api/system-tools/dev/open-finder
     Body: {"path": "/path/to/folder"}
```

## Files Created

### Backend
- `services/mac_system_tools.py` - Core service layer (~600 lines)
- `routes/system_tools_routes.py` - API routes (~400 lines)
- Modified `app.py` to register routes

### Frontend
- `static/js/system-tools.js` - JavaScript module (~500 lines)
- `static/css/system-tools.css` - Styling (~400 lines)
- `static/system-tools.html` - Standalone UI panel

### Dependencies
- Added `psutil>=5.9.0` to `requirements.txt`

## Usage

### Starting the Application
```bash
# Install dependencies
pip install -r requirements.txt

# Run Odysseus
python app.py
```

### Accessing System Tools
1. Navigate to: `http://localhost:8000/static/system-tools.html`
2. Or integrate into main Odysseus nav (see Integration section)

### API Usage Example
```python
import requests

# Get system health
response = requests.get('http://localhost:8000/api/system-tools/system/health')
health = response.json()['data']
print(f"CPU: {health['cpu']['percent']}%")
print(f"RAM: {health['memory']['percent']}%")

# Run light cleanup
response = requests.post('http://localhost:8000/api/system-tools/cleanup/light')
results = response.json()['data']
print(f"Freed: {results['total_freed_gb']} GB")
```

## Safety Features

1. **User Confirmation**: All destructive operations require confirmation
2. **Path Validation**: All file operations validate paths exist
3. **Error Handling**: Comprehensive try-catch with informative messages
4. **Permission Checks**: Graceful handling of permission errors
5. **Dry Run Available**: Node modules scanner doesn't delete, just reports
6. **Duplicate Safety**: Only removes explicitly selected files

## Platform Compatibility

- **Primary**: macOS (all features)
- **Partial**: Linux (most features except RAM purge)
- **Limited**: Windows (storage and monitoring only)

## Integration with Odysseus Nav

To add System Tools to the main Odysseus sidebar:

1. **Add navigation button** in `static/index.html`:
```html
<button class="nav-item" id="system-tools-nav-btn" title="System Tools">
  <svg><!-- wrench icon --></svg>
  <span>System Tools</span>
</button>
```

2. **Add route handler** in main app JS:
```javascript
document.getElementById('system-tools-nav-btn').addEventListener('click', () => {
  window.open('/static/system-tools.html', '_blank');
});
```

3. **Or embed as iframe**:
```html
<div id="system-tools-container" class="hidden">
  <iframe src="/static/system-tools.html" style="width:100%;height:100%;border:none;"></iframe>
</div>
```

## Chrome Extension (Godspeed Assistant)

The original Chinna included a Chrome extension called "Godspeed Assistant". To integrate:

1. Check `chinna-go-main/lib/plugins/chrome-extension/` for source
2. Package as Chromium extension
3. Add extension installation endpoint
4. Integrate with dev tools tab

## Future Enhancements

- [ ] Scheduled cleanup jobs
- [ ] Cleanup presets/profiles
- [ ] Export cleanup reports
- [ ] Integration with Odysseus settings panel
- [ ] Notification system for cleanup completion
- [ ] Storage trend tracking over time
- [ ] Duplicate finder advanced filters
- [ ] Chrome extension packaging and installation

## Credits

Features adapted from **Chinna V5** by the original author.
- Original: Go/Shell-based Mac optimization suite
- Integration: Python/FastAPI implementation for Odysseus

## License

See main Odysseus LICENSE file for details.
