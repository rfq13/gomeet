package services

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/your-org/gomeet/packages/backend/internal/models"
)

type WebRTCService struct {
	db              *gorm.DB
	wsService       *WebSocketService
	rooms           map[string]*models.WebRTCRoom
	roomsMutex      sync.RWMutex
	cleanupTicker   *time.Ticker
	cleanupStopChan chan bool
}

func NewWebRTCService(db *gorm.DB, wsService *WebSocketService) *WebRTCService {
	service := &WebRTCService{
		db:              db,
		wsService:       wsService,
		rooms:           make(map[string]*models.WebRTCRoom),
		cleanupTicker:   time.NewTicker(5 * time.Minute), // Cleanup every 5 minutes
		cleanupStopChan: make(chan bool),
	}

	// Start cleanup routine
	go service.startCleanupRoutine()

	return service
}

// startCleanupRoutine periodically cleans up inactive rooms and peers
func (s *WebRTCService) startCleanupRoutine() {
	for {
		select {
		case <-s.cleanupTicker.C:
			s.cleanupInactiveRooms()
		case <-s.cleanupStopChan:
			s.cleanupTicker.Stop()
			return
		}
	}
}

// cleanupInactiveRooms removes inactive rooms and peers
func (s *WebRTCService) cleanupInactiveRooms() {
	s.roomsMutex.Lock()
	defer s.roomsMutex.Unlock()

	now := time.Now()
	inactiveThreshold := 10 * time.Minute // Remove rooms inactive for 10 minutes

	for meetingID, room := range s.rooms {
		// Remove inactive peers
		for peerID, peer := range room.Peers {
			if now.Sub(peer.LastSeen) > inactiveThreshold {
				log.Printf("Removing inactive peer %s from room %s", peerID, meetingID)
				delete(room.Peers, peerID)
				
				// Notify other peers about the disconnection
				s.notifyPeerLeft(meetingID, peerID)
			}
		}

		// Remove empty rooms
		if room.IsEmpty() || now.Sub(room.LastActivity) > inactiveThreshold {
			log.Printf("Removing inactive room %s", meetingID)
			delete(s.rooms, meetingID)
		}
	}
}

// Stop stops the WebRTC service and cleanup routines
func (s *WebRTCService) Stop() {
	s.cleanupStopChan <- true
}

// JoinMeeting adds a peer to a WebRTC room
func (s *WebRTCService) JoinMeeting(meetingID string, peerID string, userID *uuid.UUID, publicUserID *uuid.UUID, name string, isAuth bool) (*models.WebRTCPeer, error) {
	// Validate meeting exists
	var meeting models.Meeting
	if err := s.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		return nil, fmt.Errorf("meeting not found: %w", err)
	}

	s.roomsMutex.Lock()
	defer s.roomsMutex.Unlock()

	// Get or create room
	room, exists := s.rooms[meetingID]
	if !exists {
		room = models.NewWebRTCRoom(meetingID)
		s.rooms[meetingID] = room
	}

	// Check if peer already exists
	if peer, exists := room.GetPeer(peerID); exists {
		return peer, nil
	}

	// Create new peer
	peer := &models.WebRTCPeer{
		ID:           peerID,
		MeetingID:    meetingID,
		UserID:       userID,
		PublicUserID: publicUserID,
		Name:         name,
		IsAuth:       isAuth,
		State:        models.PeerStateNew,
		JoinedAt:     time.Now(),
		LastSeen:     time.Now(),
	}

	// Add peer to room
	room.AddPeer(peer)

	// Notify other peers about the new participant
	s.notifyPeerJoined(meetingID, peer)

	log.Printf("Peer %s (%s) joined meeting %s", peerID, name, meetingID)

	return peer, nil
}

