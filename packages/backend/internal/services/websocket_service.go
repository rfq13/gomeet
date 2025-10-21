package services

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"gorm.io/gorm"

	"github.com/your-org/gomeet/packages/backend/internal/models"
)

type WebSocketService struct {
	db           *gorm.DB
	hub          *models.WebSocketHub
	upgrader     websocket.Upgrader
	jwtService   *JWTService
	webrtcService *WebRTCService
}

func NewWebSocketService(db *gorm.DB, jwtService *JWTService, webrtcService *WebRTCService) *WebSocketService {
	return &WebSocketService{
		db:           db,
		hub:          models.NewWebSocketHub(),
		jwtService:   jwtService,
		webrtcService: webrtcService,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				// Allow connections from any origin in development
				// In production, you should check against allowed origins
				return true
			},
		},
	}
}

// StartHub starts the WebSocket hub in a goroutine
func (s *WebSocketService) StartHub() {
	go s.hub.Run()
}

// HandleWebSocket handles WebSocket connections for meeting rooms
func (s *WebSocketService) HandleWebSocket(ctx *gin.Context) {
	// Get meeting ID from URL parameter
	meetingID := ctx.Param("id")
	if meetingID == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "Meeting ID is required"})
		return
	}

	log.Printf("WebSocket connection attempt for meeting ID: %s", meetingID)

	// Validate meeting exists
	var meeting models.Meeting
	if err := s.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		log.Printf("Meeting not found for ID %s: %v", meetingID, err)
		ctx.JSON(http.StatusNotFound, gin.H{"error": "Meeting not found"})
		return
	}

	log.Printf("Meeting found: %s", meeting.Name)

	// Upgrade HTTP connection to WebSocket
	conn, err := s.upgrader.Upgrade(ctx.Writer, ctx.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	// Get client information from query parameters or JWT token
	clientID := ctx.Query("clientId")
	sessionID := ctx.Query("sessionId")

	// Determine if user is authenticated or public user
	var userID *uuid.UUID
	var publicUserID *uuid.UUID
	var userName string
	var isAuth bool

	// Try to get user from JWT token first
	authHeader := ctx.GetHeader("Authorization")
	if authHeader != "" && len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		token := authHeader[7:]
		claims, err := s.jwtService.ValidateAccessToken(token)
		if err == nil {
			userID = &claims.UserID
			isAuth = true
			
			// Get user details
			var user models.User
			if err := s.db.Where("id = ?", claims.UserID).First(&user).Error; err == nil {
				userName = user.Username
			}
		}
	}

	// If not authenticated, try to get public user from session ID
	if !isAuth && sessionID != "" {
		var publicUser models.PublicUser
		if err := s.db.Where("session_id = ?", sessionID).First(&publicUser).Error; err == nil {
			publicUserID = &publicUser.ID
			userName = publicUser.Name
		}
	}

	// If still no user info, try alternative identification methods
	if userName == "" {
		log.Printf("[DEBUG] No user name found, trying alternative identification methods")
		
		// Try to generate meaningful fallback name based on available identifiers
		if clientID != "" {
			// Use client ID to generate a more meaningful name
			if strings.HasPrefix(clientID, "user_") {
				userName = fmt.Sprintf("User %s", clientID[5:8]) // Use last 8 chars of user ID
			} else if strings.HasPrefix(clientID, "public_") {
				userName = fmt.Sprintf("Guest %s", clientID[7:11]) // Use last 4 chars of public user ID
			} else if strings.HasPrefix(clientID, "session_") {
				userName = fmt.Sprintf("Participant %s", clientID[len(clientID)-4:]) // Use last 4 chars
			} else {
				userName = fmt.Sprintf("User %s", clientID[len(clientID)-4:]) // Use last 4 chars of client ID
			}
			log.Printf("[DEBUG] Generated fallback name from client ID: %s -> %s", clientID, userName)
		} else if sessionID != "" {
			// Use session ID to generate a name
			userName = fmt.Sprintf("Guest %s", sessionID[len(sessionID)-4:]) // Use last 4 chars of session ID
			log.Printf("[DEBUG] Generated fallback name from session ID: %s -> %s", sessionID, userName)
		} else {
			// Last resort: generate a random but meaningful name
			randomSuffix := uuid.New().String()[:8]
			userName = fmt.Sprintf("User %s", randomSuffix)
			log.Printf("[WARNING] Generated random fallback name: %s - no identifiers available", userName)
		}
	}
	
	// CRITICAL FIX: Use deterministic client ID instead of random UUID
	// This prevents WebSocket client explosion by ensuring same user gets same ID
	if clientID == "" {
		if userID != nil {
			clientID = fmt.Sprintf("user_%s", userID.String())
		} else if publicUserID != nil {
			clientID = fmt.Sprintf("public_%s", publicUserID.String())
		} else if sessionID != "" {
			clientID = fmt.Sprintf("session_%s_%s", meetingID, sessionID)
		} else {
			// Last resort: generate but log for debugging
			clientID = uuid.New().String()
			log.Printf("[WARNING] Generated random client ID %s - no user identity found", clientID)
		}
	}
	
	log.Printf("[DEBUG] Generated deterministic client ID: %s for user: %s (auth: %t)", clientID, userName, isAuth)

	// Create WebSocket client
	client := &models.WebSocketClient{
		ID:           clientID,
		MeetingID:    meetingID,
		UserID:       userID,
		PublicUserID: publicUserID,
		Name:         userName,
		IsAuth:       isAuth,
		Conn:         conn,
		Send:         make(chan models.SignalingMessage, 256),
		Hub:          s.hub,
	}

	// Register client with hub
	s.hub.Register <- client

	// Start goroutines for reading and writing
	go s.writePump(client)
	go s.readPump(client)
}

