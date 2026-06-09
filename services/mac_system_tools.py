"""
Mac System Utilities Service for Odysseus
Integrates system cleanup, storage analysis, duplicate finder, and dev tools
Based on Chinna's Godspeed suite
"""

import os
import subprocess
import shutil
import logging
import hashlib
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime
from collections import defaultdict
import psutil

logger = logging.getLogger(__name__)


class MacSystemToolsService:
    """
    Mac System Optimization and Utilities Service

    Features:
    - Storage analysis and disk explorer
    - Multi-level cleanup (light, deep, project, docker)
    - Duplicate file finder
    - RAM purge and memory management
    - Dev tools (port killer, project launcher)
    - System health monitoring
    """

    def __init__(self):
        self.home = os.path.expanduser("~")

    # ==================== STORAGE & DISK ANALYSIS ====================

    def get_disk_usage(self) -> Dict[str, Any]:
        """Get overall disk usage statistics"""
        try:
            usage = shutil.disk_usage(self.home)
            return {
                "total": usage.total,
                "used": usage.used,
                "free": usage.free,
                "percent": (usage.used / usage.total) * 100,
                "total_gb": round(usage.total / (1024**3), 2),
                "used_gb": round(usage.used / (1024**3), 2),
                "free_gb": round(usage.free / (1024**3), 2)
            }
        except Exception as e:
            logger.error(f"Error getting disk usage: {e}")
            return {}

    def analyze_directory_sizes(
        self,
        path: str = None,
        limit: int = 50,
        min_size_mb: int = 10
    ) -> List[Dict]:
        """
        Analyze directory sizes recursively
        Returns list of directories sorted by size
        """
        if path is None:
            path = self.home

        path = os.path.expanduser(path)
        if not os.path.exists(path):
            return []

        results = []

        try:
            for entry in os.scandir(path):
                try:
                    if entry.is_dir(follow_symlinks=False):
                        size = self._get_dir_size(entry.path)
                        size_mb = size / (1024 * 1024)

                        if size_mb >= min_size_mb:
                            results.append({
                                "path": entry.path,
                                "name": entry.name,
                                "size": size,
                                "size_mb": round(size_mb, 2),
                                "size_gb": round(size_mb / 1024, 2),
                                "type": "directory"
                            })
                    elif entry.is_file(follow_symlinks=False):
                        stat = entry.stat()
                        size_mb = stat.st_size / (1024 * 1024)

                        if size_mb >= min_size_mb:
                            results.append({
                                "path": entry.path,
                                "name": entry.name,
                                "size": stat.st_size,
                                "size_mb": round(size_mb, 2),
                                "size_gb": round(size_mb / 1024, 2),
                                "type": "file"
                            })
                except (PermissionError, OSError):
                    continue
        except Exception as e:
            logger.error(f"Error analyzing directory {path}: {e}")

        # Sort by size descending
        results.sort(key=lambda x: x["size"], reverse=True)
        return results[:limit]

    def _get_dir_size(self, path: str) -> int:
        """Calculate total size of directory recursively"""
        total = 0
        try:
            for entry in os.scandir(path):
                try:
                    if entry.is_file(follow_symlinks=False):
                        total += entry.stat().st_size
                    elif entry.is_dir(follow_symlinks=False):
                        total += self._get_dir_size(entry.path)
                except (PermissionError, OSError):
                    continue
        except (PermissionError, OSError):
            pass
        return total

    def get_storage_breakdown(self, path: str = None, limit: int = 20) -> Dict:
        """
        Get detailed storage breakdown for a path
        Similar to Chinna's storage_breakdown function
        """
        if path is None:
            path = self.home

        path = os.path.expanduser(path)

        items = self.analyze_directory_sizes(path, limit=limit, min_size_mb=1)
        total_size = sum(item["size"] for item in items)

        return {
            "path": path,
            "total_size": total_size,
            "total_gb": round(total_size / (1024**3), 2),
            "items": items,
            "count": len(items)
        }

    # ==================== CLEANUP UTILITIES ====================

    def cleanup_light(self) -> Dict[str, Any]:
        """Light cleanup: user caches only"""
        results = {
            "level": "light",
            "targets": [],
            "total_freed": 0,
            "success": True
        }

        cache_path = os.path.join(self.home, "Library", "Caches")

        try:
            before = self._get_dir_size(cache_path)

            # Clear user caches
            for item in os.listdir(cache_path):
                item_path = os.path.join(cache_path, item)
                try:
                    if os.path.isdir(item_path):
                        shutil.rmtree(item_path, ignore_errors=True)
                    else:
                        os.remove(item_path)
                except:
                    pass

            after = self._get_dir_size(cache_path)
            freed = before - after

            results["targets"].append({
                "name": "User Caches",
                "path": cache_path,
                "freed": freed,
                "freed_mb": round(freed / (1024*1024), 2)
            })
            results["total_freed"] = freed

        except Exception as e:
            logger.error(f"Light cleanup error: {e}")
            results["success"] = False
            results["error"] = str(e)

        return results

    def cleanup_deep_mac(self) -> Dict[str, Any]:
        """Deep Mac cleanup: caches, build artifacts, package managers"""
        results = {
            "level": "deep_mac",
            "targets": [],
            "total_freed": 0,
            "success": True
        }

        cleanup_targets = [
            (os.path.join(self.home, "Library", "Caches"), "User Caches"),
            (os.path.join(self.home, ".npm", "_cacache"), "npm Cache"),
            (os.path.join(self.home, ".cache"), "Generic Cache"),
            (os.path.join(self.home, "Library", "Developer", "Xcode", "DerivedData"), "Xcode DerivedData"),
            (os.path.join(self.home, "Library", "Developer", "Xcode", "Archives"), "Xcode Archives"),
            (os.path.join(self.home, "Library", "Caches", "com.microsoft.VSCode"), "VS Code Cache"),
            (os.path.join(self.home, ".cargo", "registry", "cache"), "Cargo Cache"),
        ]

        total_freed = 0

        for path, name in cleanup_targets:
            if os.path.exists(path):
                try:
                    before = self._get_dir_size(path)

                    # Clear directory contents
                    if os.path.isdir(path):
                        for item in os.listdir(path):
                            item_path = os.path.join(path, item)
                            try:
                                if os.path.isdir(item_path):
                                    shutil.rmtree(item_path, ignore_errors=True)
                                else:
                                    os.remove(item_path)
                            except:
                                pass

                    after = self._get_dir_size(path)
                    freed = before - after
                    total_freed += freed

                    results["targets"].append({
                        "name": name,
                        "path": path,
                        "freed": freed,
                        "freed_mb": round(freed / (1024*1024), 2)
                    })
                except Exception as e:
                    logger.error(f"Error cleaning {name}: {e}")

        # Run brew cleanup if available
        if shutil.which("brew"):
            try:
                subprocess.run(["brew", "cleanup", "-s"],
                             capture_output=True, timeout=60)
                results["targets"].append({
                    "name": "Homebrew Cleanup",
                    "status": "completed"
                })
            except:
                pass

        results["total_freed"] = total_freed
        results["total_freed_gb"] = round(total_freed / (1024**3), 2)

        return results

    def cleanup_node_modules(self, search_paths: List[str] = None) -> Dict[str, Any]:
        """Find and optionally remove node_modules directories"""
        if search_paths is None:
            search_paths = [
                os.path.join(self.home, "Projects"),
                os.path.join(self.home, "dev"),
                os.path.join(self.home, "Desktop"),
                os.path.join(self.home, "Documents")
            ]

        results = {
            "found": [],
            "total_size": 0,
            "count": 0
        }

        for search_path in search_paths:
            if not os.path.exists(search_path):
                continue

            for root, dirs, files in os.walk(search_path):
                if "node_modules" in dirs:
                    node_modules_path = os.path.join(root, "node_modules")
                    size = self._get_dir_size(node_modules_path)

                    results["found"].append({
                        "path": node_modules_path,
                        "size": size,
                        "size_mb": round(size / (1024*1024), 2),
                        "size_gb": round(size / (1024**3), 2)
                    })
                    results["total_size"] += size
                    results["count"] += 1

                    # Don't recurse into node_modules
                    dirs.remove("node_modules")

        results["total_size_gb"] = round(results["total_size"] / (1024**3), 2)
        return results

    def cleanup_docker(self) -> Dict[str, Any]:
        """Clean Docker images, containers, and volumes"""
        results = {
            "success": False,
            "message": ""
        }

        if not shutil.which("docker"):
            results["message"] = "Docker not found"
            return results

        try:
            # Docker system prune
            result = subprocess.run(
                ["docker", "system", "prune", "-af", "--volumes"],
                capture_output=True,
                text=True,
                timeout=120
            )

            results["success"] = result.returncode == 0
            results["message"] = result.stdout if result.returncode == 0 else result.stderr

        except Exception as e:
            logger.error(f"Docker cleanup error: {e}")
            results["message"] = str(e)

        return results

    def cleanup_project(self, project_path: str) -> Dict[str, Any]:
        """Clean build artifacts from a project directory"""
        project_path = os.path.expanduser(project_path)

        if not os.path.exists(project_path):
            return {"success": False, "error": "Project path not found"}

        artifacts = [
            "node_modules", "dist", "build", ".next", ".nuxt", ".output",
            ".turbo", ".cache", ".venv", ".parcel-cache", "target",
            ".gradle", "__pycache__"
        ]

        results = {
            "project": project_path,
            "removed": [],
            "total_freed": 0
        }

        for artifact in artifacts:
            for root, dirs, files in os.walk(project_path):
                if artifact in dirs:
                    artifact_path = os.path.join(root, artifact)
                    try:
                        size = self._get_dir_size(artifact_path)
                        shutil.rmtree(artifact_path, ignore_errors=True)

                        results["removed"].append({
                            "name": artifact,
                            "path": artifact_path,
                            "freed": size,
                            "freed_mb": round(size / (1024*1024), 2)
                        })
                        results["total_freed"] += size

                        dirs.remove(artifact)
                    except Exception as e:
                        logger.error(f"Error removing {artifact_path}: {e}")

        results["total_freed_mb"] = round(results["total_freed"] / (1024*1024), 2)
        return results

    # ==================== DUPLICATE FINDER ====================

    def find_duplicates(
        self,
        search_path: str = None,
        min_size_mb: int = 1,
        extensions: List[str] = None
    ) -> Dict[str, List[str]]:
        """
        Find duplicate files by comparing file hashes
        Returns dict mapping hash to list of file paths
        """
        if search_path is None:
            search_path = self.home

        search_path = os.path.expanduser(search_path)

        file_hashes = defaultdict(list)
        file_sizes = {}

        # First pass: group by size (faster than hashing everything)
        size_groups = defaultdict(list)

        for root, dirs, files in os.walk(search_path):
            # Skip system directories
            dirs[:] = [d for d in dirs if d not in [
                "Library", "System", ".Trash", "node_modules", ".git"
            ]]

            for filename in files:
                filepath = os.path.join(root, filename)

                # Filter by extension if specified
                if extensions:
                    if not any(filename.lower().endswith(ext) for ext in extensions):
                        continue

                try:
                    stat = os.stat(filepath)
                    size = stat.st_size

                    # Skip small files
                    if size < min_size_mb * 1024 * 1024:
                        continue

                    size_groups[size].append(filepath)
                    file_sizes[filepath] = size

                except (PermissionError, OSError):
                    continue

        # Second pass: hash files with duplicate sizes
        for size, paths in size_groups.items():
            if len(paths) < 2:
                continue

            for filepath in paths:
                try:
                    file_hash = self._hash_file(filepath)
                    file_hashes[file_hash].append(filepath)
                except Exception as e:
                    logger.error(f"Error hashing {filepath}: {e}")

        # Filter to only duplicates
        duplicates = {
            hash_val: paths
            for hash_val, paths in file_hashes.items()
            if len(paths) > 1
        }

        # Add metadata
        result = {
            "duplicates": duplicates,
            "groups": len(duplicates),
            "total_files": sum(len(paths) for paths in duplicates.values()),
            "potential_savings": sum(
                file_sizes.get(paths[0], 0) * (len(paths) - 1)
                for paths in duplicates.values()
            )
        }

        result["potential_savings_gb"] = round(
            result["potential_savings"] / (1024**3), 2
        )

        return result

    def _hash_file(self, filepath: str, block_size: int = 65536) -> str:
        """Calculate MD5 hash of file"""
        hasher = hashlib.md5()
        with open(filepath, 'rb') as f:
            while True:
                data = f.read(block_size)
                if not data:
                    break
                hasher.update(data)
        return hasher.hexdigest()

    # ==================== RAM & SYSTEM MONITORING ====================

    def purge_ram(self) -> Dict[str, Any]:
        """Purge inactive RAM (macOS purge command)"""
        results = {
            "success": False,
            "before": {},
            "after": {},
            "freed": 0
        }

        try:
            # Get memory stats before
            mem = psutil.virtual_memory()
            results["before"] = {
                "total": mem.total,
                "available": mem.available,
                "used": mem.used,
                "percent": mem.percent
            }

            # Run purge command
            if os.geteuid() == 0:  # Running as root
                subprocess.run(["purge"], timeout=30)
            else:
                # Try without sudo
                subprocess.run(["purge"], timeout=30)

            # Get memory stats after
            mem = psutil.virtual_memory()
            results["after"] = {
                "total": mem.total,
                "available": mem.available,
                "used": mem.used,
                "percent": mem.percent
            }

            results["freed"] = results["after"]["available"] - results["before"]["available"]
            results["freed_gb"] = round(results["freed"] / (1024**3), 2)
            results["success"] = True

        except Exception as e:
            logger.error(f"RAM purge error: {e}")
            results["error"] = str(e)

        return results

    def get_system_health(self) -> Dict[str, Any]:
        """Get system health metrics"""
        try:
            return {
                "cpu": {
                    "percent": psutil.cpu_percent(interval=1),
                    "count": psutil.cpu_count(),
                    "freq": psutil.cpu_freq()._asdict() if psutil.cpu_freq() else None
                },
                "memory": {
                    "total": psutil.virtual_memory().total,
                    "available": psutil.virtual_memory().available,
                    "used": psutil.virtual_memory().used,
                    "percent": psutil.virtual_memory().percent,
                    "total_gb": round(psutil.virtual_memory().total / (1024**3), 2),
                    "available_gb": round(psutil.virtual_memory().available / (1024**3), 2)
                },
                "disk": self.get_disk_usage(),
                "battery": self._get_battery_info()
            }
        except Exception as e:
            logger.error(f"Error getting system health: {e}")
            return {}

    def _get_battery_info(self) -> Optional[Dict]:
        """Get battery information if available"""
        try:
            battery = psutil.sensors_battery()
            if battery:
                return {
                    "percent": battery.percent,
                    "plugged_in": battery.power_plugged,
                    "time_left": battery.secsleft if battery.secsleft != -1 else None
                }
        except:
            pass
        return None

    # ==================== DEV TOOLS (GODSPEED) ====================

    def kill_port(self, port: int) -> Dict[str, Any]:
        """Kill process using specified port"""
        try:
            result = subprocess.run(
                ["lsof", "-ti", f"tcp:{port}"],
                capture_output=True,
                text=True
            )

            if result.stdout.strip():
                pids = result.stdout.strip().split("\n")
                for pid in pids:
                    try:
                        os.kill(int(pid), 9)
                    except:
                        pass

                return {
                    "success": True,
                    "port": port,
                    "killed_pids": pids,
                    "message": f"Killed {len(pids)} process(es) on port {port}"
                }
            else:
                return {
                    "success": True,
                    "port": port,
                    "message": f"Port {port} is already free"
                }
        except Exception as e:
            logger.error(f"Error killing port {port}: {e}")
            return {
                "success": False,
                "port": port,
                "error": str(e)
            }

    def list_busy_ports(self) -> List[Dict]:
        """List all busy ports with process information"""
        try:
            result = subprocess.run(
                ["lsof", "-iTCP", "-sTCP:LISTEN", "-n", "-P"],
                capture_output=True,
                text=True
            )

            ports = []
            for line in result.stdout.split("\n")[1:]:  # Skip header
                if line.strip():
                    parts = line.split()
                    if len(parts) >= 9:
                        port_info = parts[8].split(":")
                        if len(port_info) >= 2:
                            ports.append({
                                "command": parts[0],
                                "pid": parts[1],
                                "port": port_info[-1],
                                "address": parts[8]
                            })

            return ports
        except Exception as e:
            logger.error(f"Error listing ports: {e}")
            return []

    def open_in_vscode(self, path: str) -> Dict[str, Any]:
        """Open path in VS Code"""
        path = os.path.expanduser(path)

        if not os.path.exists(path):
            return {"success": False, "error": "Path not found"}

        try:
            if shutil.which("code"):
                subprocess.Popen(["code", path])
            else:
                subprocess.Popen(["open", "-a", "Visual Studio Code", path])

            return {"success": True, "path": path}
        except Exception as e:
            logger.error(f"Error opening VS Code: {e}")
            return {"success": False, "error": str(e)}


# Global service instance
_mac_tools_service: Optional[MacSystemToolsService] = None

def get_mac_tools_service() -> MacSystemToolsService:
    """Get or create global Mac system tools service instance"""
    global _mac_tools_service
    if _mac_tools_service is None:
        _mac_tools_service = MacSystemToolsService()
    return _mac_tools_service
