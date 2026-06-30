"""
Secure Chat Service for Odysseus
Handles peer-to-peer messaging with end-to-end encryption
"""

import json
import logging
import asyncio
from datetime import datetime
from typing import Dict, List, Optional, Set
from cryptography.fernet import Fernet
import base64
import secrets

logger = logging.getLogger(__name__)

class SecureChatService:
    """Service for managing secure peer-to-peer chat"""

    def __init__(self):
        self.active_connections: Dict[str, Set] = {}  # user_id -> set of websocket connections
        self.chat_rooms: Dict[str, Dict] = {}  # room_id -> room data
        self.user_keys: Dict[str, str] = {}  # user_id -> public_key
        self.message_history: Dict[str, List] = {}  # room_id -> messages

    async def connect_user(self, user_id: str, websocket):
        """Connect a user to the chat service"""
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)
        logger.info(f"User {user_id} connected to secure chat")

    async def disconnect_user(self, user_id: str, websocket):
        """Disconnect a user from the chat service"""
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info(f"User {user_id} disconnected from secure chat")

    def is_user_online(self, user_id: str) -> bool:
        """Check if a user is currently online"""
        return user_id in self.active_connections and len(self.active_connections[user_id]) > 0

    def get_online_users(self) -> List[str]:
        """Get list of all online users"""
        return list(self.active_connections.keys())

    async def send_to_user(self, user_id: str, message: dict):
        """Send a message to all connections of a specific user"""
        if user_id in self.active_connections:
            dead_connections = set()
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error sending to user {user_id}: {e}")
                    dead_connections.add(connection)

            # Clean up dead connections
            self.active_connections[user_id] -= dead_connections
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    async def broadcast_to_room(self, room_id: str, message: dict, exclude_user: Optional[str] = None):
        """Broadcast a message to all users in a room"""
        if room_id not in self.chat_rooms:
            return

        room = self.chat_rooms[room_id]
        for user_id in room.get('participants', []):
            if user_id != exclude_user:
                await self.send_to_user(user_id, message)

    def create_room(self, room_id: str, participants: List[str], room_type: str = "private") -> Dict:
        """Create a new chat room"""
        self.chat_rooms[room_id] = {
            'id': room_id,
            'participants': participants,
            'type': room_type,  # private, group
            'created_at': datetime.utcnow().isoformat(),
            'active': True
        }
        self.message_history[room_id] = []
        return self.chat_rooms[room_id]

    def get_room(self, room_id: str) -> Optional[Dict]:
        """Get room information"""
        return self.chat_rooms.get(room_id)

    def get_user_rooms(self, user_id: str) -> List[Dict]:
        """Get all rooms a user is part of"""
        return [
            room for room in self.chat_rooms.values()
            if user_id in room.get('participants', [])
        ]

    def add_message_to_history(self, room_id: str, message: Dict):
        """Add a message to room history"""
        if room_id not in self.message_history:
            self.message_history[room_id] = []

        self.message_history[room_id].append({
            **message,
            'timestamp': datetime.utcnow().isoformat()
        })

        # Keep only last 100 messages in memory
        if len(self.message_history[room_id]) > 100:
            self.message_history[room_id] = self.message_history[room_id][-100:]

    def get_room_messages(self, room_id: str, limit: int = 50) -> List[Dict]:
        """Get recent messages from a room"""
        messages = self.message_history.get(room_id, [])
        return messages[-limit:]

    def generate_encryption_key(self, room_id: str) -> str:
        """Generate a shared encryption key for a room"""
        # Generate a random key
        key = Fernet.generate_key()
        return base64.urlsafe_b64encode(key).decode()

    def encrypt_message(self, message: str, key: str) -> str:
        """Encrypt a message using Fernet symmetric encryption"""
        try:
            key_bytes = base64.urlsafe_b64decode(key.encode())
            f = Fernet(key_bytes)
            encrypted = f.encrypt(message.encode())
            return base64.urlsafe_b64encode(encrypted).decode()
        except Exception as e:
            logger.error(f"Encryption error: {e}")
            return message

    def decrypt_message(self, encrypted_message: str, key: str) -> str:
        """Decrypt a message using Fernet symmetric encryption"""
        try:
            key_bytes = base64.urlsafe_b64decode(key.encode())
            f = Fernet(key_bytes)
            encrypted_bytes = base64.urlsafe_b64decode(encrypted_message.encode())
            decrypted = f.decrypt(encrypted_bytes)
            return decrypted.decode()
        except Exception as e:
            logger.error(f"Decryption error: {e}")
            return encrypted_message


# Global service instance
_secure_chat_service = None

def get_secure_chat_service() -> SecureChatService:
    """Get the global secure chat service instance"""
    global _secure_chat_service
    if _secure_chat_service is None:
        _secure_chat_service = SecureChatService()
    return _secure_chat_service
