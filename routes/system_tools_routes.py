"""
Mac System Tools API Routes for Odysseus
Provides endpoints for system cleanup, storage analysis, duplicates, and dev tools
"""

from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List
import logging
import os

from services.mac_system_tools import get_mac_tools_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/system-tools", tags=["system-tools"])

# Get service instance
mac_tools = get_mac_tools_service()


# ==================== REQUEST MODELS ====================

class CleanupRequest(BaseModel):
    level: str  # "light", "deep", "nodes", "docker", "project"
    project_path: Optional[str] = None
    search_paths: Optional[List[str]] = None


class DuplicateFinderRequest(BaseModel):
    search_path: Optional[str] = None
    min_size_mb: int = 1
    extensions: Optional[List[str]] = None


class PortRequest(BaseModel):
    port: int


class PathRequest(BaseModel):
    path: str


# ==================== STORAGE & DISK ROUTES ====================

@router.get("/disk/usage")
async def get_disk_usage(request: Request):
    """Get overall disk usage statistics"""
    try:
        usage = mac_tools.get_disk_usage()
        return JSONResponse({"success": True, "data": usage})
    except Exception as e:
        logger.error(f"Error getting disk usage: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


@router.get("/storage/analyze")
async def analyze_storage(
    request: Request,
    path: Optional[str] = None,
    limit: int = 50,
    min_size_mb: int = 10
):
    """Analyze directory sizes"""
    try:
        if path:
            path = os.path.expanduser(path)

        items = mac_tools.analyze_directory_sizes(
            path=path,
            limit=limit,
            min_size_mb=min_size_mb
        )

        return JSONResponse({
            "success": True,
            "data": {
                "path": path or mac_tools.home,
                "items": items,
                "count": len(items)
            }
        })
    except Exception as e:
        logger.error(f"Error analyzing storage: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


@router.get("/storage/breakdown")
async def storage_breakdown(
    request: Request,
    path: Optional[str] = None,
    limit: int = 20
):
    """Get detailed storage breakdown"""
    try:
        breakdown = mac_tools.get_storage_breakdown(path=path, limit=limit)
        return JSONResponse({"success": True, "data": breakdown})
    except Exception as e:
        logger.error(f"Error getting storage breakdown: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


# ==================== CLEANUP ROUTES ====================

@router.post("/cleanup/light")
async def cleanup_light(request: Request, background_tasks: BackgroundTasks):
    """Run light cleanup (user caches only)"""
    try:
        results = mac_tools.cleanup_light()
        return JSONResponse({"success": True, "data": results})
    except Exception as e:
        logger.error(f"Light cleanup error: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


@router.post("/cleanup/deep")
async def cleanup_deep(request: Request):
    """Run deep Mac cleanup"""
    try:
        results = mac_tools.cleanup_deep_mac()
        return JSONResponse({"success": True, "data": results})
    except Exception as e:
        logger.error(f"Deep cleanup error: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


@router.get("/cleanup/node-modules/scan")
async def scan_node_modules(
    request: Request,
    search_paths: Optional[str] = None
):
    """Scan for node_modules directories"""
    try:
        paths = None
        if search_paths:
            paths = [p.strip() for p in search_paths.split(",")]

        results = mac_tools.cleanup_node_modules(search_paths=paths)
        return JSONResponse({"success": True, "data": results})
    except Exception as e:
        logger.error(f"Node modules scan error: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


@router.post("/cleanup/docker")
async def cleanup_docker(request: Request):
    """Clean Docker images and containers"""
    try:
        results = mac_tools.cleanup_docker()
        return JSONResponse({"success": True, "data": results})
    except Exception as e:
        logger.error(f"Docker cleanup error: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


@router.post("/cleanup/project")
async def cleanup_project(request: Request, req: PathRequest):
    """Clean build artifacts from project"""
    try:
        results = mac_tools.cleanup_project(req.path)
        return JSONResponse({"success": True, "data": results})
    except Exception as e:
        logger.error(f"Project cleanup error: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


# ==================== DUPLICATE FINDER ROUTES ====================

@router.post("/duplicates/find")
async def find_duplicates(request: Request, req: DuplicateFinderRequest):
    """Find duplicate files"""
    try:
        results = mac_tools.find_duplicates(
            search_path=req.search_path,
            min_size_mb=req.min_size_mb,
            extensions=req.extensions
        )

        # Convert duplicate data to serializable format
        duplicates_list = []
        for hash_val, paths in results["duplicates"].items():
            duplicates_list.append({
                "hash": hash_val,
                "paths": paths,
                "count": len(paths),
                "size": os.path.getsize(paths[0]) if paths else 0
            })

        return JSONResponse({
            "success": True,
            "data": {
                "groups": duplicates_list,
                "total_groups": results["groups"],
                "total_files": results["total_files"],
                "potential_savings": results["potential_savings"],
                "potential_savings_gb": results["potential_savings_gb"]
            }
        })
    except Exception as e:
        logger.error(f"Duplicate finder error: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


@router.delete("/duplicates/remove")
async def remove_duplicates(request: Request, paths: List[str]):
    """Remove specified duplicate files"""
    try:
        removed = []
        errors = []

        for path in paths:
            try:
                if os.path.exists(path):
                    os.remove(path)
                    removed.append(path)
                else:
                    errors.append(f"{path}: not found")
            except Exception as e:
                errors.append(f"{path}: {str(e)}")

        return JSONResponse({
            "success": len(errors) == 0,
            "data": {
                "removed": removed,
                "errors": errors,
                "count": len(removed)
            }
        })
    except Exception as e:
        logger.error(f"Error removing duplicates: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


# ==================== RAM & SYSTEM MONITORING ROUTES ====================

@router.post("/ram/purge")
async def purge_ram(request: Request):
    """Purge inactive RAM"""
    try:
        results = mac_tools.purge_ram()
        return JSONResponse({"success": True, "data": results})
    except Exception as e:
        logger.error(f"RAM purge error: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


@router.get("/system/health")
async def get_system_health(request: Request):
    """Get system health metrics"""
    try:
        health = mac_tools.get_system_health()
        return JSONResponse({"success": True, "data": health})
    except Exception as e:
        logger.error(f"Error getting system health: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


# ==================== DEV TOOLS ROUTES ====================

@router.post("/dev/kill-port")
async def kill_port(request: Request, req: PortRequest):
    """Kill process on specified port"""
    try:
        results = mac_tools.kill_port(req.port)
        return JSONResponse({"success": True, "data": results})
    except Exception as e:
        logger.error(f"Kill port error: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


@router.get("/dev/ports")
async def list_ports(request: Request):
    """List all busy ports"""
    try:
        ports = mac_tools.list_busy_ports()
        return JSONResponse({"success": True, "data": {"ports": ports}})
    except Exception as e:
        logger.error(f"List ports error: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


@router.post("/dev/open-vscode")
async def open_vscode(request: Request, req: PathRequest):
    """Open path in VS Code"""
    try:
        results = mac_tools.open_in_vscode(req.path)
        return JSONResponse({"success": True, "data": results})
    except Exception as e:
        logger.error(f"Open VS Code error: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


@router.post("/dev/open-finder")
async def open_finder(request: Request, req: PathRequest):
    """Open path in Finder"""
    try:
        import subprocess
        path = os.path.expanduser(req.path)

        if not os.path.exists(path):
            return JSONResponse(
                {"success": False, "error": "Path not found"},
                status_code=404
            )

        subprocess.Popen(["open", path])
        return JSONResponse({
            "success": True,
            "data": {"path": path, "message": "Opened in Finder"}
        })
    except Exception as e:
        logger.error(f"Open Finder error: {e}")
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )


def get_system_tools_router() -> APIRouter:
    """Get system tools router for app registration"""
    return router
