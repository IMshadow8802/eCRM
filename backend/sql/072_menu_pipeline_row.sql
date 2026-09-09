-- ============================================================================
-- 072_menu_pipeline_row.sql
--
-- The sidebar is DB-driven (tblMenu). 071 removed the lead pipeline; the
-- 'Pipeline' row (Id 15, /sales/pipeline) would still render and land on a
-- redirect. The 'Pipeline Funnel' report row (Id 20) becomes Leads by Status.
-- Menu rights load at LOGIN — users re-login to see the change.
--
-- APPLY BY HAND. Idempotent. Author: Claude  Date: 2026-09-08
-- ============================================================================
DELETE FROM dbo.tblGroupAccess WHERE MenuId = 15;
DELETE FROM dbo.tblMenu WHERE Id = 15 AND Route = '/sales/pipeline';

UPDATE dbo.tblMenu
SET Description = 'Leads by Status', Route = '/reports/leads-by-status'
WHERE Id = 20 AND Route = '/reports/pipeline-funnel';

-- verify: 15 absent; 20 renamed; Sales children = Leads (16) + Follow-ups (33)
SELECT Id, ParentId, Description, Route FROM dbo.tblMenu
WHERE Id IN (14, 15, 16, 20, 33) ORDER BY Id;
GO

-- ---------------------------------------------------------------------------
-- sp_FetchFollowUpLead — one row: the follow-up plus its lead's visibility
-- columns. The complete / skip / delete endpoints need to know WHOSE lead a
-- follow-up belongs to before they touch it; sp_FetchFollowUps has no @Id mode
-- and the mutating SPs are CompId-scoped only. This is the cheapest gate: one
-- read, then canSeeRecord in Node against BranchId / OwnerId / CreatedBy.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchFollowUpLead
    @CompId INT,
    @Id     INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT f.Id, f.LeadId, f.Status, f.AssignedTo,
           l.BranchId, l.OwnerId, l.CreatedBy
    FROM dbo.tblFollowUp f
    JOIN dbo.tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
    WHERE f.Id = @Id AND f.CompId = @CompId;
END
GO

-- ---------------------------------------------------------------------------
-- sp_FetchBranches — the branch pick-list for cross-branch transfers. Nothing
-- served it before (tblBranch has no CompId; one company today).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchBranches
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, BranchName FROM dbo.tblBranch ORDER BY BranchName;
END
GO
SELECT name FROM sys.procedures WHERE name IN ('sp_FetchFollowUpLead','sp_FetchBranches');   -- expect 2 rows
