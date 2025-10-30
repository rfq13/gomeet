package redis

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/filosofine/gomeet-backend/internal/models"
)

type RoomStorage struct {
	redisClient *RedisClient
}

func NewRoomStorage(redisClient *RedisClient) *RoomStorage {
	return &RoomStorage{
		redisClient: redisClient,
	}
}

// Key patterns for Redis
const (
	RoomKeyPrefix        = "webrtc:room:"
	PeerKeyPrefix        = "webrtc:peer:"
	RoomPeersKeyPattern  = "webrtc:room:%s:peers"
	RoomMetadataKey      = "webrtc:room:%s:metadata"
	PeerRoomKeyPattern   = "webrtc:peer:%s:room"
)

// SaveRoom saves room metadata to Redis
func (rs *RoomStorage) SaveRoom(room *models.WebRTCRoom) error {
	if !rs.redisClient.IsConnected() {
		return fmt.Errorf("Redis not available")
	}

	roomKey := fmt.Sprintf(RoomMetadataKey, room.MeetingID)
	
	// Save room metadata with expiration (24 hours)
	err := rs.redisClient.Set(roomKey, room, 24*time.Hour)
	if err != nil {
		log.Printf("Failed to save room metadata for %s: %v", room.MeetingID, err)
		return fmt.Errorf("failed to save room metadata: %w", err)
	}

	log.Printf("Saved room metadata for meeting %s", room.MeetingID)
	return nil
}

// GetRoom retrieves room metadata from Redis
func (rs *RoomStorage) GetRoom(meetingID string) (*models.WebRTCRoom, error) {
	if !rs.redisClient.IsConnected() {
		return nil, fmt.Errorf("Redis not available")
	}

	roomKey := fmt.Sprintf(RoomMetadataKey, meetingID)
	
	var room models.WebRTCRoom
	err := rs.redisClient.Get(roomKey, &room)
	if err != nil {
		if err.Error() == "redis: nil" {
			return nil, fmt.Errorf("room not found for meeting %s", meetingID)
		}
		log.Printf("Failed to get room metadata for %s: %v", meetingID, err)
		return nil, fmt.Errorf("failed to get room metadata: %w", err)
	}

	// Load peers for this room
	peers, err := rs.GetRoomPeers(meetingID)
	if err != nil {
		log.Printf("Failed to load peers for room %s: %v", meetingID, err)
		// Continue with empty peers if loading fails
		peers = make(map[string]*models.WebRTCPeer)
	}

	room.Peers = peers
	return &room, nil
}

// SavePeer saves a peer to Redis
func (rs *RoomStorage) SavePeer(meetingID string, peer *models.WebRTCPeer) error {
	if !rs.redisClient.IsConnected() {
		return fmt.Errorf("Redis not available")
	}

	// Save peer to room's peer set
	roomPeersKey := fmt.Sprintf(RoomPeersKeyPattern, meetingID)
	err := rs.redisClient.HSet(roomPeersKey, peer.ID, peer)
	if err != nil {
		log.Printf("Failed to save peer %s to room %s: %v", peer.ID, meetingID, err)
		return fmt.Errorf("failed to save peer to room: %w", err)
	}

	// Set peer->room mapping
	peerRoomKey := fmt.Sprintf(PeerRoomKeyPattern, peer.ID)
	err = rs.redisClient.Set(peerRoomKey, meetingID, 24*time.Hour)
	if err != nil {
		log.Printf("Failed to set peer->room mapping for peer %s: %v", peer.ID, err)
		return fmt.Errorf("failed to set peer->room mapping: %w", err)
	}

	// Update room activity timestamp
	err = rs.UpdateRoomActivity(meetingID)
	if err != nil {
		log.Printf("Failed to update room activity for %s: %v", meetingID, err)
	}

	log.Printf("Saved peer %s to room %s", peer.ID, meetingID)
	return nil
}

// GetPeer retrieves a peer from Redis
func (rs *RoomStorage) GetPeer(meetingID, peerID string) (*models.WebRTCPeer, error) {
	if !rs.redisClient.IsConnected() {
		return nil, fmt.Errorf("Redis not available")
	}

	roomPeersKey := fmt.Sprintf(RoomPeersKeyPattern, meetingID)
	
	var peer models.WebRTCPeer
	err := rs.redisClient.HGet(roomPeersKey, peerID, &peer)
	if err != nil {
		if err.Error() == "redis: nil" {
			return nil, fmt.Errorf("peer %s not found in room %s", peerID, meetingID)
		}
		log.Printf("Failed to get peer %s from room %s: %v", peerID, meetingID, err)
		return nil, fmt.Errorf("failed to get peer: %w", err)
	}

	return &peer, nil
}

