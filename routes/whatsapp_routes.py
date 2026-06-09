"""
WhatsApp Assistant routes for Godspeed.

User flows:
- List / create instances (pairing via QR — Evolution or Waha)
- Get status + refresh QR
- List contacts (from bridge)
- Get / set per-contact and global configs (name, behaviour, permissions, mode)
- The heavy lifting (receive → process with per-contact session + dynamic persona → reply) lives in src/whatsapp_processor

Admin:
- Configure the bridge once (URL, type, keys)
- Webhook receiver (the bridge posts here)

All user routes are owner-scoped. Webhook is secret-protected.
"""

import json
import logging
import secrets
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request, HTTPException, Depends
from pydantic import BaseModel, Field

from core.database import SessionLocal, WhatsappInstance, WhatsappContactConfig
from core.middleware import require_admin
from src.auth_helpers import get_current_user
from src.whatsapp_bridge import (
    load_bridge_config, save_bridge_config, get_bridge_client,
    BridgeConfig, NormalizedIncoming
)
from src.whatsapp_processor import process_incoming_message, mark_instance_activity, _load_effective_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])

MAX_PERSONALITY = 8000


class InstanceCreate(BaseModel):
    phone_number: Optional[str] = None


class ConfigUpsert(BaseModel):
    instance_id: str
    jid: str = Field(..., description="'*' for global or a real JID like 1234567890@c.us")
    contact_name: Optional[str] = None
    display_name: Optional[str] = None
    personality: Optional[str] = Field(None, max_length=MAX_PERSONALITY)
    mode: Optional[str] = Field("conversational", pattern="^(conversational|agent)$")
    enabled_tools: Optional[str] = None
    permissions: Optional[dict] = None
    enabled: Optional[bool] = True


class BridgeAdminConfig(BaseModel):
    bridge_type: str = "evolution"
    bridge_url: str
    api_key: Optional[str] = None
    webhook_secret: Optional[str] = None


def _owner(request: Request) -> str:
    u = get_current_user(request)
    if not u:
        raise HTTPException(401, "Authentication required")
    return u


def _require_instance_owner(instance_id: str, owner: str) -> WhatsappInstance:
    db = SessionLocal()
    try:
        inst = db.query(WhatsappInstance).filter(WhatsappInstance.id == instance_id).first()
        if not inst or (inst.owner and inst.owner != owner):
            raise HTTPException(404, "Instance not found")
        return inst
    finally:
        db.close()


@router.get("/admin/bridge")
def get_admin_bridge(request: Request):
    require_admin(request)
    cfg = load_bridge_config()
    return {
        "bridge_type": cfg.bridge_type,
        "bridge_url": cfg.bridge_url,
        "has_api_key": bool(cfg.api_key),
        "has_webhook_secret": bool(cfg.webhook_secret),
    }


@router.post("/admin/bridge")
def save_admin_bridge(request: Request, body: BridgeAdminConfig):
    require_admin(request)
    cfg = BridgeConfig(
        bridge_type=body.bridge_type.lower(),
        bridge_url=body.bridge_url.strip(),
        api_key=body.api_key,
        webhook_secret=body.webhook_secret or secrets.token_urlsafe(24),
    )
    save_bridge_config(cfg)
    return {"ok": True, "webhook_url_hint": f"/api/whatsapp/webhook?secret={cfg.webhook_secret}"}


# ---------------- User: Instances (pairing) ----------------

@router.get("/instances")
def list_instances(request: Request):
    owner = _owner(request)
    db = SessionLocal()
    try:
        rows = db.query(WhatsappInstance).filter(WhatsappInstance.owner == owner).order_by(WhatsappInstance.created_at.desc()).all()
        out = []
        for r in rows:
            out.append({
                "id": r.id,
                "phone_number": r.phone_number,
                "bridge_type": r.bridge_type,
                "bridge_instance_id": r.bridge_instance_id,
                "status": r.status,
                "qr_code": r.qr_code,
                "last_connected_at": r.last_connected_at.isoformat() if r.last_connected_at else None,
                "last_message_at": r.last_message_at.isoformat() if r.last_message_at else None,
                "enabled": r.enabled,
                "error_message": r.error_message,
            })
        return {"instances": out}
    finally:
        db.close()