// readPump handles messages from the WebSocket connection
func (s *WebSocketService) readPump(client *models.WebSocketClient) {
	defer func() {
		client.Hub.Unregister <- client
		client.Conn.Close()
	}()

	// Set read deadline and pong handler
	client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	client.Conn.SetPongHandler(func(string) error {
		client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		// Read message
		var rawMessage json.RawMessage
		err := client.Conn.ReadJSON(&rawMessage)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		// Parse signaling message
		var message models.SignalingMessage
		if err := json.Unmarshal(rawMessage, &message); err != nil {
			log.Printf("Invalid message format: %v", err)
			continue
		}

		// Set message metadata
		message.MeetingID = client.MeetingID
		message.From = client.ID
		message.Timestamp = time.Now()

		// Handle different message types
		log.Printf("[DEBUG] Processing message type: %s from client: %s", message.Type, client.ID)
		switch message.Type {
		case models.SignalingTypeOffer, models.SignalingTypeAnswer, models.SignalingTypeIceCandidate:
			// Forward WebRTC signaling messages
			log.Printf("[DEBUG] Forwarding WebRTC signaling message: %s", message.Type)
			s.hub.Broadcast <- message
			
		case models.SignalingTypeJoin:
			// Handle join meeting (already handled in registration)
			log.Printf("[DEBUG] Handling join message from client: %s", client.ID)
			s.handleJoinMessage(client, &message)
			
		case models.SignalingTypeLeave:
			// Handle leave meeting
			log.Printf("[DEBUG] Handling leave message from client: %s", client.ID)
			s.handleLeaveMessage(client, &message)
			
		case models.SignalingTypeChatMessage:
			// Handle chat message
			log.Printf("[DEBUG] Handling chat message from client: %s", client.ID)
			s.handleChatMessage(client, &message)
			
		case models.SignalingTypeChatMessageEdit, models.SignalingTypeChatMessageDelete:
			// Handle chat message updates
			log.Printf("[DEBUG] Handling chat message update: %s from client: %s", message.Type, client.ID)
			s.handleChatMessageUpdate(client, &message)
			
		case models.SignalingTypeChatReaction:
			// Handle chat reaction
			log.Printf("[DEBUG] Handling chat reaction from client: %s", client.ID)
			s.handleChatReaction(client, &message)
			
		case models.SignalingTypeChatReadStatus:
			// Handle chat read status
			log.Printf("[DEBUG] Handling chat read status from client: %s", client.ID)
			s.handleChatReadStatus(client, &message)
			
		case models.SignalingTypeChatTyping, models.SignalingTypeChatTypingStop:
			// Handle chat typing indicators
			log.Printf("[DEBUG] Handling chat typing: %s from client: %s", message.Type, client.ID)
			s.handleChatTyping(client, &message)
			
		default:
			log.Printf("[DEBUG] Unknown message type: %s from client: %s", message.Type, client.ID)
		}
	}
}

// writePump handles writing messages to the WebSocket connection
func (s *WebSocketService) writePump(client *models.WebSocketClient) {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		client.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-client.Send:
			client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				// Hub closed the channel
				client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// Write message
			if err := client.Conn.WriteJSON(message); err != nil {
				log.Printf("WebSocket write error: %v", err)
				return
			}

		case <-ticker.C:
			// Send ping
			client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// handleJoinMessage handles join meeting messages
func (s *WebSocketService) handleJoinMessage(client *models.WebSocketClient, message *models.SignalingMessage) {
	// Send current participants list to the new client
	participants := s.hub.GetMeetingParticipants(client.MeetingID)
	
	for _, participant := range participants {
		if participant.ID != client.ID {
			joinMessage := models.SignalingMessage{
				Type:      models.SignalingTypeParticipantJoined,
				MeetingID: client.MeetingID,
				From:      participant.ID,
				Data: models.JoinPayload{
					ParticipantID:   participant.ID,
					Name:            participant.Name,
					AvatarURL:       "", // Will be populated from user data
					IsAuthenticated: participant.IsAuth,
				},
				Timestamp: time.Now(),
			}
			
			select {
			case client.Send <- joinMessage:
			default:
				close(client.Send)
			}
		}
	}
}

// handleLeaveMessage handles leave meeting messages with atomic transaction
func (s *WebSocketService) handleLeaveMessage(client *models.WebSocketClient, message *models.SignalingMessage) {
	log.Printf("[DEBUG] Handling leave message from client: %s with atomic transaction", client.ID)
	
	// ATOMIC TRANSACTION
	tx := s.db.Begin()
	
	// 1. Update database participant status
	if err := s.updateParticipantStatus(tx, client, false); err != nil {
		tx.Rollback()
		log.Printf("[ERROR] Failed to update participant status: %v", err)
		// Still continue with WebSocket cleanup to prevent orphaned connections
	} else {
		tx.Commit()
		log.Printf("[DEBUG] Successfully updated participant status in database for client: %s", client.ID)
	}
	
	// 2. Unregister from hub (this will also notify other participants)
	s.hub.Unregister <- client
	
	// 3. Remove from WebRTC service
	if s.webrtcService != nil {
		s.webrtcService.LeaveMeeting(client.MeetingID, client.ID)
		log.Printf("[DEBUG] Removed client from WebRTC service: %s", client.ID)
	}
	
	log.Printf("[DEBUG] Completed atomic cleanup for client: %s", client.ID)
}

// updateParticipantStatus updates participant status in database within transaction
func (s *WebSocketService) updateParticipantStatus(tx *gorm.DB, client *models.WebSocketClient, isActive bool) error {
	if client.UserID != nil {
		// Update authenticated user participant
		result := tx.Model(&models.Participant{}).
			Where("meeting_id = ? AND user_id = ?", client.MeetingID, *client.UserID).
			Update("is_active", isActive)
		
		if result.Error != nil {
			return result.Error
		}
		
		if result.RowsAffected > 0 {
			log.Printf("[DEBUG] Updated participant status for user %s in meeting %s to %t",
				*client.UserID, client.MeetingID, isActive)
		}
	} else if client.PublicUserID != nil {
		// Update public user participant
		result := tx.Model(&models.Participant{}).
			Where("meeting_id = ? AND public_user_id = ?", client.MeetingID, *client.PublicUserID).
			Update("is_active", isActive)
		
		if result.Error != nil {
			return result.Error
		}
		
		if result.RowsAffected > 0 {
			log.Printf("[DEBUG] Updated participant status for public user %s in meeting %s to %t",
				*client.PublicUserID, client.MeetingID, isActive)
		}
	}
	
	return nil
}

// GetMeetingParticipants returns active WebSocket participants for a meeting
func (s *WebSocketService) GetMeetingParticipants(meetingID string) []*models.WebSocketClient {
	return s.hub.GetMeetingParticipants(meetingID)
}

// GetParticipantCount returns the number of active participants in a meeting
func (s *WebSocketService) GetParticipantCount(meetingID string) int {
	return s.hub.GetParticipantCount(meetingID)
}

// IsMeetingActive checks if a meeting has active WebSocket participants
func (s *WebSocketService) IsMeetingActive(meetingID string) bool {
	return s.hub.IsMeetingActive(meetingID)
}

// SendMessageToMeeting sends a message to all participants in a meeting
func (s *WebSocketService) SendMessageToMeeting(meetingID string, message models.SignalingMessage) {
	message.MeetingID = meetingID
	message.Timestamp = time.Now()
	s.hub.Broadcast <- message
}

// SendMessageToClient sends a message to a specific client
func (s *WebSocketService) SendMessageToClient(clientID string, message models.SignalingMessage) error {
	message.Timestamp = time.Now()
	
	if client, ok := s.hub.GetClientByID(clientID); ok {
		select {
		case client.Send <- message:
			return nil
		default:
			return fmt.Errorf("client send channel is blocked")
		}
	}
	
	return fmt.Errorf("client not found")
}

// SetWebRTCService sets the WebRTC service reference (used to break circular dependency)
func (s *WebSocketService) SetWebRTCService(webrtcService *WebRTCService) {
	s.webrtcService = webrtcService
	log.Printf("[DEBUG] WebRTC service reference set in WebSocket service")
}

// handleChatMessage handles incoming chat messages
func (s *WebSocketService) handleChatMessage(client *models.WebSocketClient, message *models.SignalingMessage) {
	// Parse chat message payload from frontend format
	var payload map[string]interface{}
	payloadBytes, err := json.Marshal(message.Data)
	if err != nil {
		log.Printf("Failed to marshal chat message payload: %v", err)
		return
	}
	
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		log.Printf("Invalid chat message payload: %v", err)
		return
	}
	
	// Broadcast chat message to all participants in the meeting
	s.hub.Broadcast <- *message
}

// handleChatMessageUpdate handles chat message edits and deletions
func (s *WebSocketService) handleChatMessageUpdate(client *models.WebSocketClient, message *models.SignalingMessage) {
	// Broadcast message update to all participants in the meeting
	s.hub.Broadcast <- *message
}

// handleChatReaction handles chat reactions
func (s *WebSocketService) handleChatReaction(client *models.WebSocketClient, message *models.SignalingMessage) {
	// Broadcast reaction to all participants in the meeting
	s.hub.Broadcast <- *message
}

// handleChatReadStatus handles chat read status updates
func (s *WebSocketService) handleChatReadStatus(client *models.WebSocketClient, message *models.SignalingMessage) {
	// Broadcast read status to all participants in the meeting
	s.hub.Broadcast <- *message
}

// handleChatTyping handles typing indicators
func (s *WebSocketService) handleChatTyping(client *models.WebSocketClient, message *models.SignalingMessage) {
	// Parse typing payload
	var payload map[string]interface{}
	payloadBytes, err := json.Marshal(message.Data)
	if err != nil {
		log.Printf("Failed to marshal typing payload: %v", err)
		return
	}
	
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		log.Printf("Invalid typing payload: %v", err)
		return
	}
	
	// Add client info to payload
	payload["userId"] = client.UserID
	payload["publicUserId"] = client.PublicUserID
	payload["userName"] = client.Name
	
	// Update message data
	message.Data = payload
	
	// Broadcast typing indicator to all participants in the meeting except sender
	s.broadcastToMeeting(client.MeetingID, *message, client.ID)
}

// broadcastToMeeting sends message to all clients in a meeting except the sender
func (s *WebSocketService) broadcastToMeeting(meetingID string, message models.SignalingMessage, excludeClientID string) {
	if meetingClients, ok := s.hub.Meetings[meetingID]; ok {
		for clientID := range meetingClients {
			if clientID != excludeClientID {
				s.sendToClient(clientID, message)
			}
		}
	}
}

// sendToClient sends message to a specific client
func (s *WebSocketService) sendToClient(clientID string, message models.SignalingMessage) {
	if client, ok := s.hub.GetClientByID(clientID); ok {
		select {
		case client.Send <- message:
		default:
			// Client send channel is blocked, close connection
			close(client.Send)
			delete(s.hub.Clients, clientID)
			
			// Remove from meeting
			if meetingClients, ok := s.hub.Meetings[client.MeetingID]; ok {
				delete(meetingClients, clientID)
				if len(meetingClients) == 0 {
					delete(s.hub.Meetings, client.MeetingID)
				}
			}
		}
	}
}