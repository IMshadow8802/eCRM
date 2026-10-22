/* =====================================================================
   114 - Visiting cards (VisiScan field-app server)
   The CRM becomes the server for the VisiScan card scanner. One row per scanned card.
   - tblVisitingCard: Id is a UUID made by the app (a retried upload hits the same row).
     CompId/BranchId/OwnerId = company, scanner's office and scanner at insert; they never change.
     Mobiles/Landlines/Emails/Addresses are JSON arrays of strings. Photos are files; only paths are kept.
   - sp_SaveVisitingCard: upsert by Id in one transaction. Same/older AppUpdatedAt or a deleted card = no change (200).
     Another person's card: 403 unless @CanEditOthers = 1 and the row is inside the caller's reach.
   - sp_FetchVisitingCards: one card (@Id) or newest first, paged, with search; reach scoped like sp_FetchLeads
     ('[]' = nobody, NULL = no filter; a card whose OwnerId = caller is always visible).
   - sp_DeleteVisitingCard: soft delete, scoped like fetch.
   - Module 'cards' added to CK_tblGroupModule_Module and (it has Own/Team/Office/... reach) CK_tblGroupModule_Reach.
   - Menu row "Visiting Cards" under Sales. No tblGroupModule rows: Owner/Admin get every module, others are granted in Roles.

   Apply order: TestCRM -> eCRM+ -> SolarCRM.
     sqlcmd -S prdinfotech.in -d TestCRM -U <user> -I -i backend/sql/114_visiting_cards.sql
   ===================================================================== */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

-- 1. Table --------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblVisitingCard') IS NULL
    CREATE TABLE dbo.tblVisitingCard (
        Id            UNIQUEIDENTIFIER  NOT NULL CONSTRAINT PK_tblVisitingCard PRIMARY KEY,
        CompId        INT               NOT NULL,
        BranchId      INT               NOT NULL,
        OwnerId       INT               NOT NULL,
        BusinessName  NVARCHAR(200)     NOT NULL CONSTRAINT DF_tblVisitingCard_BusinessName DEFAULT N'',
        ContactPerson NVARCHAR(150)     NOT NULL CONSTRAINT DF_tblVisitingCard_ContactPerson DEFAULT N'',
        Designation   NVARCHAR(150)     NOT NULL CONSTRAINT DF_tblVisitingCard_Designation DEFAULT N'',
        Website       NVARCHAR(300)     NOT NULL CONSTRAINT DF_tblVisitingCard_Website DEFAULT N'',
        Gstin         NVARCHAR(50)      NOT NULL CONSTRAINT DF_tblVisitingCard_Gstin DEFAULT N'',
        Description   NVARCHAR(MAX)     NOT NULL CONSTRAINT DF_tblVisitingCard_Description DEFAULT N'',
        Other         NVARCHAR(MAX)     NOT NULL CONSTRAINT DF_tblVisitingCard_Other DEFAULT N'',
        Notes         NVARCHAR(MAX)     NOT NULL CONSTRAINT DF_tblVisitingCard_Notes DEFAULT N'',
        Mobiles       NVARCHAR(MAX)     NOT NULL CONSTRAINT DF_tblVisitingCard_Mobiles DEFAULT N'[]'
                                        CONSTRAINT CK_tblVisitingCard_Mobiles CHECK (ISJSON(Mobiles) = 1),
        Landlines     NVARCHAR(MAX)     NOT NULL CONSTRAINT DF_tblVisitingCard_Landlines DEFAULT N'[]'
                                        CONSTRAINT CK_tblVisitingCard_Landlines CHECK (ISJSON(Landlines) = 1),
        Emails        NVARCHAR(MAX)     NOT NULL CONSTRAINT DF_tblVisitingCard_Emails DEFAULT N'[]'
                                        CONSTRAINT CK_tblVisitingCard_Emails CHECK (ISJSON(Emails) = 1),
        Addresses     NVARCHAR(MAX)     NOT NULL CONSTRAINT DF_tblVisitingCard_Addresses DEFAULT N'[]'
                                        CONSTRAINT CK_tblVisitingCard_Addresses CHECK (ISJSON(Addresses) = 1),
        FrontPath     NVARCHAR(400)     NOT NULL,
        BackPath      NVARCHAR(400)     NULL,
        AppCreatedAt  DATETIMEOFFSET    NOT NULL,
        AppUpdatedAt  DATETIMEOFFSET    NOT NULL,
        ReceivedAt    DATETIME          NOT NULL CONSTRAINT DF_tblVisitingCard_ReceivedAt DEFAULT GETDATE(),
        ModifiedAt    DATETIME          NULL,
        IsDeleted     BIT               NOT NULL CONSTRAINT DF_tblVisitingCard_IsDeleted DEFAULT 0,
        DeletedAt     DATETIME          NULL
    );
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblVisitingCard_List' AND object_id = OBJECT_ID('dbo.tblVisitingCard'))
    CREATE INDEX IX_tblVisitingCard_List ON dbo.tblVisitingCard (CompId, IsDeleted, ReceivedAt DESC);
