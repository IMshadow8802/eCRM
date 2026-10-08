-- 099_presence.sql — P2 of docs/superpowers/specs/2026-10-07-task-tat-presence-design.md §5:
-- work calendar, company settings, holidays, day marks, sessions, presence; plus lows L1.
-- Additive and backward compatible: safe to apply while the old Node is running.
-- Apply (both DBs): sqlcmd ... -C -b -I -i sql/099_presence.sql
-- Idempotent (safe to apply twice). Verify-after-apply block at the end.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

-- 1. Schema ---------------------------------------------------------------
IF OBJECT_ID('dbo.tblCompanySetting') IS NULL
CREATE TABLE dbo.tblCompanySetting (
    CompId            BIGINT       NOT NULL PRIMARY KEY,
    LateGraceMin      INT          NOT NULL CONSTRAINT DF_tblCompanySetting_Grace  DEFAULT 10,
    SessionBufferMin  INT          NOT NULL CONSTRAINT DF_tblCompanySetting_Buffer DEFAULT 120,
    WarnPct           INT          NOT NULL CONSTRAINT DF_tblCompanySetting_Warn   DEFAULT 80,
    NotifyNotSignedIn BIT          NOT NULL CONSTRAINT DF_tblCompanySetting_Notify DEFAULT 1,
    GoLiveDate        DATE         NULL,
    UpdatedAt         DATETIME     NOT NULL CONSTRAINT DF_tblCompanySetting_Upd    DEFAULT GETDATE()
);

IF OBJECT_ID('dbo.tblWorkCalendar') IS NULL
CREATE TABLE dbo.tblWorkCalendar (
    Id        INT IDENTITY(1,1) PRIMARY KEY,
    CompId    BIGINT        NOT NULL,
    Name      NVARCHAR(60)  NOT NULL,
    DaysJson  NVARCHAR(MAX) NOT NULL,
    IsDefault BIT           NOT NULL CONSTRAINT DF_tblWorkCalendar_Def DEFAULT 0,
    CreatedAt DATETIME      NOT NULL CONSTRAINT DF_tblWorkCalendar_Cr  DEFAULT GETDATE(),
    CONSTRAINT UQ_tblWorkCalendar_Name UNIQUE (CompId, Name)
);

IF OBJECT_ID('dbo.tblHoliday') IS NULL
CREATE TABLE dbo.tblHoliday (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    CompId      BIGINT       NOT NULL,
    BranchId    BIGINT       NULL,
    HolidayDate DATE         NOT NULL,
    Name        NVARCHAR(80) NOT NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblHoliday_Day')
CREATE UNIQUE INDEX UX_tblHoliday_Day ON dbo.tblHoliday (CompId, HolidayDate, BranchId);

IF OBJECT_ID('dbo.tblUserDayMark') IS NULL
CREATE TABLE dbo.tblUserDayMark (
    Id       BIGINT IDENTITY(1,1) PRIMARY KEY,
    CompId   BIGINT        NOT NULL,
    UserId   INT           NOT NULL,
    WorkDate DATE          NOT NULL,
    Part     VARCHAR(12)   NOT NULL CONSTRAINT CK_tblUserDayMark_Part CHECK (Part IN ('full','first_half','second_half')),
    Kind     VARCHAR(10)   NOT NULL CONSTRAINT CK_tblUserDayMark_Kind CHECK (Kind IN ('leave','on_duty')),
    Remarks  NVARCHAR(300) NULL,
    MarkedBy INT           NOT NULL,
    MarkedAt DATETIME      NOT NULL CONSTRAINT DF_tblUserDayMark_At DEFAULT GETDATE(),
    CONSTRAINT UQ_tblUserDayMark UNIQUE (UserId, WorkDate)
);

IF OBJECT_ID('dbo.tblUserSession') IS NULL
CREATE TABLE dbo.tblUserSession (
    SessionId  UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    CompId     BIGINT        NOT NULL,
    UserId     INT           NOT NULL,
    Device     VARCHAR(10)   NOT NULL,          -- web | mobile
    Ip         VARCHAR(64)   NULL,
    UserAgent  NVARCHAR(300) NULL,
    StartedAt  DATETIME      NOT NULL CONSTRAINT DF_tblUserSession_Start DEFAULT GETDATE(),
    LastSeenAt DATETIME      NOT NULL CONSTRAINT DF_tblUserSession_Seen  DEFAULT GETDATE(),
    ExpiresAt  DATETIME      NOT NULL,
    EndedAt    DATETIME      NULL,
    EndReason  VARCHAR(10)   NULL               -- logout | expired | forced
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblUserSession_User')
CREATE INDEX IX_tblUserSession_User ON dbo.tblUserSession (UserId, EndedAt) INCLUDE (LastSeenAt, ExpiresAt);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblUserSession_Sweep')
CREATE INDEX IX_tblUserSession_Sweep ON dbo.tblUserSession (CompId, EndedAt, ExpiresAt);

IF OBJECT_ID('dbo.tblPresenceDay') IS NULL
CREATE TABLE dbo.tblPresenceDay (
    Id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    CompId        BIGINT   NOT NULL,
    UserId        INT      NOT NULL,
    WorkDate      DATE     NOT NULL,
    ShiftStart    DATETIME NULL,
    ShiftEnd      DATETIME NULL,
    FirstSignInAt DATETIME NULL,
    LateMinutes   INT      NULL,
    SignedOutAt   DATETIME NULL,
    NotSignedInAt DATETIME NULL,
    ManagerId     INT      NULL,
    BranchId      BIGINT   NULL,
    CONSTRAINT UQ_tblPresenceDay UNIQUE (UserId, WorkDate)
);

IF COL_LENGTH('dbo.tblUser', 'WorkCalendarId') IS NULL ALTER TABLE dbo.tblUser ADD WorkCalendarId INT NULL;
IF COL_LENGTH('dbo.tblUser', 'PresenceNoticeAt') IS NULL ALTER TABLE dbo.tblUser ADD PresenceNoticeAt DATETIME NULL;
-- Owners are presence-exempt (spec §5: no presence marks; task clocks still run).
-- Set only on the apply that adds the column, so a re-run never undoes an admin's later edit.
-- Matched on the stock admin role named 'Owner' (tblUserGroups.Name).
IF COL_LENGTH('dbo.tblUser', 'PresenceExempt') IS NULL
BEGIN
    ALTER TABLE dbo.tblUser ADD PresenceExempt BIT NOT NULL CONSTRAINT DF_tblUser_PresenceExempt DEFAULT 0;
    EXEC (N'UPDATE u SET PresenceExempt = 1
              FROM dbo.tblUser u
             WHERE EXISTS (SELECT 1 FROM dbo.tblUserGroupMap m
                             JOIN dbo.tblUserGroups g ON g.Id = m.GroupId
                            WHERE m.UserId = u.Id AND g.CompId = u.CompId
                              AND g.Name = ''Owner'' AND g.IsAdmin = 1 AND g.IsActive = 1);');
END
GO

-- 2. Seeds: one settings row + the "Standard" shift per company -----------
--    Go-live is the day after apply; admins can move it (NULL = feature off).
INSERT INTO dbo.tblCompanySetting (CompId, GoLiveDate)
SELECT c.CompId, DATEADD(DAY, 1, CAST(GETDATE() AS DATE))
FROM (SELECT DISTINCT CompId FROM dbo.tblUser WHERE CompId IS NOT NULL) c
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblCompanySetting s WHERE s.CompId = c.CompId);

-- Mon–Sat 09:00–18:00, lunch 13:00–14:00 (= workCalendar.DEFAULT_DAYS).
INSERT INTO dbo.tblWorkCalendar (CompId, Name, DaysJson, IsDefault)
SELECT c.CompId, N'Standard',
       N'[{"d":0,"on":false},'
     + N'{"d":1,"on":true,"start":"09:00","end":"18:00","breakStart":"13:00","breakEnd":"14:00"},'
     + N'{"d":2,"on":true,"start":"09:00","end":"18:00","breakStart":"13:00","breakEnd":"14:00"},'
     + N'{"d":3,"on":true,"start":"09:00","end":"18:00","breakStart":"13:00","breakEnd":"14:00"},'
     + N'{"d":4,"on":true,"start":"09:00","end":"18:00","breakStart":"13:00","breakEnd":"14:00"},'
     + N'{"d":5,"on":true,"start":"09:00","end":"18:00","breakStart":"13:00","breakEnd":"14:00"},'
     + N'{"d":6,"on":true,"start":"09:00","end":"18:00","breakStart":"13:00","breakEnd":"14:00"}]',
       1
FROM (SELECT DISTINCT CompId FROM dbo.tblUser WHERE CompId IS NOT NULL) c
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblWorkCalendar w WHERE w.CompId = c.CompId AND w.IsDefault = 1)
  AND NOT EXISTS (SELECT 1 FROM dbo.tblWorkCalendar w WHERE w.CompId = c.CompId AND w.Name = N'Standard');
GO

-- 3. 'attendance' module grant (D9: company-wide presence for non-admins).
--    Every existing value kept; Reach stays NULL for it (CK_tblGroupModule_Reach).
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = 'CK_tblGroupModule_Module' AND definition LIKE '%''attendance''%')
BEGIN
    BEGIN TRAN;
    IF OBJECT_ID('dbo.CK_tblGroupModule_Module', 'C') IS NOT NULL
        ALTER TABLE dbo.tblGroupModule DROP CONSTRAINT CK_tblGroupModule_Module;
    ALTER TABLE dbo.tblGroupModule WITH CHECK ADD CONSTRAINT CK_tblGroupModule_Module
        CHECK (Module IN ('leads','sales_reports','complaints','support_reports',
                          'customers','people','tasks','teams','projects','settings','dashboard','attendance'));
    COMMIT;
