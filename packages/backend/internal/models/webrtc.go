package models

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// WebRTC signaling message types
type SignalingMessageType string

const (
	SignalingTypeOffer      SignalingMessageType = "offer"
	SignalingTypeAnswer     SignalingMessageType = "answer"
	SignalingTypeIceCandidate SignalingMessageType = "ice-candidate"
	SignalingTypeJoin       SignalingMessageType = "join"
	SignalingTypeLeave      SignalingMessageType = "leave"
	SignalingTypeParticipantJoined SignalingMessageType = "participant-joined"
	SignalingTypeParticipantLeft  SignalingMessageType = "participant-left"

	// New chat message types
	SignalingTypeChatMessage        SignalingMessageType = "chat-message"
	SignalingTypeChatMessageEdit    SignalingMessageType = "chat-message-edit"
	SignalingTypeChatMessageDelete  SignalingMessageType = "chat-message-delete"
	SignalingTypeChatReaction       SignalingMessageType = "chat-reaction"
	SignalingTypeChatReadStatus     SignalingMessageType = "chat-read-status"
	SignalingTypeChatTyping         SignalingMessageType = "chat-typing"
	SignalingTypeChatTypingStop     SignalingMessageType = "chat-typing-stop"
)

// WebRTC signaling message structure
type SignalingMessage struct {
	Type      SignalingMessageType `json:"type"`
	MeetingID string               `json:"meetingId"`
	From      string               `json:"from"`      // Participant ID
	To        string               `json:"to"`        // Target participant ID (empty for broadcast)
	Data      interface{}          `json:"data"`      // Message payload
	Timestamp time.Time            `json:"timestamp"`
}

// WebRTC offer/answer payload
type OfferAnswerPayload struct {
	SDP string `json:"sdp"`
}

// WebRTC ICE candidate payload
type ICECandidatePayload struct {
	Candidate     string `json:"candidate"`
	SDPMLineIndex int    `json:"sdpMLineIndex"`
	SDPMid        string `json:"sdpMid"`
}

// Participant join payload
type JoinPayload struct {
	ParticipantID   string `json:"participantId"`
	Name            string `json:"name"`
	AvatarURL       string `json:"avatarUrl,omitempty"`
	IsAuthenticated bool   `json:"isAuthenticated"`
}

// Participant leave payload
type LeavePayload struct {
	ParticipantID string `json:"participantId"`
}

// Chat message payload
type ChatMessagePayload struct {
	MessageID      string                 `json:"messageId"`
	MeetingID      string                 `json:"meetingId"`
	UserID         *uuid.UUID             `json:"userId,omitempty"`
	PublicUserID   *uuid.UUID             `json:"publicUserId,omitempty"`
	MessageType    MessageType            `json:"messageType"`
	Content        string                 `json:"content"`
	ReplyToID      *uuid.UUID             `json:"replyToId,omitempty"`
	AttachmentURL  string                 `json:"attachmentUrl,omitempty"`
	AttachmentType string                 `json:"attachmentType,omitempty"`
	AttachmentName string                 `json:"attachmentName,omitempty"`
	IsEdited       bool                   `json:"isEdited"`
	EditedAt       *time.Time             `json:"editedAt,omitempty"`
	IsDeleted      bool                   `json:"isDeleted"`
	DeletedAt      *time.Time             `json:"deletedAt,omitempty"`
	MessageStatus  MessageStatus          `json:"messageStatus"`
	CreatedAt      time.Time              `json:"createdAt"`
	User           *UserResponse          `json:"user,omitempty"`
	PublicUser     *PublicUserResponse    `json:"publicUser,omitempty"`
}

// Chat reaction payload
type ChatReactionPayload struct {
	MessageID    uuid.UUID              `json:"messageId"`
	UserID       *uuid.UUID             `json:"userId,omitempty"`
	PublicUserID *uuid.UUID             `json:"publicUserId,omitempty"`
	Reaction     string                 `json:"reaction"`
	Action       string                 `json:"action"` // "add" or "remove"
	CreatedAt    time.Time              `json:"createdAt"`
	User         *UserResponse          `json:"user,omitempty"`
	PublicUser   *PublicUserResponse    `json:"publicUser,omitempty"`
}

// Chat read status payload
type ChatReadStatusPayload struct {
	MessageID    uuid.UUID              `json:"messageId"`
	UserID       *uuid.UUID             `json:"userId,omitempty"`
	PublicUserID *uuid.UUID             `json:"publicUserId,omitempty"`
	ReadAt       time.Time              `json:"readAt"`
}

