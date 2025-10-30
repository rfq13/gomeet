package logger

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// WebRTCLogger provides comprehensive logging for WebRTC events
type WebRTCLogger struct {
	logger *Logger
}

// NewWebRTCLogger creates a new WebRTC logger instance
func NewWebRTCLogger(logger *Logger) *WebRTCLogger {
	return &WebRTCLogger{
		logger: logger,
	}
}

// WebRTCEventContext represents WebRTC-specific logging context
type WebRTCEventContext struct {
	LogContext
	MeetingID   string
	PeerID      string
	RoomID      string
	SessionID   string
	Event       string
	State       string
	ConnectionState string
	ICEState    string
	SignalingState string
	MediaState  string
	Direction   string // "inbound" or "outbound"
	StreamType  string // "audio", "video", "screen", "data"
	Quality     string // "high", "medium", "low"
	Bitrate     int
	PacketLoss  float64
	RTT         int // Round-trip time in ms
	Jitter      int // Jitter in ms
	FPS         int // Frames per second
	Resolution  string // e.g., "1280x720"
}

// LogPeerConnection logs peer connection events
func (wl *WebRTCLogger) LogPeerConnection(ctx context.Context, meetingID, peerID, event string, details map[string]interface{}) {
	logCtx := wl.logger.WithContextValue(ctx)
	logCtx.Component = "webrtc"
	logCtx.Operation = "peer_connection"
	logCtx.MeetingID = meetingID
	logCtx.PeerID = peerID

	wl.logger.LogWebRTCEvent(logCtx, event, details)
}

// LogSignalingEvent logs WebRTC signaling events
func (wl *WebRTCLogger) LogSignalingEvent(ctx context.Context, meetingID, peerID, eventType string, details map[string]interface{}) {
	logCtx := wl.logger.WithContextValue(ctx)
	logCtx.Component = "webrtc"
	logCtx.Operation = "signaling"
	logCtx.MeetingID = meetingID
	logCtx.PeerID = peerID

	details["event_type"] = eventType
	wl.logger.LogWebRTCEvent(logCtx, "signaling_event", details)
}

// LogICEEvent logs ICE connection events
func (wl *WebRTCLogger) LogICEEvent(ctx context.Context, meetingID, peerID, iceState string, details map[string]interface{}) {
	logCtx := wl.logger.WithContextValue(ctx)
	logCtx.Component = "webrtc"
	logCtx.Operation = "ice_connection"
	logCtx.MeetingID = meetingID
	logCtx.PeerID = peerID

	details["ice_state"] = iceState
	wl.logger.LogWebRTCEvent(logCtx, "ice_state_change", details)
}

// LogMediaEvent logs media-related events (audio/video)
func (wl *WebRTCLogger) LogMediaEvent(ctx context.Context, meetingID, peerID, mediaType, event string, details map[string]interface{}) {
	logCtx := wl.logger.WithContextValue(ctx)
	logCtx.Component = "webrtc"
	logCtx.Operation = "media"
	logCtx.MeetingID = meetingID
	logCtx.PeerID = peerID

	details["media_type"] = mediaType
	details["media_event"] = event
	wl.logger.LogWebRTCEvent(logCtx, "media_event", details)
}

// LogQualityMetrics logs WebRTC quality metrics
func (wl *WebRTCLogger) LogQualityMetrics(ctx context.Context, meetingID, peerID string, metrics map[string]interface{}) {
	logCtx := wl.logger.WithContextValue(ctx)
	logCtx.Component = "webrtc"
	logCtx.Operation = "quality_metrics"
	logCtx.MeetingID = meetingID
	logCtx.PeerID = peerID

	wl.logger.LogWebRTCEvent(logCtx, "quality_metrics", metrics)
}

// LogRoomEvent logs room-level events
func (wl *WebRTCLogger) LogRoomEvent(ctx context.Context, meetingID, event string, details map[string]interface{}) {
	logCtx := wl.logger.WithContextValue(ctx)
	logCtx.Component = "webrtc"
	logCtx.Operation = "room_management"
	logCtx.MeetingID = meetingID

	wl.logger.LogWebRTCEvent(logCtx, event, details)
}

// LogPerformanceMetrics logs WebRTC performance metrics
func (wl *WebRTCLogger) LogPerformanceMetrics(ctx context.Context, meetingID, peerID string, operation string, duration time.Duration, details map[string]interface{}) {
	logCtx := wl.logger.WithContextValue(ctx)
	logCtx.Component = "webrtc"
	logCtx.Operation = operation
	logCtx.MeetingID = meetingID
	logCtx.PeerID = peerID
	logCtx.Duration = duration

	wl.logger.LogPerformance(logCtx, operation, duration, details)
}

// LogError logs WebRTC-specific errors
func (wl *WebRTCLogger) LogError(ctx context.Context, meetingID, peerID, operation string, err error, details map[string]interface{}) {
	logCtx := wl.logger.WithContextValue(ctx)
	logCtx.Component = "webrtc"
	logCtx.Operation = operation
	logCtx.MeetingID = meetingID
	logCtx.PeerID = peerID

	entry := wl.logger.WithContext(logCtx)
	for key, value := range details {
		entry = entry.WithField(key, value)
	}

	entry.WithError(err).Error("WebRTC error occurred")
}