GO

-- 2. Module 'cards' is grantable, with reach ------------------------------------------
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblGroupModule_Module' AND definition NOT LIKE '%cards%')
BEGIN
    ALTER TABLE dbo.tblGroupModule DROP CONSTRAINT CK_tblGroupModule_Module;
    ALTER TABLE dbo.tblGroupModule ADD CONSTRAINT CK_tblGroupModule_Module CHECK (Module IN
        ('leads','sales_reports','complaints','support_reports','customers','people',
         'tasks','teams','projects','settings','dashboard','attendance','partners','cards'));
END
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblGroupModule_Reach' AND definition NOT LIKE '%cards%')
BEGIN
    ALTER TABLE dbo.tblGroupModule DROP CONSTRAINT CK_tblGroupModule_Reach;
    ALTER TABLE dbo.tblGroupModule ADD CONSTRAINT CK_tblGroupModule_Reach CHECK (
        (Module IN ('leads','complaints','customers','people','attendance','cards')
            AND Reach IN ('Own','Team','Office','OfficeTree','Company'))
        OR (Module NOT IN ('leads','complaints','customers','people','attendance','cards') AND Reach IS NULL));
END
GO

-- 3. Menu row -------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = '/sales/visiting-cards')
    INSERT INTO dbo.tblMenu (ParentId, Description, MenuType, FormId, ActualId, IsAllowed, Route, Module, SortOrder)
    SELECT p.Id, 'Visiting Cards', 1, 0, 0, 1, '/sales/visiting-cards', 'cards',
           ISNULL((SELECT MAX(SortOrder) FROM dbo.tblMenu m WHERE m.ParentId = p.Id), 0) + 1
    FROM dbo.tblMenu p WHERE p.Route = '/sales' AND p.ParentId = 0;
GO

