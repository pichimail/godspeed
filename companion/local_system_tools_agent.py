#!/usr/bin/env python3
"""
Local System Tools Agent for Godspeed / Odysseus

Run this on your Mac or Windows machine to let the Godspeed dashboard
(read-only or safe cleanups) access *your actual local* RAM, storage,
caches, duplicates, etc. — exactly the Chinna-go features.

This connects to your account on the server (via API token) and
provides live local data + execution inside the web UI (no new tabs).

Usage:
  1. In Godspeed dashboard → System Tools, click "Pair Local Agent"
     (it will show a token and this command).
  2. On your machine:
     python3 -m pip install --upgrade pip
     python3 -m pip install psutil websockets
     python3 companion/local_system_tools_agent.py \
       --server https://godspeed.itsmechinna.com \
       --token ody_your_token_here

  The agent stays running and shows status. Ctrl-C to stop.

Security notes:
- Only read + explicitly confirmed cleanups.
- All actions are scoped to your user.
- The token has the same power as a normal API token you create in the app.
- On Mac it can do real `purge`, Xcode cleanup, etc.
- On Windows it uses PowerShell-style equivalents where possible.
"""

import argparse
import asyncio
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

try:
    import psutil
except ImportError:
    print("Missing psutil. Run: pip install psutil websockets")
    sys.exit(1)

try:
    import websockets
except ImportError:
    print("Missing websockets. Run: pip install websockets")
    sys.exit(1)

# --- Core local execution logic (adapted from Chinna / mac_system_tools.py) ---

