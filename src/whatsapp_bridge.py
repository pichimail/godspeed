"""
WhatsApp Bridge Adapter for Godspeed.

Supports Evolution API (preferred for multi-instance) and Waha.
Provides a unified interface so the rest of the code does not care which bridge is used.

Admin configures once:
  - bridge_type: "evolution" | "waha"
  - bridge_url: base URL of the bridge (e.g. http://evolution:8080 or http://waha:3000)
  - api_key: for control plane calls (instance create, qr, send, etc.)
  - webhook_secret: used to validate incoming webhooks from the bridge (recommended)

The bridge must be configured by the admin to send webhooks to:
  https://your-godspeed-host/api/whatsapp/webhook?secret=YOUR_WEBHOOK_SECRET

Each Godspeed user gets their own bridge "instance" (named something like wa_<owner>_<shortid>).

Payload normalization turns Evolution or Waha message events into a common shape.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, asdict
from typing import Any, Optional, Dict, List

import httpx

logger = logging.getLogger(__name__)


@dataclass
class BridgeConfig:
    bridge_type: str = "evolution"          # "evolution" | "waha"
    bridge_url: str = ""
    api_key: Optional[str] = None
    webhook_secret: Optional[str] = None
    timeout: int = 30


@dataclass
class NormalizedIncoming:
    """Common shape we use internally after receiving a webhook from any supported bridge."""
    bridge_instance_id: str
    jid: str                  # e.g. "1234567890@c.us" or "group-xxx@g.us"
    push_name: Optional[str] = None
    text: str = ""
    is_group: bool = False
    timestamp: Optional[int] = None
    raw: Optional[Dict[str, Any]] = None   # original payload for debugging


@dataclass
class BridgeInstanceInfo:
    instance_id: str
    status: str
    qr_code: Optional[str] = None
    phone_number: Optional[str] = None


class WhatsappBridgeClient:
    """Thin client + normalizer for Evolution API and Waha."""

    def __init__(self, config: BridgeConfig):
        self.config = config
        self._client = httpx.Client(timeout=config.timeout, follow_redirects=True)

    def _headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        h = {}
        if self.config.api_key:
            # Both Evolution and Waha commonly use apikey header
            h["apikey"] = self.config.api_key
            h["Authorization"] = f"Bearer {self.config.api_key}"
        if extra:
            h.update(extra)
        return h

    def _url(self, path: str) -> str:
        base = self.config.bridge_url.rstrip("/")
        p = path if path.startswith("/") else "/" + path
        return f"{base}{p}"

    # ---------------- Control plane (admin + pairing) ----------------

    def create_instance(self, owner: str, phone_number: Optional[str] = None) -> BridgeInstanceInfo:
        """Create (or ensure) an instance for this owner in the bridge and return info + optional QR."""
        short = owner.replace("@", "_").replace(".", "_")[:16]
        instance_name = f"wa_{short}_{int(time.time()) % 100000}"

        if self.config.bridge_type == "waha":
            # Waha style
            payload = {
                "name": instance_name,
                "start": True,
                "config": {
                    "webhooks": [
                        {
                            "url": self._build_webhook_url(),
                            "events": ["message", "session.status"]
                        }
                    ]
                }
            }
            r = self._client.post(self._url("/api/sessions"), json=payload, headers=self._headers())
            r.raise_for_status()
            data = r.json()
            return BridgeInstanceInfo(
                instance_id=instance_name,
                status="qr_pending",
                qr_code=None,  # will be fetched separately
            )

        else:
            # Evolution API (most common)
            payload = {
                "instanceName": instance_name,
                "token": None,   # let bridge generate or we can pass one
                "qrcode": True,
                "webhook": self._build_webhook_url(),
                "webhook_by_events": True,
                "events": ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
            }
            r = self._client.post(self._url("/instance/create"), json=payload, headers=self._headers())
            r.raise_for_status()
            data = r.json()
            # Evolution returns { instance: { instanceName, ... }, hash, ... }
            inst = data.get("instance", {}) or data
            return BridgeInstanceInfo(
                instance_id=inst.get("instanceName") or instance_name,
                status="qr_pending",
                qr_code=data.get("qrcode", {}).get("base64") or data.get("qrcode"),
            )

    def get_qr(self, instance_id: str) -> Optional[str]:
        """Return a QR code (data URI or base64) for the instance if it is in pairing state."""
        if self.config.bridge_type == "waha":
            r = self._client.get(self._url(f"/api/sessions/{instance_id}/auth/qr"), headers=self._headers())
            if r.status_code == 200:
                data = r.json()
                # Waha often returns { qr: "data:image/..." } or raw png base64
                qr = data.get("qr") or data.get("qrcode")
                if qr and not str(qr).startswith("data:"):
                    qr = "data:image/png;base64," + qr
                return qr
            return None
        else:
            # Evolution
            r = self._client.get(self._url(f"/instance/connect/{instance_id}"), headers=self._headers())
            if r.status_code == 200:
                data = r.json()
                qr = data.get("qrcode", {}).get("base64") or data.get("base64") or data.get("qrcode")
                if qr and not str(qr).startswith("data:"):
                    qr = "data:image/png;base64," + qr
                return qr
            return None

    def get_instance_status(self, instance_id: str) -> Dict[str, Any]:
        if self.config.bridge_type == "waha":
            r = self._client.get(self._url(f"/api/sessions/{instance_id}"), headers=self._headers())
            if r.status_code == 200:
                d = r.json()
                return {"status": d.get("status", "UNKNOWN"), "phone": d.get("phoneNumber")}
            return {"status": "UNKNOWN"}
        else:
            r = self._client.get(self._url(f"/instance/connectionState/{instance_id}"), headers=self._headers())
            if r.status_code == 200:
                d = r.json()
                state = (d.get("instance", {}) or d).get("state", "close")
                return {"status": state}
            return {"status": "close"}

    def send_message(self, instance_id: str, to_jid: str, text: str) -> bool:
        """Send a text message. Returns True on success."""
        try:
            if self.config.bridge_type == "waha":
                payload = {"chatId": to_jid, "text": text}
                r = self._client.post(self._url(f"/api/sendText/{instance_id}"), json=payload, headers=self._headers())
            else:
                # Evolution
                payload = {
                    "number": to_jid.replace("@c.us", "").replace("@g.us", ""),
                    "text": text,
                }
                # Evolution v1 often uses /message/sendText/{instance}
                r = self._client.post(self._url(f"/message/sendText/{instance_id}"), json=payload, headers=self._headers())
            r.raise_for_status()
            return True
        except Exception as e:
            logger.warning(f"bridge send_message failed: {e}")
            return False

    def get_contacts(self, instance_id: str) -> List[Dict[str, Any]]:
        """Best-effort contact list. Different bridges have different endpoints."""
        try:
            if self.config.bridge_type == "waha":
                r = self._client.get(self._url(f"/api/contacts/{instance_id}"), headers=self._headers())
            else:
                r = self._client.get(self._url(f"/chat/findContacts/{instance_id}"), headers=self._headers())
            if r.status_code == 200:
                data = r.json()
                # Normalize to list of {jid, name, notify}
                if isinstance(data, list):
                    return data
                if isinstance(data, dict):
                    return data.get("contacts") or data.get("data") or []
            return []
        except Exception:
            return []

    def delete_instance(self, instance_id: str) -> bool:
        try:
            if self.config.bridge_type == "waha":
                r = self._client.delete(self._url(f"/api/sessions/{instance_id}"), headers=self._headers())
            else:
                r = self._client.delete(self._url(f"/instance/delete/{instance_id}"), headers=self._headers())
            return r.status_code < 400
        except Exception:
            return False

    # ---------------- Webhook helpers ----------------

    def _build_webhook_url(self) -> str:
        # The admin is responsible for making sure the public / LAN URL is reachable by the bridge.
        # We return a placeholder that the admin can override in the bridge UI if needed.
        # In practice the Godspeed side tells the bridge the exact URL when creating the instance.
        base = os.environ.get("PUBLIC_URL") or os.environ.get("APP_PUBLIC_URL") or "http://localhost:7000"
        secret = self.config.webhook_secret or ""
        return f"{base.rstrip('/')}/api/whatsapp/webhook?secret={secret}"

    def normalize_incoming(self, raw_payload: Dict[str, Any]) -> Optional[NormalizedIncoming]:
        """Turn Evolution or Waha message event into our common shape."""
        try:
            if self.config.bridge_type == "waha":
                # Waha typical: { event: "message", session: "...", payload: { from: "...", body: "...", ... } }
                event = raw_payload.get("event") or ""
                if "message" not in event.lower():
                    return None
                p = raw_payload.get("payload") or raw_payload
                session = raw_payload.get("session") or raw_payload.get("instance") or p.get("session")
                from_jid = p.get("from") or p.get("remoteJid") or p.get("chatId")
                if not from_jid or not session:
                    return None
                return NormalizedIncoming(
                    bridge_instance_id=session,
                    jid=from_jid,
                    push_name=p.get("notifyName") or p.get("pushName"),
                    text=p.get("body") or p.get("text") or "",
                    is_group="g.us" in str(from_jid),
                    timestamp=p.get("timestamp"),
                    raw=raw_payload,
                )
            else:
                # Evolution: { event: "messages.upsert", instance: "...", data: { key: { remoteJid }, message: { conversation }, pushName, ... } }
                event = raw_payload.get("event", "")
                if "messages.upsert" not in event and "message" not in event.lower():
                    return None
                inst = raw_payload.get("instance") or raw_payload.get("instanceName")
                data = raw_payload.get("data") or raw_payload
                key = data.get("key") or {}
                jid = key.get("remoteJid") or data.get("remoteJid")
                if not jid or not inst:
                    return None
                msg = data.get("message") or {}
                text = (
                    msg.get("conversation")
                    or (msg.get("extendedTextMessage") or {}).get("text")
                    or (msg.get("imageMessage") or {}).get("caption")
                    or ""
                )
                return NormalizedIncoming(
                    bridge_instance_id=inst,
                    jid=jid,
                    push_name=data.get("pushName") or data.get("verifiedBizName"),
                    text=text,
                    is_group="g.us" in str(jid),
                    timestamp=data.get("messageTimestamp"),
                    raw=raw_payload,
                )
        except Exception as e:
            logger.warning(f"Failed to normalize whatsapp webhook: {e}")
            return None

    def close(self):
        try:
            self._client.close()
        except Exception:
            pass


# ---------------- Config loading helpers (used by routes + processor) ----------------

_BRIDGE_CONFIG_CACHE: Optional[BridgeConfig] = None
_BRIDGE_CONFIG_PATH = os.path.join("data", "whatsapp_bridge.json")


def load_bridge_config() -> BridgeConfig:
    global _BRIDGE_CONFIG_CACHE
    if _BRIDGE_CONFIG_CACHE is not None:
        return _BRIDGE_CONFIG_CACHE

    cfg = BridgeConfig()
    # 1. Environment (highest priority for docker / one-time admin setup)
    if os.getenv("WA_BRIDGE_URL"):
        cfg.bridge_url = os.getenv("WA_BRIDGE_URL")
        cfg.bridge_type = os.getenv("WA_BRIDGE_TYPE", "evolution").lower()
        cfg.api_key = os.getenv("WA_BRIDGE_API_KEY") or os.getenv("WA_API_KEY")
        cfg.webhook_secret = os.getenv("WA_WEBHOOK_SECRET")

    # 2. JSON file (written by admin UI)
    try:
        if os.path.exists(_BRIDGE_CONFIG_PATH):
            with open(_BRIDGE_CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            if data.get("bridge_url"):
                cfg.bridge_url = data.get("bridge_url")
            if data.get("bridge_type"):
                cfg.bridge_type = data.get("bridge_type")
            if data.get("api_key"):
                cfg.api_key = data.get("api_key")
            if data.get("webhook_secret"):
                cfg.webhook_secret = data.get("webhook_secret")
    except Exception:
        pass

    _BRIDGE_CONFIG_CACHE = cfg
    return cfg


def save_bridge_config(cfg: BridgeConfig) -> None:
    global _BRIDGE_CONFIG_CACHE
    os.makedirs("data", exist_ok=True)
    data = {
        "bridge_type": cfg.bridge_type,
        "bridge_url": cfg.bridge_url,
        "api_key": cfg.api_key,
        "webhook_secret": cfg.webhook_secret,
    }
    with open(_BRIDGE_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    _BRIDGE_CONFIG_CACHE = cfg
    logger.info("WhatsApp bridge config saved")


def get_bridge_client() -> Optional[WhatsappBridgeClient]:
    cfg = load_bridge_config()
    if not cfg.bridge_url:
        return None
    return WhatsappBridgeClient(cfg)