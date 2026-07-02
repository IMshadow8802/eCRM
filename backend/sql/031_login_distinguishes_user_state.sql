-- ============================================================
-- 031: sp_ValidateUser distinguishes "username not found" vs
-- "account inactive" so the login API can surface the precise
-- reason instead of a single conflated 401.
--
-- Response codes:
--   200 → row found and active        (Password hash returned for bcrypt compare)
--   403 → row found but IsActive = 0  (Account is inactive)
--   404 → no row for that Username    (Username does not exist)
--
-- The controller layers a 401/WRONG_PASSWORD response on top of 200
-- when bcrypt.compare rejects the supplied password.
-- ============================================================
USE [eCRM+]
GO
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

IF OBJECT_ID(N'dbo.sp_ValidateUser', N'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_ValidateUser;
GO

CREATE PROC dbo.sp_ValidateUser
    @username VARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @UserId INT;
    DECLARE @IsActive BIT;

    SELECT TOP 1 @UserId = Id, @IsActive = IsActive
    FROM tblUser
    WHERE Username = @username;

    IF @UserId IS NULL
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'Username does not exist';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS UserId, NULL AS UserName, NULL AS Password, NULL AS UserActive, NULL AS IsAdmin,
               NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
               NULL AS CompId, NULL AS BranchId,
               NULL AS CompName, NULL AS CompAddress, NULL AS CompPhone, NULL AS CompState,
               NULL AS CompStateCode, NULL AS CompEmail, NULL AS CompWebSite, NULL AS CompGSTIN;

        SELECT NULL AS MenuId, NULL AS ParentId, NULL AS Description, NULL AS Image,
               NULL AS FormId, NULL AS MenuType, NULL AS ActualId, NULL AS IsAllowed,
               NULL AS FormName, NULL AS FormClass, NULL AS OpenStyle,
               NULL AS CanAdd, NULL AS CanEdit, NULL AS CanDelete, NULL AS CanView,
               NULL AS GroupName
        WHERE 1 = 0;
        RETURN;
    END

    IF @IsActive = 0
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Account is inactive';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS UserId, NULL AS UserName, NULL AS Password, NULL AS UserActive, NULL AS IsAdmin,
               NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
               NULL AS CompId, NULL AS BranchId,
               NULL AS CompName, NULL AS CompAddress, NULL AS CompPhone, NULL AS CompState,
               NULL AS CompStateCode, NULL AS CompEmail, NULL AS CompWebSite, NULL AS CompGSTIN;

        SELECT NULL AS MenuId, NULL AS ParentId, NULL AS Description, NULL AS Image,
               NULL AS FormId, NULL AS MenuType, NULL AS ActualId, NULL AS IsAllowed,
               NULL AS FormName, NULL AS FormClass, NULL AS OpenStyle,
               NULL AS CanAdd, NULL AS CanEdit, NULL AS CanDelete, NULL AS CanView,
               NULL AS GroupName
        WHERE 1 = 0;
        RETURN;
    END

    SET @ResponseCode = 200;
    SET @ResponseMess = 'User found successfully';

    SELECT @ResponseCode AS ResponseCode,
           @ResponseMess AS ResponseMess,
           u.Id       AS UserId,
           u.Username AS UserName,
           u.Password AS Password,
           u.IsActive AS UserActive,
           u.IsAdmin  AS IsAdmin,
           u.FullName, u.Email, u.JobTitle, u.HourlyRate, u.CompId, u.BranchId,
           'Your Company Name'  AS CompName,
           'Company Address'    AS CompAddress,
           'Company Phone'      AS CompPhone,
           'State'              AS CompState,
           'ST'                 AS CompStateCode,
           'company@email.com'  AS CompEmail,
           'www.company.com'    AS CompWebSite,
           'GSTIN123456789'     AS CompGSTIN
    FROM tblUser u
    WHERE u.Id = @UserId;

    SELECT DISTINCT
           m.Id          AS MenuId,
           m.ParentId, m.Description, m.Image, m.FormId, m.MenuType, m.ActualId,
           m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle,
           ga.CanAdd, ga.CanEdit, ga.CanDelete, ga.CanView,
           ug.Name AS GroupName
    FROM tblMenu m
    INNER JOIN tblGroupAccess ga    ON m.Id = ga.MenuId
    INNER JOIN tblUserGroupMap ugm  ON ga.GroupId = ugm.GroupId
    INNER JOIN tblUserGroups ug     ON ugm.GroupId = ug.Id
    WHERE ugm.UserId = @UserId
      AND m.IsAllowed = 1
      AND ga.CanView = 1
      AND ug.IsActive = 1
    ORDER BY m.ParentId, m.Id;
END
GO