@router.post("/instances")
async def create_instance(request: Request, body: InstanceCreate):
    owner = _owner(request)
    client = get_bridge_client()
    if not client:
        raise HTTPException(400, "WhatsApp bridge is not configured by the admin yet. Ask your admin to set it up in Admin → WhatsApp Bridge.")

    try:
        info = client.create_instance(owner, body.phone_number)
    except Exception as e:
        logger.exception("Bridge create_instance failed")
        raise HTTPException(502, f"Failed to create WhatsApp session in bridge: {e}")

    db = SessionLocal()
    try:
        inst_id = str(uuid.uuid4())[:12]
        inst = WhatsappInstance(
            id=inst_id,
            owner=owner,
            phone_number=body.phone_number,
            bridge_type=client.config.bridge_type,
            bridge_instance_id=info.instance_id,
            status="qr_pending",
            qr_code=info.qr_code,
            enabled=True,
        )
        db.add(inst)
        db.commit()
        db.refresh(inst)

        # Ensure a global "*" config row exists with sensible defaults
        existing_global = db.query(WhatsappContactConfig).filter(
            WhatsappContactConfig.owner == owner,
            WhatsappContactConfig.instance_id == inst_id,
            WhatsappContactConfig.jid == "*",
        ).first()
        if not existing_global:
            gc = WhatsappContactConfig(
                id=str(uuid.uuid4())[:12],
                owner=owner,
                instance_id=inst_id,
                jid="*",
                display_name="Godspeed",
                personality=None,   # will use processor default
                mode="conversational",
                enabled=True,
            )
            db.add(gc)
            db.commit()

        return {
            "id": inst.id,
            "bridge_instance_id": inst.bridge_instance_id,
            "status": inst.status,
            "qr_code": inst.qr_code,
        }
    finally:
        db.close()


@router.get("/instances/{instance_id}")
def get_instance(request: Request, instance_id: str):
    owner = _owner(request)
    inst = _require_instance_owner(instance_id, owner)
    client = get_bridge_client()
    status = inst.status
    if client:
        try:
            live = client.get_instance_status(inst.bridge_instance_id)
            status = live.get("status", status)
        except Exception:
            pass
    return {
        "id": inst.id,
        "phone_number": inst.phone_number,
        "bridge_instance_id": inst.bridge_instance_id,
        "status": status,
        "qr_code": inst.qr_code,
        "last_connected_at": inst.last_connected_at.isoformat() if inst.last_connected_at else None,
        "enabled": inst.enabled,
    }


@router.post("/instances/{instance_id}/refresh-qr")
def refresh_qr(request: Request, instance_id: str):
    owner = _owner(request)
    inst = _require_instance_owner(instance_id, owner)
    client = get_bridge_client()
    if not client:
        raise HTTPException(400, "Bridge not configured")
    qr = client.get_qr(inst.bridge_instance_id)
    if qr:
        db = SessionLocal()
        try:
            inst.qr_code = qr
            inst.status = "qr_pending"
            db.commit()
        finally:
            db.close()
    return {"qr_code": qr}


@router.delete("/instances/{instance_id}")
def delete_instance(request: Request, instance_id: str):
    owner = _owner(request)
    inst = _require_instance_owner(instance_id, owner)
    client = get_bridge_client()
    if client:
        try:
            client.delete_instance(inst.bridge_instance_id)
        except Exception:
            pass
    db = SessionLocal()
    try:
        db.delete(inst)
        # cascade will clean configs
        db.commit()
    finally:
        db.close()
    return {"ok": True}


@router.get("/instances/{instance_id}/contacts")
def list_contacts(request: Request, instance_id: str):
    owner = _owner(request)
    inst = _require_instance_owner(instance_id, owner)
    client = get_bridge_client()
    if not client:
        return {"contacts": []}
    contacts = client.get_contacts(inst.bridge_instance_id) or []
    # Normalize a bit for the UI
    norm = []
    for c in contacts[:200]:   # safety
        jid = c.get("jid") or c.get("id") or c.get("remoteJid") or ""
        norm.append({
            "jid": jid,
            "name": c.get("name") or c.get("notify") or c.get("pushName") or jid.split("@")[0],
            "notify": c.get("notify"),
        })
    return {"contacts": norm}


# ---------------- Config (global + per-contact) — fully dynamic ----------------