-- 4. Save -----------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_SaveVisitingCard
    @Id UNIQUEIDENTIFIER, @CompId INT, @UserId INT, @BranchId INT,
    @BusinessName NVARCHAR(200), @ContactPerson NVARCHAR(150), @Designation NVARCHAR(150),
    @Website NVARCHAR(300), @Gstin NVARCHAR(50),
    @Description NVARCHAR(MAX), @Other NVARCHAR(MAX), @Notes NVARCHAR(MAX),
    @Mobiles NVARCHAR(MAX), @Landlines NVARCHAR(MAX), @Emails NVARCHAR(MAX), @Addresses NVARCHAR(MAX),
    @FrontPath NVARCHAR(400), @BackPath NVARCHAR(400) = NULL,
    @AppCreatedAt DATETIMEOFFSET, @AppUpdatedAt DATETIMEOFFSET,
    @CanEditOthers BIT = 0,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    DECLARE @SavedAt DATETIMEOFFSET, @Deleted BIT, @OldFront NVARCHAR(400), @OldBack NVARCHAR(400),
            @RowOwner INT, @RowBranch INT;

    BEGIN TRY
        BEGIN TRAN;
        -- the lock keeps two copies of the same upload from both inserting
        SELECT @SavedAt = AppUpdatedAt, @Deleted = IsDeleted, @OldFront = FrontPath, @OldBack = BackPath,
               @RowOwner = OwnerId, @RowBranch = BranchId
        FROM dbo.tblVisitingCard WITH (UPDLOCK, HOLDLOCK) WHERE Id = @Id AND CompId = @CompId;

        IF (@SavedAt IS NULL)
        BEGIN
            INSERT INTO dbo.tblVisitingCard (Id, CompId, BranchId, OwnerId, BusinessName, ContactPerson, Designation, Website, Gstin,
                                             Description, Other, Notes, Mobiles, Landlines, Emails, Addresses,
                                             FrontPath, BackPath, AppCreatedAt, AppUpdatedAt)
            VALUES (@Id, @CompId, @BranchId, @UserId, @BusinessName, @ContactPerson, @Designation, @Website, @Gstin,
                    @Description, @Other, @Notes, @Mobiles, @Landlines, @Emails, @Addresses,
                    @FrontPath, @BackPath, @AppCreatedAt, @AppUpdatedAt);
            COMMIT;
            SELECT CAST(1 AS BIT) AS Saved, 200 AS ResponseCode, N'Card saved' AS ResponseMess,
                   CAST(NULL AS NVARCHAR(400)) AS OldFront, CAST(NULL AS NVARCHAR(400)) AS OldBack;
            RETURN;
        END

        IF (@Deleted = 1 OR @AppUpdatedAt <= @SavedAt)
        BEGIN
            COMMIT;
            SELECT CAST(0 AS BIT) AS Saved, 200 AS ResponseCode, N'Already up to date' AS ResponseMess,
                   CAST(NULL AS NVARCHAR(400)) AS OldFront, CAST(NULL AS NVARCHAR(400)) AS OldBack;
            RETURN;
        END

        IF (@RowOwner <> @UserId AND NOT (
                @CanEditOthers = 1
                AND (@UseBranchScope = 0 OR @RowBranch IN (SELECT BranchId FROM @BranchIds))
                AND (@UseOwnerScope  = 0 OR @RowOwner  IN (SELECT OwnerId  FROM @OwnerIds))))
        BEGIN
            COMMIT;
            SELECT CAST(0 AS BIT) AS Saved, 403 AS ResponseCode, N'Not your card' AS ResponseMess,
                   CAST(NULL AS NVARCHAR(400)) AS OldFront, CAST(NULL AS NVARCHAR(400)) AS OldBack;
            RETURN;
        END

        UPDATE dbo.tblVisitingCard
        SET BusinessName = @BusinessName, ContactPerson = @ContactPerson, Designation = @Designation, Website = @Website,
            Gstin = @Gstin, Description = @Description, Other = @Other, Notes = @Notes,
            Mobiles = @Mobiles, Landlines = @Landlines, Emails = @Emails, Addresses = @Addresses,
            FrontPath = @FrontPath, BackPath = @BackPath, AppUpdatedAt = @AppUpdatedAt, ModifiedAt = GETDATE()
        WHERE Id = @Id AND CompId = @CompId;
        COMMIT;
        SELECT CAST(1 AS BIT) AS Saved, 200 AS ResponseCode, N'Card updated' AS ResponseMess,
               @OldFront AS OldFront, @OldBack AS OldBack;
    END TRY
    BEGIN CATCH
        DECLARE @Err INT = ERROR_NUMBER(), @Msg NVARCHAR(200) = LEFT(ERROR_MESSAGE(), 200);
        IF @@TRANCOUNT > 0 ROLLBACK;
        IF (@Err = 2627)   -- a concurrent insert of the same Id won
            SELECT CAST(0 AS BIT) AS Saved, 200 AS ResponseCode, N'Already saved' AS ResponseMess,
                   CAST(NULL AS NVARCHAR(400)) AS OldFront, CAST(NULL AS NVARCHAR(400)) AS OldBack;
        ELSE
            SELECT CAST(0 AS BIT) AS Saved, 500 AS ResponseCode, @Msg AS ResponseMess,
                   CAST(NULL AS NVARCHAR(400)) AS OldFront, CAST(NULL AS NVARCHAR(400)) AS OldBack;
    END CATCH
END
GO