// Chat typing payload
type ChatTypingPayload struct {
	UserID       *uuid.UUID             `json:"userId,omitempty"`
	PublicUserID *uuid.UUID             `json:"publicUserId,omitempty"`
	UserName     string                 `json:"userName"`
	IsTyping     bool                   `json:"isTyping"`
}

// WebSocket client representation
type WebSocketClient struct {
	ID           string
	MeetingID    string
	UserID       *uuid.UUID
	PublicUserID *uuid.UUID
	Name         string
	IsAuth       bool
	Conn         *websocket.Conn
	Send         chan SignalingMessage
	Hub          *WebSocketHub
}

// WebSocket hub manages clients and message broadcasting
type WebSocketHub struct {
	Clients    map[string]*WebSocketClient // clientID -> client
	Meetings   map[string]map[string]*WebSocketClient // meetingID -> clientID -> client
	Register   chan *WebSocketClient
	Unregister chan *WebSocketClient
	Broadcast  chan SignalingMessage
}

// NewWebSocketHub creates a new WebSocket hub
func NewWebSocketHub() *WebSocketHub {
	return &WebSocketHub{
		Clients:    make(map[string]*WebSocketClient),
		Meetings:   make(map[string]map[string]*WebSocketClient),
		Register:   make(chan *WebSocketClient),
		Unregister: make(chan *WebSocketClient),
		Broadcast:  make(chan SignalingMessage),
	}
}

// Run starts the WebSocket hub
func (h *WebSocketHub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.registerClient(client)
			
		case client := <-h.Unregister:
			h.unregisterClient(client)
			
		case message := <-h.Broadcast:
			h.broadcastMessage(message)
		}
	}
}

// registerClient adds a new client to the hub
func (h *WebSocketHub) registerClient(client *WebSocketClient) {
	log.Printf("[DEBUG] Registering client: %s (name: %s, auth: %t) to meeting: %s", client.ID, client.Name, client.IsAuth, client.MeetingID)
	
	// VALIDASI DUPLICATE CLIENT
	if existingClient, exists := h.Clients[client.ID]; exists {
		log.Printf("[DEBUG] Duplicate client registration detected: %s", client.ID)
		log.Printf("[DEBUG] Force cleanup existing client: %s (meeting: %s)", existingClient.ID, existingClient.MeetingID)
		h.unregisterClient(existingClient) // Force cleanup existing client
	}
	
	h.Clients[client.ID] = client
	
	// Add client to meeting
	if h.Meetings[client.MeetingID] == nil {
		h.Meetings[client.MeetingID] = make(map[string]*WebSocketClient)
		log.Printf("[DEBUG] Created new meeting room for: %s", client.MeetingID)
	}
	h.Meetings[client.MeetingID][client.ID] = client
	log.Printf("[DEBUG] Added client to meeting. Total clients in meeting %s: %d", client.MeetingID, len(h.Meetings[client.MeetingID]))
	
	// FIXED: Ensure we never send "Anonymous User" - validate name before broadcasting
	displayName := client.Name
	if displayName == "" || displayName == "Anonymous User" {
		// Generate fallback name based on client ID
		if strings.HasPrefix(client.ID, "user_") {
			displayName = fmt.Sprintf("User %s", client.ID[5:8])
		} else if strings.HasPrefix(client.ID, "public_") {
			displayName = fmt.Sprintf("Guest %s", client.ID[7:11])
		} else {
			displayName = fmt.Sprintf("Participant %s", client.ID[len(client.ID)-4:])
		}
		log.Printf("[DEBUG] Fixed empty/Anonymous name for client %s: %s -> %s", client.ID, client.Name, displayName)
	}
	
	// Notify other participants about new join
	joinMessage := SignalingMessage{
		Type:      SignalingTypeParticipantJoined,
		MeetingID: client.MeetingID,
		From:      client.ID,
		Data: JoinPayload{
			ParticipantID:   client.ID,
			Name:            displayName, // Use validated display name
			AvatarURL:       "", // Will be populated from user data
			IsAuthenticated: client.IsAuth,
		},
		Timestamp: time.Now(),
	}
	
	log.Printf("[DEBUG] Broadcasting participant-joined message for: %s (name: %s) to meeting: %s", client.ID, displayName, client.MeetingID)
	h.broadcastToMeeting(client.MeetingID, joinMessage, client.ID)
}

