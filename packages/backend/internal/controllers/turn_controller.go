// TEMPORARILY DISABLED FOR EMERGENCY WEBSOCKET FIX
// All TURN functionality disabled to resolve compilation issues
// This will be re-enabled once WebSocket client explosion is fixed

package controllers

// import (
// 	"net/http"
// 	"time"

// 	"github.com/gin-gonic/gin"
// 	"github.com/google/uuid"
// 	"github.com/sirupsen/logrus"

// 	"github.com/your-org/gomeet/packages/backend/internal/services"
// 	"github.com/your-org/gomeet/packages/backend/internal/utils"
// )

// type TurnController struct {
// 	turnService *services.TurnService
// 	logger      *logrus.Logger
// }

// func NewTurnController(turnService *services.TurnService) *TurnController {
// 	logger := logrus.New()
// 	logger.SetLevel(logrus.InfoLevel)

// 	return &TurnController{
// 		turnService: turnService,
// 		logger:      logger,
// 	}
// }

// All methods temporarily disabled for emergency WebSocket fix