END
GO

-- 4. Menus. Sidebar order is ParentId, Id, so "Today" takes free Id 3 (top
--    level, after Tasks, before My Work 49) when it is free; else it is appended.
IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = '/today')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Id = 3)
    BEGIN
        SET IDENTITY_INSERT dbo.tblMenu ON;
        INSERT INTO dbo.tblMenu (Id, ParentId, Description, IsAllowed, Route, Module)
        VALUES (3, 0, 'Today', 1, '/today', 'tasks');
        SET IDENTITY_INSERT dbo.tblMenu OFF;
    END
    ELSE
        INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route, Module)
        VALUES (0, 'Today', 1, '/today', 'tasks');
END

IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = '/settings/work-calendar')
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route, Module)
    VALUES (26, 'Work calendar', 1, '/settings/work-calendar', 'settings');
GO

-- ===========================================================================
-- 5. Work settings: company settings, shifts, holidays
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_FetchWorkSettings
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    -- RS1 always one row (defaults when the company has no settings row yet).
    SELECT ISNULL(s.LateGraceMin, 10)                   AS LateGraceMin,
           ISNULL(s.SessionBufferMin, 120)              AS SessionBufferMin,
           ISNULL(s.WarnPct, 80)                        AS WarnPct,
           ISNULL(s.NotifyNotSignedIn, CAST(1 AS BIT))  AS NotifyNotSignedIn,
           s.GoLiveDate
    FROM (SELECT 1 AS x) d
    LEFT JOIN dbo.tblCompanySetting s ON s.CompId = @CompId;

    -- RS2 shifts. The default also counts users with no shift of their own.
    SELECT w.Id, w.Name, w.IsDefault, w.DaysJson,
           (SELECT COUNT(*) FROM dbo.tblUser u
             WHERE u.CompId = @CompId AND u.IsActive = 1
               AND (u.WorkCalendarId = w.Id OR (w.IsDefault = 1 AND u.WorkCalendarId IS NULL))) AS UserCount
    FROM dbo.tblWorkCalendar w
    WHERE w.CompId = @CompId
    ORDER BY w.IsDefault DESC, w.Name;

    -- RS3 holidays from a year ago onward.
    SELECT h.Id, h.HolidayDate, h.Name, h.BranchId, b.BranchName
    FROM dbo.tblHoliday h
    LEFT JOIN dbo.tblBranch b ON b.Id = h.BranchId
    WHERE h.CompId = @CompId
      AND h.HolidayDate >= DATEADD(YEAR, -1, CAST(GETDATE() AS DATE))
    ORDER BY h.HolidayDate;

    -- RS4 TAT policy: empty until 100 replaces this proc.
    SELECT CAST(NULL AS VARCHAR(30)) AS Priority, CAST(NULL AS INT) AS Minutes WHERE 1 = 0;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_SaveCompanySetting
    @CompId            BIGINT,
    @LateGraceMin      INT,
    @SessionBufferMin  INT,
    @WarnPct           INT,
    @NotifyNotSignedIn BIT,
    @GoLiveDate        DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @LateGraceMin IS NULL OR @LateGraceMin NOT BETWEEN 0 AND 120
    BEGIN SELECT 400 AS ResponseCode, 'Late grace must be 0 to 120 minutes' AS ResponseMess; RETURN; END
    IF @SessionBufferMin IS NULL OR @SessionBufferMin NOT BETWEEN 0 AND 480
    BEGIN SELECT 400 AS ResponseCode, 'Session buffer must be 0 to 480 minutes' AS ResponseMess; RETURN; END
    IF @WarnPct IS NULL OR @WarnPct NOT BETWEEN 50 AND 95
    BEGIN SELECT 400 AS ResponseCode, 'Warn at must be 50 to 95 percent' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        UPDATE dbo.tblCompanySetting WITH (UPDLOCK, HOLDLOCK)
           SET LateGraceMin = @LateGraceMin, SessionBufferMin = @SessionBufferMin, WarnPct = @WarnPct,
               NotifyNotSignedIn = ISNULL(@NotifyNotSignedIn, 1), GoLiveDate = @GoLiveDate, UpdatedAt = GETDATE()
         WHERE CompId = @CompId;
        IF @@ROWCOUNT = 0
            INSERT INTO dbo.tblCompanySetting (CompId, LateGraceMin, SessionBufferMin, WarnPct, NotifyNotSignedIn, GoLiveDate)
            VALUES (@CompId, @LateGraceMin, @SessionBufferMin, @WarnPct, ISNULL(@NotifyNotSignedIn, 1), @GoLiveDate);
        COMMIT;
        SELECT 200 AS ResponseCode, 'Settings saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_SaveWorkCalendar
    @Id        INT,
    @CompId    BIGINT,
    @Name      NVARCHAR(60),
    @DaysJson  NVARCHAR(MAX),          -- validated in Node (workCalendar.parseDays)
    @IsDefault BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET @Name = LTRIM(RTRIM(@Name));

    IF ISNULL(@Name, N'') = N'' OR ISNULL(@DaysJson, N'') = N''
    BEGIN SELECT 400 AS ResponseCode, 'Name and days are required' AS ResponseMess, ISNULL(@Id, 0) AS Id; RETURN; END
    IF ISNULL(@Id, 0) > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblWorkCalendar WHERE Id = @Id AND CompId = @CompId)
    BEGIN SELECT 404 AS ResponseCode, 'Shift not found' AS ResponseMess, @Id AS Id; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.tblWorkCalendar WHERE CompId = @CompId AND Name = @Name AND Id <> ISNULL(@Id, 0))
    BEGIN SELECT 409 AS ResponseCode, 'A shift with this name already exists' AS ResponseMess, ISNULL(@Id, 0) AS Id; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        IF ISNULL(@Id, 0) = 0
        BEGIN
            INSERT INTO dbo.tblWorkCalendar (CompId, Name, DaysJson, IsDefault)
            VALUES (@CompId, @Name, @DaysJson, ISNULL(@IsDefault, 0));
            SET @Id = SCOPE_IDENTITY();
        END
        ELSE
            -- The default can only be moved (by making another default), never unset.
            UPDATE dbo.tblWorkCalendar
               SET Name = @Name, DaysJson = @DaysJson,
                   IsDefault = CASE WHEN ISNULL(@IsDefault, 0) = 1 OR IsDefault = 1 THEN 1 ELSE 0 END
             WHERE Id = @Id AND CompId = @CompId;

        IF ISNULL(@IsDefault, 0) = 1
            UPDATE dbo.tblWorkCalendar SET IsDefault = 0 WHERE CompId = @CompId AND Id <> @Id AND IsDefault = 1;
        COMMIT;
        SELECT 200 AS ResponseCode, 'Shift saved' AS ResponseMess, @Id AS Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        IF ERROR_NUMBER() IN (2627, 2601)
            SELECT 409 AS ResponseCode, 'A shift with this name already exists' AS ResponseMess, ISNULL(@Id, 0) AS Id;
        ELSE
            SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess, ISNULL(@Id, 0) AS Id;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_DeleteWorkCalendar
    @Id     INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @IsDefault BIT;
    SELECT @IsDefault = IsDefault FROM dbo.tblWorkCalendar WHERE Id = @Id AND CompId = @CompId;

    IF @IsDefault IS NULL
    BEGIN SELECT 404 AS ResponseCode, 'Shift not found' AS ResponseMess; RETURN; END
    IF @IsDefault = 1
    BEGIN SELECT 409 AS ResponseCode, 'The company default shift cannot be deleted' AS ResponseMess; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.tblUser WHERE CompId = @CompId AND WorkCalendarId = @Id)
    BEGIN SELECT 409 AS ResponseCode, 'People still follow this shift; move them first' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        DELETE FROM dbo.tblWorkCalendar WHERE Id = @Id AND CompId = @CompId;
        COMMIT;
        SELECT 200 AS ResponseCode, 'Shift deleted' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_SaveHoliday
    @Id          INT,
    @CompId      BIGINT,
    @HolidayDate DATE,
    @Name        NVARCHAR(80),
    @BranchId    BIGINT = NULL        -- NULL = whole company