// LeaveMeeting removes a peer from a WebRTC room
func (s *WebRTCService) LeaveMeeting(meetingID string, peerID string) error {
	s.roomsMutex.Lock()
	defer s.roomsMutex.Unlock()

	room, exists := s.rooms[meetingID]
	if !exists {
		return fmt.Errorf("room not found for meeting %s", meetingID)
	}

	_, exists = room.GetPeer(peerID)
	if !exists {
		return fmt.Errorf("peer %s not found in room %s", peerID, meetingID)
	}

	// Remove peer from room
	room.RemovePeer(peerID)

	// Remove room if empty
	if room.IsEmpty() {
		delete(s.rooms, meetingID)
	}

	// Notify other peers about the disconnection
	s.notifyPeerLeft(meetingID, peerID)

	log.Printf("Peer %s left meeting %s", peerID, meetingID)

	return nil
}

// GetMeetingPeers returns all peers in a meeting
func (s *WebRTCService) GetMeetingPeers(meetingID string) []*models.WebRTCPeer {
	s.roomsMutex.RLock()
	defer s.roomsMutex.RUnlock()

	room, exists := s.rooms[meetingID]
	if !exists {
		return []*models.WebRTCPeer{}
	}

	return room.GetAllPeers()
}

// GetPeer returns a specific peer in a meeting
func (s *WebRTCService) GetPeer(meetingID string, peerID string) (*models.WebRTCPeer, error) {
	s.roomsMutex.RLock()
	defer s.roomsMutex.RUnlock()

	room, exists := s.rooms[meetingID]
	if !exists {
		return nil, fmt.Errorf("room not found for meeting %s", meetingID)
	}

	peer, exists := room.GetPeer(peerID)
	if !exists {
		return nil, fmt.Errorf("peer %s not found in room %s", peerID, meetingID)
	}

	return peer, nil
}

// UpdatePeerState updates a peer's connection state
func (s *WebRTCService) UpdatePeerState(meetingID string, peerID string, state models.PeerConnectionState) error {
	s.roomsMutex.Lock()
	defer s.roomsMutex.Unlock()

	room, exists := s.rooms[meetingID]
	if !exists {
		return fmt.Errorf("room not found for meeting %s", meetingID)
	}

	room.UpdatePeerState(peerID, state)
	log.Printf("Peer %s state updated to %s in meeting %s", peerID, state, meetingID)

	return nil
}

// SendOffer sends a WebRTC offer to a specific peer
func (s *WebRTCService) SendOffer(meetingID string, fromPeerID string, toPeerID string, offer models.OfferAnswerPayload) error {
	// Validate both peers exist
	_, err := s.GetPeer(meetingID, fromPeerID)
	if err != nil {
		return fmt.Errorf("sender peer not found: %w", err)
	}

	_, err = s.GetPeer(meetingID, toPeerID)
	if err != nil {
		return fmt.Errorf("target peer not found: %w", err)
	}

	// Create offer message
	message := models.SignalingMessage{
		Type:      models.SignalingTypeOffer,
		MeetingID: meetingID,
		From:      fromPeerID,
		To:        toPeerID,
		Data:      offer,
		Timestamp: time.Now(),
	}

	// Send via WebSocket
	if err := s.wsService.SendMessageToClient(toPeerID, message); err != nil {
		return fmt.Errorf("failed to send offer: %w", err)
	}

	log.Printf("Offer sent from peer %s to peer %s in meeting %s", fromPeerID, toPeerID, meetingID)
	return nil
}

// SendAnswer sends a WebRTC answer to a specific peer
func (s *WebRTCService) SendAnswer(meetingID string, fromPeerID string, toPeerID string, answer models.OfferAnswerPayload) error {
	// Validate both peers exist
	_, err := s.GetPeer(meetingID, fromPeerID)
	if err != nil {
		return fmt.Errorf("sender peer not found: %w", err)
	}

	_, err = s.GetPeer(meetingID, toPeerID)
	if err != nil {
		return fmt.Errorf("target peer not found: %w", err)
	}

	// Create answer message
	message := models.SignalingMessage{
		Type:      models.SignalingTypeAnswer,
		MeetingID: meetingID,
		From:      fromPeerID,
		To:        toPeerID,
		Data:      answer,
		Timestamp: time.Now(),
	}

	// Send via WebSocket
	if err := s.wsService.SendMessageToClient(toPeerID, message); err != nil {
		return fmt.Errorf("failed to send answer: %w", err)
	}

	log.Printf("Answer sent from peer %s to peer %s in meeting %s", fromPeerID, toPeerID, meetingID)
	return nil
}