class LocalSystemTools:
    def __init__(self):
        self.home = os.path.expanduser("~")
        self.is_mac = platform.system() == "Darwin"
        self.is_windows = platform.system() == "Windows"
        self.is_linux = platform.system() == "Linux"

    def get_system_health(self) -> Dict[str, Any]:
        try:
            cpu = psutil.cpu_percent(interval=0.5)
            mem = psutil.virtual_memory()
            disk = shutil.disk_usage(self.home)

            health = {
                "cpu": {"percent": cpu, "count": psutil.cpu_count()},
                "memory": {
                    "total": mem.total,
                    "available": mem.available,
                    "used": mem.used,
                    "percent": mem.percent,
                    "total_gb": round(mem.total / (1024**3), 2),
                    "available_gb": round(mem.available / (1024**3), 2),
                },
                "disk": {
                    "total": disk.total,
                    "used": disk.used,
                    "free": disk.free,
                    "percent": round((disk.used / disk.total) * 100, 1),
                    "total_gb": round(disk.total / (1024**3), 2),
                    "used_gb": round(disk.used / (1024**3), 2),
                    "free_gb": round(disk.free / (1024**3), 2),
                },
                "os": platform.system(),
                "platform": platform.platform(),
            }

            # Battery (best effort)
            try:
                bat = psutil.sensors_battery()
                if bat:
                    health["battery"] = {
                        "percent": bat.percent,
                        "plugged_in": bat.power_plugged,
                    }
            except Exception:
                pass

            # Mac specific RAM detail
            if self.is_mac:
                try:
                    vm = subprocess.check_output(["vm_stat"], text=True)
                    health["mac_vm_stat"] = vm.strip()
                except Exception:
                    pass

            return health
        except Exception as e:
            return {"error": str(e)}

    def get_disk_usage(self) -> Dict[str, Any]:
        try:
            usage = shutil.disk_usage(self.home)
            return {
                "total": usage.total,
                "used": usage.used,
                "free": usage.free,
                "percent": round((usage.used / usage.total) * 100, 1),
                "total_gb": round(usage.total / (1024**3), 2),
                "used_gb": round(usage.used / (1024**3), 2),
                "free_gb": round(usage.free / (1024**3), 2),
            }
        except Exception as e:
            return {"error": str(e)}

    def analyze_storage(self, path: Optional[str] = None, limit: int = 30, min_size_mb: int = 50) -> Dict[str, Any]:
        if path is None:
            path = self.home
        path = os.path.expanduser(path)
        if not os.path.exists(path):
            return {"items": [], "error": "path not found"}

        results = []
        try:
            for root, dirs, files in os.walk(path):
                if len(results) > limit * 2:
                    break
                try:
                    total = sum(os.path.getsize(os.path.join(root, f)) for f in files if os.path.isfile(os.path.join(root, f)))
                    if total >= min_size_mb * 1024 * 1024:
                        results.append({
                            "path": root,
                            "size": total,
                            "size_mb": round(total / (1024*1024), 1),
                            "size_gb": round(total / (1024**3), 2),
                        })
                except Exception:
                    pass
            results.sort(key=lambda x: x["size"], reverse=True)
            return {"path": path, "items": results[:limit], "count": len(results)}
        except Exception as e:
            return {"items": [], "error": str(e)}

    def cleanup_light(self) -> Dict[str, Any]:
        """Light user cache cleanup - safe on local machine"""
        freed = 0
        targets = []
        cache_dirs = [
            os.path.join(self.home, "Library", "Caches") if self.is_mac else os.path.join(self.home, "AppData", "Local", "Temp"),
        ]
        if self.is_windows:
            cache_dirs.append(os.path.join(self.home, "AppData", "Local", "Microsoft", "Windows", "Explorer"))

        for d in cache_dirs:
            if os.path.exists(d):
                try:
                    before = self._dir_size(d)
                    for item in os.listdir(d):
                        p = os.path.join(d, item)
                        try:
                            if os.path.isdir(p):
                                shutil.rmtree(p, ignore_errors=True)
                            else:
                                os.remove(p)
                        except:
                            pass
                    after = self._dir_size(d)
                    f = before - after
                    freed += f
                    targets.append({"name": d, "freed_mb": round(f / (1024*1024), 1)})
                except Exception as e:
                    targets.append({"name": d, "error": str(e)})
        return {"level": "light", "total_freed_mb": round(freed / (1024*1024), 1), "targets": targets}

    def cleanup_deep(self) -> Dict[str, Any]:
        """Deeper safe cleanup - Chinna style for local Mac/Windows"""
        targets = []
        total = 0

        if self.is_mac:
            mac_targets = [
                (os.path.join(self.home, "Library", "Caches"), "User Caches"),
                (os.path.join(self.home, "Library", "Developer", "Xcode", "DerivedData"), "Xcode DerivedData"),
                (os.path.join(self.home, "Library", "Logs"), "Logs"),
                (os.path.join(self.home, ".npm", "_cacache"), "npm"),
            ]
            for p, name in mac_targets:
                if os.path.exists(p):
                    try:
                        before = self._dir_size(p)
                        shutil.rmtree(p, ignore_errors=True)
                        os.makedirs(p, exist_ok=True)
                        after = self._dir_size(p)
                        f = before - after
                        total += f
                        targets.append({"name": name, "freed_mb": round(f / (1024*1024), 1)})
                    except Exception as e:
                        targets.append({"name": name, "error": str(e)})

            # brew
            if shutil.which("brew"):
                try:
                    subprocess.run(["brew", "cleanup", "-s"], capture_output=True, timeout=120)
                    targets.append({"name": "Homebrew", "status": "cleaned"})
                except:
                    pass

        elif self.is_windows:
            win_targets = [
                (os.path.join(self.home, "AppData", "Local", "Temp"), "User Temp"),
                (os.path.join(self.home, "AppData", "Local", "Microsoft", "Windows", "Explorer"), "Explorer Cache"),
            ]
            for p, name in win_targets:
                if os.path.exists(p):
                    try:
                        before = self._dir_size(p)
                        shutil.rmtree(p, ignore_errors=True)
                        os.makedirs(p, exist_ok=True)
                        after = self._dir_size(p)
                        f = before - after
                        total += f
                        targets.append({"name": name, "freed_mb": round(f / (1024*1024), 1)})
                    except Exception as e:
                        targets.append({"name": name, "error": str(e)})

        return {"level": "deep", "total_freed_mb": round(total / (1024*1024), 1), "targets": targets}

    def purge_ram(self) -> Dict[str, Any]:
        if not self.is_mac:
            return {"success": False, "error": "purge is macOS only"}
        try:
            before = psutil.virtual_memory().available
            subprocess.run(["purge"], timeout=30)
            after = psutil.virtual_memory().available
            return {
                "success": True,
                "freed_mb": round((after - before) / (1024*1024), 1),
                "note": "Inactive memory purged on your Mac"
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def find_duplicates(self, search_path: Optional[str] = None, min_size_mb: int = 5) -> Dict[str, Any]:
        # Simplified local duplicate finder (hash based, limited depth for safety)
        if search_path is None:
            search_path = self.home
        search_path = os.path.expanduser(search_path)
        seen = {}
        dups = []
        total_size = 0
        try:
            for root, dirs, files in os.walk(search_path):
                if len(dups) > 200:  # safety
                    break
                for f in files:
                    fp = os.path.join(root, f)
                    try:
                        if os.path.getsize(fp) < min_size_mb * 1024 * 1024:
                            continue
                        h = self._hash_file(fp)
                        if h in seen:
                            dups.append({"path": fp, "duplicate_of": seen[h], "size_mb": round(os.path.getsize(fp)/(1024*1024),1)})
                            total_size += os.path.getsize(fp)
                        else:
                            seen[h] = fp
                    except:
                        pass
            return {"found": dups[:50], "count": len(dups), "total_wasted_mb": round(total_size / (1024*1024), 1)}
        except Exception as e:
            return {"found": [], "error": str(e)}

    def _hash_file(self, path: str, block_size: int = 65536) -> str:
        import hashlib
        hasher = hashlib.md5()
        with open(path, "rb") as f:
            while chunk := f.read(block_size):
                hasher.update(chunk)
        return hasher.hexdigest()

    def _dir_size(self, path: str) -> int:
        total = 0
        for dirpath, _, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                try:
                    total += os.path.getsize(fp)
                except:
                    pass
        return total

    def kill_port(self, port: int) -> Dict[str, Any]:
        try:
            if self.is_mac or self.is_linux:
                result = subprocess.run(["lsof", "-ti", f"tcp:{port}"], capture_output=True, text=True)
                pids = result.stdout.strip().split()
                for pid in pids:
                    subprocess.run(["kill", "-9", pid])
                return {"success": True, "killed": pids}
            elif self.is_windows:
                # netstat + taskkill
                result = subprocess.run(["netstat", "-ano"], capture_output=True, text=True)
                for line in result.stdout.splitlines():
                    if f":{port}" in line:
                        parts = line.strip().split()
                        if parts:
                            pid = parts[-1]
                            subprocess.run(["taskkill", "/F", "/PID", pid], capture_output=True)
                            return {"success": True, "killed_pid": pid}
                return {"success": False, "error": "port not found"}
        except Exception as e:
            return {"success": False, "error": str(e)}
        return {"success": False, "error": "unsupported platform"}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", default="http://localhost:7000", help="Godspeed server URL (https://godspeed.itsmechinna.com)")
    parser.add_argument("--token", required=True, help="ody_... API token (create in app or via Pair Local Agent button)")
    args = parser.parse_args()

    server = args.server.rstrip("/")
    ws_url = server.replace("http://", "ws://").replace("https://", "wss://") + "/api/system-tools/local/ws"
    token = args.token

    print(f"[local-agent] Connecting to {ws_url} as local system tools agent...")
    print(f"[local-agent] OS: {platform.system()} | Home: {Path.home()}")

    tools = LocalSystemTools()

    headers = {"Authorization": f"Bearer {token}"}

    async with websockets.connect(ws_url, extra_headers=headers) as ws:
        print("[local-agent] Connected! Waiting for commands from Godspeed dashboard...")

        # Send initial hello
        await ws.send(json.dumps({
            "type": "hello",
            "os": platform.system(),
            "platform": platform.platform(),
            "home": str(Path.home()),
            "capabilities": ["health", "storage", "cleanup", "duplicates", "purge", "kill_port"]
        }))

        async for message in ws:
            try:
                data = json.loads(message)
                req_id = data.get("id")
                action = data.get("action")
                params = data.get("params", {})

                result = {"success": False, "error": "unknown action"}

                if action == "get_system_health":
                    result = tools.get_system_health()
                elif action == "get_disk_usage":
                    result = tools.get_disk_usage()
                elif action == "analyze_storage":
                    result = tools.analyze_storage(
                        path=params.get("path"),
                        limit=params.get("limit", 30),
                        min_size_mb=params.get("min_size_mb", 50)
                    )
                elif action == "cleanup_light":
                    result = tools.cleanup_light()
                elif action == "cleanup_deep":
                    result = tools.cleanup_deep()
                elif action == "purge_ram":
                    result = tools.purge_ram()
                elif action == "find_duplicates":
                    result = tools.find_duplicates(
                        search_path=params.get("search_path"),
                        min_size_mb=params.get("min_size_mb", 5)
                    )
                elif action == "kill_port":
                    result = tools.kill_port(params.get("port", 0))
                elif action == "ping":
                    result = {"ok": True, "os": platform.system()}

                await ws.send(json.dumps({
                    "id": req_id,
                    "result": result
                }))
            except Exception as e:
                print(f"[local-agent] Error handling message: {e}")
                await ws.send(json.dumps({"id": data.get("id") if 'data' in locals() else None, "error": str(e)}))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[local-agent] Stopped by user.")