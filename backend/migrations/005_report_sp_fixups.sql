-- ============================================================
-- Migration 005 — fix report SPs referencing tblUser.UserID
-- (mixed-case which my Phase-2 case-sensitive grep missed).
-- Apply AFTER migrations 003.
-- ============================================================

USE [eCRM+]
GO

ALTER PROCEDURE sp_FollowupsListUserWise
(
    @StartDate DATE,
    @EndDate   DATE
)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        U.Username      AS UserName,   -- output alias preserved for backward-compat
        B.BranchName,
        COUNT(*) AS TodayFollowups
    FROM tblLeads L
    LEFT JOIN tblUser   U ON L.AssignTo = U.Id
    LEFT JOIN tblBranch B ON L.BranchId = B.Id
    WHERE CAST(L.FollowupDate AS DATE) BETWEEN @StartDate AND @EndDate
    GROUP BY U.Username, B.BranchName;
END
GO

ALTER PROCEDURE sp_LeadsUserWise
(
    @StartDate DATE,
    @EndDate   DATE
)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        U.Username AS UserName,
        COUNT(L.Id) AS TotalLeads
    FROM tblLeads L
    LEFT JOIN tblUser U ON L.AssignTo = U.Id
    WHERE CAST(L.LeadDate AS DATE) BETWEEN @StartDate AND @EndDate
    GROUP BY U.Username;
END
GO

PRINT '✓ Report SPs fixed up';
GO
