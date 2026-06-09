"""
Secure Chat Routes for Odysseus
WebSocket and HTTP endpoints for real-time secure chat
"""

import json
import logging
import asyncio
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from services.secure_chat_service import get_secure_chat_service
from services.webrtc_signaling import get_webrtc_signaling_service
from src.auth_helpers import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/secure-chat", tags=["secure-chat"])

# Get service instances
chat_service = get_secure_chat_service()
signaling_service = get_webrtc_signaling_service()


# ==================== REQUEST MODELS ====================

class CreateRoomRequest(BaseModel):
    participants: list[str]
    room_type: str = "private"  # private, group


class SendMessageRequest(BaseModel):
    room_id: str
    content: str
    encrypted: bool = False


class StartCallRequest(BaseModel):
    callee_id: str
    call_type: str = "audio"  # audio, video


class SignalingRequest(BaseModel):
    call_id: str
    type: str  # offer, answer, ice-candidate
    data: dict


# ==================== WEBSOCKET ENDPOINT ====================

@router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """WebSocket endpoint for real-time chat"""
    await websocket.accept()
    await chat_service.connect_user(user_id, websocket)

    try:
        # Send online status to user
        await websocket.send_json({
            'type': 'connected',
            'user_id': user_id,
            'online_users': chat_service.get_online_users()
        })

        # Notify other users that this user is online
        for room in chat_service.get_user_rooms(user_id):
            await chat_service.broadcast_to_room(
                room['id'],
                {
                    'type': 'user_online',
                    'user_id': user_id
                },
                exclude_user=user_id
            )

        # Listen for messages
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            await handle_websocket_message(user_id, message, websocket)

    except WebSocketDisconnect:
        logger.info(f"User {user_id} disconnected")
    except Exception as e:
        logger.error(f"WebSocket error for user {user_id}: {e}")
    finally:
        await chat_service.disconnect_user(user_id, websocket)

        # Notify other users that this user is offline
        for room in chat_service.get_user_rooms(user_id):
            await chat_service.broadcast_to_room(
                room['id'],
                {
                    'type': 'user_offline',
                    'user_id': user_id
                },
                exclude_user=user_id
            )


async def handle_websocket_message(user_id: str, message: dict, websocket: WebSocket):
    """Handle incoming WebSocket messages"""
    msg_type = message.get('type')

    if msg_type == 'chat_message':
        # Handle chat message
        room_id = message.get('room_id')
        content = message.get('content')

        chat_message = {
            'type': 'chat_message',
            'room_id': room_id,
            'sender_id': user_id,
            'content': content,
            'timestamp': datetime.utcnow().isoformat(),
            'encrypted': message.get('encrypted', False)
        }

        # Save to history
        chat_service.add_message_to_history(room_id, chat_message)

        # Broadcast to room
        await chat_service.broadcast_to_room(room_id, chat_message)

    elif msg_type == 'typing':
        # Handle typing indicator
        room_id = message.get('room_id')
        await chat_service.broadcast_to_room(
            room_id,
            {
                'type': 'typing',
                'room_id': room_id,
                'user_id': user_id
            },
            exclude_user=user_id
        )

    elif msg_type == 'webrtc_signal':
        # Handle WebRTC signaling
        await handle_webrtc_signal(user_id, message, websocket)

    else:
        logger.warning(f"Unknown message type: {msg_type}")


async def handle_webrtc_signal(user_id: str, message: dict, websocket: WebSocket):
    """Handle WebRTC signaling messages"""
    signal_type = message.get('signal_type')
    call_id = message.get('call_id')

    if signal_type == 'offer':
        # Forward SDP offer to callee
        signaling_service.set_sdp_offer(call_id, message.get('sdp'))
        call = signaling_service.get_call(call_id)
        if call:
            await chat_service.send_to_user(call['callee'], {
                'type': 'webrtc_signal',
                'signal_type': 'offer',
                'call_id': call_id,
                'sdp': message.get('sdp'),
                'caller_id': call['caller']
            })

    elif signal_type == 'answer':
        # Forward SDP answer to caller
        signaling_service.set_sdp_answer(call_id, message.get('sdp'))
        call = signaling_service.get_call(call_id)
        if call:
            await chat_service.send_to_user(call['caller'], {
                'type': 'webrtc_signal',
                'signal_type': 'answer',
                'call_id': call_id,
                'sdp': message.get('sdp')
            })

    elif signal_type == 'ice-candidate':
        # Forward ICE candidate
        candidate = message.get('candidate')
        signaling_service.add_ice_candidate(call_id, candidate)

        call = signaling_service.get_call(call_id)
        if call:
            # Forward to the other peer
            target_user = call['callee'] if user_id == call['caller'] else call['caller']
            await chat_service.send_to_user(target_user, {
                'type': 'webrtc_signal',
                'signal_type': 'ice-candidate',
                'call_id': call_id,
                'candidate': candidate
            })


# ==================== HTTP ENDPOINTS ====================