AS
BEGIN
    SET NOCOUNT ON;
    SET @Name = LTRIM(RTRIM(@Name));
    IF @BranchId = 0 SET @BranchId = NULL;

    IF @HolidayDate IS NULL OR ISNULL(@Name, N'') = N''
    BEGIN SELECT 400 AS ResponseCode, 'Date and name are required' AS ResponseMess, ISNULL(@Id, 0) AS Id; RETURN; END
    -- tblBranch has no CompId (one company per database): an existing, active office is the check.
    IF @BranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblBranch WHERE Id = @BranchId AND IsActive = 1)
    BEGIN SELECT 400 AS ResponseCode, 'Unknown or inactive office' AS ResponseMess, ISNULL(@Id, 0) AS Id; RETURN; END
    IF ISNULL(@Id, 0) > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblHoliday WHERE Id = @Id AND CompId = @CompId)
    BEGIN SELECT 404 AS ResponseCode, 'Holiday not found' AS ResponseMess, @Id AS Id; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.tblHoliday
                WHERE CompId = @CompId AND HolidayDate = @HolidayDate
                  AND ISNULL(BranchId, -1) = ISNULL(@BranchId, -1) AND Id <> ISNULL(@Id, 0))
    BEGIN SELECT 409 AS ResponseCode, 'A holiday already exists on this date' AS ResponseMess, ISNULL(@Id, 0) AS Id; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        IF ISNULL(@Id, 0) = 0
        BEGIN
            INSERT INTO dbo.tblHoliday (CompId, BranchId, HolidayDate, Name)
            VALUES (@CompId, @BranchId, @HolidayDate, @Name);
            SET @Id = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.tblHoliday SET BranchId = @BranchId, HolidayDate = @HolidayDate, Name = @Name
             WHERE Id = @Id AND CompId = @CompId;
        COMMIT;
        SELECT 200 AS ResponseCode, 'Holiday saved' AS ResponseMess, @Id AS Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        IF ERROR_NUMBER() IN (2627, 2601)
            SELECT 409 AS ResponseCode, 'A holiday already exists on this date' AS ResponseMess, ISNULL(@Id, 0) AS Id;
        ELSE
            SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess, ISNULL(@Id, 0) AS Id;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_DeleteHoliday
    @Id     INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRAN;
        DELETE FROM dbo.tblHoliday WHERE Id = @Id AND CompId = @CompId;
        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK;
            SELECT 404 AS ResponseCode, 'Holiday not found' AS ResponseMess;
            RETURN;
        END
        COMMIT;
        SELECT 200 AS ResponseCode, 'Holiday deleted' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_SetUserWorkProfile
    @UserId         INT,
    @CompId         BIGINT,
    @WorkCalendarId INT = NULL,       -- NULL = keep, 0 = company default (stored as NULL)
    @PresenceExempt BIT = NULL        -- NULL = keep
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId)
    BEGIN SELECT 404 AS ResponseCode, 'User not found' AS ResponseMess; RETURN; END
    IF ISNULL(@WorkCalendarId, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.tblWorkCalendar WHERE Id = @WorkCalendarId AND CompId = @CompId)
    BEGIN SELECT 404 AS ResponseCode, 'Shift not found' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        UPDATE dbo.tblUser
           SET WorkCalendarId = CASE WHEN @WorkCalendarId IS NULL THEN WorkCalendarId
                                     WHEN @WorkCalendarId = 0 THEN NULL
                                     ELSE @WorkCalendarId END,
               PresenceExempt = ISNULL(@PresenceExempt, PresenceExempt)
         WHERE Id = @UserId AND CompId = @CompId;
        COMMIT;
        SELECT 200 AS ResponseCode, 'Work profile saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess;
    END CATCH