// SendIceCandidate sends an ICE candidate to a specific peer
func (s *WebRTCService) SendIceCandidate(meetingID string, fromPeerID string, toPeerID string, candidate models.ICECandidatePayload) error {
	// Validate both peers exist
	_, err := s.GetPeer(meetingID, fromPeerID)
	if err != nil {
		return fmt.Errorf("sender peer not found: %w", err)
	}

	_, err = s.GetPeer(meetingID, toPeerID)
	if err != nil {
		return fmt.Errorf("target peer not found: %w", err)
	}

	// Create ICE candidate message
	message := models.SignalingMessage{
		Type:      models.SignalingTypeIceCandidate,
		MeetingID: meetingID,
		From:      fromPeerID,
		To:        toPeerID,
		Data:      candidate,
		Timestamp: time.Now(),
	}

	// Send via WebSocket
	if err := s.wsService.SendMessageToClient(toPeerID, message); err != nil {
		return fmt.Errorf("failed to send ICE candidate: %w", err)
	}

	log.Printf("ICE candidate sent from peer %s to peer %s in meeting %s", fromPeerID, toPeerID, meetingID)
	return nil
}

// notifyPeerJoined notifies other peers about a new participant
func (s *WebRTCService) notifyPeerJoined(meetingID string, newPeer *models.WebRTCPeer) {
	peers := s.GetMeetingPeers(meetingID)
	
	for _, peer := range peers {
		if peer.ID != newPeer.ID {
			message := models.SignalingMessage{
				Type:      models.SignalingTypeParticipantJoined,
				MeetingID: meetingID,
				From:      newPeer.ID,
				Data: models.JoinPayload{
					ParticipantID:   newPeer.ID,
					Name:            newPeer.Name,
					AvatarURL:       "", // Will be populated from user data if needed
					IsAuthenticated: newPeer.IsAuth,
				},
				Timestamp: time.Now(),
			}

			if err := s.wsService.SendMessageToClient(peer.ID, message); err != nil {
				log.Printf("Failed to notify peer %s about new participant: %v", peer.ID, err)
			}
		}
	}
}

// notifyPeerLeft notifies other peers about a participant leaving
func (s *WebRTCService) notifyPeerLeft(meetingID string, leftPeerID string) {
	peers := s.GetMeetingPeers(meetingID)
	
	for _, peer := range peers {
		if peer.ID != leftPeerID {
			message := models.SignalingMessage{
				Type:      models.SignalingTypeParticipantLeft,
				MeetingID: meetingID,
				From:      leftPeerID,
				Data: models.LeavePayload{
					ParticipantID: leftPeerID,
				},
				Timestamp: time.Now(),
			}

			if err := s.wsService.SendMessageToClient(peer.ID, message); err != nil {
				log.Printf("Failed to notify peer %s about participant leaving: %v", peer.ID, err)
			}
		}
	}
}

// GetRoomStats returns statistics about a WebRTC room
func (s *WebRTCService) GetRoomStats(meetingID string) map[string]interface{} {
	s.roomsMutex.RLock()
	defer s.roomsMutex.RUnlock()

	room, exists := s.rooms[meetingID]
	if !exists {
		return map[string]interface{}{
			"exists": false,
		}
	}

	peers := room.GetAllPeers()
	stateCount := make(map[models.PeerConnectionState]int)
	
	for _, peer := range peers {
		stateCount[peer.State]++
	}

	return map[string]interface{}{
		"exists":         true,
		"peerCount":      len(peers),
		"createdAt":      room.CreatedAt,
		"lastActivity":   room.LastActivity,
		"stateCount":     stateCount,
	}
}

// GetAllRooms returns all active WebRTC rooms (for admin/monitoring)
func (s *WebRTCService) GetAllRooms() map[string]*models.WebRTCRoom {
	s.roomsMutex.RLock()
	defer s.roomsMutex.RUnlock()

	// Return a copy to avoid concurrent modification
	roomsCopy := make(map[string]*models.WebRTCRoom)
	for k, v := range s.rooms {
		roomsCopy[k] = v
	}

	return roomsCopy
}