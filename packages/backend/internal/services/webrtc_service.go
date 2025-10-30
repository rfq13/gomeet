package services

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"github.com/filosofine/gomeet-backend/internal/config"
	"github.com/filosofine/gomeet-backend/internal/models"
	"github.com/filosofine/gomeet-backend/internal/redis"
)

type WebRTCService struct {
	db              *gorm.DB
	wsService       *WebSocketService
	redisClient     *redis.RedisClient
	roomStorage     *redis.RoomStorage
	rooms           map[string]*models.WebRTCRoom // Fallback in-memory storage
	roomsMutex      sync.RWMutex
	useRedis        bool
	cleanupTicker   *time.Ticker
	cleanupStopChan chan bool
	config          *config.WebRTCConfig
	logger          *logrus.Logger
}

func NewWebRTCService(db *gorm.DB, wsService *WebSocketService, cfg *config.Config) *WebRTCService {
	redisClient := redis.NewRedisClient(&cfg.Redis)
	roomStorage := redis.NewRoomStorage(redisClient)
	
	logger := logrus.New()
	logger.SetLevel(logrus.InfoLevel)
	
	service := &WebRTCService{
		db:              db,
		wsService:       wsService,
		redisClient:     redisClient,
		roomStorage:     roomStorage,
		rooms:           make(map[string]*models.WebRTCRoom), // Fallback storage
		useRedis:        redisClient.IsConnected(),
		cleanupTicker:   time.NewTicker(5 * time.Minute), // Cleanup every 5 minutes
		cleanupStopChan: make(chan bool),
		config:          &cfg.WebRTC,
		logger:          logger,
	}

	if service.useRedis {
		logger.Info("WebRTC Service: Using Redis for room storage")
	} else {
		logger.Info("WebRTC Service: Using in-memory storage (Redis not available)")
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
	if s.useRedis {
		// Use Redis cleanup
		err := s.roomStorage.CleanupInactiveRooms(10 * time.Minute)
		if err != nil {
			log.Printf("Redis cleanup failed: %v", err)
			// Fallback to in-memory cleanup
			s.cleanupInactiveRoomsMemory()
		}
	} else {
		// Use in-memory cleanup
		s.cleanupInactiveRoomsMemory()
	}
}

// cleanupInactiveRoomsMemory removes inactive rooms and peers from memory
func (s *WebRTCService) cleanupInactiveRoomsMemory() {
	s.roomsMutex.Lock()
	defer s.roomsMutex.Unlock()

	now := time.Now()
	emptyTimeout := 3 * time.Minute // Empty timeout: 3 minutes
	inactiveThreshold := 10 * time.Minute // Remove rooms inactive for 10 minutes

	for meetingID, room := range s.rooms {
		// Remove inactive peers
		for peerID, peer := range room.Peers {
			if now.Sub(peer.LastSeen) > inactiveThreshold {
				log.Printf("[WebRTC] Removing inactive peer %s from room %s", peerID, meetingID)
				delete(room.Peers, peerID)
				
				// Notify other peers about the disconnection
				s.notifyPeerLeft(meetingID, peerID)
			}
		}

		// Remove empty rooms after empty timeout
		if room.IsEmpty() {
			if now.Sub(room.LastActivity) > emptyTimeout {
				log.Printf("[WebRTC] Removing empty room %s after timeout", meetingID)
				delete(s.rooms, meetingID)
			}
		} else if now.Sub(room.LastActivity) > inactiveThreshold {
			log.Printf("[WebRTC] Removing inactive room %s", meetingID)
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

	// Check participant limit using config
	currentPeers := s.GetMeetingPeers(meetingID)
	maxParticipants := 50 // Default limit - could be made configurable
	
	if len(currentPeers) >= maxParticipants {
		s.logger.WithFields(logrus.Fields{
			"meetingId": meetingID,
			"current":   len(currentPeers),
			"max":       maxParticipants,
		}).Warn("Room is full")
		return nil, fmt.Errorf("room has reached maximum capacity of %d participants", maxParticipants)
	}

	s.logger.WithFields(logrus.Fields{
		"meetingId":     meetingID,
		"userName":      name,
		"peerId":        peerID,
		"participants":  len(currentPeers),
		"maxParticipants": maxParticipants,
	}).Info("User joining meeting")

	if s.useRedis {
		return s.joinMeetingRedis(meetingID, peerID, userID, publicUserID, name, isAuth)
	} else {
		return s.joinMeetingMemory(meetingID, peerID, userID, publicUserID, name, isAuth)
	}
}

// joinMeetingRedis handles joining meeting using Redis storage
func (s *WebRTCService) joinMeetingRedis(meetingID string, peerID string, userID *uuid.UUID, publicUserID *uuid.UUID, name string, isAuth bool) (*models.WebRTCPeer, error) {
	// Check if peer already exists
	existingPeer, err := s.roomStorage.GetPeer(meetingID, peerID)
	if err == nil && existingPeer != nil {
		return existingPeer, nil
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

	// Get or create room
	room, err := s.roomStorage.GetRoom(meetingID)
	if err != nil {
		// Room doesn't exist, create new one
		room = models.NewWebRTCRoom(meetingID)
		err = s.roomStorage.SaveRoom(room)
		if err != nil {
			return nil, fmt.Errorf("failed to create room: %w", err)
		}
	}

	// Add peer to room in Redis
	err = s.roomStorage.SavePeer(meetingID, peer)
	if err != nil {
		return nil, fmt.Errorf("failed to save peer: %w", err)
	}

	// Notify other peers about the new participant
	s.notifyPeerJoined(meetingID, peer)

	log.Printf("Peer %s (%s) joined meeting %s (Redis)", peerID, name, meetingID)

	return peer, nil
}

// joinMeetingMemory handles joining meeting using in-memory storage
func (s *WebRTCService) joinMeetingMemory(meetingID string, peerID string, userID *uuid.UUID, publicUserID *uuid.UUID, name string, isAuth bool) (*models.WebRTCPeer, error) {
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

	log.Printf("Peer %s (%s) joined meeting %s (Memory)", peerID, name, meetingID)

	return peer, nil
}

// LeaveMeeting removes a peer from a WebRTC room
func (s *WebRTCService) LeaveMeeting(meetingID string, peerID string) error {
	// Get current participant count for logging
	currentPeers := s.GetMeetingPeers(meetingID)
	log.Printf("[WebRTC] Leaving meeting %s - Peer: %s, Participants before leave: %d",
		meetingID, peerID, len(currentPeers))

	if s.useRedis {
		return s.leaveMeetingRedis(meetingID, peerID)
	} else {
		return s.leaveMeetingMemory(meetingID, peerID)
	}
}

// leaveMeetingRedis handles leaving meeting using Redis storage
func (s *WebRTCService) leaveMeetingRedis(meetingID string, peerID string) error {
	// Check if peer exists
	_, err := s.roomStorage.GetPeer(meetingID, peerID)
	if err != nil {
		return fmt.Errorf("peer %s not found in room %s", peerID, meetingID)
	}

	// Remove peer from Redis
	err = s.roomStorage.RemovePeer(meetingID, peerID)
	if err != nil {
		return fmt.Errorf("failed to remove peer: %w", err)
	}

	// Check if room is empty and delete if necessary
	peers, err := s.roomStorage.GetRoomPeers(meetingID)
	if err == nil && len(peers) == 0 {
		err = s.roomStorage.DeleteRoom(meetingID)
		if err != nil {
			log.Printf("Failed to delete empty room %s: %v", meetingID, err)
		}
	}

	// Notify other peers about the disconnection
	s.notifyPeerLeft(meetingID, peerID)

	log.Printf("Peer %s left meeting %s (Redis)", peerID, meetingID)

	return nil
}

// leaveMeetingMemory handles leaving meeting using in-memory storage
func (s *WebRTCService) leaveMeetingMemory(meetingID string, peerID string) error {
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

	log.Printf("Peer %s left meeting %s (Memory)", peerID, meetingID)

	return nil
}

// GetMeetingPeers returns all peers in a meeting
func (s *WebRTCService) GetMeetingPeers(meetingID string) []*models.WebRTCPeer {
	if s.useRedis {
		return s.getMeetingPeersRedis(meetingID)
	} else {
		return s.getMeetingPeersMemory(meetingID)
	}
}

// getMeetingPeersRedis returns all peers in a meeting using Redis
func (s *WebRTCService) getMeetingPeersRedis(meetingID string) []*models.WebRTCPeer {
	peers, err := s.roomStorage.GetRoomPeers(meetingID)
	if err != nil {
		log.Printf("Failed to get peers from Redis for meeting %s: %v", meetingID, err)
		return []*models.WebRTCPeer{}
	}

	var peerList []*models.WebRTCPeer
	for _, peer := range peers {
		peerList = append(peerList, peer)
	}

	return peerList
}

// getMeetingPeersMemory returns all peers in a meeting using memory
func (s *WebRTCService) getMeetingPeersMemory(meetingID string) []*models.WebRTCPeer {
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
	if s.useRedis {
		return s.getPeerRedis(meetingID, peerID)
	} else {
		return s.getPeerMemory(meetingID, peerID)
	}
}

// getPeerRedis returns a specific peer in a meeting using Redis
func (s *WebRTCService) getPeerRedis(meetingID string, peerID string) (*models.WebRTCPeer, error) {
	peer, err := s.roomStorage.GetPeer(meetingID, peerID)
	if err != nil {
		if err.Error() == "peer "+peerID+" not found in room "+meetingID {
			return nil, fmt.Errorf("peer %s not found in room %s", peerID, meetingID)
		}
		return nil, fmt.Errorf("failed to get peer: %w", err)
	}

	return peer, nil
}

// getPeerMemory returns a specific peer in a meeting using memory
func (s *WebRTCService) getPeerMemory(meetingID string, peerID string) (*models.WebRTCPeer, error) {
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
	if s.useRedis {
		return s.updatePeerStateRedis(meetingID, peerID, state)
	} else {
		return s.updatePeerStateMemory(meetingID, peerID, state)
	}
}

// updatePeerStateRedis updates a peer's connection state using Redis
func (s *WebRTCService) updatePeerStateRedis(meetingID string, peerID string, state models.PeerConnectionState) error {
	// Get current peer
	peer, err := s.roomStorage.GetPeer(meetingID, peerID)
	if err != nil {
		return fmt.Errorf("peer %s not found in room %s", peerID, meetingID)
	}

	// Update peer state and last seen
	peer.State = state
	peer.LastSeen = time.Now()

	// Save updated peer
	err = s.roomStorage.SavePeer(meetingID, peer)
	if err != nil {
		return fmt.Errorf("failed to update peer state: %w", err)
	}

	// Update room activity
	err = s.roomStorage.UpdateRoomActivity(meetingID)
	if err != nil {
		log.Printf("Failed to update room activity: %v", err)
	}

	log.Printf("Peer %s state updated to %s in meeting %s (Redis)", peerID, state, meetingID)
	return nil
}

// updatePeerStateMemory updates a peer's connection state using memory
func (s *WebRTCService) updatePeerStateMemory(meetingID string, peerID string, state models.PeerConnectionState) error {
	s.roomsMutex.Lock()
	defer s.roomsMutex.Unlock()

	room, exists := s.rooms[meetingID]
	if !exists {
		return fmt.Errorf("room not found for meeting %s", meetingID)
	}

	room.UpdatePeerState(peerID, state)
	log.Printf("Peer %s state updated to %s in meeting %s (Memory)", peerID, state, meetingID)

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
	
	log.Printf("[WebRTC] Peer joined - Room: %s, New peer: %s (name: %s, auth: %t), Notifying %d existing peers",
		meetingID, newPeer.ID, newPeer.Name, newPeer.IsAuth, len(peers))
	
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
				log.Printf("[WebRTC] Failed to notify peer %s about new participant: %v", peer.ID, err)
			}
		}
	}
}

// notifyPeerLeft notifies other peers about a participant leaving
func (s *WebRTCService) notifyPeerLeft(meetingID string, leftPeerID string) {
	peers := s.GetMeetingPeers(meetingID)
	
	log.Printf("[WebRTC] Peer left - Room: %s, Peer: %s, Notifying %d remaining peers",
		meetingID, leftPeerID, len(peers))
	
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
				log.Printf("[WebRTC] Failed to notify peer %s about participant leaving: %v", peer.ID, err)
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
	if s.useRedis {
		return s.getAllRoomsRedis()
	} else {
		return s.getAllRoomsMemory()
	}
}

// getAllRoomsRedis returns all active WebRTC rooms using Redis
func (s *WebRTCService) getAllRoomsRedis() map[string]*models.WebRTCRoom {
	rooms, err := s.roomStorage.GetAllActiveRooms()
	if err != nil {
		log.Printf("Failed to get all rooms from Redis: %v", err)
		return make(map[string]*models.WebRTCRoom)
	}

	return rooms
}

// getAllRoomsMemory returns all active WebRTC rooms using memory
func (s *WebRTCService) getAllRoomsMemory() map[string]*models.WebRTCRoom {
	s.roomsMutex.RLock()
	defer s.roomsMutex.RUnlock()

	// Return a copy to avoid concurrent modification
	roomsCopy := make(map[string]*models.WebRTCRoom)
	for k, v := range s.rooms {
		roomsCopy[k] = v
	}

	return roomsCopy
}

// GetWebRTCStats returns comprehensive WebRTC statistics
func (s *WebRTCService) GetWebRTCStats() map[string]interface{} {
	stats := make(map[string]interface{})
	
	// Room statistics
	totalRooms := len(s.GetAllRooms())
	activeRooms := 0
	totalPeers := 0
	
	for _, room := range s.GetAllRooms() {
		if !room.IsEmpty() {
			activeRooms++
			totalPeers += room.GetPeerCount()
		}
	}
	
	stats["rooms"] = map[string]interface{}{
		"total":  totalRooms,
		"active": activeRooms,
		"empty":  totalRooms - activeRooms,
	}
	
	stats["peers"] = map[string]interface{}{
		"total": totalPeers,
		"average_per_room": float64(totalPeers) / float64(max(1, activeRooms)),
	}
	
	// Connection state statistics
	stateCount := make(map[models.PeerConnectionState]int)
	for _, room := range s.GetAllRooms() {
		for _, peer := range room.GetAllPeers() {
			stateCount[peer.State]++
		}
	}
	stats["connection_states"] = stateCount
	
	// Storage information
	stats["storage"] = map[string]interface{}{
		"using_redis": s.useRedis,
		"redis_connected": s.redisClient.IsConnected(),
	}
	
	// Configuration
	if s.config != nil {
		stats["config"] = map[string]interface{}{
			"bandwidth": s.config.Bandwidth,
			"connection_timeout": s.config.ConnectionTimeout.String(),
			"keep_alive_interval": s.config.KeepAliveInterval.String(),
			"ice_servers_count": len(s.config.ICEServers),
			"codec_preferences": s.config.CodecPreferences,
		}
	}
	
	s.logger.WithFields(logrus.Fields{
		"totalRooms":  totalRooms,
		"activeRooms": activeRooms,
		"totalPeers":  totalPeers,
	}).Info("WebRTC statistics retrieved")
	
	return stats
}

// MonitorConnectionQuality monitors and logs connection quality metrics
func (s *WebRTCService) MonitorConnectionQuality(meetingID, peerID string, quality string) {
	s.logger.WithFields(logrus.Fields{
		"meetingId": meetingID,
		"peerId":    peerID,
		"quality":   quality,
		"timestamp": time.Now(),
	}).Info("Connection quality update")
	
	// Could implement adaptive bitrate adjustments based on quality
	// This is where we would integrate with SFU for dynamic quality changes
}

// OptimizeRoomConfiguration optimizes room settings based on current conditions
func (s *WebRTCService) OptimizeRoomConfiguration(meetingID string) error {
	peers := s.GetMeetingPeers(meetingID)
	peerCount := len(peers)
	
	s.logger.WithFields(logrus.Fields{
		"meetingId": meetingID,
		"peerCount": peerCount,
	}).Info("Optimizing room configuration")
	
	// Implement adaptive configuration based on participant count
	if peerCount > 20 {
		// High participant count - reduce quality to save bandwidth
		s.logger.Info("High participant count detected, optimizing for bandwidth")
		// Could trigger SFU reconfiguration here
	} else if peerCount > 10 {
		// Medium participant count - balanced settings
		s.logger.Info("Medium participant count, using balanced configuration")
	} else {
		// Low participant count - maximum quality
		s.logger.Info("Low participant count, optimizing for quality")
	}
	
	return nil
}

// GetOptimalICEServers returns optimized ICE server configuration
func (s *WebRTCService) GetOptimalICEServers() []config.ICEServerConfig {
	if s.config == nil {
		return []config.ICEServerConfig{}
	}
	
	// Could implement logic to prioritize servers based on current conditions
	// For now, return configured servers
	return s.config.ICEServers
}

// LogWebRTCMetrics logs detailed WebRTC metrics for monitoring
func (s *WebRTCService) LogWebRTCMetrics(meetingID string) {
	peers := s.GetMeetingPeers(meetingID)
	
	metrics := map[string]interface{}{
		"meetingId":    meetingID,
		"peerCount":    len(peers),
		"timestamp":    time.Now(),
		"connectionStates": make(map[models.PeerConnectionState]int),
	}
	
	stateCount := make(map[models.PeerConnectionState]int)
	for _, peer := range peers {
		stateCount[peer.State]++
		
		// Log individual peer metrics
		s.logger.WithFields(logrus.Fields{
			"meetingId":    meetingID,
			"peerId":       peer.ID,
			"peerName":     peer.Name,
			"isAuth":       peer.IsAuth,
			"state":        peer.State,
			"joinedAt":     peer.JoinedAt,
			"lastSeen":     peer.LastSeen,
			"connectionAge": time.Since(peer.JoinedAt).String(),
		}).Debug("Peer metrics")
	}
	
	metrics["connectionStates"] = stateCount
	
	s.logger.WithFields(logrus.Fields(metrics)).Info("WebRTC room metrics")
}

// CleanupInactivePeers performs enhanced cleanup with better logging
func (s *WebRTCService) CleanupInactivePeers() {
	s.logger.Info("Starting enhanced inactive peer cleanup")
	
	cleanedRooms := 0
	cleanedPeers := 0
	
	if s.useRedis {
		// Use Redis cleanup with enhanced logging
		err := s.roomStorage.CleanupInactiveRooms(10 * time.Minute)
		if err != nil {
			s.logger.WithError(err).Error("Redis cleanup failed")
			// Fallback to in-memory cleanup
			cleanedRooms, cleanedPeers = s.cleanupInactiveRoomsMemoryEnhanced()
		} else {
			s.logger.Info("Redis cleanup completed successfully")
		}
	} else {
		// Use in-memory cleanup
		cleanedRooms, cleanedPeers = s.cleanupInactiveRoomsMemoryEnhanced()
	}
	
	s.logger.WithFields(logrus.Fields{
		"cleanedRooms": cleanedRooms,
		"cleanedPeers": cleanedPeers,
	}).Info("Enhanced inactive peer cleanup completed")
}

func (s *WebRTCService) cleanupInactiveRoomsMemoryEnhanced() (int, int) {
	s.roomsMutex.Lock()
	defer s.roomsMutex.Unlock()

	now := time.Now()
	emptyTimeout := 3 * time.Minute
	inactiveThreshold := 10 * time.Minute
	
	cleanedRooms := 0
	cleanedPeers := 0

	for meetingID, room := range s.rooms {
		peersBefore := len(room.Peers)
		
		// Remove inactive peers
		for peerID, peer := range room.Peers {
			if now.Sub(peer.LastSeen) > inactiveThreshold {
				s.logger.WithFields(logrus.Fields{
					"meetingId": meetingID,
					"peerId":    peerID,
					"peerName":  peer.Name,
					"lastSeen":  peer.LastSeen,
					"inactiveDuration": now.Sub(peer.LastSeen).String(),
				}).Info("Removing inactive peer")
				
				delete(room.Peers, peerID)
				cleanedPeers++
				
				// Notify other peers about the disconnection
				s.notifyPeerLeft(meetingID, peerID)
			}
		}

		// Remove empty rooms after empty timeout
		if room.IsEmpty() {
			if now.Sub(room.LastActivity) > emptyTimeout {
				s.logger.WithFields(logrus.Fields{
					"meetingId": meetingID,
					"emptyDuration": now.Sub(room.LastActivity).String(),
				}).Info("Removing empty room")
				
				delete(s.rooms, meetingID)
				cleanedRooms++
			}
		} else if now.Sub(room.LastActivity) > inactiveThreshold {
			s.logger.WithFields(logrus.Fields{
				"meetingId": meetingID,
				"inactiveDuration": now.Sub(room.LastActivity).String(),
				"peerCount": len(room.Peers),
			}).Info("Removing inactive room")
			
			delete(s.rooms, meetingID)
			cleanedRooms++
		}
		
		if peersBefore != len(room.Peers) {
			s.logger.WithFields(logrus.Fields{
				"meetingId": meetingID,
				"peersBefore": peersBefore,
				"peersAfter": len(room.Peers),
				"cleaned": peersBefore - len(room.Peers),
			}).Debug("Peer cleanup completed for room")
		}
	}

	return cleanedRooms, cleanedPeers
}

// Helper function
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}