@router.get("/configs")
def list_configs(request: Request, instance_id: Optional[str] = None):
    owner = _owner(request)
    db = SessionLocal()
    try:
        q = db.query(WhatsappContactConfig).filter(WhatsappContactConfig.owner == owner)
        if instance_id:
            q = q.filter(WhatsappContactConfig.instance_id == instance_id)
        rows = q.all()
        out = []
        for r in rows:
            out.append({
                "id": r.id,
                "instance_id": r.instance_id,
                "jid": r.jid,
                "contact_name": r.contact_name,
                "display_name": r.display_name,
                "personality": r.personality,
                "mode": r.mode,
                "enabled_tools": r.enabled_tools,
                "permissions": r.permissions,
                "enabled": r.enabled,
            })
        return {"configs": out}
    finally:
        db.close()


@router.post("/configs")
def upsert_config(request: Request, body: ConfigUpsert):
    owner = _owner(request)
    _require_instance_owner(body.instance_id, owner)  # ownership check

    if len(body.jid or "") > 120:
        raise HTTPException(400, "jid too long")

    db = SessionLocal()
    try:
        row = (
            db.query(WhatsappContactConfig)
            .filter(
                WhatsappContactConfig.owner == owner,
                WhatsappContactConfig.instance_id == body.instance_id,
                WhatsappContactConfig.jid == body.jid,
            )
            .first()
        )
        if not row:
            row = WhatsappContactConfig(
                id=str(uuid.uuid4())[:12],
                owner=owner,
                instance_id=body.instance_id,
                jid=body.jid,
            )
            db.add(row)

        if body.contact_name is not None:
            row.contact_name = body.contact_name
        if body.display_name is not None:
            row.display_name = body.display_name
        if body.personality is not None:
            row.personality = body.personality[:MAX_PERSONALITY]
        if body.mode is not None:
            row.mode = body.mode
        if body.enabled_tools is not None:
            row.enabled_tools = body.enabled_tools
        if body.permissions is not None:
            row.permissions = body.permissions
        if body.enabled is not None:
            row.enabled = body.enabled

        db.commit()
        db.refresh(row)
        return {
            "id": row.id,
            "jid": row.jid,
            "display_name": row.display_name,
            "mode": row.mode,
            "enabled": row.enabled,
        }
    finally:
        db.close()


@router.get("/configs/effective")
def get_effective(request: Request, instance_id: str, jid: str):
    owner = _owner(request)
    _require_instance_owner(instance_id, owner)
    cfg = _load_effective_config(owner, instance_id, jid)
    return {"effective": cfg}


# ---------------- The actual webhook from the bridge ----------------

@router.post("/webhook")
async def whatsapp_webhook(request: Request):
    """Public-ish (secret protected) endpoint that the WhatsApp bridge calls for new messages."""
    secret = request.query_params.get("secret") or request.headers.get("x-webhook-secret")
    cfg = load_bridge_config()

    if cfg.webhook_secret and secret != cfg.webhook_secret:
        # Still accept if no secret configured (dev convenience) but warn
        if cfg.webhook_secret:
            raise HTTPException(403, "Invalid webhook secret")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    client = get_bridge_client()
    if not client:
        logger.warning("Webhook received but no bridge client configured")
        return {"ok": True, "ignored": "no bridge"}

    normalized: Optional[NormalizedIncoming] = client.normalize_incoming(payload)
    if not normalized:
        return {"ok": True, "ignored": "no message event"}

    # Find the instance by bridge_instance_id
    db = SessionLocal()
    try:
        inst = db.query(WhatsappInstance).filter(
            WhatsappInstance.bridge_instance_id == normalized.bridge_instance_id
        ).first()
        if not inst or not inst.owner or not inst.enabled:
            return {"ok": True, "ignored": "unknown or disabled instance"}
        owner = inst.owner
    finally:
        db.close()

    # Optional: skip our own echoes if the bridge sends them
    if normalized.text and normalized.text.strip().startswith("[Godspeed"):
        return {"ok": True}

    contact_name = normalized.push_name

    # Mark activity
    mark_instance_activity(inst.id)

    # Process (this does persona resolution, per-contact session, LLM/agent call, returns reply text)
    reply = await process_incoming_message(owner, inst, normalized, contact_name=contact_name)

    if reply:
        # Send it back
        sent = False
        if client:
            sent = client.send_message(inst.bridge_instance_id, normalized.jid, reply)
        logger.info(f"WA reply sent={sent} to {normalized.jid} (owner={owner})")
        return {"ok": True, "replied": bool(reply), "sent": sent}

    return {"ok": True, "replied": False}


# Simple health/ping for the bridge
@router.get("/ping")
def wa_ping():
    return {"ok": True, "service": "whatsapp-assistant"}