-- 109_attendance_sessions.sql — Attendance report v2 + "online" minutes. Two read-only
-- procs, column additions only; no table or data changes.
--   1. sp_FetchAttendanceRange: RS2 also returns tblPresenceDay.SignedOutAt, so the report
--      can count "Left early" (signed out before shift end, no session still open that day).
--      Until applied, LeftEarly is always 0.
--   2. sp_FetchSessionsRange (from 108): also returns tblUserSession.EndReason. A 'logout'
--      session's online time runs to EndedAt (utils/sessionDay.js); others to the last
--      heartbeat. Until applied, every session ends at its last heartbeat (old behaviour).
-- Apply on TestCRM first, then eCRM+ and SolarCRM once checked (after 108).
-- Apply: sqlcmd -I -S <server> -d TestCRM -i 109_attendance_sessions.sql
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

-- ===========================================================================
-- 1. sp_FetchAttendanceRange
-- ===========================================================================
-- Attendance report inputs. Node counts working days (calendar, holidays, leave,
-- go-live) with workCalendar.js. @UserIdsJson: NULL = everyone, '[]' = nobody.
-- RS1 people (active, not presence-exempt), RS2 their presence rows in range,
-- RS3 one row of settings.
CREATE OR ALTER PROCEDURE dbo.sp_FetchAttendanceRange
    @CompId      BIGINT,
    @FromDate    DATE,
    @ToDate      DATE,
    @UserIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @UserIdsJson IS NOT NULL AND ISJSON(@UserIdsJson) = 0
    BEGIN RAISERROR('sp_FetchAttendanceRange: invalid UserIdsJson', 16, 1); RETURN; END

    DECLARE @Ids TABLE (UserId INT PRIMARY KEY);
    INSERT INTO @Ids (UserId)
    SELECT DISTINCT TRY_CAST(value AS INT) FROM OPENJSON(ISNULL(@UserIdsJson, N'[]'))
    WHERE TRY_CAST(value AS INT) IS NOT NULL;

    DECLARE @U TABLE (UserId INT PRIMARY KEY, FullName NVARCHAR(200), BranchId BIGINT, ManagerId INT, CreatedDate DATETIME);
    INSERT INTO @U (UserId, FullName, BranchId, ManagerId, CreatedDate)
    SELECT u.Id, u.FullName, u.BranchId, u.ReportsTo, u.CreatedDate
    FROM dbo.tblUser u
    WHERE u.CompId = @CompId AND u.IsActive = 1 AND ISNULL(u.PresenceExempt, 0) = 0
      AND (@UserIdsJson IS NULL OR u.Id IN (SELECT UserId FROM @Ids));

    SELECT UserId, FullName, BranchId, ManagerId, CreatedDate FROM @U ORDER BY FullName;

    SELECT p.UserId, p.WorkDate, p.FirstSignInAt, p.LateMinutes, p.NotSignedInAt, p.SignedOutAt
    FROM dbo.tblPresenceDay p
    JOIN @U x ON x.UserId = p.UserId
    WHERE p.CompId = @CompId AND p.WorkDate >= @FromDate AND p.WorkDate <= @ToDate
    ORDER BY p.UserId, p.WorkDate;

    SELECT s.GoLiveDate, ISNULL(s.LateGraceMin, 10) AS LateGraceMin
    FROM (SELECT 1 AS x) d
    LEFT JOIN dbo.tblCompanySetting s ON s.CompId = @CompId;
END
GO

-- ===========================================================================
-- 2. sp_FetchSessionsRange — raw sessions touching [@FromDate, @ToDate].
--    Node merges overlaps and clips to each day (utils/sessionDay.js).
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_FetchSessionsRange
    @CompId      BIGINT,
    @FromDate    DATE,
    @ToDate      DATE,
    @UserIdsJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @From DATETIME = CAST(@FromDate AS DATETIME);
    DECLARE @To   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    SELECT s.UserId, s.Device, s.StartedAt, s.LastSeenAt, s.EndedAt, s.EndReason
    FROM dbo.tblUserSession s
    WHERE s.CompId = @CompId
      AND s.UserId IN (SELECT TRY_CAST(value AS INT) FROM OPENJSON(ISNULL(@UserIdsJson, N'[]')))
      AND s.StartedAt < @To
      AND COALESCE(s.EndedAt, s.LastSeenAt, s.StartedAt) >= @From
    ORDER BY s.UserId, s.StartedAt;
END
GO

-- Verify after apply: expect HasSignedOut = 1, HasEndReason = 1.
-- SELECT
--   CASE WHEN OBJECT_DEFINITION(OBJECT_ID('dbo.sp_FetchAttendanceRange')) LIKE '%p.SignedOutAt%' THEN 1 ELSE 0 END AS HasSignedOut,
--   CASE WHEN OBJECT_DEFINITION(OBJECT_ID('dbo.sp_FetchSessionsRange'))  LIKE '%s.EndReason%'   THEN 1 ELSE 0 END AS HasEndReason;
-- EXEC dbo.sp_FetchSessionsRange @CompId = 1, @FromDate = '2026-10-10', @ToDate = '2026-10-10', @UserIdsJson = N'[24]';  -- EndReason column present