// unregisterClient removes a client from the hub
func (h *WebSocketHub) unregisterClient(client *WebSocketClient) {
	log.Printf("[DEBUG] Unregistering client: %s (name: %s) from meeting: %s", client.ID, client.Name, client.MeetingID)
	if _, ok := h.Clients[client.ID]; ok {
		delete(h.Clients, client.ID)
		
		// Remove from meeting
		if meetingClients, ok := h.Meetings[client.MeetingID]; ok {
			delete(meetingClients, client.ID)
			log.Printf("[DEBUG] Removed client from meeting. Remaining clients in meeting %s: %d", client.MeetingID, len(meetingClients))
			
			// Clean up empty meeting
			if len(meetingClients) == 0 {
				delete(h.Meetings, client.MeetingID)
				log.Printf("[DEBUG] Cleaned up empty meeting: %s", client.MeetingID)
			}
		}
		
		// Close connection
		close(client.Send)
		
		// Notify other participants about leave
		leaveMessage := SignalingMessage{
			Type:      SignalingTypeParticipantLeft,
			MeetingID: client.MeetingID,
			From:      client.ID,
			Data: LeavePayload{
				ParticipantID: client.ID,
			},
			Timestamp: time.Now(),
		}
		
		log.Printf("[DEBUG] Broadcasting participant-left message for: %s to meeting: %s", client.ID, client.MeetingID)
		h.broadcastToMeeting(client.MeetingID, leaveMessage, client.ID)
	}
}

// broadcastMessage handles message broadcasting
func (h *WebSocketHub) broadcastMessage(message SignalingMessage) {
	if message.To == "" {
		// Broadcast to all participants in the meeting
		h.broadcastToMeeting(message.MeetingID, message, "")
	} else {
		// Send to specific participant
		h.sendToClient(message.To, message)
	}
}

// broadcastToMeeting sends message to all clients in a meeting except the sender
func (h *WebSocketHub) broadcastToMeeting(meetingID string, message SignalingMessage, excludeClientID string) {
	if meetingClients, ok := h.Meetings[meetingID]; ok {
		log.Printf("[DEBUG] Broadcasting message type: %s to %d clients in meeting: %s (excluding: %s)",
			message.Type, len(meetingClients), meetingID, excludeClientID)
		for clientID := range meetingClients {
			if clientID != excludeClientID {
				h.sendToClient(clientID, message)
			}
		}
	} else {
		log.Printf("[DEBUG] No meeting clients found for meeting: %s when broadcasting message type: %s", meetingID, message.Type)
	}
}

// sendToClient sends message to a specific client
func (h *WebSocketHub) sendToClient(clientID string, message SignalingMessage) {
	if client, ok := h.Clients[clientID]; ok {
		select {
		case client.Send <- message:
		default:
			// Client send channel is blocked, close connection
			close(client.Send)
			delete(h.Clients, clientID)
			
			// Remove from meeting
			if meetingClients, ok := h.Meetings[client.MeetingID]; ok {
				delete(meetingClients, clientID)
				if len(meetingClients) == 0 {
					delete(h.Meetings, client.MeetingID)
				}
			}
		}
	}
}

// GetMeetingParticipants returns all active participants in a meeting
func (h *WebSocketHub) GetMeetingParticipants(meetingID string) []*WebSocketClient {
	var participants []*WebSocketClient
	if meetingClients, ok := h.Meetings[meetingID]; ok {
		for _, client := range meetingClients {
			participants = append(participants, client)
		}
	}
	return participants
}

// GetClientByID returns a client by ID
func (h *WebSocketHub) GetClientByID(clientID string) (*WebSocketClient, bool) {
	client, ok := h.Clients[clientID]
	return client, ok
}

// IsMeetingActive checks if a meeting has active participants
func (h *WebSocketHub) IsMeetingActive(meetingID string) bool {
	if meetingClients, ok := h.Meetings[meetingID]; ok {
		return len(meetingClients) > 0
	}
	return false
}

// GetParticipantCount returns the number of active participants in a meeting
func (h *WebSocketHub) GetParticipantCount(meetingID string) int {
	if meetingClients, ok := h.Meetings[meetingID]; ok {
		return len(meetingClients)
	}
	return 0
}

// WebRTC peer connection state
type PeerConnectionState string

