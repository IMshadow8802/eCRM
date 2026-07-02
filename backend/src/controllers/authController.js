// src/controllers/authController.js
const database = require("../config/database");
const jwt = require("jsonwebtoken");
const { comparePassword, hashPassword } = require("../utils/encryption");

// SP returns menu rows in PascalCase (MenuId, ParentId, CanAdd, ...).
// We re-map to the camelCase shape the frontend already expects.
function mapMenuRow(item) {
  return {
    menuid: item.MenuId,
    parentid: item.ParentId,
    description: item.Description,
    image: item.Image,
    formname: item.FormName,
    formclass: item.FormClass,
    openStyle: item.OpenStyle,
    permissions: {
      canAdd: item.CanAdd === 1 || item.CanAdd === true,
      canEdit: item.CanEdit === 1 || item.CanEdit === true,
      canDelete: item.CanDelete === 1 || item.CanDelete === true,
      canView: item.CanView === 1 || item.CanView === true,
    },
    groupName: item.GroupName,
  };
}

function organizeMenuHierarchy(menuItems) {
  const menuMap = {};
  const rootItems = [];

  menuItems.forEach((item) => {
    menuMap[item.menuid] = { ...item, children: [] };
  });

  menuItems.forEach((item) => {
    if (item.parentid === 0) {
      rootItems.push(menuMap[item.menuid]);
    } else if (menuMap[item.parentid]) {
      menuMap[item.parentid].children.push(menuMap[item.menuid]);
    }
  });

  return rootItems;
}

class AuthController {
  async login(req, res) {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          message: "Username and password are required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      console.log(`🔐 Login attempt for: ${username}`);

      const result = await database.executeStoredProcedure("sp_ValidateUser", {
        username,
      });

      const spResponse = result.recordsets[0][0];
      const userPermissions = result.recordsets[1] || [];

      if (spResponse.ResponseCode === 200) {
        const isPasswordValid = await comparePassword(password, spResponse.Password);

        if (!isPasswordValid) {
          return res.status(401).json({
            success: false,
            message: "Incorrect password",
            code: "WRONG_PASSWORD",
            responseCode: 401,
            timestamp: new Date().toISOString(),
          });
        }

        const tokenPayload = {
          UserId: spResponse.UserId,
          UserName: spResponse.UserName,
          BranchId: spResponse.BranchId,
          CompId: spResponse.CompId,
          IsAdmin: spResponse.IsAdmin,
          FullName: spResponse.FullName,
          Email: spResponse.Email,
          JobTitle: spResponse.JobTitle,
        };

        const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
          expiresIn: process.env.JWT_EXPIRE || "24h",
        });

        const menuItems = userPermissions
          .filter((item) => item.MenuId !== null)
          .map(mapMenuRow);

        const organizedMenu = organizeMenuHierarchy(menuItems);

