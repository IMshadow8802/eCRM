const database = require("../config/database");
const { cleanSpRows } = require("../utils/spHelpers");

class NotificationController {
  async fetch(req, res) {
    try {
      const {
        UnreadOnly = false,
        PageNumber = 1,
        PageSize = 25,
        SearchTerm = null,
      } = req.body;

      const result = await database.executeStoredProcedure(
        "sp_FetchNotifications",
        {
          UserId: req.user.UserId,
          UnreadOnly: UnreadOnly ? 1 : 0,
          PageNumber,
          PageSize,
          SearchTerm,
        },
      );

      const spResponse = result.recordsets[0][0];
      const notifications = cleanSpRows(result.recordsets[0]);

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: {
          notifications,
          unreadCount: spResponse.UnreadCount ?? 0,
          pagination: {
            currentPage: spResponse.CurrentPage,
            pageSize: spResponse.PageSize,
            totalRecords: spResponse.TotalRecords,
            totalPages: spResponse.TotalPages,
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Fetch notifications error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch notifications",
        code: "NOTIFICATION_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async markRead(req, res) {
    try {
      const { Id } = req.body;
      if (!Id) {
        return res.status(400).json({
          success: false,
          message: "Notification Id is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_MarkNotificationRead",
        { Id, UserId: req.user.UserId },
      );

      const spResponse = result.recordsets[0][0];
      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Mark notification read error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to mark notification as read",
        code: "NOTIFICATION_MARK_READ_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async markAllRead(req, res) {
    try {
      const result = await database.executeStoredProcedure(
        "sp_MarkAllNotificationsRead",
        { UserId: req.user.UserId },
      );
      const spResponse = result.recordsets[0][0];
      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: { updatedCount: spResponse.UpdatedCount ?? 0 },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Mark all notifications read error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to mark notifications as read",
        code: "NOTIFICATION_MARK_ALL_READ_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

module.exports = new NotificationController();
