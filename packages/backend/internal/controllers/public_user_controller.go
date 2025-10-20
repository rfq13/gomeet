package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"github.com/google/uuid"

	"github.com/your-org/gomeet/packages/backend/internal/models"
	"github.com/your-org/gomeet/packages/backend/internal/services"
	"github.com/your-org/gomeet/packages/backend/internal/utils"
)

type PublicUserController struct {
	publicUserService *services.PublicUserService
	validator         *validator.Validate
}

func NewPublicUserController(publicUserService *services.PublicUserService) *PublicUserController {
	return &PublicUserController{
		publicUserService: publicUserService,
		validator:         validator.New(),
	}
}

// CreatePublicUser handles creating a new public user
// @Summary Create a new public user
// @Description Create a new public user for joining meetings without authentication
// @Tags public-users
// @Accept json
// @Produce json
// @Param request body models.CreatePublicUserRequest true "Public user creation request"
// @Success 201 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/public/users [post]
func (c *PublicUserController) CreatePublicUser(ctx *gin.Context) {
	var req models.CreatePublicUserRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	publicUser, err := c.publicUserService.CreatePublicUser(&req)
	if err != nil {
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusCreated, publicUser.ToResponse(), "Public user created successfully")
}

// JoinMeetingAsPublicUser handles joining a meeting as a public user
// @Summary Join meeting as public user
// @Description Join a meeting as a public user using session ID
// @Tags public-users
// @Accept json
// @Produce json
// @Param request body models.JoinMeetingAsPublicUserRequest true "Join meeting request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/public/meetings/join [post]
func (c *PublicUserController) JoinMeetingAsPublicUser(ctx *gin.Context) {
	var req models.JoinMeetingAsPublicUserRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	meetingID, err := uuid.Parse(req.MeetingID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	participant, err := c.publicUserService.JoinMeetingAsPublicUser(req.SessionID, meetingID)
	if err != nil {
		if err.Error() == "meeting not found" {
			utils.NotFoundResponse(ctx, "Meeting not found")
			return
		}
		if err.Error() == "public user not found" {
			utils.NotFoundResponse(ctx, "Public user not found")
			return
		}
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, participant.ToResponse(), "Joined meeting successfully")
}

// LeaveMeetingAsPublicUser handles leaving a meeting as a public user
// @Summary Leave meeting as public user
// @Description Leave a meeting as a public user using session ID
// @Tags public-users
// @Accept json
// @Produce json
// @Param request body models.LeaveMeetingAsPublicUserRequest true "Leave meeting request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/public/meetings/leave [post]
func (c *PublicUserController) LeaveMeetingAsPublicUser(ctx *gin.Context) {
	var req models.LeaveMeetingAsPublicUserRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	meetingID, err := uuid.Parse(req.MeetingID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	err = c.publicUserService.LeaveMeetingAsPublicUser(req.SessionID, meetingID)
	if err != nil {
		if err.Error() == "meeting not found" || err.Error() == "public user not found" || err.Error() == "participant not found" {
			utils.NotFoundResponse(ctx, "Meeting, public user, or participant not found")
			return
		}
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, nil, "Left meeting successfully")
}

// GetPublicUserBySessionID handles getting a public user by ID
// @Summary Get public user by ID
// @Description Get a public user by their ID
// @Tags public-users
// @Produce json
// @Param id path string true "Public user ID"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/v1/public-users/{id} [get]
func (c *PublicUserController) GetPublicUserBySessionID(ctx *gin.Context) {
	sessionID := ctx.Param("session_id")

	if sessionID == "" {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_PUBLIC_USER_ID", "Invalid public user session ID")
		return
	}

	publicUser, err := c.publicUserService.GetPublicUserBySessionID(sessionID)
	if err != nil {
		if err.Error() == "public user not found" {
			utils.NotFoundResponse(ctx, "Public user not found")
			return
		}
		utils.InternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, publicUser.ToResponse(), "Public user retrieved successfully")
}