        return res.status(200).json({
          success: true,
          message: spResponse.ResponseMess,
          responseCode: spResponse.ResponseCode,
          data: {
            token,
            // Canonical PascalCase shape — matches tblUser columns and the
            // payload returned by /api/users/fetchUsers. Single shape everywhere.
            user: {
              Id: spResponse.UserId,
              Username: spResponse.UserName,
              FullName: spResponse.FullName,
              Email: spResponse.Email,
              JobTitle: spResponse.JobTitle,
              HourlyRate: spResponse.HourlyRate,
              BranchId: spResponse.BranchId,
              CompId: spResponse.CompId,
              IsAdmin: spResponse.IsAdmin,
              IsActive: spResponse.UserActive,
            },
            // Canonical PascalCase matching tblCompany columns.
            company: {
              CompId: spResponse.CompId,
              CompName: spResponse.CompName,
              CompAddress: spResponse.CompAddress,
              CompPhone: spResponse.CompPhone,
              CompState: spResponse.CompState,
              CompStateCode: spResponse.CompStateCode,
              CompEmail: spResponse.CompEmail,
              CompWebSite: spResponse.CompWebSite,
              CompGSTIN: spResponse.CompGSTIN,
            },
            permissions: {
              menuItems: organizedMenu,
              rawPermissions: menuItems,
              totalMenuItems: menuItems.length,
              hasAdminAccess:
                spResponse.IsAdmin === 1 || spResponse.IsAdmin === true,
            },
          },
          timestamp: new Date().toISOString(),
        });
      } else {
        const codeByResponse = {
          404: "USER_NOT_FOUND",
          403: "USER_INACTIVE",
        };
        return res.status(spResponse.ResponseCode).json({
          success: false,
          message: spResponse.ResponseMess,
          code: codeByResponse[spResponse.ResponseCode] || "INVALID_CREDENTIALS",
          responseCode: spResponse.ResponseCode,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error("Login error:", err);
      return res.status(500).json({
        success: false,
        message: "Login failed due to server error",
        code: "LOGIN_ERROR",
        responseCode: 500,
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async getUserPermissions(req, res) {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const tokenUser = req.user;

      if (!tokenUser.IsAdmin && tokenUser.UserId !== parseInt(userId)) {
        return res.status(403).json({
          success: false,
          message: "Access denied - can only view own permissions",
          code: "ACCESS_DENIED",
          responseCode: 403,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure("sp_FetchMenu", {
        Id: 0,
        UserId: userId,
        ParentId: null,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
        const menuItems = result.recordsets[0]
          .filter((item) => item.MenuId !== null)
          .map(mapMenuRow);

        return res.status(200).json({
          success: true,
          message: "Permissions retrieved successfully",
          responseCode: 200,
          data: {
            userId: parseInt(userId),
            menuItems: organizeMenuHierarchy(menuItems),
            totalItems: menuItems.length,
          },
          timestamp: new Date().toISOString(),
        });
      } else {
        return res.status(404).json({
          success: false,
          message: "User permissions not found",
          code: "NOT_FOUND",
          responseCode: 404,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error("Get permissions error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve permissions",
        code: "PERMISSIONS_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async hashPassword(req, res) {
    try {
      const { password } = req.body;

      if (!password) {
        return res.status(400).json({
          success: false,
          message: "Password is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const hashedPassword = await hashPassword(password);

      return res.status(200).json({
        success: true,
        message: "Password hashed successfully",
        responseCode: 200,
        data: {
          originalPassword: password,
          hashedPassword,
          usage: `UPDATE tblUser SET password = '${hashedPassword}' WHERE userid = YOUR_USER_ID;`,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Hash password error:", err);
      return res.status(500).json({
        success: false,
        message: "Password hashing failed",
        code: "HASH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async logout(req, res) {
    try {
      return res.status(200).json({
        success: true,
        message: "Logout successful",
        responseCode: 200,
        data: {
          message: "Token invalidated on client side",
          logoutTime: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Logout failed",
        code: "LOGOUT_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async refreshToken(req, res) {
    try {
      const tokenUser = req.user;

      const newTokenPayload = {
        UserId: tokenUser.UserId,
        UserName: tokenUser.UserName,
        BranchId: tokenUser.BranchId,
        CompId: tokenUser.CompId,
        IsAdmin: tokenUser.IsAdmin,
        FullName: tokenUser.FullName,
        Email: tokenUser.Email,
        JobTitle: tokenUser.JobTitle,
      };

      const newToken = jwt.sign(newTokenPayload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || "24h",
      });

      return res.status(200).json({
        success: true,
        message: "Token refreshed successfully",
        responseCode: 200,
        data: {
          token: newToken,
          expiresIn: process.env.JWT_EXPIRE || "24h",
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Refresh token error:", err);
      return res.status(500).json({
        success: false,
        message: "Token refresh failed",
        code: "TOKEN_REFRESH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

module.exports = new AuthController();