END
GO

-- Everything workCalendar.js needs to compute shifts for a set of people.
CREATE OR ALTER PROCEDURE dbo.sp_FetchCalendarContext
    @CompId      BIGINT,
    @UserIdsJson NVARCHAR(MAX),
    @FromDate    DATE,
    @ToDate      DATE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Ids TABLE (UserId INT PRIMARY KEY);
    INSERT INTO @Ids (UserId)
    SELECT DISTINCT TRY_CAST(value AS INT) FROM OPENJSON(ISNULL(@UserIdsJson, N'[]'))
    WHERE TRY_CAST(value AS INT) IS NOT NULL;

    DECLARE @DefaultId INT = (SELECT TOP 1 Id FROM dbo.tblWorkCalendar
                               WHERE CompId = @CompId AND IsDefault = 1 ORDER BY Id);

    DECLARE @Users TABLE (UserId INT PRIMARY KEY, CalendarId INT, BranchId BIGINT, PresenceExempt BIT, ReportsTo INT);
    INSERT INTO @Users
    SELECT u.Id,
           -- a shift id pointing outside the company falls back to the default
           CASE WHEN w.Id IS NOT NULL THEN w.Id ELSE @DefaultId END,
           u.BranchId, u.PresenceExempt, u.ReportsTo
    FROM dbo.tblUser u
    JOIN @Ids i ON i.UserId = u.Id
    LEFT JOIN dbo.tblWorkCalendar w ON w.Id = u.WorkCalendarId AND w.CompId = @CompId
    WHERE u.CompId = @CompId;

    -- RS1 users
    SELECT UserId, CalendarId, BranchId, PresenceExempt, ReportsTo FROM @Users;

    -- RS2 calendars referenced
    SELECT w.Id, w.DaysJson FROM dbo.tblWorkCalendar w
    WHERE w.CompId = @CompId AND w.Id IN (SELECT CalendarId FROM @Users);

    -- RS3 holidays in range (company-wide and per office)
    SELECT h.HolidayDate, h.BranchId FROM dbo.tblHoliday h
    WHERE h.CompId = @CompId AND h.HolidayDate BETWEEN @FromDate AND @ToDate;

    -- RS4 day marks in range
    SELECT d.UserId, d.WorkDate, d.Part, d.Kind FROM dbo.tblUserDayMark d
    JOIN @Users u ON u.UserId = d.UserId
    WHERE d.CompId = @CompId AND d.WorkDate BETWEEN @FromDate AND @ToDate;
END
GO

-- ===========================================================================
-- 6. Day marks (D6) — marked by the person's ReportsTo chain or an admin
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_SaveDayMark
    @CompId       BIGINT,
    @UserId       INT,
    @WorkDate     DATE,
    @Part         VARCHAR(12),
    @Kind         VARCHAR(10),
    @Remarks      NVARCHAR(300) = NULL,
    @ActorUserId  INT,
    @ActorIsAdmin BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Id BIGINT, @Allowed BIT = ISNULL(@ActorIsAdmin, 0);

    IF @WorkDate IS NULL OR ISNULL(@Part, '') NOT IN ('full','first_half','second_half')
                         OR ISNULL(@Kind, '') NOT IN ('leave','on_duty')
    BEGIN SELECT 400 AS ResponseCode, 'Invalid day mark' AS ResponseMess, CAST(NULL AS BIGINT) AS Id; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId)
    BEGIN SELECT 404 AS ResponseCode, 'User not found' AS ResponseMess, CAST(NULL AS BIGINT) AS Id; RETURN; END

    IF @Allowed = 0
    BEGIN
        ;WITH chain AS (
            SELECT u.Id, u.ReportsTo, 0 AS Depth
              FROM dbo.tblUser u WHERE u.Id = @UserId AND u.CompId = @CompId
            UNION ALL
            SELECT m.Id, m.ReportsTo, c.Depth + 1
              FROM dbo.tblUser m JOIN chain c ON m.Id = c.ReportsTo
             WHERE m.CompId = @CompId AND c.Depth < 20
        )
        SELECT @Allowed = 1
          FROM chain c JOIN dbo.tblUser u ON u.Id = c.Id
         WHERE c.Depth > 0 AND u.Id = @ActorUserId AND u.IsActive = 1
        OPTION (MAXRECURSION 32);
    END
    IF @Allowed = 0
    BEGIN SELECT 403 AS ResponseCode, 'Only their manager or an admin can mark this day' AS ResponseMess, CAST(NULL AS BIGINT) AS Id; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        SELECT @Id = Id FROM dbo.tblUserDayMark WITH (UPDLOCK, HOLDLOCK)
         WHERE UserId = @UserId AND WorkDate = @WorkDate;
        IF @Id IS NULL
        BEGIN
            INSERT INTO dbo.tblUserDayMark (CompId, UserId, WorkDate, Part, Kind, Remarks, MarkedBy)
            VALUES (@CompId, @UserId, @WorkDate, @Part, @Kind, @Remarks, @ActorUserId);
            SET @Id = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.tblUserDayMark
               SET Part = @Part, Kind = @Kind, Remarks = @Remarks, MarkedBy = @ActorUserId, MarkedAt = GETDATE()
             WHERE Id = @Id;
        COMMIT;
        SELECT 200 AS ResponseCode, 'Day marked' AS ResponseMess, @Id AS Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess, @Id AS Id;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_DeleteDayMark
    @CompId       BIGINT,
    @UserId       INT,
    @WorkDate     DATE,
    @ActorUserId  INT,
    @ActorIsAdmin BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Allowed BIT = ISNULL(@ActorIsAdmin, 0);

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId)
    BEGIN SELECT 404 AS ResponseCode, 'User not found' AS ResponseMess; RETURN; END

    IF @Allowed = 0
    BEGIN
        ;WITH chain AS (
            SELECT u.Id, u.ReportsTo, 0 AS Depth
              FROM dbo.tblUser u WHERE u.Id = @UserId AND u.CompId = @CompId
            UNION ALL
            SELECT m.Id, m.ReportsTo, c.Depth + 1
              FROM dbo.tblUser m JOIN chain c ON m.Id = c.ReportsTo
             WHERE m.CompId = @CompId AND c.Depth < 20
        )
        SELECT @Allowed = 1
          FROM chain c JOIN dbo.tblUser u ON u.Id = c.Id
         WHERE c.Depth > 0 AND u.Id = @ActorUserId AND u.IsActive = 1
        OPTION (MAXRECURSION 32);
    END
    IF @Allowed = 0
    BEGIN SELECT 403 AS ResponseCode, 'Only their manager or an admin can change this day' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        DELETE FROM dbo.tblUserDayMark WHERE CompId = @CompId AND UserId = @UserId AND WorkDate = @WorkDate;
        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK;
            SELECT 404 AS ResponseCode, 'No mark on this day' AS ResponseMess;
            RETURN;
        END
        COMMIT;
        SELECT 200 AS ResponseCode, 'Day mark removed' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_FetchDayMarks
    @CompId      BIGINT,
    @UserIdsJson NVARCHAR(MAX),
    @FromDate    DATE,
    @ToDate      DATE
