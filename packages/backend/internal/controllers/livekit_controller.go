// TEMPORARILY DISABLED FOR EMERGENCY WEBSOCKET FIX
// All LiveKit functionality disabled to resolve compilation issues
// This will be re-enabled once WebSocket client explosion is fixed

package controllers

// type LiveKitController struct {
// 	liveKitService *services.LiveKitService
// 	logger         *logrus.Logger
// }

type JoinRoomRequest struct {
	ParticipantID string `json:"participant_id" binding:"required,uuid"`
	MeetingID     string `json:"meeting_id" binding:"required,uuid"`
}

type JoinRoomResponse struct {
	Token    string `json:"token"`
	RoomID   string `json:"room_id"`
	ServerURL string `json:"server_url"`
}

type ParticipantResponse struct {
	ID                  string `json:"id"`
	MeetingID           string `json:"meeting_id"`
	ParticipantID       string `json:"participant_id"`
	LiveKitParticipantID string   `json:"livekit_participant_id"`
	JoinedAt            string `json:"joined_at"`
	LeftAt             *string `json:"left_at"`
	IsActive           bool   `json:"is_active"`
}

type CreateRoomRequest struct {
	MeetingID string `json:"meeting_id" binding:"required,uuid"`
}

type CreateRoomResponse struct {
	RoomID       string `json:"room_id"`
	MeetingID    string `json:"meeting_id"`
	LiveKitRoomID string `json:"livekit_room_id"`
}

// func NewLiveKitController(liveKitService *services.LiveKitService) *LiveKitController {
// 	logger := logrus.New()
// 	logger.SetLevel(logrus.InfoLevel)

// 	return &LiveKitController{
// 		liveKitService: liveKitService,
// 		logger:         logger,
// 	}
// }

// TEMPORARILY DISABLED FOR EMERGENCY WEBSOCKET FIX
// All LiveKit methods disabled to resolve compilation issues

// func (c *LiveKitController) JoinRoom(ctx *gin.Context) {
// 	utils.ErrorResponse(ctx, http.StatusServiceUnavailable, "LIVEKIT_DISABLED", "LiveKit functionality temporarily disabled")
// }

// func (c *LiveKitController) LeaveRoom(ctx *gin.Context) {
// 	utils.ErrorResponse(ctx, http.StatusServiceUnavailable, "LIVEKIT_DISABLED", "LiveKit functionality temporarily disabled")
// }

// func (c *LiveKitController) GetParticipants(ctx *gin.Context) {
// 	utils.ErrorResponse(ctx, http.StatusServiceUnavailable, "LIVEKIT_DISABLED", "LiveKit functionality temporarily disabled")
// }

// func (c *LiveKitController) CreateRoom(ctx *gin.Context) {
// 	utils.ErrorResponse(ctx, http.StatusServiceUnavailable, "LIVEKIT_DISABLED", "LiveKit functionality temporarily disabled")
// }

// func (c *LiveKitController) DeleteRoom(ctx *gin.Context) {
// 	utils.ErrorResponse(ctx, http.StatusServiceUnavailable, "LIVEKIT_DISABLED", "LiveKit functionality temporarily disabled")
// }

// func (c *LiveKitController) GetRoomStatus(ctx *gin.Context) {
// 	utils.ErrorResponse(ctx, http.StatusServiceUnavailable, "LIVEKIT_DISABLED", "LiveKit functionality temporarily disabled")
// }

// func (c *LiveKitController) GetParticipantCount(ctx *gin.Context) {
// 	utils.ErrorResponse(ctx, http.StatusServiceUnavailable, "LIVEKIT_DISABLED", "LiveKit functionality temporarily disabled")
// }