// GetRoomPeers retrieves all peers for a room
func (rs *RoomStorage) GetRoomPeers(meetingID string) (map[string]*models.WebRTCPeer, error) {
	if !rs.redisClient.IsConnected() {
		return nil, fmt.Errorf("Redis not available")
	}

	roomPeersKey := fmt.Sprintf(RoomPeersKeyPattern, meetingID)
	
	peerData, err := rs.redisClient.HGetAll(roomPeersKey)
	if err != nil {
		log.Printf("Failed to get all peers for room %s: %v", meetingID, err)
		return nil, fmt.Errorf("failed to get room peers: %w", err)
	}

	peers := make(map[string]*models.WebRTCPeer)
	for peerID, peerJSON := range peerData {
		var peer models.WebRTCPeer
		err := json.Unmarshal([]byte(peerJSON), &peer)
		if err != nil {
			log.Printf("Failed to unmarshal peer %s: %v", peerID, err)
			continue
		}
		peers[peerID] = &peer
	}

	return peers, nil
}

// RemovePeer removes a peer from Redis
func (rs *RoomStorage) RemovePeer(meetingID, peerID string) error {
	if !rs.redisClient.IsConnected() {
		return fmt.Errorf("Redis not available")
	}

	// Remove peer from room's peer set
	roomPeersKey := fmt.Sprintf(RoomPeersKeyPattern, meetingID)
	err := rs.redisClient.HDel(roomPeersKey, peerID)
	if err != nil {
		log.Printf("Failed to remove peer %s from room %s: %v", peerID, meetingID, err)
		return fmt.Errorf("failed to remove peer from room: %w", err)
	}

	// Remove peer->room mapping
	peerRoomKey := fmt.Sprintf(PeerRoomKeyPattern, peerID)
	err = rs.redisClient.Delete(peerRoomKey)
	if err != nil {
		log.Printf("Failed to remove peer->room mapping for peer %s: %v", peerID, err)
		// Don't return error for this, as the main operation succeeded
	}

	// Update room activity timestamp
	err = rs.UpdateRoomActivity(meetingID)
	if err != nil {
		log.Printf("Failed to update room activity for %s: %v", meetingID, err)
	}

	log.Printf("Removed peer %s from room %s", peerID, meetingID)
	return nil
}

// DeleteRoom removes a room and all its peers from Redis
func (rs *RoomStorage) DeleteRoom(meetingID string) error {
	if !rs.redisClient.IsConnected() {
		return fmt.Errorf("Redis not available")
	}

	// Get all peers in the room first to clean up their mappings
	peers, err := rs.GetRoomPeers(meetingID)
	if err != nil {
		log.Printf("Failed to get peers for room deletion %s: %v", meetingID, err)
	}

	// Remove peer->room mappings for all peers
	for peerID := range peers {
		peerRoomKey := fmt.Sprintf(PeerRoomKeyPattern, peerID)
		err := rs.redisClient.Delete(peerRoomKey)
		if err != nil {
			log.Printf("Failed to remove peer->room mapping for peer %s: %v", peerID, err)
		}
	}

	// Remove room metadata
	roomKey := fmt.Sprintf(RoomMetadataKey, meetingID)
	err = rs.redisClient.Delete(roomKey)
	if err != nil {
		log.Printf("Failed to delete room metadata for %s: %v", meetingID, err)
		return fmt.Errorf("failed to delete room metadata: %w", err)
	}

	// Remove room's peer set
	roomPeersKey := fmt.Sprintf(RoomPeersKeyPattern, meetingID)
	err = rs.redisClient.Delete(roomPeersKey)
	if err != nil {
		log.Printf("Failed to delete room peers for %s: %v", meetingID, err)
		return fmt.Errorf("failed to delete room peers: %w", err)
	}

	log.Printf("Deleted room %s and all its peers", meetingID)
	return nil
}

