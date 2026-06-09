// Secure Chat Module with Audio/Video Calls
/**
 * Complete secure chat system with WebRTC audio/video calling
 */

let API_BASE = window.location.origin;
let ws = null;
let currentUserId = null;
let currentRoomId = null;
let onlineUsers = [];
let activeCall = null;
let localStream = null;
let remoteStream = null;
let peerConnection = null;

// WebRTC Configuration
const rtcConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

const secureChatModule = {

  // ==================== INITIALIZATION ====================

  init(userId) {
    currentUserId = userId;
    this.connectWebSocket();
    this.setupEventListeners();
  },

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/secure-chat/ws/${currentUserId}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected');
      this.showNotification('Connected to secure chat', 'success');
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.showNotification('Connection error', 'error');
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.showNotification('Disconnected', 'warning');
      // Attempt to reconnect after 5 seconds
      setTimeout(() => this.connectWebSocket(), 5000);
    };
  },

  // ==================== MESSAGE HANDLING ====================

  handleMessage(message) {
    const { type } = message;

    switch (type) {
      case 'connected':
        onlineUsers = message.online_users;
        this.renderOnlineUsers();
        break;

      case 'user_online':
        if (!onlineUsers.includes(message.user_id)) {
          onlineUsers.push(message.user_id);
          this.renderOnlineUsers();
        }
        break;

      case 'user_offline':
        onlineUsers = onlineUsers.filter(id => id !== message.user_id);
        this.renderOnlineUsers();
        break;

      case 'chat_message':
        this.displayMessage(message);
        break;

      case 'typing':
        this.showTypingIndicator(message.user_id);
        break;

      case 'room_created':
        this.onRoomCreated(message.room);
        break;

      case 'incoming_call':
        this.handleIncomingCall(message.call);
        break;

      case 'call_accepted':
        this.onCallAccepted(message.call_id);
        break;

      case 'call_rejected':
        this.onCallRejected(message.call_id);
        break;

      case 'call_ended':
        this.onCallEnded(message.call_id);
        break;

      case 'webrtc_signal':
        this.handleWebRTCSignal(message);
        break;

      default:
        console.log('Unknown message type:', type);
    }
  },

  sendWebSocketMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket not connected');
    }
  },

  // ==================== CHAT FUNCTIONS ====================

  async sendMessage(content) {
    if (!currentRoomId) {
      this.showNotification('Please select a chat room', 'warning');
      return;
    }

    this.sendWebSocketMessage({
      type: 'chat_message',
      room_id: currentRoomId,
      content: content,
      encrypted: false  // TODO: Enable encryption
    });
  },

  displayMessage(message) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.sender_id === currentUserId ? 'sent' : 'received'}`;

    messageDiv.innerHTML = `
      <div class="message-header">
        <span class="message-sender">${message.sender_id}</span>
        <span class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</span>
      </div>
      <div class="message-content">${this.escapeHtml(message.content)}</div>
    `;

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  },

  showTypingIndicator(userId) {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) {
      indicator.textContent = `${userId} is typing...`;
      indicator.style.display = 'block';

      // Hide after 3 seconds
      setTimeout(() => {
        indicator.style.display = 'none';
      }, 3000);
    }
  },

  // ==================== WEBRTC AUDIO/VIDEO CALLS ====================

  async startCall(calleeId, callType = 'audio') {
    try {
      // Request media permissions
      const constraints = {
        audio: true,
        video: callType === 'video'
      };

      localStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Display local stream
      const localVideo = document.getElementById('local-video');
      if (localVideo) {
        localVideo.srcObject = localStream;
      }

      // Start call via API
      const response = await fetch(`${API_BASE}/api/secure-chat/calls/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callee_id: calleeId, call_type: callType })
      });

      const result = await response.json();
      if (result.success) {
        activeCall = result.call;
        this.setupPeerConnection();
        this.createOffer();
        this.showCallUI('outgoing');
      } else {
        this.showNotification('Failed to start call', 'error');
        this.stopLocalStream();
      }
    } catch (error) {
      console.error('Error starting call:', error);
      this.showNotification('Failed to access media devices', 'error');
      this.stopLocalStream();
    }
  },

  async handleIncomingCall(call) {
    activeCall = call;

    // Show incoming call modal
    const modal = document.getElementById('incoming-call-modal');
    if (modal) {
      document.getElementById('caller-name').textContent = call.caller;
      document.getElementById('call-type-display').textContent = call.type;
      modal.style.display = 'flex';
    }
  },

  async acceptCall() {
    try {
      // Request media permissions
      const constraints = {
        audio: true,
        video: activeCall.type === 'video'
      };

      localStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Display local stream
      const localVideo = document.getElementById('local-video');
      if (localVideo) {
        localVideo.srcObject = localStream;
      }

      // Accept call via API
      const response = await fetch(`${API_BASE}/api/secure-chat/calls/${activeCall.id}/accept`, {
        method: 'POST'
      });

      const result = await response.json();
      if (result.success) {
        this.setupPeerConnection();
        this.showCallUI('incoming');

        // Hide incoming call modal
        const modal = document.getElementById('incoming-call-modal');
        if (modal) modal.style.display = 'none';
      }
    } catch (error) {
      console.error('Error accepting call:', error);
      this.showNotification('Failed to accept call', 'error');
    }
  },

  async rejectCall() {
    if (!activeCall) return;

    await fetch(`${API_BASE}/api/secure-chat/calls/${activeCall.id}/reject`, {
      method: 'POST'
    });

    // Hide incoming call modal
    const modal = document.getElementById('incoming-call-modal');
    if (modal) modal.style.display = 'none';

    activeCall = null;
  },

  async endCall() {
    if (!activeCall) return;

    await fetch(`${API_BASE}/api/secure-chat/calls/${activeCall.id}/end`, {
      method: 'POST'
    });

    this.cleanup();
  },

  setupPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfiguration);

    // Add local stream tracks
    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }

    // Handle remote stream
    peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        remoteStream = event.streams[0];
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo) {
          remoteVideo.srcObject = remoteStream;
        }
      }
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendWebSocketMessage({
          type: 'webrtc_signal',
          signal_type: 'ice-candidate',
          call_id: activeCall.id,
          candidate: event.candidate
        });
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnection.connectionState);
      if (peerConnection.connectionState === 'connected') {
        this.showNotification('Call connected', 'success');
      } else if (peerConnection.connectionState === 'failed') {
        this.showNotification('Call failed', 'error');
        this.cleanup();
      }
    };
  },

  async createOffer() {
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      this.sendWebSocketMessage({
        type: 'webrtc_signal',
        signal_type: 'offer',
        call_id: activeCall.id,
        sdp: offer
      });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  },

  async createAnswer(offer) {
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      this.sendWebSocketMessage({
        type: 'webrtc_signal',
        signal_type: 'answer',
        call_id: activeCall.id,
        sdp: answer
      });
    } catch (error) {
      console.error('Error creating answer:', error);
    }
  },

  async handleWebRTCSignal(message) {
    const { signal_type, sdp, candidate } = message;

    if (signal_type === 'offer') {
      await this.createAnswer(sdp);
    } else if (signal_type === 'answer') {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    } else if (signal_type === 'ice-candidate') {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  },

  onCallAccepted(callId) {
    this.showNotification('Call accepted', 'success');
  },

  onCallRejected(callId) {
    this.showNotification('Call rejected', 'warning');
    this.cleanup();
  },

  onCallEnded(callId) {
    this.showNotification('Call ended', 'info');
    this.cleanup();
  },

  stopLocalStream() {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
  },

  cleanup() {
    this.stopLocalStream();

    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    remoteStream = null;
    activeCall = null;

    // Hide call UI
    const callContainer = document.getElementById('call-container');
    if (callContainer) callContainer.style.display = 'none';
  },

  // ==================== UI FUNCTIONS ====================

  showCallUI(type) {
    const callContainer = document.getElementById('call-container');
    if (callContainer) {
      callContainer.style.display = 'flex';

      const status = document.getElementById('call-status');
      if (status) {
        status.textContent = type === 'outgoing' ? 'Calling...' : 'Connected';
      }
    }
  },

  renderOnlineUsers() {
    const container = document.getElementById('online-users-list');
    if (!container) return;

    container.innerHTML = onlineUsers.map(userId => `
      <div class="user-item ${userId === currentUserId ? 'current-user' : ''}">
        <div class="user-avatar">${userId.charAt(0).toUpperCase()}</div>
        <div class="user-info">
          <div class="user-name">${userId}</div>
          <div class="user-status online">Online</div>
        </div>
        ${userId !== currentUserId ? `
          <div class="user-actions">
            <button class="btn-icon" onclick="secureChat.startCall('${userId}', 'audio')" title="Audio Call">
              📞
            </button>
            <button class="btn-icon" onclick="secureChat.startCall('${userId}', 'video')" title="Video Call">
              📹
            </button>
          </div>
        ` : ''}
      </div>
    `).join('');
  },

  onRoomCreated(room) {
    currentRoomId = room.id;
    this.showNotification('Room created', 'success');
  },

  setupEventListeners() {
    // Send message on Enter
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
      messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const content = messageInput.value.trim();
          if (content) {
            this.sendMessage(content);
            messageInput.value = '';
          }
        }
      });

      // Typing indicator
      messageInput.addEventListener('input', () => {
        this.sendWebSocketMessage({
          type: 'typing',
          room_id: currentRoomId
        });
      });
    }

    // Send button
    const sendBtn = document.getElementById('send-message-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => {
        const content = messageInput.value.trim();
        if (content) {
          this.sendMessage(content);
          messageInput.value = '';
        }
      });
    }

    // Call controls
    const endCallBtn = document.getElementById('end-call-btn');
    if (endCallBtn) {
      endCallBtn.addEventListener('click', () => this.endCall());
    }

    const acceptCallBtn = document.getElementById('accept-call-btn');
    if (acceptCallBtn) {
      acceptCallBtn.addEventListener('click', () => this.acceptCall());
    }

    const rejectCallBtn = document.getElementById('reject-call-btn');
    if (rejectCallBtn) {
      rejectCallBtn.addEventListener('click', () => this.rejectCall());
    }
  },

  // ==================== UTILITY FUNCTIONS ====================

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  showNotification(message, type = 'info') {
    if (window.showToast) {
      window.showToast(message, type);
    } else {
      console.log(`[${type}] ${message}`);
    }
  }
};

// Global export
window.secureChat = secureChatModule;

export default secureChatModule;