AS
BEGIN
    SET NOCOUNT ON;
    SELECT d.UserId, d.WorkDate, d.Part, d.Kind, d.Remarks, d.MarkedBy,
           ISNULL(mb.FullName, mb.Username) AS MarkedByName, d.MarkedAt
    FROM dbo.tblUserDayMark d
    LEFT JOIN dbo.tblUser mb ON mb.Id = d.MarkedBy
    WHERE d.CompId = @CompId
      AND d.WorkDate BETWEEN @FromDate AND @ToDate
      AND d.UserId IN (SELECT TRY_CAST(value AS INT) FROM OPENJSON(ISNULL(@UserIdsJson, N'[]')))
    ORDER BY d.WorkDate, d.UserId;
END
GO

-- ===========================================================================
-- 7. Sessions (D7)
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_StartSession
    @SessionId   UNIQUEIDENTIFIER,
    @CompId      BIGINT,
    @UserId      INT,
    @Device      VARCHAR(10),
    @Ip          VARCHAR(64)   = NULL,
    @UserAgent   NVARCHAR(300) = NULL,
    @ExpiresAt   DATETIME,
    @WorkDate    DATE     = NULL,     -- NULL = no shift now, nothing recorded
    @ShiftStart  DATETIME = NULL,
    @ShiftEnd    DATETIME = NULL,
    @LateMinutes INT      = NULL,
    @BranchId    BIGINT   = NULL,
    @ManagerId   INT      = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @GoLive DATE = (SELECT GoLiveDate FROM dbo.tblCompanySetting WHERE CompId = @CompId);
    DECLARE @ShowNotice BIT;

    -- 1. The session. Its failure fails the login.
    BEGIN TRY
        INSERT INTO dbo.tblUserSession (SessionId, CompId, UserId, Device, Ip, UserAgent, ExpiresAt)
        VALUES (@SessionId, @CompId, @UserId, @Device, @Ip, LEFT(@UserAgent, 300), @ExpiresAt);
    END TRY
    BEGIN CATCH
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess, CAST(0 AS BIT) AS ShowNotice;
        RETURN;
    END CATCH

    -- 2. Presence: first sign-in of the shift. A race with another sign-in or
    --    the not-signed-in sweep must not fail the login: the unique key wins.
    IF @WorkDate IS NOT NULL AND @GoLive IS NOT NULL AND @WorkDate >= @GoLive
       AND NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND PresenceExempt = 1)
    BEGIN
        BEGIN TRY
            BEGIN TRAN;
            IF NOT EXISTS (SELECT 1 FROM dbo.tblPresenceDay WITH (UPDLOCK, HOLDLOCK)
                            WHERE UserId = @UserId AND WorkDate = @WorkDate)
                INSERT INTO dbo.tblPresenceDay (CompId, UserId, WorkDate, ShiftStart, ShiftEnd,
                                                FirstSignInAt, LateMinutes, ManagerId, BranchId)
                VALUES (@CompId, @UserId, @WorkDate, @ShiftStart, @ShiftEnd,
                        GETDATE(), @LateMinutes, @ManagerId, @BranchId);
            ELSE
                -- row pre-created by the not-signed-in sweep: its shift stays frozen
                UPDATE dbo.tblPresenceDay SET FirstSignInAt = GETDATE(), LateMinutes = @LateMinutes
                 WHERE UserId = @UserId AND WorkDate = @WorkDate AND FirstSignInAt IS NULL;
            COMMIT;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK;
            IF ERROR_NUMBER() NOT IN (2627, 2601)
            BEGIN
                SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess, CAST(0 AS BIT) AS ShowNotice;
                RETURN;
            END
        END CATCH
    END

    SELECT @ShowNotice = CAST(CASE WHEN u.PresenceNoticeAt IS NULL
                                    AND @GoLive IS NOT NULL AND @GoLive <= CAST(GETDATE() AS DATE)
                                   THEN 1 ELSE 0 END AS BIT)
      FROM dbo.tblUser u WHERE u.Id = @UserId AND u.CompId = @CompId;

    SELECT 200 AS ResponseCode, 'Session started' AS ResponseMess, ISNULL(@ShowNotice, CAST(0 AS BIT)) AS ShowNotice;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_CheckSession
    @SessionId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT UserId, CompId, ExpiresAt, EndedAt, EndReason
    FROM dbo.tblUserSession WHERE SessionId = @SessionId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_TouchSession
    @SessionId UNIQUEIDENTIFIER,
    @ExpiresAt DATETIME
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        -- open = not ended and not yet expired (an expired row awaiting the sweep is not revived)
        UPDATE dbo.tblUserSession
           SET LastSeenAt = GETDATE(),
               ExpiresAt  = CASE WHEN @ExpiresAt > ExpiresAt THEN @ExpiresAt ELSE ExpiresAt END
         WHERE SessionId = @SessionId AND EndedAt IS NULL AND ExpiresAt > GETDATE();
        SELECT 200 AS ResponseCode, 'Session touched' AS ResponseMess,
               CAST(CASE WHEN @@ROWCOUNT > 0 THEN 1 ELSE 0 END AS BIT) AS Touched;
    END TRY
    BEGIN CATCH
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess, CAST(0 AS BIT) AS Touched;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_EndSession
    @SessionId UNIQUEIDENTIFIER,
    @Reason    VARCHAR(10),
    @CompId    BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @UserId INT, @Ended BIT = 0, @StartedAt DATETIME;

    IF ISNULL(@Reason, '') NOT IN ('logout','expired','forced')
    BEGIN SELECT 400 AS ResponseCode, 'Invalid reason' AS ResponseMess, CAST(NULL AS INT) AS UserId, CAST(0 AS BIT) AS Ended; RETURN; END

    SELECT @UserId = UserId, @StartedAt = StartedAt FROM dbo.tblUserSession
     WHERE SessionId = @SessionId AND (@CompId IS NULL OR CompId = @CompId);

    BEGIN TRY
        BEGIN TRAN;
        UPDATE dbo.tblUserSession SET EndedAt = GETDATE(), EndReason = @Reason
         WHERE SessionId = @SessionId AND EndedAt IS NULL AND (@CompId IS NULL OR CompId = @CompId);
        IF @@ROWCOUNT > 0 SET @Ended = 1;

        IF @Ended = 1 AND @Reason = 'logout'
            UPDATE p SET SignedOutAt = GETDATE()
              FROM dbo.tblPresenceDay p
             -- the shift this session belongs to: signed in, and no older than the day before it started
             WHERE p.Id = (SELECT TOP 1 Id FROM dbo.tblPresenceDay
                            WHERE UserId = @UserId AND FirstSignInAt IS NOT NULL
                              AND WorkDate >= DATEADD(DAY, -1, CAST(@StartedAt AS DATE))
                            ORDER BY WorkDate DESC);
        COMMIT;
        SELECT 200 AS ResponseCode, CASE WHEN @Ended = 1 THEN 'Session ended' ELSE 'Session already ended' END AS ResponseMess,
               @UserId AS UserId, @Ended AS Ended;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess, @UserId AS UserId, CAST(0 AS BIT) AS Ended;
    END CATCH
