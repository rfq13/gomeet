package controllers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"github.com/google/uuid"

	"github.com/your-org/gomeet-backend/internal/models"
	"github.com/your-org/gomeet-backend/internal/services"
	"github.com/your-org/gomeet-backend/internal/utils"
)

type MeetingController struct {
	meetingService *services.MeetingService
	validator      *validator.Validate
}

func NewMeetingController(meetingService *services.MeetingService) *MeetingController {
	return &MeetingController{
		meetingService: meetingService,
		validator:      validator.New(),
	}
}

// CreateMeeting handles meeting creation
// @Summary Create a new meeting
// @Description Create a new meeting for the authenticated user
// @Tags meetings
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body models.CreateMeetingRequest true "Meeting creation request"
// @Success 201 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings [post]
func (c *MeetingController) CreateMeeting(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	var req models.CreateMeetingRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	meeting, err := c.meetingService.CreateMeeting(userUUID, &req)
	if err != nil {
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusCreated, meeting.ToResponse(), "Meeting created successfully")
}

// GetMeetings handles retrieving user's meetings
// @Summary Get user meetings
// @Description Get paginated list of user's meetings
// @Tags meetings
// @Produce json
// @Security BearerAuth
// @Param page query int false "Page number" default(1)
// @Param limit query int false "Items per page" default(10)
// @Param search query string false "Search term for meeting names"
// @Success 200 {object} utils.APIResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings [get]
func (c *MeetingController) GetMeetings(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	// Parse query parameters
	page, _ := strconv.Atoi(ctx.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(ctx.DefaultQuery("limit", "10"))
	search := ctx.Query("search")

	// Validate pagination parameters
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 10
	}

	response, err := c.meetingService.GetMeetings(userUUID, page, limit, search)
	if err != nil {
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, response, "Meetings retrieved successfully")
}

// GetMeeting handles retrieving a specific meeting
// @Summary Get meeting by ID
// @Description Get a specific meeting by ID (only if user is the host)
// @Tags meetings
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings/{id} [get]
func (c *MeetingController) GetMeeting(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	meeting, err := c.meetingService.GetMeetingByID(meetingID, userUUID)
	if err != nil {
		if err.Error() == "meeting not found" {
			utils.NotFoundResponse(ctx, "Meeting not found")
			return
		}
		if err.Error() == "unauthorized access to meeting" {
			utils.ForbiddenResponse(ctx, "You don't have permission to access this meeting")
			return
		}
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, meeting.ToResponse(), "Meeting retrieved successfully")
}

// GetMeetingPublic handles retrieving a specific meeting without authentication
// @Summary Get meeting by ID (Public)
// @Description Get a specific meeting by ID without authentication (for meeting page access)
// @Tags meetings
// @Produce json
// @Param id path string true "Meeting ID"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings/{id}/public [get]
func (c *MeetingController) GetMeetingPublic(ctx *gin.Context) {
	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	meeting, err := c.meetingService.GetMeetingByIDPublic(meetingID)
	if err != nil {
		if err.Error() == "meeting not found" {
			utils.NotFoundResponse(ctx, "Meeting not found")
			return
		}
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, meeting.ToResponse(), "Meeting retrieved successfully")
}

// UpdateMeeting handles updating a meeting
// @Summary Update meeting
// @Description Update a meeting (only if user is the host)
// @Tags meetings
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Param request body models.UpdateMeetingRequest true "Meeting update request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 403 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings/{id} [put]
func (c *MeetingController) UpdateMeeting(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	var req models.UpdateMeetingRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	meeting, err := c.meetingService.UpdateMeeting(meetingID, userUUID, &req)
	if err != nil {
		if err.Error() == "meeting not found or unauthorized" {
			utils.ForbiddenResponse(ctx, "Meeting not found or you don't have permission to update it")
			return
		}
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, meeting.ToResponse(), "Meeting updated successfully")
}

// DeleteMeeting handles deleting a meeting
// @Summary Delete meeting
// @Description Delete a meeting (only if user is the host)
// @Tags meetings
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 403 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings/{id} [delete]
func (c *MeetingController) DeleteMeeting(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	err = c.meetingService.DeleteMeeting(meetingID, userUUID)
	if err != nil {
		if err.Error() == "meeting not found or unauthorized" {
			utils.ForbiddenResponse(ctx, "Meeting not found or you don't have permission to delete it")
			return
		}
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, nil, "Meeting deleted successfully")
}

