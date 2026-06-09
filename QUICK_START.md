# 🚀 Quick Start Guide - Mac System Tools

## Installation

```bash
cd /Users/damarakamraavi/Downloads/odysseus

# Install dependencies
pip install -r requirements.txt

# Start Odysseus
python app.py
```

## Access System Tools

### Method 1: Via Navigation (Recommended)
1. Open Odysseus in browser: `http://localhost:8000`
2. Look for **"System Tools"** button in left sidebar (under Tools section)
3. Click to open System Tools panel in new window

### Method 2: Direct URL
Navigate to: `http://localhost:8000/static/system-tools.html`

### Method 3: API Direct
Use curl or Postman to test endpoints:
```bash
# Get system health
curl http://localhost:8000/api/system-tools/system/health

# Get disk usage
curl http://localhost:8000/api/system-tools/disk/usage

# List busy ports
curl http://localhost:8000/api/system-tools/dev/ports
```

## Testing

```bash
# Run automated API tests
python test_system_tools.py
```

## Features Overview

### 1. System Health Monitor 🏥
- **What**: Real-time CPU, RAM, Disk, Battery monitoring
- **Location**: Overview tab
- **Use**: See current system resource usage at a glance

### 2. Disk Usage Analysis 📊
- **What**: Analyze directory sizes, find space hogs
- **Location**: Storage tab
- **Use**: Enter a path (or leave empty for home directory) and click Analyze

### 3. Multi-Level Cleanup 🧹
- **Light Cleanup**: User caches only (safe, quick)
- **Deep Cleanup**: System-wide cache clearance
- **Docker Cleanup**: Remove unused Docker images/containers
- **node_modules Scanner**: Find and measure node_modules directories
- **Location**: Cleanup tab

### 4. Duplicate File Finder 🔍
- **What**: Find duplicate files based on MD5 hash
- **Location**: Duplicates tab
- **Use**:
  1. Click "Scan for Duplicates"
  2. Wait for scan to complete
  3. Review results
  4. Select duplicates to remove
  5. Click "Remove Selected"

### 5. RAM Purge 💾
- **What**: Free up inactive RAM
- **Location**: Dev Tools tab or Overview tab
- **Use**: Click "Purge RAM" button (requires sudo on macOS)

### 6. Port Management ⚙️
- **Kill Port**: Free up a specific port
- **List Ports**: See all busy ports with PIDs
- **Location**: Dev Tools tab
- **Use**:
  - List: Click "List Busy Ports"
  - Kill: Click "Kill Port", enter port number

### 7. Dev Launchers 🛠️
- **VS Code**: Open path in VS Code
- **Finder**: Open path in Finder
- **Location**: Dev Tools tab

## Safety Tips ⚠️

1. **Start with Light Cleanup** - Test with light cleanup first
2. **Review Before Deleting** - Always review what will be deleted
3. **Backup Important Data** - Have backups before major cleanups
4. **Check Disk Space First** - Run disk usage analysis before cleanup
5. **Test Duplicates** - Run duplicate scan without removing first to see results

## Common Issues

### Issue: "Permission denied" errors
**Solution**: Some operations require elevated permissions. Run with sudo if needed:
```bash
sudo python app.py
```

### Issue: "Port already in use"
**Solution**: Use the Port Manager to free up the port or change Odysseus port

### Issue: System Tools button not visible
**Solution**:
1. Hard refresh browser (Cmd+Shift+R)
2. Clear browser cache
3. Check console for JavaScript errors

### Issue: API returns 404
**Solution**:
1. Make sure Odysseus is running
2. Check that routes are registered in app.py
3. Restart Odysseus server

## API Examples

### Get System Health
```bash
curl http://localhost:8000/api/system-tools/system/health
```

### Run Light Cleanup
```bash
curl -X POST http://localhost:8000/api/system-tools/cleanup/light
```

### Analyze Storage
```bash
curl "http://localhost:8000/api/system-tools/storage/analyze?limit=20"
```

### Kill Port
```bash
curl -X POST http://localhost:8000/api/system-tools/dev/kill-port \
  -H "Content-Type: application/json" \
  -d '{"port": 3000}'
```

### Find Duplicates
```bash
curl -X POST http://localhost:8000/api/system-tools/duplicates/find \
  -H "Content-Type: application/json" \
  -d '{
    "search_path": null,
    "min_size_mb": 1,
    "extensions": null
  }'
```

## Keyboard Shortcuts

None currently implemented (future enhancement)

## Performance Tips

1. **Cleanup Frequency**: Run light cleanup weekly, deep cleanup monthly
2. **Duplicate Scans**: Run on specific directories rather than entire disk
3. **Storage Analysis**: Use min_size_mb filter to ignore small files
4. **RAM Purge**: Only use when experiencing memory pressure

## Next Steps

1. Explore each tab in System Tools panel
2. Run light cleanup to see results
3. Analyze your home directory storage
4. Scan for duplicates in Downloads folder
5. Monitor system health regularly

## Documentation

- **Full README**: See `MAC_SYSTEM_TOOLS_README.md`
- **Integration Details**: See `INTEGRATION_COMPLETE.md`
- **API Reference**: See API endpoint summary in README

## Support

For issues or questions:
1. Check console logs in browser (F12)
2. Check Odysseus server logs
3. Review error messages in UI
4. Test API endpoints directly with curl

---

**Quick Win**: Start with light cleanup and storage analysis to see immediate results! 🎉