END
GO

-- Admin "end all sessions" / deactivation. RS1 = the ended SessionId rows.
CREATE OR ALTER PROCEDURE dbo.sp_EndUserSessions
    @UserId INT,
    @CompId BIGINT,
    @Reason VARCHAR(10) = 'forced'
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.tblUserSession
       SET EndedAt = GETDATE(),
           EndReason = CASE WHEN @Reason IN ('logout','expired','forced') THEN @Reason ELSE 'forced' END
    OUTPUT inserted.SessionId
     WHERE UserId = @UserId AND CompId = @CompId AND EndedAt IS NULL;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_FetchSessions
    @CompId BIGINT,
    @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 30 SessionId, Device, Ip, UserAgent, StartedAt, LastSeenAt, ExpiresAt, EndedAt, EndReason
    FROM dbo.tblUserSession
    WHERE CompId = @CompId AND UserId = @UserId
    ORDER BY StartedAt DESC;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_AckPresenceNotice
    @UserId INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        UPDATE dbo.tblUser SET PresenceNoticeAt = GETDATE()
         WHERE Id = @UserId AND CompId = @CompId AND PresenceNoticeAt IS NULL;
        SELECT 200 AS ResponseCode, 'Notice acknowledged' AS ResponseMess;
    END TRY
    BEGIN CATCH
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess;
    END CATCH
END
GO