@router.post("/rooms/create")
async def create_room(request: Request, req: CreateRoomRequest):
    """Create a new chat room"""
    try:
        # Generate room ID
        import uuid
        room_id = str(uuid.uuid4())

        # Create room
        room = chat_service.create_room(room_id, req.participants, req.room_type)

        # Generate encryption key for the room
        encryption_key = chat_service.generate_encryption_key(room_id)
        room['encryption_key'] = encryption_key

        # Notify participants
        for user_id in req.participants:
            await chat_service.send_to_user(user_id, {
                'type': 'room_created',
                'room': room
            })

        return JSONResponse({
            'success': True,
            'room': room
        })
    except Exception as e:
        logger.error(f"Error creating room: {e}")
        return JSONResponse(
            {'success': False, 'error': str(e)},
            status_code=500
        )


@router.get("/rooms/{room_id}")
async def get_room(request: Request, room_id: str):
    """Get room information"""
    room = chat_service.get_room(room_id)
    if not room:
        return JSONResponse(
            {'success': False, 'error': 'Room not found'},
            status_code=404
        )

    return JSONResponse({
        'success': True,
        'room': room
    })


@router.get("/rooms/{room_id}/messages")
async def get_room_messages(request: Request, room_id: str, limit: int = 50):
    """Get messages from a room"""
    messages = chat_service.get_room_messages(room_id, limit)

    return JSONResponse({
        'success': True,
        'messages': messages,
        'count': len(messages)
    })


@router.get("/users/online")
async def get_online_users(request: Request):
    """Get list of online users"""
    users = chat_service.get_online_users()

    return JSONResponse({
        'success': True,
        'users': users,
        'count': len(users)
    })


# ==================== CALL ENDPOINTS ====================

@router.post("/calls/start")
async def start_call(request: Request, req: StartCallRequest):
    """Initiate an audio/video call"""
    try:
        # Get caller from auth (simplified - use actual auth)
        caller_id = "user1"  # TODO: Get from auth

        # Check if callee is online
        if not chat_service.is_user_online(req.callee_id):
            return JSONResponse(
                {'success': False, 'error': 'User is offline'},
                status_code=400
            )

        # Create call
        call = signaling_service.create_call(caller_id, req.callee_id, req.call_type)

        # Notify callee
        await chat_service.send_to_user(req.callee_id, {
            'type': 'incoming_call',
            'call': call
        })

        return JSONResponse({
            'success': True,
            'call': call
        })
    except Exception as e:
        logger.error(f"Error starting call: {e}")
        return JSONResponse(
            {'success': False, 'error': str(e)},
            status_code=500
        )


@router.post("/calls/{call_id}/accept")
async def accept_call(request: Request, call_id: str):
    """Accept an incoming call"""
    try:
        success = signaling_service.accept_call(call_id)
        if not success:
            return JSONResponse(
                {'success': False, 'error': 'Call not found'},
                status_code=404
            )

        call = signaling_service.get_call(call_id)

        # Notify caller
        await chat_service.send_to_user(call['caller'], {
            'type': 'call_accepted',
            'call_id': call_id
        })

        return JSONResponse({
            'success': True,
            'call': call
        })
    except Exception as e:
        logger.error(f"Error accepting call: {e}")
        return JSONResponse(
            {'success': False, 'error': str(e)},
            status_code=500
        )


@router.post("/calls/{call_id}/reject")
async def reject_call(request: Request, call_id: str):
    """Reject an incoming call"""
    try:
        call = signaling_service.get_call(call_id)
        if not call:
            return JSONResponse(
                {'success': False, 'error': 'Call not found'},
                status_code=404
            )

        signaling_service.reject_call(call_id, "rejected")

        # Notify caller
        await chat_service.send_to_user(call['caller'], {
            'type': 'call_rejected',
            'call_id': call_id
        })

        return JSONResponse({
            'success': True,
            'message': 'Call rejected'
        })
    except Exception as e:
        logger.error(f"Error rejecting call: {e}")
        return JSONResponse(
            {'success': False, 'error': str(e)},
            status_code=500
        )


@router.post("/calls/{call_id}/end")
async def end_call(request: Request, call_id: str):
    """End an active call"""
    try:
        call = signaling_service.get_call(call_id)
        if not call:
            return JSONResponse(
                {'success': False, 'error': 'Call not found'},
                status_code=404
            )

        signaling_service.end_call(call_id, "ended")

        # Notify both parties
        await chat_service.send_to_user(call['caller'], {
            'type': 'call_ended',
            'call_id': call_id
        })
        await chat_service.send_to_user(call['callee'], {
            'type': 'call_ended',
            'call_id': call_id
        })

        return JSONResponse({
            'success': True,
            'message': 'Call ended',
            'stats': signaling_service.get_call_stats(call_id)
        })
    except Exception as e:
        logger.error(f"Error ending call: {e}")
        return JSONResponse(
            {'success': False, 'error': str(e)},
            status_code=500
        )


@router.get("/calls/{call_id}")
async def get_call(request: Request, call_id: str):
    """Get call information"""
    call = signaling_service.get_call(call_id)
    if not call:
        return JSONResponse(
            {'success': False, 'error': 'Call not found'},
            status_code=404
        )

    return JSONResponse({
        'success': True,
        'call': call,
        'stats': signaling_service.get_call_stats(call_id)
    })


def get_secure_chat_router() -> APIRouter:
    """Get secure chat router for app registration"""
    return router