-- 5. Fetch ----------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_FetchVisitingCards
    @CompId INT,
    @Id UNIQUEIDENTIFIER = NULL,
    @Search NVARCHAR(100) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 50,
    @UserId INT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize, 50) < 1 THEN 50 WHEN @PageSize > 200 THEN 200 ELSE @PageSize END;
    SET @Search = LTRIM(RTRIM(ISNULL(@Search, N'')));
    DECLARE @Like NVARCHAR(400) = N'%' + REPLACE(REPLACE(REPLACE(@Search, N'[', N'[[]'), N'%', N'[%]'), N'_', N'[_]') + N'%';

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    SELECT COUNT(*) AS TotalCount
    FROM dbo.tblVisitingCard c
    WHERE c.CompId = @CompId AND c.IsDeleted = 0 AND (@Id IS NULL OR c.Id = @Id)
      AND (@Search = N'' OR c.BusinessName LIKE @Like OR c.ContactPerson LIKE @Like OR c.Gstin LIKE @Like
           OR c.Mobiles LIKE @Like OR c.Landlines LIKE @Like OR c.Emails LIKE @Like)
      AND (c.OwnerId = @UserId
           OR ((@UseBranchScope = 0 OR c.BranchId IN (SELECT BranchId FROM @BranchIds))
               AND (@UseOwnerScope = 0 OR c.OwnerId IN (SELECT OwnerId FROM @OwnerIds))));

    SELECT c.Id, c.BusinessName, c.ContactPerson, c.Designation, c.Website, c.Gstin, c.Description, c.Other, c.Notes,
           c.Mobiles, c.Landlines, c.Emails, c.Addresses, c.FrontPath, c.BackPath,
           c.AppCreatedAt, c.AppUpdatedAt, c.ReceivedAt, c.OwnerId, u.FullName AS OwnerName
    FROM dbo.tblVisitingCard c
    LEFT JOIN dbo.tblUser u ON u.Id = c.OwnerId
    WHERE c.CompId = @CompId AND c.IsDeleted = 0 AND (@Id IS NULL OR c.Id = @Id)
      AND (@Search = N'' OR c.BusinessName LIKE @Like OR c.ContactPerson LIKE @Like OR c.Gstin LIKE @Like
           OR c.Mobiles LIKE @Like OR c.Landlines LIKE @Like OR c.Emails LIKE @Like)
      AND (c.OwnerId = @UserId
           OR ((@UseBranchScope = 0 OR c.BranchId IN (SELECT BranchId FROM @BranchIds))
               AND (@UseOwnerScope = 0 OR c.OwnerId IN (SELECT OwnerId FROM @OwnerIds))))
    ORDER BY c.ReceivedAt DESC, c.Id
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- 6. Delete ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_DeleteVisitingCard
    @Id UNIQUEIDENTIFIER, @CompId INT, @UserId INT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    -- The app retries any non-2xx forever, so a repeat on a deleted card answers 200 (404 = missing or out of reach).
    DECLARE @WasDeleted BIT;
    SELECT @WasDeleted = c.IsDeleted FROM dbo.tblVisitingCard c
    WHERE c.Id = @Id AND c.CompId = @CompId
      AND (c.OwnerId = @UserId
           OR ((@UseBranchScope = 0 OR c.BranchId IN (SELECT BranchId FROM @BranchIds))
               AND (@UseOwnerScope = 0 OR c.OwnerId IN (SELECT OwnerId FROM @OwnerIds))));
    IF (@WasDeleted = 1)
    BEGIN
        SELECT 200 AS ResponseCode, N'Already deleted' AS ResponseMess;
        RETURN;
    END

    UPDATE c SET IsDeleted = 1, DeletedAt = GETDATE()
    FROM dbo.tblVisitingCard c
    WHERE c.Id = @Id AND c.CompId = @CompId AND c.IsDeleted = 0
      AND (c.OwnerId = @UserId
           OR ((@UseBranchScope = 0 OR c.BranchId IN (SELECT BranchId FROM @BranchIds))
               AND (@UseOwnerScope = 0 OR c.OwnerId IN (SELECT OwnerId FROM @OwnerIds))));

    IF (@@ROWCOUNT = 0)
        SELECT 404 AS ResponseCode, N'This card was not found. It may have been deleted.' AS ResponseMess;
    ELSE
        SELECT 200 AS ResponseCode, N'Card deleted' AS ResponseMess;