// UpdateRoomActivity updates the last activity timestamp for a room
func (rs *RoomStorage) UpdateRoomActivity(meetingID string) error {
	if !rs.redisClient.IsConnected() {
		return fmt.Errorf("Redis not available")
	}

	roomKey := fmt.Sprintf(RoomMetadataKey, meetingID)
	
	// Get existing room
	var room models.WebRTCRoom
	err := rs.redisClient.Get(roomKey, &room)
	if err != nil {
		if err.Error() == "redis: nil" {
			// Room doesn't exist, create a new one
			room = models.WebRTCRoom{
				MeetingID:    meetingID,
				Peers:        make(map[string]*models.WebRTCPeer),
				CreatedAt:    time.Now(),
				LastActivity: time.Now(),
			}
		} else {
			return fmt.Errorf("failed to get room for activity update: %w", err)
		}
	}

	// Update activity timestamp
	room.LastActivity = time.Now()
	
	// Save updated room
	err = rs.redisClient.Set(roomKey, room, 24*time.Hour)
	if err != nil {
		return fmt.Errorf("failed to update room activity: %w", err)
	}

	return nil
}

// GetAllActiveRooms returns all active rooms from Redis
func (rs *RoomStorage) GetAllActiveRooms() (map[string]*models.WebRTCRoom, error) {
	if !rs.redisClient.IsConnected() {
		return nil, fmt.Errorf("Redis not available")
	}

	// Get all room metadata keys
	roomKeys, err := rs.redisClient.Keys(RoomMetadataKey + "*")
	if err != nil {
		log.Printf("Failed to get room keys: %v", err)
		return nil, fmt.Errorf("failed to get room keys: %w", err)
	}

	rooms := make(map[string]*models.WebRTCRoom)
	for _, roomKey := range roomKeys {
		var room models.WebRTCRoom
		err := rs.redisClient.Get(roomKey, &room)
		if err != nil {
			log.Printf("Failed to get room data for key %s: %v", roomKey, err)
			continue
		}

		// Load peers for this room
		peers, err := rs.GetRoomPeers(room.MeetingID)
		if err != nil {
			log.Printf("Failed to load peers for room %s: %v", room.MeetingID, err)
			peers = make(map[string]*models.WebRTCPeer)
		}

		room.Peers = peers
		rooms[room.MeetingID] = &room
	}

	return rooms, nil
}

// GetPeerRoom returns the meeting ID for a peer
func (rs *RoomStorage) GetPeerRoom(peerID string) (string, error) {
	if !rs.redisClient.IsConnected() {
		return "", fmt.Errorf("Redis not available")
	}

	peerRoomKey := fmt.Sprintf(PeerRoomKeyPattern, peerID)
	
	var meetingID string
	err := rs.redisClient.Get(peerRoomKey, &meetingID)
	if err != nil {
		if err.Error() == "redis: nil" {
			return "", fmt.Errorf("peer %s not found in any room", peerID)
		}
		return "", fmt.Errorf("failed to get peer room: %w", err)
	}

	return meetingID, nil
}

// CleanupInactiveRooms removes rooms that have been inactive for too long
func (rs *RoomStorage) CleanupInactiveRooms(inactiveThreshold time.Duration) error {
	if !rs.redisClient.IsConnected() {
		return fmt.Errorf("Redis not available")
	}

	rooms, err := rs.GetAllActiveRooms()
	if err != nil {
		return fmt.Errorf("failed to get active rooms for cleanup: %w", err)
	}

	now := time.Now()
	for meetingID, room := range rooms {
		// Check if room is inactive
		if room.IsEmpty() || now.Sub(room.LastActivity) > inactiveThreshold {
			log.Printf("Cleaning up inactive room %s", meetingID)
			err := rs.DeleteRoom(meetingID)
			if err != nil {
				log.Printf("Failed to cleanup room %s: %v", meetingID, err)
			}
		} else {
			// Check for inactive peers within the room
			inactivePeers := []string{}
			for peerID, peer := range room.Peers {
				if now.Sub(peer.LastSeen) > inactiveThreshold {
					inactivePeers = append(inactivePeers, peerID)
				}
			}

			// Remove inactive peers
			for _, peerID := range inactivePeers {
				log.Printf("Removing inactive peer %s from room %s", peerID, meetingID)
				err := rs.RemovePeer(meetingID, peerID)
				if err != nil {
					log.Printf("Failed to remove inactive peer %s: %v", peerID, err)
				}
			}
		}
	}

	return nil
}