const (
	PeerStateNew        PeerConnectionState = "new"
	PeerStateConnecting PeerConnectionState = "connecting"
	PeerStateConnected  PeerConnectionState = "connected"
	PeerStateDisconnected PeerConnectionState = "disconnected"
	PeerStateFailed     PeerConnectionState = "failed"
	PeerStateClosed     PeerConnectionState = "closed"
)

// WebRTC peer information
type WebRTCPeer struct {
	ID           string               `json:"id"`
	MeetingID    string               `json:"meetingId"`
	UserID       *uuid.UUID           `json:"userId,omitempty"`
	PublicUserID *uuid.UUID           `json:"publicUserId,omitempty"`
	Name         string               `json:"name"`
	IsAuth       bool                 `json:"isAuth"`
	State        PeerConnectionState  `json:"state"`
	JoinedAt     time.Time            `json:"joinedAt"`
	LastSeen     time.Time            `json:"lastSeen"`
}

// WebRTC signaling request/response types
type WebRTCOfferRequest struct {
	To    string             `json:"to" validate:"required"`
	Offer OfferAnswerPayload `json:"offer" validate:"required"`
}

type WebRTCAnswerRequest struct {
	To     string             `json:"to" validate:"required"`
	Answer OfferAnswerPayload `json:"answer" validate:"required"`
}

type WebRTCIceCandidateRequest struct {
	To        string              `json:"to" validate:"required"`
	Candidate ICECandidatePayload `json:"candidate" validate:"required"`
}

type WebRTCPeerResponse struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	IsAuthenticated bool             `json:"isAuthenticated"`
	UserID         *uuid.UUID        `json:"userId,omitempty"`
	PublicUserID   *uuid.UUID        `json:"publicUserId,omitempty"`
	State          PeerConnectionState `json:"state"`
	JoinedAt       time.Time         `json:"joinedAt"`
	LastSeen       time.Time         `json:"lastSeen"`
}

type WebRTCPeersResponse struct {
	MeetingID string              `json:"meetingId"`
	Peers     []WebRTCPeerResponse `json:"peers"`
	Count     int                 `json:"count"`
}

type WebRTCSignalingRequest struct {
	Type      SignalingMessageType `json:"type" validate:"required,oneof=offer answer ice-candidate"`
	To        string               `json:"to" validate:"required"`
	Data      interface{}          `json:"data" validate:"required"`
}

// WebRTC room management
type WebRTCRoom struct {
	ID           string                    `json:"id"`
	MeetingID    string                    `json:"meetingId"`
	Peers        map[string]*WebRTCPeer    `json:"peers"`
	CreatedAt    time.Time                 `json:"createdAt"`
	LastActivity time.Time                `json:"lastActivity"`
}

// NewWebRTCRoom creates a new WebRTC room
func NewWebRTCRoom(meetingID string) *WebRTCRoom {
	now := time.Now()
	return &WebRTCRoom{
		ID:           uuid.New().String(),
		MeetingID:    meetingID,
		Peers:        make(map[string]*WebRTCPeer),
		CreatedAt:    now,
		LastActivity: now,
	}
}

// AddPeer adds a peer to the room
func (r *WebRTCRoom) AddPeer(peer *WebRTCPeer) {
	r.Peers[peer.ID] = peer
	r.LastActivity = time.Now()
}

// RemovePeer removes a peer from the room
func (r *WebRTCRoom) RemovePeer(peerID string) {
	delete(r.Peers, peerID)
	r.LastActivity = time.Now()
}

// GetPeer returns a peer by ID
func (r *WebRTCRoom) GetPeer(peerID string) (*WebRTCPeer, bool) {
	peer, exists := r.Peers[peerID]
	return peer, exists
}

// GetAllPeers returns all peers in the room
func (r *WebRTCRoom) GetAllPeers() []*WebRTCPeer {
	var peers []*WebRTCPeer
	for _, peer := range r.Peers {
		peers = append(peers, peer)
	}
	return peers
}

// GetPeerCount returns the number of peers in the room
func (r *WebRTCRoom) GetPeerCount() int {
	return len(r.Peers)
}

// UpdatePeerState updates a peer's connection state
func (r *WebRTCRoom) UpdatePeerState(peerID string, state PeerConnectionState) {
	if peer, exists := r.Peers[peerID]; exists {
		peer.State = state
		peer.LastSeen = time.Now()
		r.LastActivity = time.Now()
	}
}

// IsEmpty checks if the room has no peers
func (r *WebRTCRoom) IsEmpty() bool {
	return len(r.Peers) == 0
}