END
GO

/* =====================================================================
   VERIFY AFTER APPLY (run by hand; uses CompId 1 / UserId 1 / BranchId 1 - change if needed)
   ===================================================================== */
-- SELECT OBJECT_ID('dbo.tblVisitingCard'), OBJECT_ID('dbo.sp_SaveVisitingCard'), OBJECT_ID('dbo.sp_FetchVisitingCards'), OBJECT_ID('dbo.sp_DeleteVisitingCard');
-- SELECT name, definition FROM sys.check_constraints WHERE name LIKE 'CK_tblGroupModule_%';   -- both contain 'cards'
-- SELECT Id, ParentId, Description, Route, Module FROM dbo.tblMenu WHERE Route = '/sales/visiting-cards';
--
-- DECLARE @g UNIQUEIDENTIFIER = '11111111-2222-3333-4444-555555555555', @t DATETIMEOFFSET = SYSDATETIMEOFFSET();
-- EXEC dbo.sp_SaveVisitingCard @Id=@g, @CompId=1, @UserId=1, @BranchId=1, @BusinessName=N'राम ट्रेडर्स', @ContactPerson=N'', @Designation=N'',
--      @Website=N'', @Gstin=N'', @Description=N'', @Other=N'', @Notes=N'', @Mobiles=N'["9825012345"]', @Landlines=N'[]', @Emails=N'[]',
--      @Addresses=N'[]', @FrontPath=N'cards/x/front-a.jpg', @AppCreatedAt=@t, @AppUpdatedAt=@t, @CanEditOthers=0;   -- Saved 1, 200
-- EXEC dbo.sp_SaveVisitingCard @Id=@g, @CompId=1, @UserId=1, @BranchId=1, @BusinessName=N'राम ट्रेडर्स', @ContactPerson=N'', @Designation=N'',
--      @Website=N'', @Gstin=N'', @Description=N'', @Other=N'', @Notes=N'', @Mobiles=N'[]', @Landlines=N'[]', @Emails=N'[]',
--      @Addresses=N'[]', @FrontPath=N'cards/x/front-a.jpg', @AppCreatedAt=@t, @AppUpdatedAt=@t, @CanEditOthers=0;   -- Saved 0, 200
-- EXEC dbo.sp_FetchVisitingCards @CompId=1, @Id=@g, @UserId=1;                 -- BusinessName = राम ट्रेडर्स unchanged
-- DECLARE @g2 UNIQUEIDENTIFIER = '11111111-2222-3333-4444-666666666666';
-- EXEC dbo.sp_SaveVisitingCard @Id=@g2, @CompId=1, @UserId=1, @BranchId=1, @BusinessName=N'500 Traders', @ContactPerson=N'', @Designation=N'',
--      @Website=N'', @Gstin=N'', @Description=N'', @Other=N'', @Notes=N'', @Mobiles=N'[]', @Landlines=N'[]', @Emails=N'[]',
--      @Addresses=N'[]', @FrontPath=N'cards/y/front-a.jpg', @AppCreatedAt=@t, @AppUpdatedAt=@t, @CanEditOthers=0;   -- Saved 1, 200
-- EXEC dbo.sp_FetchVisitingCards @CompId=1, @Id=NULL, @Search=N'50%', @UserId=1;  -- EXPECT: '500 Traders' NOT returned ('%' is literal; no card contains "50%")
-- EXEC dbo.sp_DeleteVisitingCard @Id=@g, @CompId=1, @UserId=1;                 -- 200
-- EXEC dbo.sp_DeleteVisitingCard @Id=@g, @CompId=1, @UserId=1;                 -- 200 again ('Already deleted'): same card twice is 200 both times
-- EXEC dbo.sp_FetchVisitingCards @CompId=1, @Id=@g, @UserId=1;                 -- no row
-- DELETE FROM dbo.tblVisitingCard WHERE Id IN (@g, @g2);                             -- cleanup