-- ===========================================================================
-- 8. Presence
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_FetchPresence
    @CompId      BIGINT,
    @WorkDate    DATE,
    @UserIdsJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.Id AS UserId, u.FullName, u.JobTitle, u.BranchId, u.PresenceExempt,
           p.ShiftStart, p.ShiftEnd, p.FirstSignInAt, p.LateMinutes, p.SignedOutAt,
           s.LastSeenAt,
           CAST(CASE WHEN s.LastSeenAt IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS HasOpenSession,
           d.Part AS MarkPart, d.Kind AS MarkKind
    FROM dbo.tblUser u
    LEFT JOIN dbo.tblPresenceDay p ON p.UserId = u.Id AND p.WorkDate = @WorkDate
    LEFT JOIN dbo.tblUserDayMark d ON d.UserId = u.Id AND d.WorkDate = @WorkDate
    OUTER APPLY (SELECT TOP 1 LastSeenAt FROM dbo.tblUserSession
                  WHERE UserId = u.Id AND EndedAt IS NULL ORDER BY LastSeenAt DESC) s
    WHERE u.CompId = @CompId AND u.IsActive = 1
      AND u.Id IN (SELECT TRY_CAST(value AS INT) FROM OPENJSON(ISNULL(@UserIdsJson, N'[]')))
    ORDER BY u.FullName;
END
GO

-- Run every 60 s per live company. RS1 = SessionId rows it just expired.
CREATE OR ALTER PROCEDURE dbo.sp_PresenceSweep
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.tblUserSession
       SET EndedAt = GETDATE(), EndReason = 'expired'
    OUTPUT inserted.SessionId
     WHERE CompId = @CompId AND EndedAt IS NULL AND ExpiresAt < GETDATE();

    -- Retention: 13 months (CERT-In asks for 180 days of IP logs). Batched.
    DELETE TOP (2000) FROM dbo.tblUserSession
     WHERE CompId = @CompId AND StartedAt < DATEADD(MONTH, -13, GETDATE());
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_FetchPresenceCandidates
    @CompId   BIGINT,
    @WorkDate DATE
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.Id AS UserId, u.BranchId
    FROM dbo.tblUser u
    JOIN dbo.tblCompanySetting s ON s.CompId = u.CompId
    WHERE u.CompId = @CompId AND u.IsActive = 1 AND u.PresenceExempt = 0
      AND s.NotifyNotSignedIn = 1
      AND s.GoLiveDate IS NOT NULL AND @WorkDate >= s.GoLiveDate
      AND NOT EXISTS (SELECT 1 FROM dbo.tblPresenceDay p WHERE p.UserId = u.Id AND p.WorkDate = @WorkDate);
END
GO

-- Shift start + grace passed with no sign-in: one row, one notification per recipient.
-- RS1 ResponseCode, ResponseMess, Inserted; RS2 notified UserId rows.
CREATE OR ALTER PROCEDURE dbo.sp_MarkNotSignedIn
    @CompId     BIGINT,
    @UserId     INT,
    @WorkDate   DATE,
    @ShiftStart DATETIME,
    @ShiftEnd   DATETIME,
    @BranchId   BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Inserted BIT = 0, @ManagerId INT, @Title VARCHAR(200), @RecipientId INT;
    DECLARE @Mgr TABLE (UserId INT, Source VARCHAR(10));
    DECLARE @Notified TABLE (UserId INT);
    DECLARE @ntf TABLE (ResponseCode INT, ResponseMess VARCHAR(400), NotificationId BIGINT, UserId INT, Type VARCHAR(40));

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId)
    BEGIN
        SELECT 404 AS ResponseCode, 'User not found' AS ResponseMess, CAST(0 AS BIT) AS Inserted;
        SELECT UserId FROM @Notified;
        RETURN;
    END

    SELECT @Title = LEFT(ISNULL(FullName, Username) + ' has not signed in', 200),
           @BranchId = ISNULL(@BranchId, BranchId)
      FROM dbo.tblUser WHERE Id = @UserId;

    BEGIN TRY
        BEGIN TRAN;
        IF NOT EXISTS (SELECT 1 FROM dbo.tblPresenceDay WITH (UPDLOCK, HOLDLOCK)
                        WHERE UserId = @UserId AND WorkDate = @WorkDate)
        BEGIN
            INSERT INTO @Mgr (UserId, Source) EXEC dbo.sp_FetchPersonManagers @UserId = @UserId, @CompId = @CompId;
            SELECT TOP 1 @ManagerId = UserId FROM @Mgr WHERE Source = 'manager';

            INSERT INTO dbo.tblPresenceDay (CompId, UserId, WorkDate, ShiftStart, ShiftEnd, NotSignedInAt, ManagerId, BranchId)
            VALUES (@CompId, @UserId, @WorkDate, @ShiftStart, @ShiftEnd, GETDATE(), @ManagerId, @BranchId);
            SET @Inserted = 1;

            -- tblNotifications.BranchId is NOT NULL: with no office at all the row is
            -- still recorded (so the sweep never retries) but nobody is notified.
            DECLARE rcp CURSOR LOCAL FAST_FORWARD FOR SELECT UserId FROM @Mgr WHERE @BranchId IS NOT NULL;
            OPEN rcp;
            FETCH NEXT FROM rcp INTO @RecipientId;
            WHILE @@FETCH_STATUS = 0
            BEGIN
                INSERT INTO @ntf EXEC dbo.sp_CreateNotification
                    @UserId = @RecipientId, @Type = 'presence_not_signed_in', @EntityType = 'user',
                    @EntityId = @UserId, @ActorUserId = NULL, @Title = @Title, @Body = NULL,
                    @CompId = @CompId, @BranchId = @BranchId, @SkipSelf = 1;
                FETCH NEXT FROM rcp INTO @RecipientId;
            END
            CLOSE rcp; DEALLOCATE rcp;

            INSERT INTO @Notified (UserId)
            SELECT DISTINCT UserId FROM @ntf WHERE NotificationId IS NOT NULL;
        END
        COMMIT;
        SELECT 200 AS ResponseCode, CASE WHEN @Inserted = 1 THEN 'Marked not signed in' ELSE 'Already recorded' END AS ResponseMess,
               @Inserted AS Inserted;
        SELECT UserId FROM @Notified;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        IF ERROR_NUMBER() IN (2627, 2601)   -- signed in at the same moment: nothing to do
            SELECT 200 AS ResponseCode, 'Already recorded' AS ResponseMess, CAST(0 AS BIT) AS Inserted;
        ELSE
            SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess, CAST(0 AS BIT) AS Inserted;
        SELECT CAST(NULL AS INT) AS UserId WHERE 1 = 0;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_FetchLiveCompanies
AS
BEGIN
    SET NOCOUNT ON;
    SELECT CompId FROM dbo.tblCompanySetting
    WHERE GoLiveDate IS NOT NULL AND GoLiveDate <= CAST(GETDATE() AS DATE);
END
GO

