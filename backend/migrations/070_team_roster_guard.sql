-- ============================================================================
-- 070_team_roster_guard.sql
--
-- Two fixes to the team procedures, both found by the test suite written for
-- teamController on 2026-08-04 (which had none before).
--
-- 1. A NAME-ONLY TEAM SAVE WIPES THE ROSTER.
--
--    sp_SaveTeam's update path does this, unconditionally:
--
--        DELETE FROM tblTeamMembers WHERE TeamId = @Id;
--        ...
--        IF (@Members IS NOT NULL AND @Members <> '')   <- re-insert only then
--
--    and teamController sends NULL whenever Members is absent or `[]`. So a
--    request that changes only the team name deletes every member. Worse, the
--    workspace cascade below it then reads the (now empty) @NewMembers table
--    and soft-removes those same users from every linked project workspace.
--    Silent, and the blast radius reaches well past tblTeamMembers.
--
--    The web form happens to be safe because it reloads the roster and posts
--    the whole array back every time — but that is luck, not design, and any
--    partial client walks straight into it.
--
--    This is the same "no opinion" vs "clear it" conflation sp_SaveTask already
--    solved with @HasAssigneeInput, and it is fixed the same way:
--
--        @Members NULL  -> leave the roster alone
--        @Members '[]'  -> clear it deliberately
--        @Members '[..]'-> replace it
--
--    The controller change lands with this: `[]` now serialises to '[]' rather
--    than NULL, so removing everyone from a team still works. Apply this script
--    and deploy together — until the backend deploys, an explicit "remove all"
--    from the web form silently does nothing (the safe direction).
--
-- 2. sp_FetchTeam LEAKS ACROSS BRANCHES WITHIN A COMPANY.
--
--    The @Id > 0 branch gates existence on CompId but then selects
--    `WHERE t.Id = @Id` with no branch predicate at all — while the list branch
--    right above it applies the full @UseScope filter. So a Branch- or
--    Self-scoped user cannot SEE a team from another branch in the list, but
--    can read it in full by asking for its id.
--
--    Not cross-company: the EXISTS check blocks that. Intra-company scope only.
--
-- Author: Claude  Date: 2026-08-04
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. sp_SaveTeam — the whole membership block becomes conditional
--
--    The DELETE moves INSIDE the block rather than staying in the @Id > 0
--    branch. On create @Id is already SCOPE_IDENTITY() by that point and the
--    table has no rows for it, so the delete is a harmless no-op there and the
--    two paths stop needing to differ.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_SaveTeam
    @Id           INT,
    @Name         VARCHAR(200),
    @Description  VARCHAR(500),
    @LeadUserId   INT,
    @Color        VARCHAR(10),
    @Members      NVARCHAR(MAX),
    @IsActive     BIT,
    @CompId       BIGINT,
    @BranchId     BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @MemberCount INT = 0;

    IF (@Name IS NULL OR LTRIM(RTRIM(@Name)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Team name is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@LeadUserId IS NOT NULL AND @LeadUserId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @LeadUserId AND IsActive = 1)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid team lead selected';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            INSERT INTO tblTeams (Name, Description, LeadUserId, Color, IsActive, CompId, BranchId)
            VALUES (@Name, @Description, @LeadUserId, @Color, @IsActive, @CompId, @BranchId);
            SET @Id = SCOPE_IDENTITY();
            SET @ResponseCode = 201; SET @ResponseMess = 'Team created successfully';
        END
        ELSE
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM tblTeams WHERE Id = @Id AND CompId = @CompId)
            BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Team not found';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
                  ROLLBACK TRANSACTION; RETURN; END
            UPDATE tblTeams
               SET Name = @Name, Description = @Description, LeadUserId = @LeadUserId,
                   Color = @Color, IsActive = @IsActive
             WHERE Id = @Id AND CompId = @CompId;
            SET @ResponseCode = 200; SET @ResponseMess = 'Team updated successfully';
        END

        -- ------------------------------------------------------------------
        -- Membership. Touched ONLY when the caller expressed an opinion.
        --
        -- NULL means "I am not editing the roster" — a rename, a colour
        -- change, a deactivate. '[]' means "remove everyone", and still works.
        -- ------------------------------------------------------------------
        IF (@Members IS NOT NULL)
        BEGIN
            DELETE FROM tblTeamMembers WHERE TeamId = @Id;

            DECLARE @NewMembers TABLE (UserId INT PRIMARY KEY);
            IF (@Members <> '')
                INSERT INTO @NewMembers (UserId)
                SELECT DISTINCT CAST(value AS INT)
                  FROM OPENJSON(@Members)
                 WHERE CAST(value AS INT) IN (SELECT Id FROM tblUser WHERE IsActive = 1);

            INSERT INTO tblTeamMembers (TeamId, UserId, JoinedDate, IsActive)
            SELECT @Id, UserId, GETDATE(), 1 FROM @NewMembers;
            SET @MemberCount = @@ROWCOUNT;

            -- Cascade: every project workspace linked to this team now mirrors
            -- the new member list. Owner + manager keep their roles; everyone
            -- else becomes 'member'. Users dropped from the team are soft-
            -- removed from those workspaces too.
            --
            -- Inside the guard for the same reason as the DELETE: with @Members
            -- NULL, @NewMembers is empty and this removed every member of every
            -- linked workspace on a rename.
            DECLARE @LinkedWorkspaces TABLE (Id BIGINT PRIMARY KEY);
            INSERT INTO @LinkedWorkspaces (Id)
            SELECT Id FROM dbo.tblWorkspaces
             WHERE TeamId = @Id AND Type = 'project' AND IsArchived = 0;

            -- Remove absent members from each workspace
            UPDATE wm
               SET IsActive = 0,
                   InviteStatus = 'removed',
                   RespondedDate = GETDATE()
              FROM dbo.tblWorkspaceMembers wm
             WHERE wm.WorkspaceId IN (SELECT Id FROM @LinkedWorkspaces)
               AND wm.UserId NOT IN (SELECT UserId FROM @NewMembers)
               AND wm.Role <> 'owner'
               AND wm.UserId <>
                   ISNULL((SELECT OwnerUserId FROM dbo.tblWorkspaces
                            WHERE Id = wm.WorkspaceId), -1);

            -- Insert newcomers + reactivate anyone who had been removed
            MERGE dbo.tblWorkspaceMembers AS tgt
            USING (
                SELECT lw.Id AS WorkspaceId, nm.UserId
                  FROM @LinkedWorkspaces lw
                  CROSS JOIN @NewMembers nm
            ) AS src
            ON (tgt.WorkspaceId = src.WorkspaceId AND tgt.UserId = src.UserId)
            WHEN MATCHED THEN
                UPDATE SET IsActive = 1,
                           InviteStatus = 'active',
                           RespondedDate = GETDATE()
            WHEN NOT MATCHED BY TARGET THEN
                INSERT (WorkspaceId, UserId, Role, AddedByUserId, IsActive, InviteStatus)
                VALUES (src.WorkspaceId, src.UserId, 'member', @LeadUserId, 1, 'active');
        END
        ELSE
        BEGIN
            -- Roster untouched. Report what is actually there, so the caller's
            -- "(N members)" audit line does not claim the team was emptied.
            SET @MemberCount = (SELECT COUNT(*) FROM tblTeamMembers
                                 WHERE TeamId = @Id AND IsActive = 1);
        END

        COMMIT TRANSACTION;
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @Id AS TeamId, @MemberCount AS MemberCount;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Error saving team: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO


