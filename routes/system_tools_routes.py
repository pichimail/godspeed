"""
Mac System Tools API Routes for Odysseus
Provides endpoints for system cleanup, storage analysis, duplicates, and dev tools
"""

from fastapi import APIRouter, Request, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Dict
import logging
import os
import json
import asyncio
import bcrypt

from services.mac_system_tools import get_mac_tools_service
from src.auth_helpers import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/system-tools", tags=["system-tools"])

# Get service instance
mac_tools = get_mac_tools_service()

# --- Local agent relay (per-user WebSocket connections for real local Mac/Windows data) ---
# Keyed by owner username. Value is the active websocket from the local agent script.
_local_agents: Dict[str, WebSocket] = {}
_local_agent_lock = asyncio.Lock()


async def _get_current_owner(request: Request) -> Optional[str]:
    """Resolve the real user owner (cookie session or API token owner)."""
    if getattr(request.state, "api_token", False):
        return getattr(request.state, "api_token_owner", None)
    return get_current_user(request)


async def relay_to_local_agent(owner: str, action: str, params: dict = None) -> dict:
    """Send a command to the user's local agent (if connected) and wait for result."""
    async with _local_agent_lock:
        ws = _local_agents.get(owner)
    if not ws:
        return {"success": False, "error": "No local agent connected for this user. Run the local_system_tools_agent.py on your Mac/Windows."}

    req_id = str(asyncio.current_task().get_name() or id(asyncio.current_task()))
    payload = {"id": req_id, "action": action, "params": params or {}}

    try:
        await ws.send_text(json.dumps(payload))
        # Wait for matching response (simple correlation by id)
        async with asyncio.timeout(25):  # 25s timeout for local ops
            while True:
                msg = await ws.receive_text()
                data = json.loads(msg)
                if data.get("id") == req_id:
                    return data.get("result", {"success": False, "error": "empty result from agent"})
    except asyncio.TimeoutError:
        return {"success": False, "error": "Local agent did not respond in time (is it still running?)"}
    except Exception as e:
        logger.warning(f"Local agent relay error for {owner}: {e}")
        return {"success": False, "error": str(e)}


# --- Local agent status & proxy endpoints (used by the dashboard System Tools modal) ---

@router.get("/local/status")
async def local_agent_status(request: Request):
    """Is a local Mac/Windows agent currently connected for this user?"""
    owner = await _get_current_owner(request)
    if not owner:
        return {"connected": False, "error": "Not authenticated"}
    async with _local_agent_lock:
        connected = owner in _local_agents
    return {
        "connected": connected,
        "owner": owner,
        "message": "Local agent connected - live data from your Mac/Windows available" if connected else "No local agent. Click 'Pair Local Agent' in System Tools and run the agent script on your computer."
    }


@router.get("/local/health")
async def local_health(request: Request):
    owner = await _get_current_owner(request)
    if not owner:
        raise HTTPException(401, "Not authenticated")
    data = await relay_to_local_agent(owner, "get_system_health")
    return JSONResponse({"success": data.get("success", True), "data": data, "source": "local-agent" if "error" not in data else "error"})


@router.get("/local/disk/usage")
async def local_disk_usage(request: Request):
    owner = await _get_current_owner(request)
    if not owner:
        raise HTTPException(401, "Not authenticated")
    data = await relay_to_local_agent(owner, "get_disk_usage")
    return JSONResponse({"success": True, "data": data, "source": "local"})


@router.post("/local/cleanup/light")
async def local_cleanup_light(request: Request):
    owner = await _get_current_owner(request)
    if not owner:
        raise HTTPException(401, "Not authenticated")
    data = await relay_to_local_agent(owner, "cleanup_light")
    return JSONResponse({"success": data.get("success", True), "data": data, "source": "local"})


@router.post("/local/cleanup/deep")
async def local_cleanup_deep(request: Request):
    owner = await _get_current_owner(request)
    if not owner:
        raise HTTPException(401, "Not authenticated")
    data = await relay_to_local_agent(owner, "cleanup_deep")
    return JSONResponse({"success": data.get("success", True), "data": data, "source": "local"})


@router.post("/local/purge-ram")
async def local_purge_ram(request: Request):
    owner = await _get_current_owner(request)
    if not owner:
        raise HTTPException(401, "Not authenticated")
    data = await relay_to_local_agent(owner, "purge_ram")
    return JSONResponse({"success": data.get("success", True), "data": data, "source": "local"})