-- ===========================================================================
-- 9. sp_FetchUser — live text (098) with two changes only:
--    (a) lows L1: @SearchSensitive = 0 also keeps Username out of the search;
--    (b) WorkCalendarId, PresenceExempt appended to every user SELECT (Task 10 user form).
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_FetchUser
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(100) = NULL,
    -- 098: 0 = the caller may not see contact details, so search must not match on them.
    -- 099: that includes Username.
    @SearchSensitive BIT = 1
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    -- Users with an ACTIVE manager somewhere up the chain (094). The walk
    -- continues only through inactive managers, so it stops at the first active one.
    DECLARE @Managed TABLE (UserId INT PRIMARY KEY);
    ;WITH up AS (
        SELECT u.Id AS UserId, u.ReportsTo AS AncestorId, 1 AS Depth
          FROM tblUser u WHERE u.CompId = @CompId AND u.ReportsTo IS NOT NULL
        UNION ALL
        SELECT up.UserId, m.ReportsTo, up.Depth + 1
          FROM up JOIN tblUser m ON m.Id = up.AncestorId
         WHERE m.CompId = @CompId AND m.IsActive = 0 AND m.ReportsTo IS NOT NULL AND up.Depth < 20
    )
    INSERT INTO @Managed (UserId)
    SELECT DISTINCT up.UserId
      FROM up JOIN tblUser a ON a.Id = up.AncestorId AND a.CompId = @CompId AND a.IsActive = 1
     WHERE a.Id <> up.UserId
    OPTION (MAXRECURSION 32);

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        SELECT @TotalRecords = COUNT(*)
        FROM tblUser u
        WHERE u.CompId = @CompId
          AND ((@UseScope = 1 AND u.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0 AND (@IsAdmin = 1 OR u.BranchId = @BranchId)))
          AND (@SearchTerm IS NULL OR
               (@SearchSensitive = 1 AND u.Username LIKE '%' + @SearchTerm + '%') OR
               u.FullName LIKE '%' + @SearchTerm + '%' OR
               (@SearchSensitive = 1 AND u.Email  LIKE '%' + @SearchTerm + '%') OR
               (@SearchSensitive = 1 AND u.Mobile LIKE '%' + @SearchTerm + '%') OR
               u.JobTitle LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No users found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS Username, NULL AS IsActive, NULL AS IsAdmin,
                   NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
                   NULL AS Mobile, NULL AS Avatar,
                   NULL AS GroupId, NULL AS GroupName,
                   NULL AS ReportsTo, NULL AS ReportsToName,
                   NULL AS BranchName, NULL AS NoManager,
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate,
                   NULL AS WorkCalendarId, NULL AS PresenceExempt;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Users retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   u.Id, u.Username, u.IsActive, u.IsAdmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate, u.Mobile, u.Avatar,
                   (SELECT TOP 1 m.GroupId
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupId,
                   (SELECT TOP 1 g.Name
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupName,
                   u.ReportsTo,
                   (SELECT r.FullName FROM tblUser r WHERE r.Id = u.ReportsTo) AS ReportsToName,
                   b.BranchName,
                   CAST(CASE WHEN u.IsActive = 1
                              AND NOT EXISTS (SELECT 1 FROM @Managed mg WHERE mg.UserId = u.Id)
                              AND NOT EXISTS (SELECT 1 FROM tblUserGroupMap am
                                                JOIN tblUserGroups ag ON ag.Id = am.GroupId AND ag.IsActive = 1 AND ag.IsAdmin = 1
                                               WHERE am.UserId = u.Id)
                             THEN 1 ELSE 0 END AS BIT) AS NoManager,
                   u.CompId, u.BranchId, u.CreatedDate,
                   u.WorkCalendarId, u.PresenceExempt
            FROM tblUser u
            LEFT JOIN tblBranch b ON b.Id = u.BranchId
            WHERE u.CompId = @CompId
              AND ((@UseScope = 1 AND u.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0 AND (@IsAdmin = 1 OR u.BranchId = @BranchId)))
              AND (@SearchTerm IS NULL OR
                   (@SearchSensitive = 1 AND u.Username LIKE '%' + @SearchTerm + '%') OR
                   u.FullName LIKE '%' + @SearchTerm + '%' OR
                   (@SearchSensitive = 1 AND u.Email  LIKE '%' + @SearchTerm + '%') OR
                   (@SearchSensitive = 1 AND u.Mobile LIKE '%' + @SearchTerm + '%') OR
                   u.JobTitle LIKE '%' + @SearchTerm + '%')
            ORDER BY u.FullName
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblUser
                   WHERE Id = @Id AND CompId = @CompId
                     AND ((@UseScope = 1 AND BranchId IN (SELECT BranchId FROM @BranchIds))
                       OR (@UseScope = 0 AND (@IsAdmin = 1 OR BranchId = @BranchId))))
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'User retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   u.Id, u.Username, u.IsActive, u.IsAdmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate, u.Mobile, u.Avatar,
                   (SELECT TOP 1 m.GroupId
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupId,
                   (SELECT TOP 1 g.Name
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupName,
                   u.ReportsTo,
                   (SELECT r.FullName FROM tblUser r WHERE r.Id = u.ReportsTo) AS ReportsToName,
                   b.BranchName,
                   CAST(CASE WHEN u.IsActive = 1
                              AND NOT EXISTS (SELECT 1 FROM @Managed mg WHERE mg.UserId = u.Id)
                              AND NOT EXISTS (SELECT 1 FROM tblUserGroupMap am
                                                JOIN tblUserGroups ag ON ag.Id = am.GroupId AND ag.IsActive = 1 AND ag.IsAdmin = 1
                                               WHERE am.UserId = u.Id)
                             THEN 1 ELSE 0 END AS BIT) AS NoManager,
                   u.CompId, u.BranchId, u.CreatedDate,
                   u.WorkCalendarId, u.PresenceExempt
            FROM tblUser u
            LEFT JOIN tblBranch b ON b.Id = u.BranchId
            WHERE u.Id = @Id AND u.CompId = @CompId;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'User not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Username, NULL AS IsActive, NULL AS IsAdmin,
                   NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
                   NULL AS Mobile, NULL AS Avatar,
                   NULL AS GroupId, NULL AS GroupName,
                   NULL AS ReportsTo, NULL AS ReportsToName,
                   NULL AS BranchName, NULL AS NoManager,
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate,
                   NULL AS WorkCalendarId, NULL AS PresenceExempt;
        END
    END
END
GO

/* ===========================================================================
   VERIFY AFTER APPLY (read-only; run on both DBs)
   ===========================================================================
-- tables + columns
SELECT name FROM sys.tables WHERE name IN ('tblCompanySetting','tblWorkCalendar','tblHoliday',
       'tblUserDayMark','tblUserSession','tblPresenceDay');                         -- expect 6
SELECT COL_LENGTH('dbo.tblUser','WorkCalendarId') AS Cal, COL_LENGTH('dbo.tblUser','PresenceExempt') AS Exempt,
       COL_LENGTH('dbo.tblUser','PresenceNoticeAt') AS Notice;                      -- expect 3 non-NULL

-- procs, all with QUOTED_IDENTIFIER ON (every uses_quoted_identifier = 1)
SELECT OBJECT_NAME(object_id) AS proc_name, uses_quoted_identifier FROM sys.sql_modules
WHERE OBJECT_NAME(object_id) IN ('sp_FetchWorkSettings','sp_SaveCompanySetting','sp_SaveWorkCalendar',
  'sp_DeleteWorkCalendar','sp_SaveHoliday','sp_DeleteHoliday','sp_SetUserWorkProfile','sp_FetchCalendarContext',
  'sp_SaveDayMark','sp_DeleteDayMark','sp_FetchDayMarks','sp_StartSession','sp_CheckSession','sp_TouchSession',
  'sp_EndSession','sp_EndUserSessions','sp_FetchSessions','sp_AckPresenceNotice','sp_FetchPresence',
  'sp_PresenceSweep','sp_FetchPresenceCandidates','sp_MarkNotSignedIn','sp_FetchLiveCompanies','sp_FetchUser')
ORDER BY 1;   -- (24 names listed; expect 24 rows)

-- one settings row and exactly one default shift per company
SELECT c.CompId, (SELECT COUNT(*) FROM dbo.tblCompanySetting s WHERE s.CompId = c.CompId) AS Settings,
       (SELECT COUNT(*) FROM dbo.tblWorkCalendar w WHERE w.CompId = c.CompId AND w.IsDefault = 1) AS Defaults
FROM (SELECT DISTINCT CompId FROM dbo.tblUser) c;                                   -- expect 1 / 1 per row
SELECT CompId, GoLiveDate FROM dbo.tblCompanySetting;                               -- tomorrow at first apply

-- owners exempt
SELECT u.Id, u.FullName, u.PresenceExempt FROM dbo.tblUser u WHERE u.PresenceExempt = 1;

-- module constraint carries 'attendance'
SELECT definition FROM sys.check_constraints WHERE name = 'CK_tblGroupModule_Module';  -- contains 'attendance'

-- the two menu rows
SELECT Id, ParentId, Description, Route, Module FROM dbo.tblMenu
WHERE Route IN ('/today','/settings/work-calendar');                                -- expect 2 rows (Today = Id 3)

-- sp_FetchUser smoke: the last two columns are WorkCalendarId, PresenceExempt
EXEC dbo.sp_FetchUser @Id = 0, @CompId = 1, @BranchId = 1, @IsAdmin = 1, @SearchTerm = 'admin', @SearchSensitive = 0;
EXEC dbo.sp_FetchWorkSettings @CompId = 1;                                          -- 4 result sets, RS4 empty
*/