-- ---------------------------------------------------------------------------
-- 2. sp_FetchTeam — the @Id > 0 branch gets the same scope as the list
--
--    ONE predicate changes: `WHERE t.Id = @Id` becomes the company + scope
--    filter the list branch already uses. Everything else is verbatim.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchTeam
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(100) = NULL
AS
BEGIN
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

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;
        SELECT @TotalRecords = COUNT(*)
        FROM tblTeams t
        LEFT JOIN tblUser u ON t.LeadUserId = u.Id
        WHERE t.CompId = @CompId
          AND ((@UseScope = 1 AND t.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0 AND (@IsAdmin = 1 OR t.BranchId = @BranchId)))
          AND (@SearchTerm IS NULL OR t.Name LIKE '%' + @SearchTerm + '%' OR t.Description LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%');
        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No teams found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Description, NULL AS LeadUserId,
                   NULL AS Color, NULL AS IsActive, NULL AS BranchId, NULL AS LeadName,
                   CAST(NULL AS NVARCHAR(MAX)) AS Members;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Teams retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   t.Id, t.Name, t.Description, t.LeadUserId, t.Color, t.IsActive, t.BranchId,
                   u.FullName AS LeadName,
                   (SELECT '[' + STRING_AGG(
                       '{' +
                           '"UserId":' + CAST(tm.UserId AS VARCHAR) + ',' +
                           '"FullName":"' + REPLACE(ISNULL(mu.FullName, ''), '"', '\"') + '",' +
                           '"Email":"'    + REPLACE(ISNULL(mu.Email, ''),    '"', '\"') + '",' +
                           '"JobTitle":"' + REPLACE(ISNULL(mu.JobTitle, ''), '"', '\"') + '",' +
                           '"JoinedDate":"' + CONVERT(VARCHAR, tm.JoinedDate, 23) + '",' +
                           '"IsActive":' + CAST(tm.IsActive AS VARCHAR) +
                       '}', ',') + ']'
                    FROM tblTeamMembers tm INNER JOIN tblUser mu ON tm.UserId = mu.Id
                    WHERE tm.TeamId = t.Id AND tm.IsActive = 1 AND mu.IsActive = 1) AS Members
            FROM tblTeams t
            LEFT JOIN tblUser u ON t.LeadUserId = u.Id
            WHERE t.CompId = @CompId
              AND ((@UseScope = 1 AND t.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0 AND (@IsAdmin = 1 OR t.BranchId = @BranchId)))
              AND (@SearchTerm IS NULL OR t.Name LIKE '%' + @SearchTerm + '%' OR t.Description LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%')
            ORDER BY t.Name
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        -- Scope applied here too. This used to be `WHERE t.Id = @Id` alone, so
        -- a branch-scoped user who could not see a team in the list could still
        -- read it in full by asking for its id.
        IF EXISTS (
            SELECT 1 FROM tblTeams t
             WHERE t.Id = @Id AND t.CompId = @CompId
               AND ((@UseScope = 1 AND t.BranchId IN (SELECT BranchId FROM @BranchIds))
                 OR (@UseScope = 0 AND (@IsAdmin = 1 OR t.BranchId = @BranchId)))
        )
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Team retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   t.Id, t.Name, t.Description, t.LeadUserId, t.Color, t.IsActive, t.BranchId,
                   u.FullName AS LeadName,
                   (SELECT '[' + STRING_AGG(
                       '{' +
                           '"UserId":' + CAST(tm.UserId AS VARCHAR) + ',' +
                           '"FullName":"' + REPLACE(ISNULL(mu.FullName, ''), '"', '\"') + '",' +
                           '"Email":"'    + REPLACE(ISNULL(mu.Email, ''),    '"', '\"') + '",' +
                           '"JobTitle":"' + REPLACE(ISNULL(mu.JobTitle, ''), '"', '\"') + '",' +
                           '"JoinedDate":"' + CONVERT(VARCHAR, tm.JoinedDate, 23) + '",' +
                           '"IsActive":' + CAST(tm.IsActive AS VARCHAR) +
                       '}', ',') + ']'
                    FROM tblTeamMembers tm INNER JOIN tblUser mu ON tm.UserId = mu.Id
                    WHERE tm.TeamId = t.Id AND tm.IsActive = 1 AND mu.IsActive = 1) AS Members
            FROM tblTeams t
            LEFT JOIN tblUser u ON t.LeadUserId = u.Id
            WHERE t.Id = @Id AND t.CompId = @CompId;
        END
        ELSE
        BEGIN
            -- Same 404 for "does not exist" and "outside your scope", so the
            -- endpoint cannot be walked as an id oracle.
            SET @ResponseCode = 404; SET @ResponseMess = 'Team not found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Description, NULL AS LeadUserId,
                   NULL AS Color, NULL AS IsActive, NULL AS BranchId, NULL AS LeadName,
                   CAST(NULL AS NVARCHAR(MAX)) AS Members;
        END
    END
END
GO


-- ============================================================================
-- VERIFY AFTER APPLY — creates a team, edits its name only, checks the roster
-- survived, then clears it deliberately. Rolled back; leaves nothing behind.
--
-- Expected, in order:
--   1. 201 'Team created successfully', MemberCount = 2
--   2. 200 'Team updated successfully', MemberCount = 2   <- NULL left it alone
--   3. roster_after_rename = 2                            <- THE FIX
--   4. 200 'Team updated successfully', MemberCount = 0   <- '[]' cleared it
--   5. roster_after_clear = 0                             <- clearing still works
-- ============================================================================
BEGIN TRANSACTION;
    DECLARE @cid BIGINT, @bid BIGINT, @u1 INT, @u2 INT, @tid INT;

    SELECT TOP 1 @cid = CompId, @bid = BranchId FROM tblUser WHERE IsActive = 1;
    SELECT TOP 2 @u1 = MIN(Id), @u2 = MAX(Id)
      FROM (SELECT TOP 2 Id FROM tblUser WHERE IsActive = 1 ORDER BY Id) x;

    IF @u1 IS NULL OR @u1 = @u2
        SELECT 'SKIPPED - need two active users to test with' AS Note;
    ELSE
    BEGIN
        DECLARE @out TABLE (ResponseCode INT, ResponseMess VARCHAR(400),
                            TeamId INT, MemberCount INT);

        INSERT INTO @out
        EXEC dbo.sp_SaveTeam @Id = 0, @Name = 'verify-070', @Description = 'tmp',
             @LeadUserId = NULL, @Color = '#fff',
             @Members = NULL, @IsActive = 1, @CompId = @cid, @BranchId = @bid;
        SELECT @tid = TeamId FROM @out;
        -- seed the roster directly; the create path is not what is under test
        INSERT INTO tblTeamMembers (TeamId, UserId, JoinedDate, IsActive)
        VALUES (@tid, @u1, GETDATE(), 1), (@tid, @u2, GETDATE(), 1);

        -- (2) rename only — @Members omitted
        EXEC dbo.sp_SaveTeam @Id = @tid, @Name = 'verify-070-renamed', @Description = 'tmp',
             @LeadUserId = NULL, @Color = '#fff',
             @Members = NULL, @IsActive = 1, @CompId = @cid, @BranchId = @bid;

        -- (3) THE FIX: 2, not 0
        SELECT COUNT(*) AS roster_after_rename FROM tblTeamMembers WHERE TeamId = @tid;

        -- (4) explicit clear
        EXEC dbo.sp_SaveTeam @Id = @tid, @Name = 'verify-070-renamed', @Description = 'tmp',
             @LeadUserId = NULL, @Color = '#fff',
             @Members = '[]', @IsActive = 1, @CompId = @cid, @BranchId = @bid;

        -- (5) 0 — clearing still works
        SELECT COUNT(*) AS roster_after_clear FROM tblTeamMembers WHERE TeamId = @tid;
    END
ROLLBACK TRANSACTION;