@router.post("/local/duplicates/find")
async def local_find_duplicates(request: Request, req: "DuplicateFinderRequest"):
    owner = await _get_current_owner(request)
    if not owner:
        raise HTTPException(401, "Not authenticated")
    data = await relay_to_local_agent(owner, "find_duplicates", {
        "search_path": getattr(req, "search_path", None),
        "min_size_mb": getattr(req, "min_size_mb", 5)
    })
    return JSONResponse({"success": True, "data": data, "source": "local"})


@router.post("/local/kill-port")
async def local_kill_port(request: Request, req: "PortRequest"):
    owner = await _get_current_owner(request)
    if not owner:
        raise HTTPException(401, "Not authenticated")
    data = await relay_to_local_agent(owner, "kill_port", {"port": getattr(req, "port", 0)})
    return JSONResponse({"success": data.get("success", True), "data": data, "source": "local"})


@router.post("/local/mint-agent-token")
async def mint_local_agent_token(request: Request):
    """Mint a fresh API token the user can give to the local_system_tools_agent.py.
    Only the raw token is returned once. Store it safely on the user's machine."""
    owner = await _get_current_owner(request)
    if not owner:
        raise HTTPException(401, "Not authenticated")

    # Reuse the companion pairing mint (it creates a proper ody_ token)
    from companion.routes import mint_pairing_token
    try:
        invalidate = getattr(request.app.state, "invalidate_token_cache", None)
        token_id, raw_token = mint_pairing_token(owner, invalidate=invalidate)
        # Name it nicely
        # (the mint function already creates the row)
        return {
            "ok": True,
            "token": raw_token,
            "instructions": f"Run on your Mac/Windows:\npython3 -m pip install psutil websockets\npython3 companion/local_system_tools_agent.py --server https://godspeed.itsmechinna.com --token {raw_token}"
        }
    except Exception as e:
        logger.error(f"Failed to mint agent token: {e}")
        raise HTTPException(500, "Failed to mint token")


@router.websocket("/local/ws")
async def local_system_tools_ws(websocket: WebSocket):
    """
    WebSocket endpoint for the local_system_tools_agent.py running on the user's Mac/Windows.
    The agent authenticates with a Bearer ody_ token (same as normal API tokens).
    Once connected, the dashboard can request real local data and trigger cleanups.
    """
    await websocket.accept()

    # Minimal auth for WS: look for token in query or subprotocol/header
    token = websocket.query_params.get("token")
    auth_header = websocket.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1]

    if not token or not token.startswith("ody_"):
        await websocket.close(code=1008, reason="Missing or invalid ody_ token")
        return

    # Validate token and get owner (reuse existing logic)
    from core.database import get_db_session, ApiToken
    from core.auth import _verify_password  # not needed, we use the hash check path
    owner = None
    try:
        with get_db_session() as db:
            # Find matching active token by prefix + verify hash (simplified from middleware)
            prefix = token[:8]
            rows = db.query(ApiToken).filter(
                ApiToken.is_active == True,
                ApiToken.token_prefix == prefix
            ).all()
            for row in rows:
                if row.token_hash and bcrypt.checkpw(token.encode(), row.token_hash.encode()):
                    owner = row.owner
                    break
    except Exception as e:
        logger.error(f"WS token validation error: {e}")

    if not owner:
        await websocket.close(code=1008, reason="Invalid or expired token")
        return

    # Register this connection for the owner (only one per user for simplicity)
    async with _local_agent_lock:
        old_ws = _local_agents.get(owner)
        if old_ws:
            try:
                await old_ws.close()
            except:
                pass
        _local_agents[owner] = websocket

    logger.info(f"Local system tools agent connected for owner={owner}")

    try:
        # Keep the connection alive; the relay_to_local_agent handles send/recv
        while True:
            # Agents can also proactively send heartbeats or status
            msg = await websocket.receive_text()
            # We mostly ignore unsolicited messages from agent except for hello
            try:
                data = json.loads(msg)
                if data.get("type") == "hello":
                    logger.info(f"Local agent hello from {owner}: {data.get('os')}")
            except:
                pass
    except WebSocketDisconnect:
        logger.info(f"Local agent disconnected for {owner}")
    finally:
        async with _local_agent_lock:
            if _local_agents.get(owner) is websocket:
                _local_agents.pop(owner, None)


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