// GetUpcomingMeetings handles retrieving upcoming meetings
// @Summary Get upcoming meetings
// @Description Get list of upcoming meetings for the authenticated user
// @Tags meetings
// @Produce json
// @Security BearerAuth
// @Param limit query int false "Maximum number of meetings to return" default(5)
// @Success 200 {object} utils.APIResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings/upcoming [get]
func (c *MeetingController) GetUpcomingMeetings(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	limit, _ := strconv.Atoi(ctx.DefaultQuery("limit", "5"))
	if limit < 1 || limit > 50 {
		limit = 5
	}

	meetings, err := c.meetingService.GetUpcomingMeetings(userUUID, limit)
	if err != nil {
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	// Convert to response
	meetingResponses := make([]models.MeetingResponse, len(meetings))
	for i, meeting := range meetings {
		meetingResponses[i] = meeting.ToResponse()
	}

	utils.SuccessResponse(ctx, http.StatusOK, meetingResponses, "Upcoming meetings retrieved successfully")
}

// GetPastMeetings handles retrieving past meetings
// @Summary Get past meetings
// @Description Get paginated list of past meetings for the authenticated user
// @Tags meetings
// @Produce json
// @Security BearerAuth
// @Param page query int false "Page number" default(1)
// @Param limit query int false "Items per page" default(10)
// @Success 200 {object} utils.APIResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings/past [get]
func (c *MeetingController) GetPastMeetings(ctx *gin.Context) {
	userUUID, exists := utils.GetUserIDUUID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	// Parse query parameters
	page, _ := strconv.Atoi(ctx.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(ctx.DefaultQuery("limit", "10"))

	// Validate pagination parameters
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 10
	}

	response, err := c.meetingService.GetPastMeetings(userUUID, page, limit)
	if err != nil {
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, response, "Past meetings retrieved successfully")
}

// JoinMeeting handles joining a meeting
// @Summary Join a meeting
// @Description Join a meeting as a participant
// @Tags meetings
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body models.JoinMeetingRequest true "Join meeting request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings/join [post]
func (c *MeetingController) JoinMeeting(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	var req models.JoinMeetingRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	participant, err := c.meetingService.JoinMeeting(userUUID, req.MeetingID)
	if err != nil {
		if err.Error() == "meeting not found" {
			utils.NotFoundResponse(ctx, "Meeting not found")
			return
		}
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, participant, "Joined meeting successfully")
}

// LeaveMeeting handles leaving a meeting
// @Summary Leave a meeting
// @Description Leave a meeting as a participant
// @Tags meetings
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body models.LeaveMeetingRequest true "Leave meeting request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings/leave [post]
func (c *MeetingController) LeaveMeeting(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	var req models.LeaveMeetingRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	err = c.meetingService.LeaveMeeting(userUUID, req.MeetingID)
	if err != nil {
		if err.Error() == "meeting not found" {
			utils.NotFoundResponse(ctx, "Meeting not found")
			return
		}
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, nil, "Left meeting successfully")
}

// GetMeetingParticipantsPublic handles retrieving meeting participants without authentication
// @Summary Get meeting participants (Public)
// @Description Get list of participants in a meeting without authentication
// @Tags meetings
// @Produce json
// @Param id path string true "Meeting ID"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings/{id}/participants/public [get]
func (c *MeetingController) GetMeetingParticipantsPublic(ctx *gin.Context) {
	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	participants, err := c.meetingService.GetMeetingParticipantsPublic(meetingID)
	if err != nil {
		if err.Error() == "meeting not found" {
			utils.NotFoundResponse(ctx, "Meeting not found")
			return
		}
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, participants, "Participants retrieved successfully")
}

// GetMeetingParticipants handles retrieving meeting participants
// @Summary Get meeting participants
// @Description Get list of participants in a meeting
// @Tags meetings
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings/{id}/participants [get]
func (c *MeetingController) GetMeetingParticipants(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	participants, err := c.meetingService.GetMeetingParticipants(meetingID, userUUID)
	if err != nil {
		if err.Error() == "meeting not found" {
			utils.NotFoundResponse(ctx, "Meeting not found")
			return
		}
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, participants, "Participants retrieved successfully")
}

// GetJoinedMeetings handles retrieving meetings where user is a participant
// @Summary Get joined meetings
// @Description Get list of meetings where the user is a participant
// @Tags meetings
// @Produce json
// @Security BearerAuth
// @Param page query int false "Page number" default(1)
// @Param limit query int false "Items per page" default(10)
// @Success 200 {object} utils.APIResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings/joined [get]
func (c *MeetingController) GetJoinedMeetings(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	// Parse query parameters
	page, _ := strconv.Atoi(ctx.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(ctx.DefaultQuery("limit", "10"))

	// Validate pagination parameters
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 10
	}

	response, err := c.meetingService.GetJoinedMeetings(userUUID, page, limit)
	if err != nil {
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, response, "Joined meetings retrieved successfully")
}

// StartMeeting handles starting a meeting
// @Summary Start a meeting
// @Description Activate a meeting to start it
// @Tags meetings
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 403 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings/{id}/start [patch]
func (c *MeetingController) StartMeeting(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	meeting, err := c.meetingService.StartMeeting(meetingID, userUUID)
	if err != nil {
		if err.Error() == "meeting not found or unauthorized" {
			utils.ForbiddenResponse(ctx, "Meeting not found or you don't have permission to start it")
			return
		}
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, meeting.ToResponse(), "Meeting started successfully")
}

// EndMeeting handles ending a meeting
// @Summary End a meeting
// @Description Deactivate a meeting to end it
// @Tags meetings
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 403 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/meetings/{id}/end [patch]
func (c *MeetingController) EndMeeting(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	meeting, err := c.meetingService.EndMeeting(meetingID, userUUID)
	if err != nil {
		if err.Error() == "meeting not found or unauthorized" {
			utils.ForbiddenResponse(ctx, "Meeting not found or you don't have permission to end it")
			return
		}
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, meeting.ToResponse(), "Meeting ended successfully")
}