// LogSecurityEvent logs WebRTC security-related events
func (wl *WebRTCLogger) LogSecurityEvent(ctx context.Context, meetingID, peerID, eventType string, details map[string]interface{}) {
	logCtx := wl.logger.WithContextValue(ctx)
	logCtx.Component = "webrtc"
	logCtx.Operation = "security"
	logCtx.MeetingID = meetingID
	logCtx.PeerID = peerID

	wl.logger.LogSecurity(logCtx, eventType, details)
}

// LogConnectionStateChange logs connection state changes
func (wl *WebRTCLogger) LogConnectionStateChange(ctx context.Context, meetingID, peerID, fromState, toState string, details map[string]interface{}) {
	logCtx := wl.logger.WithContextValue(ctx)
	logCtx.Component = "webrtc"
	logCtx.Operation = "connection_state_change"
	logCtx.MeetingID = meetingID
	logCtx.PeerID = peerID

	details["from_state"] = fromState
	details["to_state"] = toState
	
	wl.logger.LogWebRTCEvent(logCtx, "connection_state_changed", details)
}

// LogDataChannelEvent logs data channel events
func (wl *WebRTCLogger) LogDataChannelEvent(ctx context.Context, meetingID, peerID, channelID, event string, details map[string]interface{}) {
	logCtx := wl.logger.WithContextValue(ctx)
	logCtx.Component = "webrtc"
	logCtx.Operation = "data_channel"
	logCtx.MeetingID = meetingID
	logCtx.PeerID = peerID

	details["channel_id"] = channelID
	details["data_channel_event"] = event
	
	wl.logger.LogWebRTCEvent(logCtx, "data_channel_event", details)
}

// LogStats logs WebRTC statistics
func (wl *WebRTCLogger) LogStats(ctx context.Context, meetingID, peerID string, stats map[string]interface{}) {
	logCtx := wl.logger.WithContextValue(ctx)
	logCtx.Component = "webrtc"
	logCtx.Operation = "statistics"
	logCtx.MeetingID = meetingID
	logCtx.PeerID = peerID

	wl.logger.LogWebRTCEvent(logCtx, "webrtc_stats", stats)
}

// CreateWebRTCContext creates a WebRTC-specific logging context
func (wl *WebRTCLogger) CreateWebRTCContext(ctx context.Context, meetingID, peerID string) WebRTCEventContext {
	logCtx := wl.logger.WithContextValue(ctx)
	
	return WebRTCEventContext{
		LogContext: logCtx,
		MeetingID:  meetingID,
		PeerID:     peerID,
	}
}

// WithUserID adds user ID to the WebRTC context
func (wctx WebRTCEventContext) WithUserID(userID uuid.UUID) WebRTCEventContext {
	wctx.UserID = userID.String()
	return wctx
}

// WithSessionID adds session ID to the WebRTC context
func (wctx WebRTCEventContext) WithSessionID(sessionID string) WebRTCEventContext {
	wctx.SessionID = sessionID
	return wctx
}

// WithEvent adds event type to the WebRTC context
func (wctx WebRTCEventContext) WithEvent(event string) WebRTCEventContext {
	wctx.Event = event
	return wctx
}

// WithState adds state information to the WebRTC context
func (wctx WebRTCEventContext) WithState(state string) WebRTCEventContext {
	wctx.State = state
	return wctx
}

// WithConnectionState adds connection state to the WebRTC context
func (wctx WebRTCEventContext) WithConnectionState(state string) WebRTCEventContext {
	wctx.ConnectionState = state
	return wctx
}

// WithMediaInfo adds media information to the WebRTC context
func (wctx WebRTCEventContext) WithMediaInfo(streamType, quality, resolution string, bitrate, fps int) WebRTCEventContext {
	wctx.StreamType = streamType
	wctx.Quality = quality
	wctx.Resolution = resolution
	wctx.Bitrate = bitrate
	wctx.FPS = fps
	return wctx
}

// WithNetworkMetrics adds network metrics to the WebRTC context
func (wctx WebRTCEventContext) WithNetworkMetrics(packetLoss float64, rtt, jitter int) WebRTCEventContext {
	wctx.PacketLoss = packetLoss
	wctx.RTT = rtt
	wctx.Jitter = jitter
	return wctx
}

// Log logs the WebRTC event using the context
func (wctx WebRTCEventContext) Log(logger *Logger, message string) {
	logger.LogWebRTCEvent(wctx.LogContext, message, map[string]interface{}{
		"meeting_id":        wctx.MeetingID,
		"peer_id":           wctx.PeerID,
		"session_id":        wctx.SessionID,
		"event":             wctx.Event,
		"state":             wctx.State,
		"connection_state":  wctx.ConnectionState,
		"ice_state":         wctx.ICEState,
		"signaling_state":   wctx.SignalingState,
		"media_state":       wctx.MediaState,
		"direction":         wctx.Direction,
		"stream_type":       wctx.StreamType,
		"quality":           wctx.Quality,
		"bitrate":           wctx.Bitrate,
		"packet_loss":       wctx.PacketLoss,
		"rtt":               wctx.RTT,
		"jitter":            wctx.Jitter,
		"fps":               wctx.FPS,
		"resolution":        wctx.Resolution,
	})
}