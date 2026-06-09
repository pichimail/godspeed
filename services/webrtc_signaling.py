"""
WebRTC Signaling Service for Odysseus
Handles signaling for audio/video calls
"""

import json
import logging
import asyncio
from datetime import datetime
from typing import Dict, Optional, Set
import uuid

logger = logging.getLogger(__name__)

class WebRTCSignalingService:
    """Service for WebRTC signaling (SDP offers/answers, ICE candidates)"""

    def __init__(self):
        self.active_calls: Dict[str, Dict] = {}  # call_id -> call data
        self.user_calls: Dict[str, str] = {}  # user_id -> call_id
        self.pending_ice_candidates: Dict[str, List] = {}  # call_id -> candidates

    def create_call(self, caller_id: str, callee_id: str, call_type: str = "audio") -> Dict:
        """Create a new call session"""
        call_id = str(uuid.uuid4())

        self.active_calls[call_id] = {
            'id': call_id,
            'caller': caller_id,
            'callee': callee_id,
            'type': call_type,  # audio, video
            'status': 'ringing',  # ringing, active, ended
            'created_at': datetime.utcnow().isoformat(),
            'started_at': None,
            'ended_at': None,
            'sdp_offer': None,
            'sdp_answer': None
        }

        self.user_calls[caller_id] = call_id
        self.user_calls[callee_id] = call_id
        self.pending_ice_candidates[call_id] = []

        logger.info(f"Created {call_type} call {call_id}: {caller_id} -> {callee_id}")
        return self.active_calls[call_id]

    def get_call(self, call_id: str) -> Optional[Dict]:
        """Get call information"""
        return self.active_calls.get(call_id)

    def get_user_call(self, user_id: str) -> Optional[Dict]:
        """Get active call for a user"""
        call_id = self.user_calls.get(user_id)
        if call_id:
            return self.active_calls.get(call_id)
        return None

    def set_sdp_offer(self, call_id: str, sdp: Dict) -> bool:
        """Set SDP offer for a call"""
        if call_id in self.active_calls:
            self.active_calls[call_id]['sdp_offer'] = sdp
            return True
        return False

    def set_sdp_answer(self, call_id: str, sdp: Dict) -> bool:
        """Set SDP answer for a call"""
        if call_id in self.active_calls:
            self.active_calls[call_id]['sdp_answer'] = sdp
            self.active_calls[call_id]['status'] = 'active'
            self.active_calls[call_id]['started_at'] = datetime.utcnow().isoformat()
            return True
        return False

    def add_ice_candidate(self, call_id: str, candidate: Dict):
        """Add an ICE candidate for a call"""
        if call_id not in self.pending_ice_candidates:
            self.pending_ice_candidates[call_id] = []
        self.pending_ice_candidates[call_id].append({
            'candidate': candidate,
            'timestamp': datetime.utcnow().isoformat()
        })

    def get_ice_candidates(self, call_id: str) -> List[Dict]:
        """Get all ICE candidates for a call"""
        return self.pending_ice_candidates.get(call_id, [])

    def accept_call(self, call_id: str) -> bool:
        """Accept a call"""
        if call_id in self.active_calls:
            self.active_calls[call_id]['status'] = 'connecting'
            return True
        return False

    def reject_call(self, call_id: str, reason: str = "rejected") -> bool:
        """Reject a call"""
        if call_id in self.active_calls:
            self.active_calls[call_id]['status'] = 'rejected'
            self.active_calls[call_id]['ended_at'] = datetime.utcnow().isoformat()
            self.active_calls[call_id]['end_reason'] = reason
            self._cleanup_call(call_id)
            return True
        return False

    def end_call(self, call_id: str, reason: str = "ended") -> bool:
        """End an active call"""
        if call_id in self.active_calls:
            self.active_calls[call_id]['status'] = 'ended'
            self.active_calls[call_id]['ended_at'] = datetime.utcnow().isoformat()
            self.active_calls[call_id]['end_reason'] = reason
            self._cleanup_call(call_id)
            logger.info(f"Call {call_id} ended: {reason}")
            return True
        return False

    def _cleanup_call(self, call_id: str):
        """Clean up call resources"""
        if call_id in self.active_calls:
            call = self.active_calls[call_id]
            # Remove user mappings
            if call['caller'] in self.user_calls:
                del self.user_calls[call['caller']]
            if call['callee'] in self.user_calls:
                del self.user_calls[call['callee']]
            # Keep call in history but mark as inactive
            # Don't delete to preserve history

    def get_call_stats(self, call_id: str) -> Dict:
        """Get call statistics"""
        call = self.active_calls.get(call_id)
        if not call:
            return {}

        duration = 0
        if call.get('started_at') and call.get('ended_at'):
            start = datetime.fromisoformat(call['started_at'])
            end = datetime.fromisoformat(call['ended_at'])
            duration = (end - start).total_seconds()

        return {
            'call_id': call_id,
            'type': call['type'],
            'status': call['status'],
            'duration_seconds': duration,
            'ice_candidates': len(self.pending_ice_candidates.get(call_id, []))
        }


# Global service instance
_webrtc_signaling_service = None

def get_webrtc_signaling_service() -> WebRTCSignalingService:
    """Get the global WebRTC signaling service instance"""
    global _webrtc_signaling_service
    if _webrtc_signaling_service is None:
        _webrtc_signaling_service = WebRTCSignalingService()
    return _webrtc_signaling_service
